/// Community Grants Cloak Contract
///
/// Template for community grant programs.
///
/// Key Features:
/// - Grant programs with budgets
/// - Anonymous grant applications
/// - Peer review process
/// - Milestone-based disbursement
/// - Application scoring
///
/// Privacy: Balanced (applications can be anonymous)

use dep::aztec::macros::aztec;

#[aztec]
pub contract GrantsCloak {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{address::AztecAddress, traits::Hash},
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::types::proposal::VoteTally;
    use crate::types::member_info::MemberInfo;

    // ===== APPLICATION STATUS =====
    global STATUS_DRAFT: u8 = 0;
    global STATUS_SUBMITTED: u8 = 1;
    global STATUS_UNDER_REVIEW: u8 = 2;
    global STATUS_APPROVED: u8 = 3;
    global STATUS_REJECTED: u8 = 4;
    global STATUS_FUNDED: u8 = 5;
    global STATUS_COMPLETED: u8 = 6;

    // ===== GRANT PROGRAM STRUCT =====

    #[derive(Serialize, Deserialize, Eq)]
    struct GrantProgram {
        id: u64,
        title: FieldCompressedString,
        description_hash: Field,
        total_budget: u128,
        remaining_budget: u128,
        max_grant_size: u128,
        application_deadline: u32,
        is_active: bool,
    }

    // ===== GRANT APPLICATION STRUCT =====

    #[derive(Serialize, Deserialize, Eq)]
    struct GrantApplication {
        id: u64,
        program_id: u64,
        applicant: AztecAddress,
        applicant_commitment: Field, // For anonymous applications
        title: FieldCompressedString,
        description_hash: Field,
        requested_amount: u128,
        milestone_count: u8,
        status: u8,
        submitted_at: u32,
        approved_amount: u128,
        disbursed_amount: u128,
    }

    // ===== MILESTONE STRUCT =====

    #[derive(Serialize, Deserialize, Eq)]
    struct Milestone {
        application_id: u64,
        milestone_index: u8,
        description_hash: Field,
        amount: u128,
        is_completed: bool,
        is_disbursed: bool,
    }

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // ===== CONFIGURATION =====
        name: PublicImmutable<FieldCompressedString, Context>,
        admin: PublicMutable<AztecAddress, Context>,

        // ===== MEMBERSHIP =====
        members: Map<AztecAddress, PublicMutable<MemberInfo, Context>, Context>,
        member_count: PublicMutable<u64, Context>,
        /// Reviewers who can score applications
        reviewers: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        reviewer_count: PublicMutable<u64, Context>,

    
        // ===== GRANT PROGRAMS =====
        programs: Map<Field, PublicMutable<GrantProgram, Context>, Context>,
        program_count: PublicMutable<u64, Context>,

        // ===== APPLICATIONS =====
        applications: Map<Field, PublicMutable<GrantApplication, Context>, Context>,
        application_count: PublicMutable<u64, Context>,

        // ===== MILESTONES =====
        /// (application_id, milestone_index) → Milestone
        milestones: Map<Field, Map<u8, PublicMutable<Milestone, Context>, Context>, Context>,

        // ===== REVIEWS =====
        /// (application_id, reviewer) → score
        review_scores: Map<Field, Map<AztecAddress, PublicMutable<u8, Context>, Context>, Context>,
        /// application_id → total score, review count
        application_scores: Map<Field, PublicMutable<u128, Context>, Context>,
        review_counts: Map<Field, PublicMutable<u64, Context>, Context>,

        // ===== VOTING =====
        vote_tallies: Map<Field, PublicMutable<VoteTally, Context>, Context>,

        // ===== GOVERNANCE =====
        voting_duration: PublicMutable<u32, Context>,
        quorum_threshold: PublicMutable<u64, Context>,
        min_reviews_required: PublicMutable<u8, Context>,
        min_score_threshold: PublicMutable<u8, Context>,
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
        min_reviews: u8,
        min_score: u8,
    
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
        self.storage.min_reviews_required.write(min_reviews);
        self.storage.min_score_threshold.write(min_score);

        // Initialize counters
        self.storage.member_count.write(0);
        self.storage.reviewer_count.write(0);
        self.storage.program_count.write(0);
        self.storage.application_count.write(0);

        // Add admin
        self.storage.members.at(admin).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 2,
            domain_proof_nullifier: 0,
        });
        self.storage.member_count.write(1);
        self.storage.reviewers.at(admin).write(true);
        self.storage.reviewer_count.write(1);
    
        // Initialize token gating
        self.storage.membership_mode.write(membership_mode);
        self.storage.token_gate_address.write(token_gate_address);
        self.storage.token_address.write(token_address);
        self.storage.erc20_token_address_hash.write(erc20_token_address_hash);
        self.storage.erc20_min_balance.write(erc20_min_balance);
    }


    /// Join with Aztec token proof (mode 2)
    #[external("private")]
    fn join_with_aztec_token(token_nullifier_seed: Field) {
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

        self.enqueue_self.add_token_member_internal(sender, nullifier);
    }

    #[external("public")]
    #[only_self]
    fn add_token_member_internal(member: AztecAddress, nullifier: Field) {
        self.storage.members.at(member).write(MemberInfo {
            voting_power: 1,
            joined_at: self.context.block_number(),
            role: 0,
            domain_proof_nullifier: nullifier,
        });

        let count = self.storage.member_count.read();
        self.storage.member_count.write(count + 1);
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

        let sender = self.msg_sender().unwrap();

        self.storage.members.at(sender).write(MemberInfo {
            voting_power: verified_balance,
            joined_at: self.context.block_number(),
            role: 0,
            domain_proof_nullifier: proof_nullifier,
        });

        let count = self.storage.member_count.read();
        self.storage.member_count.write(count + 1);
    }

    // ===== GRANT PROGRAMS =====

    /// Create a new grant program (admin only)
    #[external("public")]
    fn create_program(
        title: FieldCompressedString,
        description_hash: Field,
        total_budget: u128,
        max_grant_size: u128,
        application_deadline: u32,
    ) -> pub u64 {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let program_id = self.storage.program_count.read();

        let program = GrantProgram {
            id: program_id,
            title,
            description_hash,
            total_budget,
            remaining_budget: total_budget,
            max_grant_size,
            application_deadline,
            is_active: true,
        };

        self.storage.programs.at(program_id as Field).write(program);
        self.storage.program_count.write(program_id + 1);

        program_id
    }

    // ===== APPLICATIONS =====

    /// Submit a grant application
    #[external("public")]
    fn submit_application(
        program_id: u64,
        title: FieldCompressedString,
        description_hash: Field,
        requested_amount: u128,
        milestone_count: u8,
    ) -> pub u64 {
        let applicant = self.msg_sender().unwrap();

        let program = self.storage.programs.at(program_id as Field).read();
        assert(program.is_active, "program not active");
        assert(self.context.block_number() <= program.application_deadline, "deadline passed");
        assert(requested_amount <= program.max_grant_size, "exceeds max grant size");
        assert(requested_amount <= program.remaining_budget, "exceeds remaining budget");

        let app_id = self.storage.application_count.read();

        let application = GrantApplication {
            id: app_id,
            program_id,
            applicant,
            applicant_commitment: 0,
            title,
            description_hash,
            requested_amount,
            milestone_count,
            status: STATUS_SUBMITTED,
            submitted_at: self.context.block_number(),
            approved_amount: 0,
            disbursed_amount: 0,
        };

        self.storage.applications.at(app_id as Field).write(application);
        self.storage.application_count.write(app_id + 1);
        self.storage.application_scores.at(app_id as Field).write(0);
        self.storage.review_counts.at(app_id as Field).write(0);

        app_id
    }

    /// Submit anonymous application
    #[external("private")]
    fn submit_anonymous_application(
        program_id: u64,
        title: FieldCompressedString,
        description_hash: Field,
        requested_amount: u128,
        milestone_count: u8,
    ) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let applicant_commitment = std::hash::pedersen_hash([
            sender.to_field(),
            secret,
            self.context.block_number() as Field,
        ]);

        self.enqueue_self.create_anonymous_application(
            program_id,
            applicant_commitment,
            title,
            description_hash,
            requested_amount,
            milestone_count,
        );
    }

    #[external("public")]
    #[only_self]
    fn create_anonymous_application(
        program_id: u64,
        applicant_commitment: Field,
        title: FieldCompressedString,
        description_hash: Field,
        requested_amount: u128,
        milestone_count: u8,
    ) {
        let program = self.storage.programs.at(program_id as Field).read();
        assert(program.is_active, "program not active");
        assert(self.context.block_number() <= program.application_deadline, "deadline passed");
        assert(requested_amount <= program.max_grant_size, "exceeds max grant size");

        let app_id = self.storage.application_count.read();

        let application = GrantApplication {
            id: app_id,
            program_id,
            applicant: AztecAddress::zero(),
            applicant_commitment,
            title,
            description_hash,
            requested_amount,
            milestone_count,
            status: STATUS_SUBMITTED,
            submitted_at: self.context.block_number(),
            approved_amount: 0,
            disbursed_amount: 0,
        };

        self.storage.applications.at(app_id as Field).write(application);
        self.storage.application_count.write(app_id + 1);
    }

    // ===== REVIEWS =====

    /// Submit a review score (reviewer only)
    #[external("public")]
    fn submit_review(application_id: Field, score: u8) {
        let reviewer = self.msg_sender().unwrap();
        assert(self.storage.reviewers.at(reviewer).read(), "not a reviewer");
        assert(score <= 100, "score must be 0-100");

        // Check not already reviewed
        let existing = self.storage.review_scores.at(application_id).at(reviewer).read();
        assert(existing == 0, "already reviewed");

        let application = self.storage.applications.at(application_id).read();
        assert(application.status == STATUS_SUBMITTED | application.status == STATUS_UNDER_REVIEW, "not reviewable");

        // Record score
        self.storage.review_scores.at(application_id).at(reviewer).write(score);

        // Update totals
        let total = self.storage.application_scores.at(application_id).read();
        self.storage.application_scores.at(application_id).write(total + score as u128);

        let count = self.storage.review_counts.at(application_id).read();
        self.storage.review_counts.at(application_id).write(count + 1);

        // Update status if needed
        if application.status == STATUS_SUBMITTED {
            let mut updated = application;
            updated.status = STATUS_UNDER_REVIEW;
            self.storage.applications.at(application_id).write(updated);
        }
    }

    // ===== APPROVAL =====

    /// Vote on application (after reviews)
    #[external("private")]
    fn vote_on_application(application_id: Field, approve: bool) {
        let sender = self.msg_sender().unwrap();
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);

        let nullifier = std::hash::pedersen_hash([application_id, secret]);
        self.context.push_nullifier(nullifier);

        self.enqueue_self.add_application_vote(application_id, approve, sender);
    }

    #[external("public")]
    #[only_self]
    fn add_application_vote(application_id: Field, approve: bool, voter: AztecAddress) {
        let member = self.storage.members.at(voter).read();
        assert(member.voting_power > 0, "not a member");

        let mut tally = self.storage.vote_tallies.at(application_id).read();
        if approve {
            tally.yes_votes += member.voting_power;
        } else {
            tally.no_votes += member.voting_power;
        }
        tally.total_votes += member.voting_power;
        tally.voter_count += 1;
        self.storage.vote_tallies.at(application_id).write(tally);
    }

    /// Finalize application approval
    #[external("public")]
    fn finalize_application(application_id: Field) {
        let mut application = self.storage.applications.at(application_id).read();
        assert(application.status == STATUS_UNDER_REVIEW, "not under review");

        let review_count = self.storage.review_counts.at(application_id).read();
        let min_reviews = self.storage.min_reviews_required.read();
        assert(review_count >= min_reviews as u64, "not enough reviews");

        let total_score = self.storage.application_scores.at(application_id).read();
        let avg_score = total_score / review_count as u128;
        let min_score = self.storage.min_score_threshold.read();

        let tally = self.storage.vote_tallies.at(application_id).read();
        let quorum = self.storage.quorum_threshold.read();

        if avg_score >= min_score as u128 & tally.yes_votes > tally.no_votes & tally.total_votes >= quorum as u128 {
            application.status = STATUS_APPROVED;
            application.approved_amount = application.requested_amount;

            // Reduce program budget
            let program = self.storage.programs.at(application.program_id as Field).read();
            let mut updated_program = program;
            updated_program.remaining_budget -= application.requested_amount;
            self.storage.programs.at(application.program_id as Field).write(updated_program);
        } else {
            application.status = STATUS_REJECTED;
        }

        self.storage.applications.at(application_id).write(application);
    }

    // ===== MILESTONES =====

    /// Complete a milestone and request disbursement
    #[external("public")]
    fn complete_milestone(application_id: Field, milestone_index: u8) {
        let caller = self.msg_sender().unwrap();
        let application = self.storage.applications.at(application_id).read();
        assert(caller.eq(application.applicant), "not applicant");
        assert(application.status == STATUS_APPROVED | application.status == STATUS_FUNDED, "not approved");

        let mut milestone = self.storage.milestones.at(application_id).at(milestone_index).read();
        milestone.is_completed = true;
        self.storage.milestones.at(application_id).at(milestone_index).write(milestone);
    }

    /// Disburse milestone funds (admin only)
    #[external("public")]
    fn disburse_milestone(application_id: Field, milestone_index: u8) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        let mut application = self.storage.applications.at(application_id).read();
        let mut milestone = self.storage.milestones.at(application_id).at(milestone_index).read();

        assert(milestone.is_completed, "milestone not completed");
        assert(!milestone.is_disbursed, "already disbursed");

        milestone.is_disbursed = true;
        self.storage.milestones.at(application_id).at(milestone_index).write(milestone);

        application.disbursed_amount += milestone.amount;
        if application.status == STATUS_APPROVED {
            application.status = STATUS_FUNDED;
        }
        if application.disbursed_amount >= application.approved_amount {
            application.status = STATUS_COMPLETED;
        }
        self.storage.applications.at(application_id).write(application);
    }

    // ===== ADMIN =====

    /// Add reviewer
    #[external("public")]
    fn add_reviewer(reviewer: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.reviewers.at(reviewer).write(true);
        let count = self.storage.reviewer_count.read();
        self.storage.reviewer_count.write(count + 1);
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_name() -> pub FieldCompressedString {
        self.storage.name.read()
    }

    #[external("public")]
    #[view]
    fn get_program_count() -> pub u64 {
        self.storage.program_count.read()
    }

    #[external("public")]
    #[view]
    fn get_program(program_id: Field) -> pub GrantProgram {
        self.storage.programs.at(program_id).read()
    }

    #[external("public")]
    #[view]
    fn get_application_count() -> pub u64 {
        self.storage.application_count.read()
    }

    #[external("public")]
    #[view]
    fn get_application(app_id: Field) -> pub GrantApplication {
        self.storage.applications.at(app_id).read()
    }

    #[external("public")]
    #[view]
    fn get_application_score(app_id: Field) -> pub (u128, u64) {
        let total = self.storage.application_scores.at(app_id).read();
        let count = self.storage.review_counts.at(app_id).read();
        (total, count)
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
