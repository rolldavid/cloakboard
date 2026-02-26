/// Duel Cloak Contract V4 - Privacy-preserving binary voting
///
/// V3 Architecture -- Trustless Private Voting:
/// - Votes: cast_vote is PRIVATE. The voter's browser generates a ZK proof
///   that enqueues a public counter update. The voter's address NEVER appears
///   in any public function argument. A nullifier (derived from the voter's
///   secret key + duel_id) prevents double-voting without revealing identity.
/// - Tallying: REAL-TIME. agree_votes and disagree_votes are incremented
///   directly by the voter's enqueued public call. No keeper tally needed.
///   total_votes = agree + disagree, computed on read.
/// - Privacy: The public call args reveal the direction (1,0 vs 0,1) but
///   there is NO link to the voter. The keeper cannot see who voted or how.
///   The keeper is ONLY used for admin (start_duel, submit_statement_hash).
///
/// Roles:
///   0 = NONE, 1 = MEMBER, 2 = COUNCIL, 3 = CREATOR

use aztec::macros::aztec;

#[aztec]
pub contract DuelCloak {
    use aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, only_self, internal}, storage::storage},
        protocol::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use compressed_string::FieldCompressedString;
    use crate::types::duel::Duel;
    use crate::types::removal_proposal::RemovalProposal;

    // ===== ROLE CONSTANTS =====
    global ROLE_NONE: u8 = 0;
    global ROLE_MEMBER: u8 = 1;
    global ROLE_COUNCIL: u8 = 2;
    global ROLE_CREATOR: u8 = 3;

    // ===== REMOVAL RESULT CONSTANTS =====
    global REMOVAL_PENDING: u8 = 0;
    global REMOVAL_REMOVED: u8 = 1;
    global REMOVAL_KEPT: u8 = 2;

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // Config
        name: PublicImmutable<FieldCompressedString, Context>,
        creator: PublicImmutable<AztecAddress, Context>,
        keeper: PublicImmutable<AztecAddress, Context>,
        allowed_account_class_id: PublicImmutable<Field, Context>,
        duel_duration: PublicMutable<u32, Context>,
        first_duel_block: PublicMutable<u32, Context>,
        is_publicly_viewable: PublicMutable<bool, Context>,

        // Membership (role: 0=none, 1=member, 2=council, 3=creator)
        member_roles: Map<AztecAddress, PublicMutable<u8, Context>, Context>,
        member_count: PublicMutable<u64, Context>,
        council_count: PublicMutable<u64, Context>,

        // Statement pool (public: only hashes)
        statement_pool: Map<Field, PublicMutable<bool, Context>, Context>,
        statement_by_index: Map<Field, PublicMutable<Field, Context>, Context>,
        statement_count: PublicMutable<u64, Context>,

        // Active duel
        current_duel_id: PublicMutable<u64, Context>,

        // Duel history
        duel_count: PublicMutable<u64, Context>,
        duels: Map<Field, PublicMutable<Duel, Context>, Context>,

        // Council removal governance
        removal_count: PublicMutable<u64, Context>,
        removal_proposals: Map<Field, PublicMutable<RemovalProposal, Context>, Context>,
        removal_votes: Map<Field, Map<AztecAddress, PublicMutable<bool, Context>, Context>, Context>,
        removal_keep_votes: Map<Field, PublicMutable<u64, Context>, Context>,
        removal_remove_votes: Map<Field, PublicMutable<u64, Context>, Context>,
        removal_vote_duration: PublicMutable<u32, Context>,

    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        duel_duration: u32,
        first_duel_block: u32,
        is_publicly_viewable: bool,
        keeper_address: AztecAddress,
        allowed_account_class_id: Field,
        _tally_mode: u8,
        creator: AztecAddress,
    ) {
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.creator.initialize(creator);
        self.storage.keeper.initialize(keeper_address);
        self.storage.allowed_account_class_id.initialize(allowed_account_class_id);
        self.storage.duel_duration.write(duel_duration);
        self.storage.first_duel_block.write(first_duel_block);
        self.storage.is_publicly_viewable.write(is_publicly_viewable);

        self.storage.member_roles.at(creator).write(ROLE_CREATOR);
        self.storage.member_count.write(1);
        self.storage.council_count.write(1);

        self.storage.current_duel_id.write(0);
        self.storage.duel_count.write(0);
        self.storage.statement_count.write(0);

        self.storage.removal_count.write(0);
        self.storage.removal_vote_duration.write(duel_duration);
    }

    // =========================================================================
    // MEMBERSHIP & COUNCIL
    // =========================================================================

    #[external("public")]
    fn invite_member(member: AztecAddress) {
        let sender = self.msg_sender();
        let sender_role = self.storage.member_roles.at(sender).read();
        assert(sender_role >= ROLE_COUNCIL, "only council or creator");

        let existing_role = self.storage.member_roles.at(member).read();
        if existing_role == ROLE_NONE {
            self.storage.member_roles.at(member).write(ROLE_MEMBER);
            let count = self.storage.member_count.read();
            self.storage.member_count.write(count + 1);
        }
    }

    #[external("public")]
    fn invite_council(member: AztecAddress) {
        let sender = self.msg_sender();
        let sender_role = self.storage.member_roles.at(sender).read();
        assert(sender_role >= ROLE_COUNCIL, "only council or creator");

        let existing_role = self.storage.member_roles.at(member).read();
        if existing_role == ROLE_NONE {
            self.storage.member_roles.at(member).write(ROLE_COUNCIL);
            let m_count = self.storage.member_count.read();
            self.storage.member_count.write(m_count + 1);
            let c_count = self.storage.council_count.read();
            self.storage.council_count.write(c_count + 1);
        } else if existing_role == ROLE_MEMBER {
            self.storage.member_roles.at(member).write(ROLE_COUNCIL);
            let c_count = self.storage.council_count.read();
            self.storage.council_count.write(c_count + 1);
        }
    }

    // =========================================================================
    // COUNCIL REMOVAL GOVERNANCE
    // =========================================================================

    #[external("public")]
    fn propose_removal(target: AztecAddress) {
        let sender = self.msg_sender();
        let sender_role = self.storage.member_roles.at(sender).read();
        assert(sender_role >= ROLE_COUNCIL, "only council or creator");

        let c_count = self.storage.council_count.read();
        assert(c_count >= 3, "need at least 3 council members");

        let target_role = self.storage.member_roles.at(target).read();
        assert(target_role == ROLE_COUNCIL, "target must be council (not creator)");

        let removal_id = self.storage.removal_count.read();
        let duration = self.storage.removal_vote_duration.read();
        let start_block = self.context.block_number();
        let end_block = start_block + duration;

        let proposal = RemovalProposal {
            id: removal_id,
            target,
            proposer: sender,
            start_block,
            end_block,
            executed: false,
            result: REMOVAL_PENDING,
        };

        self.storage.removal_proposals.at(removal_id as Field).write(proposal);
        self.storage.removal_keep_votes.at(removal_id as Field).write(0);
        self.storage.removal_remove_votes.at(removal_id as Field).write(1);
        self.storage.removal_votes.at(removal_id as Field).at(sender).write(true);
        self.storage.removal_count.write(removal_id + 1);
    }

    #[external("public")]
    fn vote_on_removal(removal_id: u64, keep: bool) {
        let sender = self.msg_sender();
        let sender_role = self.storage.member_roles.at(sender).read();
        assert(sender_role >= ROLE_COUNCIL, "only council can vote on removal");

        let proposal = self.storage.removal_proposals.at(removal_id as Field).read();
        assert(!proposal.executed, "already executed");
        assert(self.context.block_number() <= proposal.end_block, "voting ended");

        let already_voted = self.storage.removal_votes.at(removal_id as Field).at(sender).read();
        assert(!already_voted, "already voted");

        self.storage.removal_votes.at(removal_id as Field).at(sender).write(true);

        if keep {
            let current = self.storage.removal_keep_votes.at(removal_id as Field).read();
            self.storage.removal_keep_votes.at(removal_id as Field).write(current + 1);
        } else {
            let current = self.storage.removal_remove_votes.at(removal_id as Field).read();
            self.storage.removal_remove_votes.at(removal_id as Field).write(current + 1);
        }
    }

    #[external("public")]
    fn execute_removal(removal_id: u64) {
        let mut proposal = self.storage.removal_proposals.at(removal_id as Field).read();
        assert(!proposal.executed, "already executed");
        assert(self.context.block_number() > proposal.end_block, "voting not ended");

        let keep_v = self.storage.removal_keep_votes.at(removal_id as Field).read();
        let remove_v = self.storage.removal_remove_votes.at(removal_id as Field).read();

        proposal.executed = true;

        if remove_v > keep_v {
            proposal.result = REMOVAL_REMOVED;
            self.storage.member_roles.at(proposal.target).write(ROLE_MEMBER);
            let c_count = self.storage.council_count.read();
            self.storage.council_count.write(c_count - 1);
        } else {
            proposal.result = REMOVAL_KEPT;
        }

        self.storage.removal_proposals.at(removal_id as Field).write(proposal);
    }

    // =========================================================================
    // V2: PUBLIC STATEMENT SUBMISSION
    // =========================================================================

    #[external("public")]
    fn submit_statement_hash(statement_hash: Field) {
        let sender = self.msg_sender();
        let keeper = self.storage.keeper.read();
        assert(sender == keeper, "only keeper");

        let exists = self.storage.statement_pool.at(statement_hash).read();
        assert(!exists, "statement already in pool");

        self.storage.statement_pool.at(statement_hash).write(true);
        let idx = self.storage.statement_count.read();
        self.storage.statement_by_index.at(idx as Field).write(statement_hash);
        self.storage.statement_count.write(idx + 1);
    }

    // =========================================================================
    // V2: PUBLIC DUEL START
    // =========================================================================

    #[external("public")]
    fn start_duel(
        statement_hash: Field,
        text_part_1: Field,
        text_part_2: Field,
        text_part_3: Field,
        text_part_4: Field,
    ) {
        let sender = self.msg_sender();
        let keeper = self.storage.keeper.read();
        assert(sender == keeper, "only keeper");

        let first_block = self.storage.first_duel_block.read();
        assert(self.context.block_number() >= first_block, "duels not started yet");

        let duel_count = self.storage.duel_count.read();
        if duel_count > 0 {
            let prev_duel = self.storage.duels.at((duel_count - 1) as Field).read();
            assert(self.context.block_number() > prev_duel.end_block, "current duel not ended");
        }

        let computed_hash = std::hash::pedersen_hash([text_part_1, text_part_2, text_part_3, text_part_4]);
        assert(computed_hash == statement_hash, "hash mismatch");

        let in_pool = self.storage.statement_pool.at(statement_hash).read();
        assert(in_pool, "statement not in pool");
        self.storage.statement_pool.at(statement_hash).write(false);

        let duration = self.storage.duel_duration.read();
        let start_block = self.context.block_number();
        let end_block = start_block + duration;

        let duel = Duel {
            id: duel_count,
            statement_part_1: text_part_1,
            statement_part_2: text_part_2,
            statement_part_3: text_part_3,
            statement_part_4: text_part_4,
            start_block,
            end_block,
            total_votes: 0,
            agree_votes: 0,
            disagree_votes: 0,
            is_tallied: false,
            started_by: sender,
        };

        self.storage.duels.at(duel_count as Field).write(duel);
        self.storage.current_duel_id.write(duel_count);
        self.storage.duel_count.write(duel_count + 1);
    }

    /// Combined submit + start in a single tx (saves ~30s vs two separate txs).
    /// Adds the statement hash to the pool AND starts the duel atomically.
    #[external("public")]
    fn submit_and_start_duel(
        text_part_1: Field,
        text_part_2: Field,
        text_part_3: Field,
        text_part_4: Field,
    ) {
        let sender = self.msg_sender();
        let keeper = self.storage.keeper.read();
        assert(sender == keeper, "only keeper");

        let first_block = self.storage.first_duel_block.read();
        assert(self.context.block_number() >= first_block, "duels not started yet");

        let duel_count = self.storage.duel_count.read();
        if duel_count > 0 {
            let prev_duel = self.storage.duels.at((duel_count - 1) as Field).read();
            assert(self.context.block_number() > prev_duel.end_block, "current duel not ended");
        }

        // Compute hash and add to pool + remove atomically (no need to persist separately)
        let statement_hash = std::hash::pedersen_hash([text_part_1, text_part_2, text_part_3, text_part_4]);
        let idx = self.storage.statement_count.read();
        self.storage.statement_by_index.at(idx as Field).write(statement_hash);
        self.storage.statement_count.write(idx + 1);

        // Create duel
        let duration = self.storage.duel_duration.read();
        let start_block = self.context.block_number();
        let end_block = start_block + duration;

        let duel = Duel {
            id: duel_count,
            statement_part_1: text_part_1,
            statement_part_2: text_part_2,
            statement_part_3: text_part_3,
            statement_part_4: text_part_4,
            start_block,
            end_block,
            total_votes: 0,
            agree_votes: 0,
            disagree_votes: 0,
            is_tallied: false,
            started_by: sender,
        };

        self.storage.duels.at(duel_count as Field).write(duel);
        self.storage.current_duel_id.write(duel_count);
        self.storage.duel_count.write(duel_count + 1);
    }

    // =========================================================================
    // V3: PRIVATE VOTING -- TRUSTLESS, NO KEEPER
    //
    // Privacy guarantees:
    // 1. Voter address NEVER appears in any public function argument
    // 2. No private notes -- nothing encrypted to any third party
    // 3. Nullifier is derived from voter's secret key -- unlinkable to address
    // 4. The enqueued public call is #[only_self], so msg_sender = contract
    // 5. Direction (agree/disagree) visible in public args but NOT linked to identity
    // =========================================================================

    #[external("private")]
    fn cast_vote(duel_id: Field, support: bool) {
        let sender = self.msg_sender();

        // Double-vote nullifier: hash(duel_id, secret_derived_from_keys)
        // The nullifier is unique per (voter, duel) but cannot be traced
        // back to the voter's address by anyone.
        let npk_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nhk_app(npk_hash);
        let nullifier = std::hash::pedersen_hash([duel_id, secret]);
        self.context.push_nullifier(nullifier);

        // Directly update public counters -- no keeper, no VoteNotes.
        // The voter's address is NOT passed to the public function.
        let agree_delta: u64 = if support { 1 } else { 0 };
        let disagree_delta: u64 = if support { 0 } else { 1 };
        self.enqueue_self.apply_vote(duel_id, agree_delta, disagree_delta);
    }

    /// Public counter update, callable only from this contract's private cast_vote.
    /// No voter address -- the caller is the contract itself (#[only_self]).
    #[external("public")]
    #[only_self]
    fn apply_vote(duel_id: Field, agree_delta: u64, disagree_delta: u64) {
        let mut duel = self.storage.duels.at(duel_id).read();

        assert(self.context.block_number() >= duel.start_block, "duel not started");
        assert(self.context.block_number() <= duel.end_block, "duel ended");

        duel.agree_votes = duel.agree_votes + agree_delta;
        duel.disagree_votes = duel.disagree_votes + disagree_delta;
        duel.total_votes = duel.agree_votes + duel.disagree_votes;
        self.storage.duels.at(duel_id).write(duel);
    }

    // =========================================================================
    // CONFIG (creator only)
    // =========================================================================

    #[external("public")]
    fn update_duel_duration(new_duration: u32) {
        let sender = self.msg_sender();
        let sender_role = self.storage.member_roles.at(sender).read();
        assert(sender_role == ROLE_CREATOR, "only creator");
        self.storage.duel_duration.write(new_duration);
    }

    #[external("public")]
    fn update_visibility(is_publicly_viewable: bool) {
        let sender = self.msg_sender();
        let sender_role = self.storage.member_roles.at(sender).read();
        assert(sender_role == ROLE_CREATOR, "only creator");
        self.storage.is_publicly_viewable.write(is_publicly_viewable);
    }

    // =========================================================================
    // UTILITY VIEW FUNCTIONS (V4: unconstrained, reads public storage via oracle)
    // =========================================================================

    #[external("utility")]
    unconstrained fn get_name() -> FieldCompressedString { self.storage.name.read() }

    #[external("utility")]
    unconstrained fn get_duel_duration() -> u32 { self.storage.duel_duration.read() }

    #[external("utility")]
    unconstrained fn get_member_count() -> u64 { self.storage.member_count.read() }

    #[external("utility")]
    unconstrained fn get_council_count() -> u64 { self.storage.council_count.read() }

    #[external("utility")]
    unconstrained fn get_member_role(member: AztecAddress) -> u8 { self.storage.member_roles.at(member).read() }

    #[external("utility")]
    unconstrained fn get_duel_count() -> u64 { self.storage.duel_count.read() }

    #[external("utility")]
    unconstrained fn get_statement_count() -> u64 { self.storage.statement_count.read() }

    #[external("utility")]
    unconstrained fn get_active_duel() -> Duel {
        let current_id = self.storage.current_duel_id.read();
        self.storage.duels.at(current_id as Field).read()
    }

    #[external("utility")]
    unconstrained fn get_duel(duel_id: u64) -> Duel { self.storage.duels.at(duel_id as Field).read() }

    #[external("utility")]
    unconstrained fn get_is_publicly_viewable() -> bool { self.storage.is_publicly_viewable.read() }

    #[external("utility")]
    unconstrained fn is_statement_in_pool(statement_hash: Field) -> bool { self.storage.statement_pool.at(statement_hash).read() }

    #[external("utility")]
    unconstrained fn get_first_duel_block() -> u32 { self.storage.first_duel_block.read() }

    #[external("utility")]
    unconstrained fn get_current_duel_id() -> u64 { self.storage.current_duel_id.read() }

    #[external("utility")]
    unconstrained fn get_keeper() -> AztecAddress { self.storage.keeper.read() }

    #[external("utility")]
    unconstrained fn get_allowed_account_class_id() -> Field { self.storage.allowed_account_class_id.read() }

    #[external("utility")]
    unconstrained fn get_removal_proposal(removal_id: u64) -> RemovalProposal { self.storage.removal_proposals.at(removal_id as Field).read() }

    #[external("utility")]
    unconstrained fn get_removal_count() -> u64 { self.storage.removal_count.read() }

    #[external("utility")]
    unconstrained fn has_voted_on_removal(removal_id: u64, voter: AztecAddress) -> bool { self.storage.removal_votes.at(removal_id as Field).at(voter).read() }

    #[external("utility")]
    unconstrained fn get_removal_keep_votes(removal_id: u64) -> u64 { self.storage.removal_keep_votes.at(removal_id as Field).read() }

    #[external("utility")]
    unconstrained fn get_removal_remove_votes(removal_id: u64) -> u64 { self.storage.removal_remove_votes.at(removal_id as Field).read() }
}
