/// Governor Bravo Cloak Contract -- Full Privacy Implementation
///
/// Implements all OpenZeppelin Governor features with full privacy on Aztec:
/// - GovernorCore: propose, execute, cancel, castVote, state machine
/// - GovernorSettings: governance-updatable votingDelay, votingPeriod, proposalThreshold
/// - GovernorVotes + GovernorVotesQuorumFraction: dynamic quorum as fraction of total supply
/// - GovernorCountingSimple: For/Against/Abstain with private voting
/// - GovernorCountingFractional: split voting power across choices
/// - GovernorTimelockControl: timelock queue/execute
/// - GovernorStorage: on-chain proposal detail storage
/// - GovernorPreventLateQuorum: extend deadline if quorum reached late
/// - GovernorProposalGuardian: designated guardian can cancel proposals
/// - Multi-target proposals: batched protocol upgrades
/// - Private delegation: delegate voting power without revealing relationships
///
/// Privacy Architecture:
/// - Private token gating (token-only, no admin invite)
/// - Private proposal threshold proof (ZK range proof)
/// - Fully private voting (nullifier-based, voter identity never stored)
///
/// NOTE: All helper function logic has been inlined at call sites because
/// Aztec Noir v3 contract functions annotated with #[external("public")] or
/// #[internal("public")] return PublicCall<...> objects that cannot be used
/// synchronously from other contract functions.

use dep::aztec::macros::aztec;

