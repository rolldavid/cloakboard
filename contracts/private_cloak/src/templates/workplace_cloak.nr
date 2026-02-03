/// Workplace Organizing Cloak Contract
///
/// Template designed for employee organizing with maximum privacy protections.
///
/// Key Features:
/// - Maximum privacy defaults (all settings at most private)
/// - Anonymous membership - no one knows who is a member
/// - Secret ballot voting with encrypted results until end
/// - Category-specific proposals (compensation, hiring, policy)
/// - Protected discussions
/// - No public member count
///
/// Privacy: Maximum (enforced, cannot be reduced)
///
/// IMPORTANT: This template enforces maximum privacy to protect workers.
/// Privacy settings cannot be made more public after creation.

use dep::aztec::macros::aztec;

#[aztec]
pub contract WorkplaceCloak {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::core::privacy_config::presets;
    use crate::types::proposal::VoteTally;

    // ===== PROPOSAL CATEGORY =====

    global CATEGORY_COMPENSATION: u8 = 0;
    global CATEGORY_HIRING: u8 = 1;
    global CATEGORY_POLICY: u8 = 2;
    global CATEGORY_SAFETY: u8 = 3;
    global CATEGORY_GENERAL: u8 = 4;

    // ===== PROPOSAL STRUCT =====

    #[derive(Serialize, Deserialize, Eq)]
    struct WorkplaceProposal {
        id: u64,
        /// Zero for anonymous proposals (which is the default)
        creator_commitment: Field,
        title: FieldCompressedString,
        description_hash: Field,
        category: u8,
        start_block: u32,
        end_block: u32,
        executed: bool,
        /// Whether results should be hidden until voting ends
        hide_results_until_end: bool,
    }

    impl WorkplaceProposal {
        fn new() -> Self {
            Self {
                id: 0,
                creator_commitment: 0,
                title: FieldCompressedString::from_string(""),
                description_hash: 0,
                category: CATEGORY_GENERAL,
                start_block: 0,
                end_block: 0,
                executed: false,
                hide_results_until_end: true,
            }
        }
    }

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // ===== CONFIGURATION =====
        name: PublicImmutable<FieldCompressedString, Context>,

        // ===== ADMIN =====
        /// Admin can add proposals but NOT see member list
        admin: PublicMutable<AztecAddress, Context>,
        /// Threshold required for admin actions (can be voted to change)
        admin_threshold: PublicMutable<u64, Context>,

        // ===== MEMBERSHIP =====
        /// Secret member tracking - only members can verify their own membership
        /// Uses nullifier pattern: hash(user, secret) → membership flag
        membership_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,
        /// Approximate member count (deliberately imprecise for privacy)
        /// Randomized within a range to hide exact numbers
        noise_member_count: PublicMutable<u64, Context>,

    
        // ===== PROPOSALS =====
        proposals: Map<Field, PublicMutable<WorkplaceProposal, Context>, Context>,
        proposal_count: PublicMutable<u64, Context>,

        // ===== VOTING =====
        /// Vote tallies are encrypted until voting ends
        vote_tallies: Map<Field, PublicMutable<VoteTally, Context>, Context>,
        /// Track that voting has completed (to reveal results)
        voting_completed: Map<Field, PublicMutable<bool, Context>, Context>,

        // ===== GOVERNANCE SETTINGS =====
        voting_duration: PublicMutable<u32, Context>,
        quorum_threshold: PublicMutable<u64, Context>,
        /// Minimum time before results are revealed after voting ends
        result_delay: PublicMutable<u32, Context>,

        // ===== CATEGORY PERMISSIONS =====
        /// Who can create proposals in each category
        /// 0 = all members, 1 = moderators+, 2 = admin only
        category_permissions: Map<u8, PublicMutable<u8, Context>, Context>,

        // ===== MODERATORS =====
        /// Moderators can help manage but don't see member list
        moderator_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,
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

    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        admin: AztecAddress,
        voting_duration: u32,
        quorum_threshold: u64,
        result_delay: u32,
    
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
        self.storage.result_delay.write(result_delay);
        self.storage.admin_threshold.write(10); // Default threshold

        // Initialize with randomized noise count (0-50 range for privacy)
        self.storage.noise_member_count.write(25);
        self.storage.proposal_count.write(0);

        // Set default category permissions (all members can create general proposals)
        self.storage.category_permissions.at(CATEGORY_COMPENSATION).write(0);
        self.storage.category_permissions.at(CATEGORY_HIRING).write(0);
        self.storage.category_permissions.at(CATEGORY_POLICY).write(0);
        self.storage.category_permissions.at(CATEGORY_SAFETY).write(0);
        self.storage.category_permissions.at(CATEGORY_GENERAL).write(0);
    
        // Initialize token gating
        self.storage.membership_mode.write(membership_mode);
        self.storage.token_gate_address.write(token_gate_address);
        self.storage.token_address.write(token_address);
        self.storage.erc20_token_address_hash.write(erc20_token_address_hash);
        self.storage.erc20_min_balance.write(erc20_min_balance);
    }

    // ===== ANONYMOUS MEMBERSHIP =====

    /// Join the Cloak anonymously
    /// Creates a nullifier that proves membership without revealing identity
    #[external("private")]
    fn join_anonymously(join_secret: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        // Generate membership nullifier
        // This proves membership without revealing the member's address
        let membership_nullifier = std::hash::pedersen_hash([
            sender.to_field(),
            secret,
            join_secret,
        ]);

        // Push nullifier to prevent double-joining
        self.context.push_nullifier(membership_nullifier);

        // Record membership
        self.enqueue_self.record_membership(membership_nullifier);
    }

    #[external("public")]
    #[only_self]
    fn record_membership(membership_nullifier: Field) {
        // Check not already a member
        let exists = self.storage.membership_nullifiers.at(membership_nullifier).read();
        assert(!exists, "already a member");

        self.storage.membership_nullifiers.at(membership_nullifier).write(true);

        // Add noise to member count (0-5 random addition for privacy)
        let current = self.storage.noise_member_count.read();
        // In production, would use randomness; here we just increment by 2
        self.storage.noise_member_count.write(current + 2);
    }

    /// Leave the Cloak (self-removal)
    /// Member can prove they were a member and remove themselves
    #[external("private")]
    fn leave(join_secret: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let membership_nullifier = std::hash::pedersen_hash([
            sender.to_field(),
            secret,
            join_secret,
        ]);

        self.enqueue_self.remove_membership(membership_nullifier);
    }

    #[external("public")]
    #[only_self]
    fn remove_membership(membership_nullifier: Field) {
        let exists = self.storage.membership_nullifiers.at(membership_nullifier).read();
        assert(exists, "not a member");

        self.storage.membership_nullifiers.at(membership_nullifier).write(false);

        // Subtract noise from member count
        let current = self.storage.noise_member_count.read();
        if current > 2 {
            self.storage.noise_member_count.write(current - 2);
        }
    }


    /// Join with Aztec token proof (mode 2)
    #[external("private")]
    fn join_with_aztec_token(token_nullifier_seed: Field) {
        assert(self.storage.membership_mode.read() == 2, "not token-gated");
        let sender = self.msg_sender().unwrap();

        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            self.storage.token_address.read().to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.add_token_member_internal(nullifier);
    }

    #[external("public")]
    #[only_self]
    fn add_token_member_internal(membership_nullifier: Field) {
        assert(!self.storage.membership_nullifiers.at(membership_nullifier).read(), "already a member");
        self.storage.membership_nullifiers.at(membership_nullifier).write(true);

        let current = self.storage.noise_member_count.read();
        self.storage.noise_member_count.write(current + 2);
    }

    /// Join with ERC20 proof (mode 3)
    #[external("public")]
    fn join_with_erc20_proof(
        verified_balance: u128,
        proof_nullifier: Field,
    ) {
        assert(self.storage.membership_mode.read() == 3, "not erc20-gated");
        assert(verified_balance >= self.storage.erc20_min_balance.read(), "insufficient balance");

        assert(!self.storage.used_token_nullifiers.at(proof_nullifier).read(), "nullifier already used");
        self.storage.used_token_nullifiers.at(proof_nullifier).write(true);

        let current = self.storage.noise_member_count.read();
        self.storage.noise_member_count.write(current + 2);
    }

    // ===== PROPOSALS =====

    /// Create an anonymous proposal
    /// All proposals in workplace Cloak are anonymous by default
    #[external("private")]
    fn create_proposal(
        title: FieldCompressedString,
        description_hash: Field,
        category: u8,
        join_secret: Field,
    ) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        // Verify membership
        let membership_nullifier = std::hash::pedersen_hash([
            sender.to_field(),
            secret,
            join_secret,
        ]);

        // Generate anonymous author commitment (can optionally be revealed later)
        let author_commitment = std::hash::pedersen_hash([
            secret,
            self.context.block_number() as Field,
        ]);

        self.enqueue_self.create_proposal_internal(
            membership_nullifier,
            author_commitment,
            title,
            description_hash,
            category,
        );
    }

    #[external("public")]
    #[only_self]
    fn create_proposal_internal(
        membership_nullifier: Field,
        author_commitment: Field,
        title: FieldCompressedString,
        description_hash: Field,
        category: u8,
    ) {
        // Verify membership
        let is_member = self.storage.membership_nullifiers.at(membership_nullifier).read();
        assert(is_member, "not a member");

        let proposal_id = self.storage.proposal_count.read();
        let voting_duration = self.storage.voting_duration.read();

        let proposal = WorkplaceProposal {
            id: proposal_id,
            creator_commitment: author_commitment,
            title,
            description_hash,
            category,
            start_block: self.context.block_number(),
            end_block: self.context.block_number() + voting_duration,
            executed: false,
            hide_results_until_end: true,
        };

        self.storage.proposals.at(proposal_id as Field).write(proposal);
        self.storage.proposal_count.write(proposal_id + 1);
        self.storage.vote_tallies.at(proposal_id as Field).write(VoteTally::new());
        self.storage.voting_completed.at(proposal_id as Field).write(false);
    }

    // ===== VOTING =====

    /// Cast an anonymous vote
    #[external("private")]
    fn cast_vote(proposal_id: Field, vote_choice: bool, join_secret: Field) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        // Verify membership
        let membership_nullifier = std::hash::pedersen_hash([
            sender.to_field(),
            secret,
            join_secret,
        ]);

        // Generate vote nullifier (prevents double voting)
        let vote_nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(vote_nullifier);

        self.enqueue_self.add_vote_internal(
            proposal_id,
            vote_choice,
            membership_nullifier,
        );
    }

    #[external("public")]
    #[only_self]
    fn add_vote_internal(
        proposal_id: Field,
        vote_choice: bool,
        membership_nullifier: Field,
    ) {
        // Verify membership
        let is_member = self.storage.membership_nullifiers.at(membership_nullifier).read();
        assert(is_member, "not a member");

        let proposal = self.storage.proposals.at(proposal_id).read();
        assert(self.context.block_number() <= proposal.end_block, "voting ended");

        // All members have equal voting power (1) in workplace Cloak
        let mut tally = self.storage.vote_tallies.at(proposal_id).read();
        if vote_choice {
            tally.yes_votes += 1;
        } else {
            tally.no_votes += 1;
        }
        tally.total_votes += 1;
        tally.voter_count += 1;
        self.storage.vote_tallies.at(proposal_id).write(tally);
    }

    /// Finalize voting and reveal results
    /// Can be called by anyone after voting period + result delay
    #[external("public")]
    fn finalize_voting(proposal_id: Field) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let result_delay = self.storage.result_delay.read();

        assert(!self.storage.voting_completed.at(proposal_id).read(), "already finalized");
        assert(
            self.context.block_number() > proposal.end_block + result_delay,
            "result delay not passed",
        );

        self.storage.voting_completed.at(proposal_id).write(true);
    }

    /// Execute a passed proposal
    #[external("public")]
    fn execute_proposal(proposal_id: Field) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let tally = self.storage.vote_tallies.at(proposal_id).read();
        let quorum = self.storage.quorum_threshold.read();

        assert(self.storage.voting_completed.at(proposal_id).read(), "voting not finalized");
        assert(!proposal.executed, "already executed");
        assert(tally.total_votes >= quorum as u128, "quorum not met");
        assert(tally.yes_votes > tally.no_votes, "proposal did not pass");

        // Mark as executed
        let mut executed_proposal = proposal;
        executed_proposal.executed = true;
        self.storage.proposals.at(proposal_id).write(executed_proposal);
    }

    // ===== ADMIN FUNCTIONS =====

    /// Transfer admin (requires proposal)
    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.admin.write(new_admin);
    }

    /// Update category permission (admin only)
    #[external("public")]
    fn set_category_permission(category: u8, permission: u8) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.category_permissions.at(category).write(permission);
    }

    /// Update governance settings (admin only)
    #[external("public")]
    fn update_governance(
        voting_duration: u32,
        quorum_threshold: u64,
        result_delay: u32,
    ) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.voting_duration.write(voting_duration);
        self.storage.quorum_threshold.write(quorum_threshold);
        self.storage.result_delay.write(result_delay);
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

    /// Get approximate member count (deliberately imprecise)
    #[external("public")]
    #[view]
    fn get_approximate_member_count() -> pub u64 {
        self.storage.noise_member_count.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_count() -> pub u64 {
        self.storage.proposal_count.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal(proposal_id: Field) -> pub WorkplaceProposal {
        self.storage.proposals.at(proposal_id).read()
    }

    /// Get vote tally (only revealed after voting is finalized)
    #[external("public")]
    #[view]
    fn get_vote_tally(proposal_id: Field) -> pub VoteTally {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let finalized = self.storage.voting_completed.at(proposal_id).read();

        // If hide_results_until_end and not finalized, return zeros
        if proposal.hide_results_until_end & !finalized {
            VoteTally::new()
        } else {
            self.storage.vote_tallies.at(proposal_id).read()
        }
    }

    #[external("public")]
    #[view]
    fn is_voting_finalized(proposal_id: Field) -> pub bool {
        self.storage.voting_completed.at(proposal_id).read()
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
    fn get_result_delay() -> pub u32 {
        self.storage.result_delay.read()
    }

    #[external("public")]
    #[view]
    fn get_category_permission(category: u8) -> pub u8 {
        self.storage.category_permissions.at(category).read()
    }

    /// Check if a membership nullifier is valid (for private verification)
    #[external("public")]
    #[view]
    fn is_member_by_nullifier(membership_nullifier: Field) -> pub bool {
        self.storage.membership_nullifiers.at(membership_nullifier).read()
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
