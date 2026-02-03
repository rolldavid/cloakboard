pub mod types;
// pub mod core;       // Contains separate contracts (BaseCloak, CloakRegistry) - must be separate packages
// pub mod templates;  // Contains GovernorBravoCloak contract - must be separate package
// pub mod token;      // Contains GovernanceToken, TokenGate contracts - must be separate packages
// pub mod test;       // Disabled - needs TXE for testing

use dep::aztec::macros::aztec;

#[aztec]
pub contract PrivateCloak {
    // ===== IMPORTS =====
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, internal, view, only_self}, storage::storage},
        protocol_types::{
            address::AztecAddress,
            traits::{Hash, ToField},
        },
        state_vars::{Map, PublicImmutable, PublicMutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::types::proposal::{Proposal, VoteTally};

    // ===== STORAGE =====
    // Following the EasyPrivateVoting pattern - all storage is public
    // Privacy is achieved through nullifiers that hide who voted
    #[storage]
    struct Storage<Context> {
        // Cloak Configuration (Immutable after init)
        name: PublicImmutable<FieldCompressedString, Context>,
        admin: PublicMutable<AztecAddress, Context>,
        voting_duration: PublicMutable<u32, Context>,
        quorum_threshold: PublicMutable<u64, Context>,

        // Sponsored Voting Configuration (FPC - Fee Payment Contract)
        sponsored_fpc_address: PublicMutable<AztecAddress, Context>,
        sponsored_voting_enabled: PublicMutable<bool, Context>,

        // Membership tracking (public - members and their voting power)
        member_voting_power: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        member_count: PublicMutable<u64, Context>,

        // Proposals (Public)
        proposals: Map<Field, PublicMutable<Proposal, Context>, Context>,
        proposal_count: PublicMutable<u64, Context>,

        // Vote tallies (Public - revealed after voting ends)
        vote_tallies: Map<Field, PublicMutable<VoteTally, Context>, Context>,

        // ===== TOKEN GATING =====
        membership_mode: PublicMutable<u8, Context>,
        token_gate_address: PublicMutable<AztecAddress, Context>,
        token_address: PublicMutable<AztecAddress, Context>,
        erc20_token_address_hash: PublicMutable<Field, Context>,
        erc20_min_balance: PublicMutable<u128, Context>,
        used_token_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        admin: AztecAddress,
        voting_duration: u32,
        quorum_threshold: u64,
        membership_mode: u8,
        token_gate_address: AztecAddress,
        token_address: AztecAddress,
        erc20_token_address_hash: Field,
        erc20_min_balance: u128,
    ) {
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.admin.write(admin);
        self.storage.voting_duration.write(voting_duration);
        self.storage.quorum_threshold.write(quorum_threshold);
        self.storage.sponsored_fpc_address.write(AztecAddress::zero());
        self.storage.sponsored_voting_enabled.write(false);
        self.storage.member_count.write(0);
        self.storage.proposal_count.write(0);
        self.storage.membership_mode.write(membership_mode);
        self.storage.token_gate_address.write(token_gate_address);
        self.storage.token_address.write(token_address);
        self.storage.erc20_token_address_hash.write(erc20_token_address_hash);
        self.storage.erc20_min_balance.write(erc20_min_balance);
    }

    // ===== PUBLIC FUNCTIONS =====

    /// Adds a new member with voting power (admin only)
    #[external("public")]
    fn add_member(new_member: AztecAddress, voting_power: u128) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "caller is not admin");

        // Check if member already exists
        let existing_power = self.storage.member_voting_power.at(new_member).read();
        if existing_power == 0 {
            // New member
            let count = self.storage.member_count.read();
            self.storage.member_count.write(count + 1);
        }

        // Set voting power
        self.storage.member_voting_power.at(new_member).write(voting_power);
    }

    /// Remove a member (admin only)
    #[external("public")]
    fn remove_member(member: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "caller is not admin");

        let existing_power = self.storage.member_voting_power.at(member).read();
        assert(existing_power > 0, "not a member");

        self.storage.member_voting_power.at(member).write(0);
        let count = self.storage.member_count.read();
        self.storage.member_count.write(count - 1);
    }

    /// Join with Aztec token proof (mode 2)
    /// Takes membership_mode and token_address as args since private context
    /// cannot read public state directly.
    #[external("private")]
    fn join_with_aztec_token(membership_mode: u8, token_addr: AztecAddress) {
        assert(membership_mode == 2, "not token-gated");
        let sender = self.msg_sender().unwrap();

        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            token_addr.to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.add_token_member_internal(sender);
    }

    #[external("public")]
    #[only_self]
    fn add_token_member_internal(member: AztecAddress) {
        let existing_power = self.storage.member_voting_power.at(member).read();
        if existing_power == 0 {
            let count = self.storage.member_count.read();
            self.storage.member_count.write(count + 1);
        }
        self.storage.member_voting_power.at(member).write(1);
    }

    /// Join with ERC20 proof (mode 3)
    #[external("public")]
    fn join_with_erc20_proof(verified_balance: u128, proof_nullifier: Field) {
        assert(self.storage.membership_mode.read() == 3, "not erc20-gated");
        assert(verified_balance >= self.storage.erc20_min_balance.read(), "insufficient balance");
        assert(!self.storage.used_token_nullifiers.at(proof_nullifier).read(), "nullifier already used");
        self.storage.used_token_nullifiers.at(proof_nullifier).write(true);

        let sender = self.msg_sender().unwrap();
        let existing_power = self.storage.member_voting_power.at(sender).read();
        if existing_power == 0 {
            let count = self.storage.member_count.read();
            self.storage.member_count.write(count + 1);
        }
        self.storage.member_voting_power.at(sender).write(verified_balance);
    }

    /// Creates a new proposal (anyone can create, but only members can vote)
    #[external("public")]
    fn create_proposal(
        title: FieldCompressedString,
        description: FieldCompressedString,
        proposal_type: u8,
        target_address: AztecAddress,
        value: u128,
    ) {
        let creator = self.msg_sender().unwrap();
        let proposal_id = self.storage.proposal_count.read();
        let voting_duration = self.storage.voting_duration.read();

        let proposal = Proposal {
            id: proposal_id,
            creator,
            title,
            description,
            proposal_type,
            target_address,
            value,
            start_block: self.context.block_number(),
            end_block: self.context.block_number() + voting_duration,
            executed: false,
        };

        self.storage.proposals.at(proposal_id as Field).write(proposal);
        self.storage.proposal_count.write(proposal_id + 1);
        self.storage.vote_tallies.at(proposal_id as Field).write(VoteTally::new());
    }

    /// Cast a vote on a proposal (private vote using nullifier pattern)
    /// The vote itself is private - only the tally is revealed
    #[external("private")]
    fn cast_vote(proposal_id: Field, vote_choice: bool) {
        // Compute nullifier to prevent double voting using NSK pattern
        // This hides WHO voted while still preventing double voting
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(nullifier);

        // Get voting power and add to tally via enqueued public call
        self.enqueue_self.add_to_tally_internal(
            proposal_id,
            vote_choice,
            sender,
        );
    }

    /// Execute a passed proposal
    #[external("public")]
    fn execute_proposal(proposal_id: Field) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let tally = self.storage.vote_tallies.at(proposal_id).read();
        let quorum = self.storage.quorum_threshold.read();

        assert(!proposal.executed, "already executed");
        assert(tally.total_votes >= quorum as u128, "quorum not met");
        assert(tally.yes_votes > tally.no_votes, "proposal did not pass");

        // Mark as executed
        let mut executed_proposal = proposal;
        executed_proposal.executed = true;
        self.storage.proposals.at(proposal_id).write(executed_proposal);
    }

    // ===== ADMIN FUNCTIONS =====

    #[external("public")]
    fn set_sponsored_fpc(new_fpc_address: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "caller is not admin");
        self.storage.sponsored_fpc_address.write(new_fpc_address);
    }

    #[external("public")]
    fn set_sponsored_voting_enabled(enabled: bool) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "caller is not admin");
        self.storage.sponsored_voting_enabled.write(enabled);
    }

    // ===== INTERNAL PUBLIC FUNCTIONS =====

    #[external("public")]
    #[only_self]
    fn add_to_tally_internal(
        proposal_id: Field,
        vote_choice: bool,
        voter: AztecAddress,
    ) {
        // Verify proposal is still active
        let proposal = self.storage.proposals.at(proposal_id).read();
        assert(self.context.block_number() <= proposal.end_block, "voting ended");

        // Get voter's voting power
        let voting_power = self.storage.member_voting_power.at(voter).read();
        assert(voting_power > 0, "not a member");

        // Update tally
        let mut tally = self.storage.vote_tallies.at(proposal_id).read();
        if vote_choice {
            tally.yes_votes += voting_power;
        } else {
            tally.no_votes += voting_power;
        }
        tally.total_votes += voting_power;
        self.storage.vote_tallies.at(proposal_id).write(tally);
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_name() -> pub FieldCompressedString {
        self.storage.name.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal(proposal_id: Field) -> pub Proposal {
        self.storage.proposals.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn get_vote_tally(proposal_id: Field) -> pub VoteTally {
        self.storage.vote_tallies.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn get_member_count() -> pub u64 {
        self.storage.member_count.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_count() -> pub u64 {
        self.storage.proposal_count.read()
    }

    #[external("public")]
    #[view]
    fn get_voting_power(member: AztecAddress) -> pub u128 {
        self.storage.member_voting_power.at(member).read()
    }

    #[external("public")]
    #[view]
    fn get_sponsored_fpc_address() -> pub AztecAddress {
        self.storage.sponsored_fpc_address.read()
    }

    #[external("public")]
    #[view]
    fn is_sponsored_voting_enabled() -> pub bool {
        self.storage.sponsored_voting_enabled.read()
    }

    #[external("public")]
    #[view]
    fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn get_voting_duration() -> pub u32 {
        self.storage.voting_duration.read()
    }

    #[external("public")]
    #[view]
    fn get_quorum_threshold() -> pub u64 {
        self.storage.quorum_threshold.read()
    }

    #[external("public")]
    #[view]
    fn get_membership_mode() -> pub u8 {
        self.storage.membership_mode.read()
    }

    #[external("public")]
    #[view]
    fn get_token_address() -> pub AztecAddress {
        self.storage.token_address.read()
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

    // ===== UTILITY FUNCTIONS =====

    #[external("utility")]
    unconstrained fn get_tally(proposal_id: Field) -> VoteTally {
        self.storage.vote_tallies.at(proposal_id).read()
    }
}
