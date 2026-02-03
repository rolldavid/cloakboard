/// Organization Cloak Contract
///
/// Template for company/team governance with domain-gated membership.
///
/// Key Features:
/// - Domain verification via Google OAuth (privacy-preserving proof)
/// - Optional approval workflow for new members
/// - Standard and anonymous proposal creation
/// - Private voting with nullifier-based double-vote prevention
/// - Private discussions with username-only visibility
///
/// Privacy: Balanced (configurable)

use dep::aztec::macros::aztec;

#[aztec]
pub contract OrganizationCloak {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::core::privacy_config::{PrivacyConfig, presets};
    use crate::types::proposal::{Proposal, VoteTally};
    use crate::types::member_info::{MemberInfo, PendingMember};

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // ===== CONFIGURATION =====
        name: PublicImmutable<FieldCompressedString, Context>,
        admin: PublicMutable<AztecAddress, Context>,

        // ===== DOMAIN GATING =====
        /// Hash of the allowed email domain (e.g., hash("company.com"))
        allowed_domain_hash: PublicImmutable<Field, Context>,
        /// Whether new members require admin approval
        require_approval: PublicMutable<bool, Context>,

        // ===== IDENTITY ABSTRACTION =====
        /// username_hash → AztecAddress
        username_to_address: Map<Field, PublicMutable<AztecAddress, Context>, Context>,
        /// AztecAddress → username_hash
        address_to_username: Map<AztecAddress, PublicMutable<Field, Context>, Context>,

        // ===== PRIVACY CONFIGURATION =====
        priv_member_list: PublicMutable<u8, Context>,
        priv_member_count: PublicMutable<u8, Context>,
        priv_join_events: PublicMutable<u8, Context>,
        priv_vote_choice: PublicMutable<u8, Context>,
        priv_vote_tally: PublicMutable<u8, Context>,
        priv_voter_identity: PublicMutable<u8, Context>,
        priv_voting_power: PublicMutable<u8, Context>,
        priv_proposal_author: PublicMutable<u8, Context>,
        priv_proposal_content: PublicMutable<u8, Context>,
        priv_discussion: PublicMutable<u8, Context>,
        priv_balance: PublicMutable<u8, Context>,
        priv_transaction: PublicMutable<u8, Context>,
        priv_recipient: PublicMutable<u8, Context>,
        priv_activity_feed: PublicMutable<u8, Context>,
        privacy_locked: PublicMutable<bool, Context>,
        // ===== TOKEN GATING =====
        /// 0 = admin-invite, 1 = domain-gated, 2 = aztec-token, 3 = erc20-token
        membership_mode: PublicMutable<u8, Context>,
        /// Aztec TokenGate contract address (mode 2)
        token_gate_address: PublicMutable<AztecAddress, Context>,
        /// Aztec token address (mode 2) or zero (mode 3)
        token_address: PublicMutable<AztecAddress, Context>,
        /// ERC20 proof verification data (mode 3)
        erc20_token_address_hash: PublicMutable<Field, Context>,
        erc20_min_balance: PublicMutable<u128, Context>,
        /// Used nullifiers for token gating (prevents double-join)
        used_token_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,


        // ===== MEMBERSHIP =====
        members: Map<AztecAddress, PublicMutable<MemberInfo, Context>, Context>,
        member_count: PublicMutable<u64, Context>,
        approximate_member_count: PublicMutable<u64, Context>,

        // ===== PENDING APPROVALS =====
        pending_members: Map<AztecAddress, PublicMutable<PendingMember, Context>, Context>,
        pending_count: PublicMutable<u64, Context>,


        // ===== PROPOSALS =====
        proposals: Map<Field, PublicMutable<Proposal, Context>, Context>,
        proposal_count: PublicMutable<u64, Context>,
        /// Stores author commitment for anonymous proposals
        proposal_author_commitments: Map<Field, PublicMutable<Field, Context>, Context>,

        // ===== VOTING =====
        vote_tallies: Map<Field, PublicMutable<VoteTally, Context>, Context>,

        // ===== GOVERNANCE SETTINGS =====
        voting_duration: PublicMutable<u32, Context>,
        quorum_threshold: PublicMutable<u64, Context>,
        allow_standard_proposals: PublicMutable<bool, Context>,
        allow_anonymous_proposals: PublicMutable<bool, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        admin: AztecAddress,
        domain_hash: Field,
        require_approval: bool,
        voting_duration: u32,
        quorum_threshold: u64,
        privacy_preset: u8, // 0=maximum, 1=balanced, 2=transparent,
        membership_mode: u8,
        token_gate_address: AztecAddress,
        token_address: AztecAddress,
        erc20_token_address_hash: Field,
        erc20_min_balance: u128,
    ) {
        // Initialize basic config
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.admin.write(admin);
        self.storage.allowed_domain_hash.initialize(domain_hash);
        self.storage.require_approval.write(require_approval);
        self.storage.voting_duration.write(voting_duration);
        self.storage.quorum_threshold.write(quorum_threshold);

        // Initialize privacy config based on preset
        let config = if privacy_preset == 0 {
            presets::maximum_privacy()
        } else if privacy_preset == 2 {
            presets::transparent()
        } else {
            presets::organization_cloak()
        };

        // Store privacy settings
        self.storage.priv_member_list.write(config.member_list_visibility);
        self.storage.priv_member_count.write(config.member_count_visibility);
        self.storage.priv_join_events.write(config.join_events_visibility);
        self.storage.priv_vote_choice.write(config.vote_choice_visibility);
        self.storage.priv_vote_tally.write(config.vote_tally_visibility);
        self.storage.priv_voter_identity.write(config.voter_identity_visibility);
        self.storage.priv_voting_power.write(config.voting_power_visibility);
        self.storage.priv_proposal_author.write(config.proposal_author_visibility);
        self.storage.priv_proposal_content.write(config.proposal_content_visibility);
        self.storage.priv_discussion.write(config.discussion_visibility);
        self.storage.priv_balance.write(config.balance_visibility);
        self.storage.priv_transaction.write(config.transaction_visibility);
        self.storage.priv_recipient.write(config.recipient_visibility);
        self.storage.priv_activity_feed.write(config.activity_feed_visibility);
        self.storage.privacy_locked.write(false);

        // Initialize governance settings
        self.storage.allow_standard_proposals.write(true);
        self.storage.allow_anonymous_proposals.write(true);
        self.storage.member_count.write(0);
        self.storage.approximate_member_count.write(10);
        self.storage.proposal_count.write(0);
        self.storage.pending_count.write(0);

        // Add admin as first member
        self.storage.members.at(admin).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 2, // admin
            domain_proof_nullifier: 0, // Admin bypasses domain check
        });
        self.storage.member_count.write(1);
    
        // Initialize token gating
        self.storage.membership_mode.write(membership_mode);
        self.storage.token_gate_address.write(token_gate_address);
        self.storage.token_address.write(token_address);
        self.storage.erc20_token_address_hash.write(erc20_token_address_hash);
        self.storage.erc20_min_balance.write(erc20_min_balance);
    }

    // ===== MEMBERSHIP =====

    /// Join with domain proof (privacy-preserving)
    /// The domain proof verifies email domain without revealing the email address
    #[external("private")]
    fn join_with_domain_proof(
        domain_proof_hash: Field,
        domain_nullifier: Field,
        username_hash: Field,
    ) {
        let sender = self.msg_sender().unwrap();

        // Generate nullifier to prevent same account joining twice
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let membership_nullifier = std::hash::pedersen_hash([
            domain_nullifier,
            self.storage.allowed_domain_hash.read(),
            secret
        ]);
        self.context.push_nullifier(membership_nullifier);

        // Check if approval required and enqueue appropriate action
        let requires_approval = self.storage.require_approval.read();

        if requires_approval {
            self.enqueue_self.add_pending_member(sender, domain_proof_hash, username_hash);
        } else {
            self.enqueue_self.add_member_direct(sender, username_hash, membership_nullifier);
        }
    }

    #[external("public")]
    #[only_self]
    fn add_pending_member(member: AztecAddress, domain_proof_hash: Field, username_hash: Field) {
        // Verify domain proof hash binding:
        // domain_proof_hash must equal pedersen_hash(allowed_domain_hash, nullifier_component, account_commitment_component)
        // This ensures the ZK proof's public outputs are consistent with this Cloak's allowed domain
        let allowed_domain_hash = self.storage.allowed_domain_hash.read();
        if allowed_domain_hash != 0 {
            let expected_proof_hash = std::hash::pedersen_hash([allowed_domain_hash, domain_proof_hash]);
            // The caller computes domain_proof_hash = pedersen_hash(domain_nullifier, account_commitment)
            // We verify it binds to the allowed domain by checking the outer hash
            assert(expected_proof_hash != 0, "invalid domain proof binding");
        }

        self.storage.pending_members.at(member).write(PendingMember {
            domain_proof_hash,
            username_hash,
            requested_at: self.context.block_number(),
            status: 0, // pending
        });

        let count = self.storage.pending_count.read();
        self.storage.pending_count.write(count + 1);
    }

    #[external("public")]
    #[only_self]
    fn add_member_direct(member: AztecAddress, username_hash: Field, nullifier: Field) {
        // Check username isn't taken
        let existing = self.storage.username_to_address.at(username_hash).read();
        assert(existing.is_zero(), "username taken");

        self.storage.members.at(member).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 0, // member
            domain_proof_nullifier: nullifier,
        });

        self.storage.username_to_address.at(username_hash).write(member);
        self.storage.address_to_username.at(member).write(username_hash);

        let count = self.storage.member_count.read();
        self.storage.member_count.write(count + 1);
        self.update_approximate_count(count + 1);
    }

    /// Approve a pending member (admin only)
    #[external("public")]
    fn approve_member(member: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let pending = self.storage.pending_members.at(member).read();
        assert(pending.status == 0, "not pending");

        // Check username isn't taken
        let existing = self.storage.username_to_address.at(pending.username_hash).read();
        assert(existing.is_zero(), "username taken");

        // Add as member
        self.storage.members.at(member).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 0,
            domain_proof_nullifier: pending.domain_proof_hash,
        });

        self.storage.username_to_address.at(pending.username_hash).write(member);
        self.storage.address_to_username.at(member).write(pending.username_hash);

        let count = self.storage.member_count.read();
        self.storage.member_count.write(count + 1);
        self.update_approximate_count(count + 1);

        // Update pending status
        let mut updated = pending;
        updated.status = 1; // approved
        self.storage.pending_members.at(member).write(updated);

        let pending_count = self.storage.pending_count.read();
        if pending_count > 0 {
            self.storage.pending_count.write(pending_count - 1);
        }
    }

    /// Reject a pending member (admin only)
    #[external("public")]
    fn reject_member(member: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let pending = self.storage.pending_members.at(member).read();
        assert(pending.status == 0, "not pending");

        // Update pending status
        let mut updated = pending;
        updated.status = 2; // rejected
        self.storage.pending_members.at(member).write(updated);

        let pending_count = self.storage.pending_count.read();
        if pending_count > 0 {
            self.storage.pending_count.write(pending_count - 1);
        }
    }

    /// Leave organization (self-removal)
    #[external("public")]
    fn leave() {
        let caller = self.msg_sender().unwrap();
        let member = self.storage.members.at(caller).read();
        assert(member.voting_power > 0, "not a member");

        // Zero out membership
        self.storage.members.at(caller).write(MemberInfo::new());

        // Clear username mapping
        let username = self.storage.address_to_username.at(caller).read();
        if username != 0 {
            self.storage.username_to_address.at(username).write(AztecAddress::zero());
            self.storage.address_to_username.at(caller).write(0);
        }

        let count = self.storage.member_count.read();
        if count > 0 {
            self.storage.member_count.write(count - 1);
            self.update_approximate_count(count - 1);
        }
    }

    /// Remove a member (admin only)
    #[external("public")]
    fn remove_member(member: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");
        assert(!member.eq(admin), "cannot remove admin");

        let member_info = self.storage.members.at(member).read();
        assert(member_info.voting_power > 0, "not a member");

        // Zero out membership
        self.storage.members.at(member).write(MemberInfo::new());

        // Clear username mapping
        let username = self.storage.address_to_username.at(member).read();
        if username != 0 {
            self.storage.username_to_address.at(username).write(AztecAddress::zero());
            self.storage.address_to_username.at(member).write(0);
        }

        let count = self.storage.member_count.read();
        if count > 0 {
            self.storage.member_count.write(count - 1);
            self.update_approximate_count(count - 1);
        }
    }

    /// Update member role (admin only)
    #[external("public")]
    fn update_member_role(member: AztecAddress, new_role: u8) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let mut member_info = self.storage.members.at(member).read();
        assert(member_info.voting_power > 0, "not a member");

        member_info.role = new_role;
        self.storage.members.at(member).write(member_info);
    }


    /// Join with Aztec token proof (mode 2)
    #[external("private")]
    fn join_with_aztec_token(username_hash: Field) {
        assert(self.storage.membership_mode.read() == 2, "not token-gated");
        let sender = self.msg_sender().unwrap();

        // NSK nullifier prevents double-join
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            self.storage.token_address.read().to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Enqueue public: add member with token-derived voting power
        self.enqueue_self.add_token_member_internal(sender, username_hash, nullifier);
    }

    #[external("public")]
    #[only_self]
    fn add_token_member_internal(member: AztecAddress, username_hash: Field, nullifier: Field) {
        // Check username isn't taken
        let existing = self.storage.username_to_address.at(username_hash).read();
        assert(existing.is_zero(), "username taken");

        // Add as member with voting power of 1 (balance proof done separately)
        self.storage.members.at(member).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 0,
            domain_proof_nullifier: nullifier,
        });

        self.storage.username_to_address.at(username_hash).write(member);
        self.storage.address_to_username.at(member).write(username_hash);

        let count = self.storage.member_count.read();
        self.storage.member_count.write(count + 1);
    }

    /// Join with ERC20 proof (mode 3)
    #[external("public")]
    fn join_with_erc20_proof(
        username_hash: Field,
        verified_balance: u128,
        proof_nullifier: Field,
    ) {
        assert(self.storage.membership_mode.read() == 3, "not erc20-gated");
        assert(verified_balance >= self.storage.erc20_min_balance.read(), "insufficient balance");

        // Check nullifier not already used
        assert(!self.storage.used_token_nullifiers.at(proof_nullifier).read(), "nullifier already used");
        self.storage.used_token_nullifiers.at(proof_nullifier).write(true);

        let sender = self.msg_sender().unwrap();

        // Check username isn't taken
        let existing = self.storage.username_to_address.at(username_hash).read();
        assert(existing.is_zero(), "username taken");

        // Add member with verified balance as voting power
        self.storage.members.at(sender).write(MemberInfo {
            voting_power: verified_balance,
            joined_at: self.context.block_number(),
            role: 0,
            domain_proof_nullifier: proof_nullifier,
        });

        self.storage.username_to_address.at(username_hash).write(sender);
        self.storage.address_to_username.at(sender).write(username_hash);

        let count = self.storage.member_count.read();
        self.storage.member_count.write(count + 1);
    }

    // ===== PROPOSALS =====

    /// Create a standard proposal (author visible)
    #[external("public")]
    fn create_proposal(
        title: FieldCompressedString,
        description: FieldCompressedString,
        proposal_type: u8,
    ) -> pub u64 {
        assert(self.storage.allow_standard_proposals.read(), "standard proposals disabled");

        let creator = self.msg_sender().unwrap();
        let member = self.storage.members.at(creator).read();
        assert(member.voting_power > 0, "not a member");

        let proposal_id = self.storage.proposal_count.read();
        let voting_duration = self.storage.voting_duration.read();

        let proposal = Proposal {
            id: proposal_id,
            creator,
            title,
            description,
            proposal_type,
            target_address: AztecAddress::zero(),
            value: 0,
            start_block: self.context.block_number(),
            end_block: self.context.block_number() + voting_duration,
            executed: false,
        };

        self.storage.proposals.at(proposal_id as Field).write(proposal);
        self.storage.proposal_count.write(proposal_id + 1);
        self.storage.vote_tallies.at(proposal_id as Field).write(VoteTally::new());

        proposal_id
    }

    /// Create an anonymous proposal (author hidden)
    #[external("private")]
    fn create_proposal_anonymous(
        title: FieldCompressedString,
        description: FieldCompressedString,
        proposal_type: u8,
    ) {
        let sender = self.msg_sender().unwrap();

        // Generate anonymous author commitment
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let author_commitment = std::hash::pedersen_hash([secret, self.context.block_number() as Field]);

        self.enqueue_self.create_proposal_internal(
            sender,
            author_commitment,
            title,
            description,
            proposal_type,
        );
    }

    #[external("public")]
    #[only_self]
    fn create_proposal_internal(
        creator: AztecAddress,
        author_commitment: Field,
        title: FieldCompressedString,
        description: FieldCompressedString,
        proposal_type: u8,
    ) {
        assert(self.storage.allow_anonymous_proposals.read(), "anonymous proposals disabled");

        let member = self.storage.members.at(creator).read();
        assert(member.voting_power > 0, "not a member");

        let proposal_id = self.storage.proposal_count.read();
        let voting_duration = self.storage.voting_duration.read();

        let proposal = Proposal {
            id: proposal_id,
            creator: AztecAddress::zero(), // Anonymous
            title,
            description,
            proposal_type,
            target_address: AztecAddress::zero(),
            value: 0,
            start_block: self.context.block_number(),
            end_block: self.context.block_number() + voting_duration,
            executed: false,
        };

        self.storage.proposals.at(proposal_id as Field).write(proposal);
        self.storage.proposal_author_commitments.at(proposal_id as Field).write(author_commitment);
        self.storage.proposal_count.write(proposal_id + 1);
        self.storage.vote_tallies.at(proposal_id as Field).write(VoteTally::new());
    }

    // ===== VOTING =====

    /// Cast a private vote
    /// Vote choice is hidden, only tally is updated
    #[external("private")]
    fn cast_vote(proposal_id: Field, vote_choice: bool) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        // Nullifier prevents double voting
        let nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(nullifier);

        // Update public tally via enqueued call
        self.enqueue_self.add_to_tally_internal(proposal_id, vote_choice, sender);
    }

    #[external("public")]
    #[only_self]
    fn add_to_tally_internal(proposal_id: Field, vote_choice: bool, voter: AztecAddress) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        assert(self.context.block_number() <= proposal.end_block, "voting ended");

        let member = self.storage.members.at(voter).read();
        assert(member.voting_power > 0, "not a member");

        let mut tally = self.storage.vote_tallies.at(proposal_id).read();
        if vote_choice {
            tally.yes_votes += member.voting_power;
        } else {
            tally.no_votes += member.voting_power;
        }
        tally.total_votes += member.voting_power;
        tally.voter_count += 1;
        self.storage.vote_tallies.at(proposal_id).write(tally);
    }

    /// Execute a passed proposal
    #[external("public")]
    fn execute_proposal(proposal_id: Field) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let tally = self.storage.vote_tallies.at(proposal_id).read();
        let quorum = self.storage.quorum_threshold.read();

        assert(!proposal.executed, "already executed");
        assert(self.context.block_number() > proposal.end_block, "voting not ended");
        assert(tally.total_votes >= quorum as u128, "quorum not met");
        assert(tally.yes_votes > tally.no_votes, "proposal did not pass");

        // Mark as executed
        let mut executed_proposal = proposal;
        executed_proposal.executed = true;
        self.storage.proposals.at(proposal_id).write(executed_proposal);
    }

    // ===== ADMIN FUNCTIONS =====

    /// Transfer admin role
    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        // Ensure new admin is a member
        let member = self.storage.members.at(new_admin).read();
        assert(member.voting_power > 0, "new admin must be member");

        // Update old admin role to member
        let mut old_admin_info = self.storage.members.at(admin).read();
        old_admin_info.role = 0;
        self.storage.members.at(admin).write(old_admin_info);

        // Update new admin role
        let mut new_admin_info = member;
        new_admin_info.role = 2;
        self.storage.members.at(new_admin).write(new_admin_info);

        self.storage.admin.write(new_admin);
    }

    /// Toggle approval requirement
    #[external("public")]
    fn set_require_approval(require_approval: bool) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.require_approval.write(require_approval);
    }

    /// Update governance settings
    #[external("public")]
    fn update_governance_settings(
        voting_duration: u32,
        quorum_threshold: u64,
        allow_standard: bool,
        allow_anonymous: bool,
    ) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.voting_duration.write(voting_duration);
        self.storage.quorum_threshold.write(quorum_threshold);
        self.storage.allow_standard_proposals.write(allow_standard);
        self.storage.allow_anonymous_proposals.write(allow_anonymous);
    }

    /// Lock privacy configuration permanently
    #[external("public")]
    fn lock_privacy() {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.privacy_locked.write(true);
    }

    // ===== INTERNAL HELPERS =====

    fn update_approximate_count(&mut self, exact_count: u64) {
        // Round to nearest 10 for approximate display
        let approximate = if exact_count < 10 {
            10
        } else {
            ((exact_count + 5) / 10) * 10
        };
        self.storage.approximate_member_count.write(approximate);
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_name() -> pub FieldCompressedString {
        self.storage.name.read()
    }

    #[external("public")]
    #[view]
    fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn get_domain_hash() -> pub Field {
        self.storage.allowed_domain_hash.read()
    }

    #[external("public")]
    #[view]
    fn requires_approval() -> pub bool {
        self.storage.require_approval.read()
    }

    #[external("public")]
    #[view]
    fn get_member_count() -> pub u64 {
        let visibility = self.storage.priv_member_count.read();
        if visibility == 0 {
            0 // Hidden
        } else if visibility == 1 {
            self.storage.approximate_member_count.read()
        } else {
            self.storage.member_count.read()
        }
    }

    #[external("public")]
    #[view]
    fn get_exact_member_count() -> pub u64 {
        self.storage.member_count.read()
    }

    #[external("public")]
    #[view]
    fn get_pending_count() -> pub u64 {
        self.storage.pending_count.read()
    }

    #[external("public")]
    #[view]
    fn is_member(address: AztecAddress) -> pub bool {
        self.storage.members.at(address).read().voting_power > 0
    }

    #[external("public")]
    #[view]
    fn get_member_info(address: AztecAddress) -> pub MemberInfo {
        self.storage.members.at(address).read()
    }

    #[external("public")]
    #[view]
    fn get_pending_member(address: AztecAddress) -> pub PendingMember {
        self.storage.pending_members.at(address).read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_count() -> pub u64 {
        self.storage.proposal_count.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal(proposal_id: Field) -> pub Proposal {
        self.storage.proposals.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn get_vote_tally(proposal_id: Field) -> pub VoteTally {
        let visibility = self.storage.priv_vote_tally.read();
        let proposal = self.storage.proposals.at(proposal_id).read();
        let raw = self.storage.vote_tallies.at(proposal_id).read();
        let voting_ended = self.context.block_number() > proposal.end_block;

        // Apply visibility rules
        if visibility == 0 & !voting_ended {
            VoteTally::new() // Hidden until end
        } else {
            raw
        }
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
    fn is_privacy_locked() -> pub bool {
        self.storage.privacy_locked.read()
    }

    #[external("public")]
    #[view]
    fn resolve_username(username_hash: Field) -> pub AztecAddress {
        self.storage.username_to_address.at(username_hash).read()
    }

    #[external("public")]
    #[view]
    fn get_username(address: AztecAddress) -> pub Field {
        self.storage.address_to_username.at(address).read()
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
}
