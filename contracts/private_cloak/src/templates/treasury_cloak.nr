/// Treasury Management Cloak Contract
///
/// Template for collective fund management with multi-sig support.
///
/// Key Features:
/// - Multi-asset treasury management
/// - Multi-sig approval for large transactions
/// - Privacy-aware balance display (hidden/approximate/exact)
/// - Spending proposals with approval thresholds
/// - Budget allocation and tracking
/// - Transparent transaction history
///
/// Privacy: Balanced (configurable, treasury tends toward transparency)

use dep::aztec::macros::aztec;

#[aztec]
pub contract TreasuryCloak {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::core::privacy_config::{PrivacyConfig, presets};
    use crate::types::proposal::VoteTally;
    use crate::types::member_info::MemberInfo;

    // ===== SPENDING PROPOSAL STRUCT =====

    #[derive(Serialize, Deserialize, Eq)]
    struct SpendingProposal {
        id: u64,
        creator: AztecAddress,
        title: FieldCompressedString,
        description: FieldCompressedString,
        recipient: AztecAddress,
        amount: u128,
        asset: AztecAddress, // Zero for native asset
        category: u8, // 0=general, 1=development, 2=marketing, 3=operations, 4=grants
        start_block: u32,
        end_block: u32,
        executed: bool,
        signature_count: u8,
    }

    impl SpendingProposal {
        fn new() -> Self {
            Self {
                id: 0,
                creator: AztecAddress::zero(),
                title: FieldCompressedString::from_string(""),
                description: FieldCompressedString::from_string(""),
                recipient: AztecAddress::zero(),
                amount: 0,
                asset: AztecAddress::zero(),
                category: 0,
                start_block: 0,
                end_block: 0,
                executed: false,
                signature_count: 0,
            }
        }
    }

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // ===== CONFIGURATION =====
        name: PublicImmutable<FieldCompressedString, Context>,
        admin: PublicMutable<AztecAddress, Context>,

        // ===== IDENTITY ABSTRACTION =====
        username_to_address: Map<Field, PublicMutable<AztecAddress, Context>, Context>,
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

        // ===== TREASURY =====
        /// Native asset balance
        treasury_balance: PublicMutable<u128, Context>,
        /// Approximate balance for privacy display
        approximate_balance: PublicMutable<u128, Context>,
        /// ERC20 token balances (token address → balance)
        asset_balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        /// Total assets under management
        total_assets: PublicMutable<u128, Context>,

        // ===== MULTI-SIG =====
        /// Addresses that can sign spending proposals
        signers: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        /// Number of required signatures for execution
        required_signatures: PublicMutable<u8, Context>,
        /// Total number of signers
        signer_count: PublicMutable<u8, Context>,
        /// Proposal ID → signer → has signed
        proposal_signatures: Map<Field, Map<AztecAddress, PublicMutable<bool, Context>, Context>, Context>,

        // ===== SPENDING PROPOSALS =====
        proposals: Map<Field, PublicMutable<SpendingProposal, Context>, Context>,
        proposal_count: PublicMutable<u64, Context>,
        vote_tallies: Map<Field, PublicMutable<VoteTally, Context>, Context>,

        // ===== BUDGET TRACKING =====
        /// Category budgets (category → allocated amount)
        category_budgets: Map<u8, PublicMutable<u128, Context>, Context>,
        /// Category spent (category → spent amount)
        category_spent: Map<u8, PublicMutable<u128, Context>, Context>,
        /// Per-user spending limits (address → limit)
        spending_limits: Map<AztecAddress, PublicMutable<u128, Context>, Context>,

        // ===== GOVERNANCE SETTINGS =====
        voting_duration: PublicMutable<u32, Context>,
        quorum_threshold: PublicMutable<u64, Context>,
        /// Threshold for requiring multi-sig (amount above this needs signatures)
        multisig_threshold: PublicMutable<u128, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        admin: AztecAddress,
        required_signatures: u8,
        voting_duration: u32,
        quorum_threshold: u64,
        multisig_threshold: u128,
        privacy_preset: u8,
    
        membership_mode: u8,
        token_gate_address: AztecAddress,
        token_address: AztecAddress,
        erc20_token_address_hash: Field,
        erc20_min_balance: u128,
    ) {
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.admin.write(admin);
        self.storage.required_signatures.write(required_signatures);
        self.storage.voting_duration.write(voting_duration);
        self.storage.quorum_threshold.write(quorum_threshold);
        self.storage.multisig_threshold.write(multisig_threshold);

        // Initialize privacy config
        let config = if privacy_preset == 0 {
            presets::maximum_privacy()
        } else if privacy_preset == 2 {
            presets::transparent()
        } else {
            presets::treasury_cloak()
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

        // Initialize counters
        self.storage.member_count.write(0);
        self.storage.proposal_count.write(0);
        self.storage.signer_count.write(0);
        self.storage.treasury_balance.write(0);
        self.storage.approximate_balance.write(0);
        self.storage.total_assets.write(0);

        // Add admin as first member and signer
        self.storage.members.at(admin).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 2,
            domain_proof_nullifier: 0,
        });
        self.storage.member_count.write(1);
        self.storage.signers.at(admin).write(true);
        self.storage.signer_count.write(1);
    
        // Initialize token gating
        self.storage.membership_mode.write(membership_mode);
        self.storage.token_gate_address.write(token_gate_address);
        self.storage.token_address.write(token_address);
        self.storage.erc20_token_address_hash.write(erc20_token_address_hash);
        self.storage.erc20_min_balance.write(erc20_min_balance);
    }

    // ===== MEMBERSHIP =====

    /// Add a member (admin only)
    #[external("public")]
    fn add_member(new_member: AztecAddress, voting_power: u128) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let existing = self.storage.members.at(new_member).read();
        let is_new = existing.voting_power == 0;

        self.storage.members.at(new_member).write(MemberInfo {
            voting_power,
            joined_at: self.context.block_number(),
            role: 0,
            domain_proof_nullifier: 0,
        });

        if is_new {
            let count = self.storage.member_count.read();
            self.storage.member_count.write(count + 1);
        }
    }

    /// Remove a member (admin only)
    #[external("public")]
    fn remove_member(member: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");
        assert(!member.eq(admin), "cannot remove admin");

        let existing = self.storage.members.at(member).read();
        assert(existing.voting_power > 0, "not a member");

        self.storage.members.at(member).write(MemberInfo::new());

        // Also remove signer status
        if self.storage.signers.at(member).read() {
            self.storage.signers.at(member).write(false);
            let signer_count = self.storage.signer_count.read();
            if signer_count > 0 {
                self.storage.signer_count.write(signer_count - 1);
            }
        }

        let count = self.storage.member_count.read();
        if count > 0 {
            self.storage.member_count.write(count - 1);
        }
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

    // ===== MULTI-SIG MANAGEMENT =====

    /// Add a signer (admin only)
    #[external("public")]
    fn add_signer(signer: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        // Must be a member
        let member = self.storage.members.at(signer).read();
        assert(member.voting_power > 0, "not a member");

        // Check not already a signer
        let is_signer = self.storage.signers.at(signer).read();
        assert(!is_signer, "already a signer");

        self.storage.signers.at(signer).write(true);
        let count = self.storage.signer_count.read();
        self.storage.signer_count.write(count + 1);
    }

    /// Remove a signer (admin only)
    #[external("public")]
    fn remove_signer(signer: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let is_signer = self.storage.signers.at(signer).read();
        assert(is_signer, "not a signer");

        // Ensure we maintain required signatures
        let count = self.storage.signer_count.read();
        let required = self.storage.required_signatures.read();
        assert(count > required, "would have fewer signers than required");

        self.storage.signers.at(signer).write(false);
        self.storage.signer_count.write(count - 1);
    }

    /// Update required signatures (admin only)
    #[external("public")]
    fn set_required_signatures(required: u8) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let signer_count = self.storage.signer_count.read();
        assert(required <= signer_count, "not enough signers");
        assert(required >= 1, "need at least 1 signature");

        self.storage.required_signatures.write(required);
    }

    // ===== SPENDING PROPOSALS =====

    /// Create a spending proposal
    #[external("public")]
    fn create_spending_proposal(
        title: FieldCompressedString,
        description: FieldCompressedString,
        recipient: AztecAddress,
        amount: u128,
        asset: AztecAddress,
        category: u8,
    ) -> pub u64 {
        let creator = self.msg_sender().unwrap();
        let member = self.storage.members.at(creator).read();
        assert(member.voting_power > 0, "not a member");

        let proposal_id = self.storage.proposal_count.read();
        let voting_duration = self.storage.voting_duration.read();

        let proposal = SpendingProposal {
            id: proposal_id,
            creator,
            title,
            description,
            recipient,
            amount,
            asset,
            category,
            start_block: self.context.block_number(),
            end_block: self.context.block_number() + voting_duration,
            executed: false,
            signature_count: 0,
        };

        self.storage.proposals.at(proposal_id as Field).write(proposal);
        self.storage.proposal_count.write(proposal_id + 1);
        self.storage.vote_tallies.at(proposal_id as Field).write(VoteTally::new());

        proposal_id
    }

    /// Cast a private vote on a spending proposal
    #[external("private")]
    fn cast_vote(proposal_id: Field, vote_choice: bool) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        // Nullifier prevents double voting
        let nullifier = std::hash::pedersen_hash([proposal_id, secret]);
        self.context.push_nullifier(nullifier);

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

    /// Sign a spending proposal (for multi-sig)
    #[external("public")]
    fn sign_proposal(proposal_id: Field) {
        let signer = self.msg_sender().unwrap();
        assert(self.storage.signers.at(signer).read(), "not a signer");

        let mut proposal = self.storage.proposals.at(proposal_id).read();
        assert(!proposal.executed, "already executed");

        // Check not already signed
        let already_signed = self.storage.proposal_signatures.at(proposal_id).at(signer).read();
        assert(!already_signed, "already signed");

        // Record signature
        self.storage.proposal_signatures.at(proposal_id).at(signer).write(true);
        proposal.signature_count += 1;
        self.storage.proposals.at(proposal_id).write(proposal);
    }

    /// Execute a spending proposal
    #[external("public")]
    fn execute_spending_proposal(proposal_id: Field) {
        let proposal = self.storage.proposals.at(proposal_id).read();
        let tally = self.storage.vote_tallies.at(proposal_id).read();
        let quorum = self.storage.quorum_threshold.read();
        let multisig_threshold = self.storage.multisig_threshold.read();
        let required_signatures = self.storage.required_signatures.read();

        assert(!proposal.executed, "already executed");
        assert(self.context.block_number() > proposal.end_block, "voting not ended");
        assert(tally.total_votes >= quorum as u128, "quorum not met");
        assert(tally.yes_votes > tally.no_votes, "proposal did not pass");

        // Check multi-sig requirements for large amounts
        if proposal.amount >= multisig_threshold {
            assert(proposal.signature_count >= required_signatures, "not enough signatures");
        }

        // Check budget
        let budget = self.storage.category_budgets.at(proposal.category).read();
        let spent = self.storage.category_spent.at(proposal.category).read();
        if budget > 0 {
            assert(spent + proposal.amount <= budget, "exceeds category budget");
        }

        // Check treasury balance
        let balance = if proposal.asset.is_zero() {
            self.storage.treasury_balance.read()
        } else {
            self.storage.asset_balances.at(proposal.asset).read()
        };
        assert(balance >= proposal.amount, "insufficient funds");

        // Execute the transfer
        if proposal.asset.is_zero() {
            let new_balance = balance - proposal.amount;
            self.storage.treasury_balance.write(new_balance);
            self.update_approximate_balance(new_balance);
        } else {
            self.storage.asset_balances.at(proposal.asset).write(balance - proposal.amount);
        }

        // Update spent tracking
        self.storage.category_spent.at(proposal.category).write(spent + proposal.amount);

        // Mark as executed
        let mut executed_proposal = proposal;
        executed_proposal.executed = true;
        self.storage.proposals.at(proposal_id).write(executed_proposal);
    }

    // ===== BUDGET MANAGEMENT =====

    /// Set budget for a category (admin only)
    #[external("public")]
    fn set_category_budget(category: u8, amount: u128) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.category_budgets.at(category).write(amount);
    }

    /// Set spending limit for a member (admin only)
    #[external("public")]
    fn set_spending_limit(member: AztecAddress, limit: u128) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.spending_limits.at(member).write(limit);
    }

    // ===== DEPOSIT FUNCTIONS =====

    /// Deposit native asset to treasury
    #[external("public")]
    fn deposit(amount: u128) {
        let current = self.storage.treasury_balance.read();
        let new_balance = current + amount;
        self.storage.treasury_balance.write(new_balance);
        self.update_approximate_balance(new_balance);

        let total = self.storage.total_assets.read();
        self.storage.total_assets.write(total + amount);
    }

    /// Deposit ERC20 token to treasury
    #[external("public")]
    fn deposit_asset(asset: AztecAddress, amount: u128) {
        let current = self.storage.asset_balances.at(asset).read();
        self.storage.asset_balances.at(asset).write(current + amount);

        let total = self.storage.total_assets.read();
        self.storage.total_assets.write(total + amount);
    }

    // ===== INTERNAL HELPERS =====

    fn update_approximate_balance(&mut self, exact_balance: u128) {
        // Round to nearest significant figure for approximate display
        let approximate = if exact_balance < 1000 {
            ((exact_balance + 50) / 100) * 100
        } else if exact_balance < 10000 {
            ((exact_balance + 500) / 1000) * 1000
        } else {
            ((exact_balance + 5000) / 10000) * 10000
        };
        self.storage.approximate_balance.write(approximate);
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
    fn get_member_count() -> pub u64 {
        self.storage.member_count.read()
    }

    #[external("public")]
    #[view]
    fn is_member(address: AztecAddress) -> pub bool {
        self.storage.members.at(address).read().voting_power > 0
    }

    #[external("public")]
    #[view]
    fn is_signer(address: AztecAddress) -> pub bool {
        self.storage.signers.at(address).read()
    }

    #[external("public")]
    #[view]
    fn get_signer_count() -> pub u8 {
        self.storage.signer_count.read()
    }

    #[external("public")]
    #[view]
    fn get_required_signatures() -> pub u8 {
        self.storage.required_signatures.read()
    }

    /// Get treasury balance (respects privacy settings)
    #[external("public")]
    #[view]
    fn get_treasury_balance() -> pub u128 {
        let visibility = self.storage.priv_balance.read();
        if visibility == 0 {
            0 // Hidden
        } else if visibility == 1 {
            self.storage.approximate_balance.read()
        } else {
            self.storage.treasury_balance.read()
        }
    }

    #[external("public")]
    #[view]
    fn get_exact_balance() -> pub u128 {
        self.storage.treasury_balance.read()
    }

    #[external("public")]
    #[view]
    fn get_asset_balance(asset: AztecAddress) -> pub u128 {
        self.storage.asset_balances.at(asset).read()
    }

    #[external("public")]
    #[view]
    fn get_proposal_count() -> pub u64 {
        self.storage.proposal_count.read()
    }

    #[external("public")]
    #[view]
    fn get_proposal(proposal_id: Field) -> pub SpendingProposal {
        self.storage.proposals.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn get_vote_tally(proposal_id: Field) -> pub VoteTally {
        self.storage.vote_tallies.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn get_category_budget(category: u8) -> pub u128 {
        self.storage.category_budgets.at(category).read()
    }

    #[external("public")]
    #[view]
    fn get_category_spent(category: u8) -> pub u128 {
        self.storage.category_spent.at(category).read()
    }

    #[external("public")]
    #[view]
    fn get_multisig_threshold() -> pub u128 {
        self.storage.multisig_threshold.read()
    }

    #[external("public")]
    #[view]
    fn has_signed(proposal_id: Field, signer: AztecAddress) -> pub bool {
        self.storage.proposal_signatures.at(proposal_id).at(signer).read()
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