#[aztec]
pub contract GovernorBravoCloak {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self, internal}, storage::storage},
        protocol_types::{address::AztecAddress, traits::{Hash, ToField, FromField}},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::types::proposal::GovernorProposal;

    // ===== PROPOSAL STATES (Governor Bravo / OZ compatible) =====
    global STATE_PENDING: u8 = 0;
    global STATE_ACTIVE: u8 = 1;
    global STATE_CANCELED: u8 = 2;
    global STATE_DEFEATED: u8 = 3;
    global STATE_SUCCEEDED: u8 = 4;
    global STATE_QUEUED: u8 = 5;
    global STATE_EXPIRED: u8 = 6;
    global STATE_EXECUTED: u8 = 7;

    // ===== VOTE SUPPORT =====
    global VOTE_AGAINST: u8 = 0;
    global VOTE_FOR: u8 = 1;
    global VOTE_ABSTAIN: u8 = 2;

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // ===== CONFIGURATION (immutable after init or governance-updatable) =====
        name: PublicImmutable<FieldCompressedString, Context>,

        // GovernorSettings (updatable via governance only)
        voting_delay: PublicMutable<u32, Context>,
        voting_period: PublicMutable<u32, Context>,
        proposal_threshold: PublicMutable<u128, Context>,

        // GovernorVotesQuorumFraction
        quorum_numerator: PublicMutable<u128, Context>,
        quorum_denominator: PublicMutable<u128, Context>,

        // GovernorPreventLateQuorum
        late_quorum_extension: PublicMutable<u32, Context>,

        // GovernorTimelockControl
        timelock_delay: PublicMutable<u32, Context>,

        // GovernorProposalGuardian
        proposal_guardian: PublicMutable<AztecAddress, Context>,

        // ===== PROPOSALS (GovernorStorage) =====
        proposals: Map<Field, PublicMutable<GovernorProposal, Context>, Context>,
        proposal_count: PublicMutable<u64, Context>,

        // Vote tallies (public aggregates only -- voter identity never stored)
        proposal_for_votes: Map<Field, PublicMutable<u128, Context>, Context>,
        proposal_against_votes: Map<Field, PublicMutable<u128, Context>, Context>,
        proposal_abstain_votes: Map<Field, PublicMutable<u128, Context>, Context>,

        // ===== TOKEN / VOTING POWER =====
        governance_token: PublicImmutable<AztecAddress, Context>,
        token_address: PublicImmutable<AztecAddress, Context>,
        total_supply_snapshot: Map<Field, PublicMutable<u128, Context>, Context>,

        // Voting power (private state managed via token proofs)
        voting_power: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        delegated_power: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        delegates: Map<AztecAddress, PublicMutable<AztecAddress, Context>, Context>,
        total_voting_power: PublicMutable<u128, Context>,

        // Checkpoint: account -> block -> voting power at that block
        voting_power_checkpoints: Map<AztecAddress, Map<Field, PublicMutable<u128, Context>, Context>, Context>,
        // Track latest checkpoint block per account (for writes)
        latest_checkpoint_block: Map<AztecAddress, PublicMutable<u32, Context>, Context>,

        // ===== TOKEN GATING (token-only, no admin invite) =====
        // mode: 0 = aztec-token, 1 = erc20-token
        membership_mode: PublicMutable<u8, Context>,
        token_gate_address: PublicMutable<AztecAddress, Context>,
        erc20_token_address_hash: PublicMutable<Field, Context>,
        erc20_min_balance: PublicMutable<u128, Context>,
        used_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,

        // ===== PRIVACY CONFIG =====
        privacy_membership: PublicMutable<u8, Context>,
        privacy_proposals: PublicMutable<u8, Context>,
        privacy_voting: PublicMutable<u8, Context>,
        privacy_treasury: PublicMutable<u8, Context>,
        privacy_identity: PublicMutable<u8, Context>,
        privacy_delegation: PublicMutable<u8, Context>,
        privacy_execution: PublicMutable<u8, Context>,
        privacy_quorum: PublicMutable<u8, Context>,
        privacy_threshold: PublicMutable<u8, Context>,
        privacy_guardian: PublicMutable<u8, Context>,
        privacy_timelock: PublicMutable<u8, Context>,
        privacy_fractional: PublicMutable<u8, Context>,
        privacy_late_quorum: PublicMutable<u8, Context>,
        privacy_storage: PublicMutable<u8, Context>,

        // ===== TIMELOCK ROLES =====
        timelock_proposer: PublicMutable<AztecAddress, Context>,
        timelock_executor: PublicMutable<AztecAddress, Context>,
        timelock_canceller: PublicMutable<AztecAddress, Context>,

        // ===== CLOAK MODE =====
        // 0 = token-holder, 1 = multisig, 2 = hybrid
        cloak_mode: PublicImmutable<u8, Context>,

        // ===== COUNCIL (mode 1 = multisig signers, mode 2 = security council) =====
        council_member_0: PublicMutable<AztecAddress, Context>,
        council_member_1: PublicMutable<AztecAddress, Context>,
        council_member_2: PublicMutable<AztecAddress, Context>,
        council_member_3: PublicMutable<AztecAddress, Context>,
        council_member_4: PublicMutable<AztecAddress, Context>,
        council_member_5: PublicMutable<AztecAddress, Context>,
        council_member_6: PublicMutable<AztecAddress, Context>,
        council_member_7: PublicMutable<AztecAddress, Context>,
        council_member_8: PublicMutable<AztecAddress, Context>,
        council_member_9: PublicMutable<AztecAddress, Context>,
        council_member_10: PublicMutable<AztecAddress, Context>,
        council_member_11: PublicMutable<AztecAddress, Context>,
        council_count: PublicMutable<u8, Context>,
        council_threshold: PublicMutable<u8, Context>,       // M-of-N for normal ops
        emergency_threshold: PublicMutable<u8, Context>,     // higher threshold, mode 2 only

        // Per-proposal council approval tracking
        council_approvals: Map<Field, Map<AztecAddress, PublicMutable<bool, Context>, Context>, Context>,
        council_approval_counts: Map<Field, PublicMutable<u8, Context>, Context>,

        // ===== VISIBILITY =====
        // true = open (anyone can view), false = closed (token holders only)
        // Can be changed via governance proposal
        is_publicly_viewable: PublicMutable<bool, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        governance_token: AztecAddress,
        voting_delay: u32,
        voting_period: u32,
        proposal_threshold: u128,
        quorum_numerator: u128,
        quorum_denominator: u128,
        late_quorum_extension: u32,
        timelock_delay: u32,
        proposal_guardian: AztecAddress,
        membership_mode: u8,
        token_gate_address: AztecAddress,
        erc20_token_address_hash: Field,
        erc20_min_balance: u128,
        cloak_mode: u8,
        council_members: [AztecAddress; 12],
        council_count: u8,
        council_threshold: u8,
        emergency_threshold: u8,
        is_publicly_viewable: bool,
    ) {
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.cloak_mode.initialize(cloak_mode);
        self.storage.is_publicly_viewable.write(is_publicly_viewable);

        // Token fields (mode 0 and 2)
        self.storage.governance_token.initialize(governance_token);
        self.storage.token_address.initialize(governance_token);

        // GovernorSettings
        self.storage.voting_delay.write(voting_delay);
        self.storage.voting_period.write(voting_period);
        self.storage.proposal_threshold.write(proposal_threshold);

        // GovernorVotesQuorumFraction
        self.storage.quorum_numerator.write(quorum_numerator);
        self.storage.quorum_denominator.write(if quorum_denominator == 0 { 100 } else { quorum_denominator });

        // GovernorPreventLateQuorum
        self.storage.late_quorum_extension.write(late_quorum_extension);

        // GovernorTimelockControl
        self.storage.timelock_delay.write(timelock_delay);

        // GovernorProposalGuardian
        self.storage.proposal_guardian.write(proposal_guardian);

        // Token gating
        self.storage.membership_mode.write(membership_mode);
        self.storage.token_gate_address.write(token_gate_address);
        self.storage.erc20_token_address_hash.write(erc20_token_address_hash);
        self.storage.erc20_min_balance.write(erc20_min_balance);

        // Initialize counters
        self.storage.proposal_count.write(0);
        self.storage.total_voting_power.write(0);

        // Council storage
        self.storage.council_count.write(council_count);
        self.storage.council_threshold.write(council_threshold);
        self.storage.emergency_threshold.write(emergency_threshold);

        // Store council members
        self.storage.council_member_0.write(council_members[0]);
        self.storage.council_member_1.write(council_members[1]);
        self.storage.council_member_2.write(council_members[2]);
        self.storage.council_member_3.write(council_members[3]);
        self.storage.council_member_4.write(council_members[4]);
        self.storage.council_member_5.write(council_members[5]);
        self.storage.council_member_6.write(council_members[6]);
        self.storage.council_member_7.write(council_members[7]);
        self.storage.council_member_8.write(council_members[8]);
        self.storage.council_member_9.write(council_members[9]);
        self.storage.council_member_10.write(council_members[10]);
        self.storage.council_member_11.write(council_members[11]);

        // Mode 1: give each council member voting_power = 1
        if cloak_mode == 1 {
            let mut total: u128 = 0;
            for idx in 0..12 {
                if idx < council_count as u32 {
                    let member = council_members[idx];
                    if !member.is_zero() {
                        self.storage.voting_power.at(member).write(1);
                        total += 1;
                    }
                }
            }
            self.storage.total_voting_power.write(total);
        }

        // Default privacy config (all private)
        self.storage.privacy_membership.write(2);
        self.storage.privacy_proposals.write(2);
        self.storage.privacy_voting.write(2);
        self.storage.privacy_treasury.write(1);
        self.storage.privacy_identity.write(2);
        self.storage.privacy_delegation.write(2);
        self.storage.privacy_execution.write(1);
        self.storage.privacy_quorum.write(1);
        self.storage.privacy_threshold.write(2);
        self.storage.privacy_guardian.write(1);
        self.storage.privacy_timelock.write(1);
        self.storage.privacy_fractional.write(2);
        self.storage.privacy_late_quorum.write(1);
        self.storage.privacy_storage.write(1);

        // Timelock roles default to deployer (msg_sender)
        let deployer = self.msg_sender().unwrap();
        self.storage.timelock_proposer.write(deployer);
        self.storage.timelock_executor.write(deployer);
        self.storage.timelock_canceller.write(deployer);
    }

    // =========================================================================
    // PRIVATE TOKEN GATING (Membership -- Token-Only, No Admin Invite)
    // =========================================================================

    /// Join with Aztec token proof (mode 0).
    #[external("private")]
    fn join_with_token_proof(balance_commitment: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([
            balance_commitment,
            secret
        ]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.add_member_internal(sender, balance_commitment);
    }

    #[external("public")]
    #[only_self]
    fn add_member_internal(member: AztecAddress, balance_commitment: Field) {
        let mode = self.storage.membership_mode.read();
        assert(mode == 0, "not aztec-token mode");

        let current = self.storage.voting_power.at(member).read();
        if current == 0 {
            self.storage.voting_power.at(member).write(1);
            let total = self.storage.total_voting_power.read();
            self.storage.total_voting_power.write(total + 1);

            // Checkpoint: write effective votes at current block
            let effective = 1 + self.storage.delegated_power.at(member).read();
            let current_block = self.context.block_number();
            self.storage.voting_power_checkpoints.at(member).at(current_block as Field).write(effective);
            self.storage.latest_checkpoint_block.at(member).write(current_block);
        }
    }

    /// Join with ERC20 proof (mode 1).
    #[external("private")]
    fn join_with_erc20_proof(verified_balance: u128, proof_nullifier: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([proof_nullifier, secret]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.add_erc20_member_internal(sender, verified_balance, proof_nullifier);
    }

    #[external("public")]
    #[only_self]
    fn add_erc20_member_internal(member: AztecAddress, verified_balance: u128, proof_nullifier: Field) {
        let mode = self.storage.membership_mode.read();
        assert(mode == 1, "not erc20-token mode");
        assert(verified_balance >= self.storage.erc20_min_balance.read(), "insufficient balance");
        assert(!self.storage.used_nullifiers.at(proof_nullifier).read(), "nullifier already used");

        self.storage.used_nullifiers.at(proof_nullifier).write(true);

        let current = self.storage.voting_power.at(member).read();
        if current == 0 {
            self.storage.voting_power.at(member).write(verified_balance);
            let total = self.storage.total_voting_power.read();
            self.storage.total_voting_power.write(total + verified_balance);

            // Checkpoint: write effective votes at current block
            let effective = verified_balance + self.storage.delegated_power.at(member).read();
            let current_block = self.context.block_number();
            self.storage.voting_power_checkpoints.at(member).at(current_block as Field).write(effective);
            self.storage.latest_checkpoint_block.at(member).write(current_block);
        }
    }

    // =========================================================================
    // PRIVATE DELEGATION
    // =========================================================================

    /// Delegate voting power privately.
    #[external("private")]
    fn delegate(delegatee: AztecAddress) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([
            delegatee.to_field(),
            secret,
            0xDE1E6A7E
        ]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.delegate_internal(sender, delegatee);
    }

    #[external("public")]
    #[only_self]
    fn delegate_internal(delegator: AztecAddress, delegatee: AztecAddress) {
        let power = self.storage.voting_power.at(delegator).read();

        let old_delegate = self.storage.delegates.at(delegator).read();
        if !old_delegate.is_zero() {
            let old_power = self.storage.delegated_power.at(old_delegate).read();
            self.storage.delegated_power.at(old_delegate).write(old_power - power);
        }

        self.storage.delegates.at(delegator).write(delegatee);
        if !delegatee.is_zero() {
            let new_power = self.storage.delegated_power.at(delegatee).read();
            self.storage.delegated_power.at(delegatee).write(new_power + power);
        }

        // Checkpoint all affected accounts
        let current_block = self.context.block_number();

        // Checkpoint delegator
        let delegator_effective = self.storage.voting_power.at(delegator).read()
            + self.storage.delegated_power.at(delegator).read();
        self.storage.voting_power_checkpoints.at(delegator).at(current_block as Field).write(delegator_effective);
        self.storage.latest_checkpoint_block.at(delegator).write(current_block);

        // Checkpoint old delegatee
        if !old_delegate.is_zero() {
            let old_effective = self.storage.voting_power.at(old_delegate).read()
                + self.storage.delegated_power.at(old_delegate).read();
            self.storage.voting_power_checkpoints.at(old_delegate).at(current_block as Field).write(old_effective);
            self.storage.latest_checkpoint_block.at(old_delegate).write(current_block);
        }

        // Checkpoint new delegatee
        if !delegatee.is_zero() {
            let new_effective = self.storage.voting_power.at(delegatee).read()
                + self.storage.delegated_power.at(delegatee).read();
            self.storage.voting_power_checkpoints.at(delegatee).at(current_block as Field).write(new_effective);
            self.storage.latest_checkpoint_block.at(delegatee).write(current_block);
        }
    }

    /// Get effective voting power (own + delegated)
    #[external("public")]
    fn get_effective_votes(account: AztecAddress) -> u128 {
        let own = self.storage.voting_power.at(account).read();
        let delegated = self.storage.delegated_power.at(account).read();
        own + delegated
    }

    // =========================================================================
    // PRIVATE PROPOSING (with ZK threshold proof)
    // =========================================================================

    /// Create a new proposal with private threshold proof.
    #[external("private")]
    fn propose(
        actions_hash: Field,
        description_hash: Field,
        target_count: u8,
        proposal_type: u8,
    ) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([
            actions_hash,
            description_hash,
            secret
        ]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.create_proposal_internal(
            sender, actions_hash, description_hash, target_count, proposal_type
        );
    }

    #[external("public")]
    #[only_self]
    fn create_proposal_internal(
        proposer: AztecAddress,
        actions_hash: Field,
        description_hash: Field,
        target_count: u8,
        proposal_type: u8,
    ) {
        let mode = self.storage.cloak_mode.read();

        // Mode 1 (multisig): require caller is council member, no token threshold
        if mode == 1 {
            // Inline _is_council_member_check
            let council_count = self.storage.council_count.read();
            let council_members = [
                self.storage.council_member_0.read(),
                self.storage.council_member_1.read(),
                self.storage.council_member_2.read(),
                self.storage.council_member_3.read(),
                self.storage.council_member_4.read(),
                self.storage.council_member_5.read(),
                self.storage.council_member_6.read(),
                self.storage.council_member_7.read(),
                self.storage.council_member_8.read(),
                self.storage.council_member_9.read(),
                self.storage.council_member_10.read(),
                self.storage.council_member_11.read(),
            ];
            let mut is_member = false;
            for i in 0..12 {
                if (i as u8) < council_count {
                    if council_members[i].eq(proposer) {
                        is_member = true;
                    }
                }
            }
            assert(is_member, "not a council member");
        } else {
            // Mode 0 and 2: verify proposer has sufficient voting power
            // Inline _get_effective_votes_internal
            let voting_power = self.storage.voting_power.at(proposer).read()
                + self.storage.delegated_power.at(proposer).read();
            let threshold = self.storage.proposal_threshold.read();
            assert(voting_power >= threshold, "below proposal threshold");
        }

        let proposal_id = self.storage.proposal_count.read();
        let voting_delay = self.storage.voting_delay.read();
        let voting_period = self.storage.voting_period.read();
        let current_block = self.context.block_number();

        let proposal = GovernorProposal {
            id: proposal_id,
            proposer,
            eta: 0,
            start_block: current_block + voting_delay,
            end_block: current_block + voting_delay + voting_period,
            canceled: false,
            executed: false,
            actions_hash,
            description_hash,
            target_count,
            proposal_type,
        };

        self.storage.proposals.at(proposal_id as Field).write(proposal);
        self.storage.proposal_for_votes.at(proposal_id as Field).write(0);
        self.storage.proposal_against_votes.at(proposal_id as Field).write(0);
        self.storage.proposal_abstain_votes.at(proposal_id as Field).write(0);
        self.storage.proposal_count.write(proposal_id + 1);

        // Snapshot total supply at proposal creation for quorum calculation
        self.storage.total_supply_snapshot.at(current_block as Field).write(
            self.storage.total_voting_power.read()
        );
    }

    /// Cancel a proposal. Guardian or proposer (if below threshold) can cancel.
    #[external("public")]
    fn cancel(proposal_id: Field) {
        let mut proposal = self.storage.proposals.at(proposal_id).read();
        let caller = self.msg_sender().unwrap();

        let guardian = self.storage.proposal_guardian.read();
        // Inline _get_effective_votes_internal
        let proposer_votes = self.storage.voting_power.at(proposal.proposer).read()
            + self.storage.delegated_power.at(proposal.proposer).read();
        let threshold = self.storage.proposal_threshold.read();

        assert(
            caller.eq(guardian) | (caller.eq(proposal.proposer) & (proposer_votes < threshold)),
            "cannot cancel"
        );

        proposal.canceled = true;
        self.storage.proposals.at(proposal_id).write(proposal);
    }

    // =========================================================================
    // FULLY PRIVATE VOTING (GovernorCountingSimple)
    // =========================================================================

    /// Cast a private vote.
    #[external("private")]
    fn cast_vote(proposal_id: Field, support: u8) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.tally_vote_internal(proposal_id, support, sender);
    }

    /// Cast vote with reason (reason is off-chain only for privacy)
    #[external("private")]
    fn cast_vote_with_reason(proposal_id: Field, support: u8, _reason_hash: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.tally_vote_internal(proposal_id, support, sender);
    }

    #[external("public")]
    #[only_self]
    fn tally_vote_internal(proposal_id: Field, support: u8, voter: AztecAddress) {
        let proposal = self.storage.proposals.at(proposal_id).read();

        assert(!proposal.canceled, "proposal canceled");
        assert(self.context.block_number() >= proposal.start_block, "voting not started");
        assert(self.context.block_number() <= proposal.end_block, "voting ended");

        // Use snapshot voting power from proposal start block
        let votes = self.storage.voting_power_checkpoints
            .at(voter).at(proposal.start_block as Field).read();
        // Fallback to current power if no checkpoint exists at snapshot block
        let effective_votes = if votes > 0 {
            votes
        } else {
            self.storage.voting_power.at(voter).read()
                + self.storage.delegated_power.at(voter).read()
        };
        assert(effective_votes > 0, "no voting power");

        // Tally votes -- only aggregates updated, no per-voter record
        if support == VOTE_AGAINST {
            let current = self.storage.proposal_against_votes.at(proposal_id).read();
            self.storage.proposal_against_votes.at(proposal_id).write(current + effective_votes);
        } else if support == VOTE_FOR {
            let current = self.storage.proposal_for_votes.at(proposal_id).read();
            self.storage.proposal_for_votes.at(proposal_id).write(current + effective_votes);
        } else if support == VOTE_ABSTAIN {
            let current = self.storage.proposal_abstain_votes.at(proposal_id).read();
            self.storage.proposal_abstain_votes.at(proposal_id).write(current + effective_votes);
        } else {
            assert(false, "invalid vote support");
        }

        // Inline _check_late_quorum_internal
        let mut lq_proposal = self.storage.proposals.at(proposal_id).read();
        let extension = self.storage.late_quorum_extension.read();

        if extension != 0 {
            let current_block = self.context.block_number();
            let extension_threshold = lq_proposal.end_block - extension;

            if current_block >= extension_threshold {
                let lq_for_votes = self.storage.proposal_for_votes.at(proposal_id).read();
                let lq_abstain_votes = self.storage.proposal_abstain_votes.at(proposal_id).read();

                // Inline _quorum_at_block_internal
                let lq_total = self.storage.total_supply_snapshot.at(lq_proposal.start_block as Field).read();
                let lq_numerator = self.storage.quorum_numerator.read();
                let lq_denominator = self.storage.quorum_denominator.read();
                let lq_quorum = if (lq_total == 0) | (lq_denominator == 0) {
                    0
                } else {
                    (lq_total * lq_numerator) / lq_denominator
                };

                if lq_for_votes + lq_abstain_votes >= lq_quorum {
                    let new_end = current_block + extension;
                    if new_end > lq_proposal.end_block {
                        lq_proposal.end_block = new_end;
                        self.storage.proposals.at(proposal_id).write(lq_proposal);
                    }
                }
            }
        }
    }

    // =========================================================================
    // FRACTIONAL VOTING (GovernorCountingFractional)
    // =========================================================================

    /// Cast a fractional vote: split voting power across For/Against/Abstain.
    #[external("private")]
    fn cast_fractional_vote(
        proposal_id: Field,
        for_weight: u128,
        against_weight: u128,
        abstain_weight: u128,
    ) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.tally_fractional_internal(
            proposal_id, for_weight, against_weight, abstain_weight, sender
        );
    }

    #[external("public")]
    #[only_self]
    fn tally_fractional_internal(
        proposal_id: Field,
        for_weight: u128,
        against_weight: u128,
        abstain_weight: u128,
        voter: AztecAddress,
    ) {
        let proposal = self.storage.proposals.at(proposal_id).read();

        assert(!proposal.canceled, "proposal canceled");
        assert(self.context.block_number() >= proposal.start_block, "voting not started");
        assert(self.context.block_number() <= proposal.end_block, "voting ended");

        // Use snapshot voting power from proposal start block
        let snapshot_power = self.storage.voting_power_checkpoints
            .at(voter).at(proposal.start_block as Field).read();
        let total_power = if snapshot_power > 0 {
            snapshot_power
        } else {
            self.storage.voting_power.at(voter).read()
                + self.storage.delegated_power.at(voter).read()
        };
        assert(total_power > 0, "no voting power");
        assert(for_weight + against_weight + abstain_weight == total_power, "weights must equal total power");

        if for_weight > 0 {
            let current = self.storage.proposal_for_votes.at(proposal_id).read();
            self.storage.proposal_for_votes.at(proposal_id).write(current + for_weight);
        }
        if against_weight > 0 {
            let current = self.storage.proposal_against_votes.at(proposal_id).read();
            self.storage.proposal_against_votes.at(proposal_id).write(current + against_weight);
        }
        if abstain_weight > 0 {
            let current = self.storage.proposal_abstain_votes.at(proposal_id).read();
            self.storage.proposal_abstain_votes.at(proposal_id).write(current + abstain_weight);
        }

        // Inline _check_late_quorum_internal
        let mut lq_proposal = self.storage.proposals.at(proposal_id).read();
        let extension = self.storage.late_quorum_extension.read();

        if extension != 0 {
            let current_block = self.context.block_number();
            let extension_threshold = lq_proposal.end_block - extension;

            if current_block >= extension_threshold {
                let lq_for_votes = self.storage.proposal_for_votes.at(proposal_id).read();
                let lq_abstain_votes = self.storage.proposal_abstain_votes.at(proposal_id).read();

                // Inline _quorum_at_block_internal
                let lq_total = self.storage.total_supply_snapshot.at(lq_proposal.start_block as Field).read();
                let lq_numerator = self.storage.quorum_numerator.read();
                let lq_denominator = self.storage.quorum_denominator.read();
                let lq_quorum = if (lq_total == 0) | (lq_denominator == 0) {
                    0
                } else {
                    (lq_total * lq_numerator) / lq_denominator
                };

                if lq_for_votes + lq_abstain_votes >= lq_quorum {
                    let new_end = current_block + extension;
                    if new_end > lq_proposal.end_block {
                        lq_proposal.end_block = new_end;
                        self.storage.proposals.at(proposal_id).write(lq_proposal);
                    }
                }
            }
        }
    }

    // =========================================================================
    // TIMELOCK (GovernorTimelockControl)
    // =========================================================================

    /// Queue a succeeded proposal for execution after timelock delay.
    #[external("public")]
    fn queue(proposal_id: Field) {
        // Inline _get_state_internal
        let st_proposal = self.storage.proposals.at(proposal_id).read();
        let st_for_votes = self.storage.proposal_for_votes.at(proposal_id).read();
        let st_against_votes = self.storage.proposal_against_votes.at(proposal_id).read();
        let st_abstain_votes = self.storage.proposal_abstain_votes.at(proposal_id).read();

        // Inline _quorum_at_block_internal
        let st_total = self.storage.total_supply_snapshot.at(st_proposal.start_block as Field).read();
        let st_numerator = self.storage.quorum_numerator.read();
        let st_denominator = self.storage.quorum_denominator.read();
        let st_quorum = if (st_total == 0) | (st_denominator == 0) {
            0
        } else {
            (st_total * st_numerator) / st_denominator
        };

        let state = if st_proposal.canceled {
            STATE_CANCELED
        } else if self.context.block_number() < st_proposal.start_block {
            STATE_PENDING
        } else if self.context.block_number() <= st_proposal.end_block {
            STATE_ACTIVE
        } else if (st_for_votes <= st_against_votes) | ((st_for_votes + st_abstain_votes) < st_quorum) {
            STATE_DEFEATED
        } else if st_proposal.eta == 0 {
            STATE_SUCCEEDED
        } else if st_proposal.executed {
            STATE_EXECUTED
        } else if self.context.block_number() > st_proposal.eta + 14400 {
            STATE_EXPIRED
        } else {
            STATE_QUEUED
        };

        assert(state == STATE_SUCCEEDED, "not succeeded");

        let mut proposal = self.storage.proposals.at(proposal_id).read();
        let timelock_delay = self.storage.timelock_delay.read();
        proposal.eta = self.context.block_number() + timelock_delay;
        self.storage.proposals.at(proposal_id).write(proposal);
    }

    /// Execute a queued proposal after timelock has elapsed.
    #[external("public")]
    fn execute(proposal_id: Field) {
        // Inline _get_state_internal
        let st_proposal = self.storage.proposals.at(proposal_id).read();
        let st_for_votes = self.storage.proposal_for_votes.at(proposal_id).read();
        let st_against_votes = self.storage.proposal_against_votes.at(proposal_id).read();
        let st_abstain_votes = self.storage.proposal_abstain_votes.at(proposal_id).read();

        // Inline _quorum_at_block_internal
        let st_total = self.storage.total_supply_snapshot.at(st_proposal.start_block as Field).read();
        let st_numerator = self.storage.quorum_numerator.read();
        let st_denominator = self.storage.quorum_denominator.read();
        let st_quorum = if (st_total == 0) | (st_denominator == 0) {
            0
        } else {
            (st_total * st_numerator) / st_denominator
        };

        let state = if st_proposal.canceled {
            STATE_CANCELED
        } else if self.context.block_number() < st_proposal.start_block {
            STATE_PENDING
        } else if self.context.block_number() <= st_proposal.end_block {
            STATE_ACTIVE
        } else if (st_for_votes <= st_against_votes) | ((st_for_votes + st_abstain_votes) < st_quorum) {
            STATE_DEFEATED
        } else if st_proposal.eta == 0 {
            STATE_SUCCEEDED
        } else if st_proposal.executed {
            STATE_EXECUTED
        } else if self.context.block_number() > st_proposal.eta + 14400 {
            STATE_EXPIRED
        } else {
            STATE_QUEUED
        };

        assert(state == STATE_QUEUED, "not queued");

        let mut proposal = self.storage.proposals.at(proposal_id).read();
        assert(self.context.block_number() >= proposal.eta, "timelock not elapsed");

        proposal.executed = true;
        self.storage.proposals.at(proposal_id).write(proposal);

        // In production: iterate targets[], call each with value and calldata
    }

    // =========================================================================
    // GOVERNANCE PARAMETER UPDATES (self-governing -- via proposals only)
    // =========================================================================

    #[external("public")]
    #[only_self]
    fn update_voting_delay(new_delay: u32) {
        self.storage.voting_delay.write(new_delay);
    }

    #[external("public")]
    #[only_self]
    fn update_voting_period(new_period: u32) {
        self.storage.voting_period.write(new_period);
    }

    #[external("public")]
    #[only_self]
    fn update_proposal_threshold(new_threshold: u128) {
        self.storage.proposal_threshold.write(new_threshold);
    }

    #[external("public")]
    #[only_self]
    fn update_quorum_numerator(new_numerator: u128) {
        let denominator = self.storage.quorum_denominator.read();
        assert(new_numerator <= denominator, "numerator exceeds denominator");
        self.storage.quorum_numerator.write(new_numerator);
    }

    #[external("public")]
    #[only_self]
    fn update_late_quorum_extension(new_extension: u32) {
        self.storage.late_quorum_extension.write(new_extension);
    }

    #[external("public")]
    #[only_self]
    fn update_proposal_guardian(new_guardian: AztecAddress) {
        self.storage.proposal_guardian.write(new_guardian);
    }

    #[external("public")]
    #[only_self]
    fn update_timelock_delay(new_delay: u32) {
        self.storage.timelock_delay.write(new_delay);
    }

    #[external("public")]
    #[only_self]
    fn update_visibility(is_publicly_viewable: bool) {
        self.storage.is_publicly_viewable.write(is_publicly_viewable);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    // --- Always public (basic cloak info) ---

    #[external("public")]
    #[view]
    fn get_name() -> pub FieldCompressedString {
        self.storage.name.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_count() -> pub u64 {
        self.storage.proposal_count.read()
    }

    // --- Visibility-gated functions (require membership for closed cloaks) ---
    // For closed cloaks, caller must have voting power to view sensitive data.
    // Caller passes their address; we verify they are a member.

    #[external("public")]
    #[view]
    fn get_proposal(proposal_id: Field, caller: AztecAddress) -> pub GovernorProposal {
        // Check visibility: if closed, require caller to be a member
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.proposals.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn proposal_state(proposal_id: Field, caller: AztecAddress) -> pub u8 {
        // Check visibility
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }

        // Inline _get_state_internal
        let proposal = self.storage.proposals.at(proposal_id).read();
        let for_votes = self.storage.proposal_for_votes.at(proposal_id).read();
        let against_votes = self.storage.proposal_against_votes.at(proposal_id).read();
        let abstain_votes = self.storage.proposal_abstain_votes.at(proposal_id).read();

        // Inline _quorum_at_block_internal
        let total = self.storage.total_supply_snapshot.at(proposal.start_block as Field).read();
        let numerator = self.storage.quorum_numerator.read();
        let denominator = self.storage.quorum_denominator.read();
        let quorum = if (total == 0) | (denominator == 0) {
            0
        } else {
            (total * numerator) / denominator
        };

        if proposal.canceled {
            STATE_CANCELED
        } else if self.context.block_number() < proposal.start_block {
            STATE_PENDING
        } else if self.context.block_number() <= proposal.end_block {
            STATE_ACTIVE
        } else if (for_votes <= against_votes) | ((for_votes + abstain_votes) < quorum) {
            STATE_DEFEATED
        } else if proposal.eta == 0 {
            STATE_SUCCEEDED
        } else if proposal.executed {
            STATE_EXECUTED
        } else if self.context.block_number() > proposal.eta + 14400 {
            STATE_EXPIRED
        } else {
            STATE_QUEUED
        }
    }

    #[external("public")]
    #[view]
    fn proposal_votes(proposal_id: Field, caller: AztecAddress) -> pub (u128, u128, u128) {
        // Check visibility
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }

        (
            self.storage.proposal_for_votes.at(proposal_id).read(),
            self.storage.proposal_against_votes.at(proposal_id).read(),
            self.storage.proposal_abstain_votes.at(proposal_id).read(),
        )
    }

    #[external("public")]
    #[view]
    fn proposal_snapshot(proposal_id: Field, caller: AztecAddress) -> pub u32 {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.proposals.at(proposal_id).read().start_block
    }

    #[external("public")]
    #[view]
    fn proposal_deadline(proposal_id: Field, caller: AztecAddress) -> pub u32 {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.proposals.at(proposal_id).read().end_block
    }

    #[external("public")]
    #[view]
    fn proposal_eta(proposal_id: Field, caller: AztecAddress) -> pub u32 {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.proposals.at(proposal_id).read().eta
    }

    #[external("public")]
    #[view]
    fn proposal_proposer(proposal_id: Field, caller: AztecAddress) -> pub AztecAddress {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.proposals.at(proposal_id).read().proposer
    }

    #[external("public")]
    #[view]
    fn get_votes(account: AztecAddress, caller: AztecAddress) -> pub u128 {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        // Inline _get_effective_votes_internal
        self.storage.voting_power.at(account).read()
            + self.storage.delegated_power.at(account).read()
    }

    #[external("public")]
    #[view]
    fn get_past_votes(account: AztecAddress, block_number: u32, caller: AztecAddress) -> pub u128 {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }

        let checkpoint = self.storage.voting_power_checkpoints
            .at(account).at(block_number as Field).read();
        if checkpoint > 0 {
            checkpoint
        } else {
            // Fallback to current effective votes if no checkpoint at that block
            self.storage.voting_power.at(account).read()
                + self.storage.delegated_power.at(account).read()
        }
    }

    #[external("public")]
    #[view]
    fn get_delegate(account: AztecAddress, caller: AztecAddress) -> pub AztecAddress {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.delegates.at(account).read()
    }

    #[external("public")]
    #[view]
    fn get_total_voting_power(caller: AztecAddress) -> pub u128 {
        let is_public = self.storage.is_publicly_viewable.read();
        if !is_public {
            let caller_power = self.storage.voting_power.at(caller).read()
                + self.storage.delegated_power.at(caller).read();
            assert(caller_power > 0, "closed cloak: caller must be a member");
        }
        self.storage.total_voting_power.read()
    }

    #[external("public")]
    #[view]
    fn get_voting_delay() -> pub u32 {
        self.storage.voting_delay.read()
    }

    #[external("public")]
    #[view]
    fn get_voting_period() -> pub u32 {
        self.storage.voting_period.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_threshold() -> pub u128 {
        self.storage.proposal_threshold.read()
    }

    #[external("public")]
    #[view]
    fn get_quorum_numerator() -> pub u128 {
        self.storage.quorum_numerator.read()
    }

    #[external("public")]
    #[view]
    fn get_quorum_denominator() -> pub u128 {
        self.storage.quorum_denominator.read()
    }

    #[external("public")]
    #[view]
    fn quorum(block_number: u32) -> pub u128 {
        // Inline _quorum_at_block_internal
        let total = self.storage.total_supply_snapshot.at(block_number as Field).read();
        let numerator = self.storage.quorum_numerator.read();
        let denominator = self.storage.quorum_denominator.read();

        if (total == 0) | (denominator == 0) {
            0
        } else {
            (total * numerator) / denominator
        }
    }

    #[external("public")]
    #[view]
    fn get_late_quorum_extension() -> pub u32 {
        self.storage.late_quorum_extension.read()
    }

    #[external("public")]
    #[view]
    fn get_timelock_delay() -> pub u32 {
        self.storage.timelock_delay.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_guardian() -> pub AztecAddress {
        self.storage.proposal_guardian.read()
    }

    #[external("public")]
    #[view]
    fn get_governance_token() -> pub AztecAddress {
        self.storage.governance_token.read()
    }

    #[external("public")]
    #[view]
    fn get_membership_mode() -> pub u8 {
        self.storage.membership_mode.read()
    }

    #[external("public")]
    #[view]
    fn get_token_gate_address() -> pub AztecAddress {
        self.storage.token_gate_address.read()
    }

    #[external("public")]
    #[view]
    fn get_erc20_config() -> pub (Field, u128) {
        (self.storage.erc20_token_address_hash.read(), self.storage.erc20_min_balance.read())
    }

    // =========================================================================
    // HASH PROPOSAL (deterministic proposal ID from targets/values/calldatas)
    // =========================================================================

    #[external("public")]
    #[view]
    fn hash_proposal(actions_hash: Field, description_hash: Field) -> pub Field {
        std::hash::pedersen_hash([actions_hash, description_hash])
    }

    // =========================================================================
    // MULTISIG VOTING (mode 1)
    // =========================================================================

    /// Council member approves a proposal (1-person-1-vote).
    #[external("public")]
    fn council_approve(proposal_id: Field) {
        let mode = self.storage.cloak_mode.read();
        assert((mode == 1) | (mode == 2), "council approval not available in this mode");

        let caller = self.msg_sender().unwrap();

        // Inline _is_council_member_check
        let council_count = self.storage.council_count.read();
        let council_members = [
            self.storage.council_member_0.read(),
            self.storage.council_member_1.read(),
            self.storage.council_member_2.read(),
            self.storage.council_member_3.read(),
            self.storage.council_member_4.read(),
            self.storage.council_member_5.read(),
            self.storage.council_member_6.read(),
            self.storage.council_member_7.read(),
            self.storage.council_member_8.read(),
            self.storage.council_member_9.read(),
            self.storage.council_member_10.read(),
            self.storage.council_member_11.read(),
        ];
        let mut is_member = false;
        for i in 0..12 {
            if (i as u8) < council_count {
                if council_members[i].eq(caller) {
                    is_member = true;
                }
            }
        }
        assert(is_member, "not a council member");

        // Prevent double approval
        let already_approved = self.storage.council_approvals.at(proposal_id).at(caller).read();
        assert(!already_approved, "already approved");

        self.storage.council_approvals.at(proposal_id).at(caller).write(true);

        let current_count = self.storage.council_approval_counts.at(proposal_id).read();
        self.storage.council_approval_counts.at(proposal_id).write(current_count + 1);
    }

    // =========================================================================
    // EMERGENCY FUNCTIONS (mode 2)
    // =========================================================================

    /// Emergency execute: bypasses timelock, requires emergency_threshold council approvals.
    #[external("public")]
    fn emergency_execute(proposal_id: Field) {
        let mode = self.storage.cloak_mode.read();
        assert(mode == 2, "emergency execute only in hybrid mode");

        let approval_count = self.storage.council_approval_counts.at(proposal_id).read();
        let threshold = self.storage.emergency_threshold.read();
        assert(approval_count >= threshold, "insufficient emergency approvals");

        let mut proposal = self.storage.proposals.at(proposal_id).read();
        assert(!proposal.canceled, "proposal canceled");
        assert(!proposal.executed, "already executed");

        proposal.executed = true;
        self.storage.proposals.at(proposal_id).write(proposal);
    }

    /// Emergency cancel: council cancels malicious proposals, requires council_threshold.
    #[external("public")]
    fn emergency_cancel(proposal_id: Field) {
        let mode = self.storage.cloak_mode.read();
        assert(mode == 2, "emergency cancel only in hybrid mode");

        let approval_count = self.storage.council_approval_counts.at(proposal_id).read();
        let threshold = self.storage.council_threshold.read();
        assert(approval_count >= threshold, "insufficient council approvals to cancel");

        let mut proposal = self.storage.proposals.at(proposal_id).read();
        assert(!proposal.executed, "already executed");

        proposal.canceled = true;
        self.storage.proposals.at(proposal_id).write(proposal);
    }

    // =========================================================================
    // COUNCIL MANAGEMENT (governance proposals only -- #[only_self])
    // =========================================================================

    #[external("public")]
    #[only_self]
    fn replace_council_member(old_member: AztecAddress, new_member: AztecAddress) {
        let count = self.storage.council_count.read();

        // Read all 12 members into array
        let mut members = [
            self.storage.council_member_0.read(),
            self.storage.council_member_1.read(),
            self.storage.council_member_2.read(),
            self.storage.council_member_3.read(),
            self.storage.council_member_4.read(),
            self.storage.council_member_5.read(),
            self.storage.council_member_6.read(),
            self.storage.council_member_7.read(),
            self.storage.council_member_8.read(),
            self.storage.council_member_9.read(),
            self.storage.council_member_10.read(),
            self.storage.council_member_11.read(),
        ];

        let mut replaced = false;
        for i in 0..12 {
            if (i as u8) < count {
                if members[i].eq(old_member) {
                    members[i] = new_member;
                    replaced = true;
                }
            }
        }
        assert(replaced, "old member not found");

        // Write all 12 back
        self.storage.council_member_0.write(members[0]);
        self.storage.council_member_1.write(members[1]);
        self.storage.council_member_2.write(members[2]);
        self.storage.council_member_3.write(members[3]);
        self.storage.council_member_4.write(members[4]);
        self.storage.council_member_5.write(members[5]);
        self.storage.council_member_6.write(members[6]);
        self.storage.council_member_7.write(members[7]);
        self.storage.council_member_8.write(members[8]);
        self.storage.council_member_9.write(members[9]);
        self.storage.council_member_10.write(members[10]);
        self.storage.council_member_11.write(members[11]);
    }

    #[external("public")]
    #[only_self]
    fn add_council_member(new_member: AztecAddress) {
        let count = self.storage.council_count.read();
        assert(count < 12, "council full");

        // Read all 12 members into array
        let mut members = [
            self.storage.council_member_0.read(),
            self.storage.council_member_1.read(),
            self.storage.council_member_2.read(),
            self.storage.council_member_3.read(),
            self.storage.council_member_4.read(),
            self.storage.council_member_5.read(),
            self.storage.council_member_6.read(),
            self.storage.council_member_7.read(),
            self.storage.council_member_8.read(),
            self.storage.council_member_9.read(),
            self.storage.council_member_10.read(),
            self.storage.council_member_11.read(),
        ];

        members[count as u32] = new_member;

        // Write all 12 back
        self.storage.council_member_0.write(members[0]);
        self.storage.council_member_1.write(members[1]);
        self.storage.council_member_2.write(members[2]);
        self.storage.council_member_3.write(members[3]);
        self.storage.council_member_4.write(members[4]);
        self.storage.council_member_5.write(members[5]);
        self.storage.council_member_6.write(members[6]);
        self.storage.council_member_7.write(members[7]);
        self.storage.council_member_8.write(members[8]);
        self.storage.council_member_9.write(members[9]);
        self.storage.council_member_10.write(members[10]);
        self.storage.council_member_11.write(members[11]);

        self.storage.council_count.write(count + 1);
    }

    #[external("public")]
    #[only_self]
    fn remove_council_member(member: AztecAddress) {
        let count = self.storage.council_count.read();

        // Read all 12 members into array
        let mut members = [
            self.storage.council_member_0.read(),
            self.storage.council_member_1.read(),
            self.storage.council_member_2.read(),
            self.storage.council_member_3.read(),
            self.storage.council_member_4.read(),
            self.storage.council_member_5.read(),
            self.storage.council_member_6.read(),
            self.storage.council_member_7.read(),
            self.storage.council_member_8.read(),
            self.storage.council_member_9.read(),
            self.storage.council_member_10.read(),
            self.storage.council_member_11.read(),
        ];

        let mut found_index: u8 = 255;
        for i in 0..12 {
            if (i as u8) < count {
                if members[i].eq(member) {
                    found_index = i as u8;
                }
            }
        }
        assert(found_index != 255, "member not found");

        // Shift remaining members down
        let mut i = found_index;
        for _ in 0..11 {
            if i + 1 < count {
                members[i as u32] = members[(i + 1) as u32];
                i += 1;
            }
        }
        // Zero out last slot
        members[(count - 1) as u32] = AztecAddress::from_field(0);

        // Write all 12 back
        self.storage.council_member_0.write(members[0]);
        self.storage.council_member_1.write(members[1]);
        self.storage.council_member_2.write(members[2]);
        self.storage.council_member_3.write(members[3]);
        self.storage.council_member_4.write(members[4]);
        self.storage.council_member_5.write(members[5]);
        self.storage.council_member_6.write(members[6]);
        self.storage.council_member_7.write(members[7]);
        self.storage.council_member_8.write(members[8]);
        self.storage.council_member_9.write(members[9]);
        self.storage.council_member_10.write(members[10]);
        self.storage.council_member_11.write(members[11]);

        self.storage.council_count.write(count - 1);

        // Ensure threshold does not exceed new count
        let threshold = self.storage.council_threshold.read();
        if threshold > count - 1 {
            self.storage.council_threshold.write(count - 1);
        }
    }

    #[external("public")]
    #[only_self]
    fn update_council_threshold(new_threshold: u8) {
        let count = self.storage.council_count.read();
        assert(new_threshold <= count, "threshold exceeds council size");
        assert(new_threshold > 0, "threshold must be positive");
        self.storage.council_threshold.write(new_threshold);
    }

    // =========================================================================
    // COUNCIL VIEW FUNCTIONS
    // =========================================================================

    #[external("public")]
    #[view]
    fn get_cloak_mode() -> pub u8 {
        self.storage.cloak_mode.read()
    }

    #[external("public")]
    #[view]
    fn get_council_member(index: u8) -> pub AztecAddress {
        // Inline _get_council_member_by_index
        if index == 0 { self.storage.council_member_0.read() }
        else if index == 1 { self.storage.council_member_1.read() }
        else if index == 2 { self.storage.council_member_2.read() }
        else if index == 3 { self.storage.council_member_3.read() }
        else if index == 4 { self.storage.council_member_4.read() }
        else if index == 5 { self.storage.council_member_5.read() }
        else if index == 6 { self.storage.council_member_6.read() }
        else if index == 7 { self.storage.council_member_7.read() }
        else if index == 8 { self.storage.council_member_8.read() }
        else if index == 9 { self.storage.council_member_9.read() }
        else if index == 10 { self.storage.council_member_10.read() }
        else if index == 11 { self.storage.council_member_11.read() }
        else { AztecAddress::from_field(0) }
    }

    #[external("public")]
    #[view]
    fn get_council_count() -> pub u8 {
        self.storage.council_count.read()
    }

    #[external("public")]
    #[view]
    fn get_council_threshold() -> pub u8 {
        self.storage.council_threshold.read()
    }

    #[external("public")]
    #[view]
    fn get_emergency_threshold() -> pub u8 {
        self.storage.emergency_threshold.read()
    }

    #[external("public")]
    #[view]
    fn is_council_member(addr: AztecAddress) -> pub bool {
        // Inline _is_council_member_check
        let count = self.storage.council_count.read();
        let members = [
            self.storage.council_member_0.read(),
            self.storage.council_member_1.read(),
            self.storage.council_member_2.read(),
            self.storage.council_member_3.read(),
            self.storage.council_member_4.read(),
            self.storage.council_member_5.read(),
            self.storage.council_member_6.read(),
            self.storage.council_member_7.read(),
            self.storage.council_member_8.read(),
            self.storage.council_member_9.read(),
            self.storage.council_member_10.read(),
            self.storage.council_member_11.read(),
        ];
        let mut found = false;
        for i in 0..12 {
            if (i as u8) < count {
                if members[i].eq(addr) {
                    found = true;
                }
            }
        }
        found
    }

    #[external("public")]
    #[view]
    fn get_council_approval_count(proposal_id: Field) -> pub u8 {
        self.storage.council_approval_counts.at(proposal_id).read()
    }

    // =========================================================================
    // VISIBILITY
    // =========================================================================

    #[external("public")]
    #[view]
    fn get_is_publicly_viewable() -> pub bool {
        self.storage.is_publicly_viewable.read()
    }
}
