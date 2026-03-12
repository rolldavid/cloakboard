/// UserProfile Contract V7 -- Private cross-cloak user state + public staking
///
/// Stores data that belongs to the USER across all cloaks:
/// - Whisper points (private PointNotes, only owner can read)
/// - Username (private UsernameNote, only owner can read)
/// - Stakes (public StakeRecords, intentionally visible)
///
/// V7: Adds staking functions for the queue system. Users lock private points
/// into public stake records to curate which duels go live. Staker identity
/// and reward amounts are intentionally public -- staking is a curation signal.
///
/// V6: Points are RESTRICTED -- only the authorized DuelCloak contract can award
/// points via cross-contract private call. This prevents arbitrary self-awarding.
///
/// Privacy model:
/// - Points from voting: PRIVATE (PointNotes encrypted to user)
/// - Staker identity + amount: PUBLIC (intentional curation signal)
/// - Reward amounts: PUBLIC (keeper sends directly to known staker address)
/// - Vote direction: PRIVATE (unchanged, separate VoteHistory contract)
/// - User account details: PRIVATE (signin method never on-chain)

use aztec::macros::aztec;

#[aztec]
pub contract UserProfile {
    use aztec::{
        macros::{functions::{initializer, external, only_self}, storage::storage},
        protocol::{address::AztecAddress, traits::ToField},
        state_vars::{Map, Owned, PrivateSet, PublicMutable, PublicImmutable},
        note::{note_getter_options::NoteGetterOptions, note_viewer_options::NoteViewerOptions},
        messages::message_delivery::MessageDelivery,
        oracle::notes::set_sender_for_tags,
    };
    use crate::types::point_note::PointNote;
    use crate::types::username_note::UsernameNote;
    use crate::types::stake_record::StakeRecord;

    #[storage]
    struct Storage<Context> {
        /// Private whisper points per user (encrypted to user, only their PXE can read)
        user_points: Owned<PrivateSet<PointNote, Context>, Context>,

        /// Private username per user (encrypted to user, only their PXE can read)
        user_names: Owned<PrivateSet<UsernameNote, Context>, Context>,

        /// Public eligibility flag per user -- set by certify_eligible after ZK proof
        eligible_creators: Map<Field, PublicMutable<bool, Context>, Context>,

        /// V6: Address of the DuelCloak contract authorized to award points
        authorized_caller: PublicMutable<AztecAddress, Context>,

        /// V6: Keeper address (admin, can set authorized_caller)
        keeper: PublicImmutable<AztecAddress, Context>,

        // ===== V7: Staking storage =====

        /// Public stake records per duel (duel_id -> StakeRecord)
        stakes: Map<Field, PublicMutable<StakeRecord, Context>, Context>,

        /// Running totals for platform stats
        total_staked: PublicMutable<u64, Context>,
        total_burned: PublicMutable<u64, Context>,

        /// Staking parameters (keeper-adjustable)
        min_stake: PublicMutable<u64, Context>,
        min_votes_threshold: PublicMutable<u64, Context>,
    }

    // =========================================================================
    // INITIALIZER
    // =========================================================================

    #[external("public")]
    #[initializer]
    fn constructor(keeper_address: AztecAddress) {
        self.storage.keeper.initialize(keeper_address);
        // V7: Set default staking params
        self.storage.min_stake.write(100);
        self.storage.min_votes_threshold.write(10);
    }

    // =========================================================================
    // POINTS -- Awarded atomically during voting via cross-contract call
    // =========================================================================

    /// Award points to a voter. RESTRICTED to authorized DuelCloak contract.
    /// In cross-contract calls, msg_sender() = calling contract, so voter is passed explicitly.
    /// set_sender_for_tags(voter) works because the voter's PXE is generating the proof.
    /// Authorization check is enqueued as a public call because PublicMutable cannot be
    /// read from private context. If the check fails, the entire tx reverts (including
    /// the private note emission). The caller arg in the public function is the DuelCloak
    /// contract address (not the voter) -- no privacy leak.
    #[external("private")]
    fn award_vote_points(voter: AztecAddress, amount: Field) {
        let caller = self.msg_sender();
        // Safety: voter's PXE is executing, voter's keys are registered
        unsafe { set_sender_for_tags(voter) };
        let note = PointNote { amount };
        self.storage.user_points.at(voter).insert(note).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        // Enqueue authorization check in public (reverts entire tx if unauthorized)
        self.enqueue_self.verify_authorized_caller(caller);
    }

    /// Internal: verify the caller is the authorized DuelCloak contract.
    /// Called via enqueue from award_vote_points. Reverts entire tx if unauthorized.
    #[external("public")]
    #[only_self]
    fn verify_authorized_caller(caller: AztecAddress) {
        let authorized = self.storage.authorized_caller.read();
        assert(caller == authorized, "only authorized caller can award points");
    }

    /// Keeper-only: set the authorized caller (DuelCloak contract address).
    #[external("public")]
    fn set_authorized_caller(caller: AztecAddress) {
        assert(self.msg_sender() == self.storage.keeper.read(), "only keeper");
        self.storage.authorized_caller.write(caller);
    }

    /// Read the caller's total private whisper points.
    /// Utility -- runs client-side in PXE, no proof generated.
    /// Only the note owner's PXE can decrypt these.
    #[external("utility")]
    unconstrained fn get_my_points(owner: AztecAddress) -> pub Field {
        let options = NoteViewerOptions::new();
        let notes = self.storage.user_points.at(owner).view_notes(options);
        let mut total: Field = 0;
        for i in 0..notes.len() {
            total += notes.get_unchecked(i).amount;
        }
        total
    }

    /// Generate a ZK proof that the caller's points >= threshold.
    /// Future use: gate features behind point thresholds without revealing exact amount.
    /// Notes consumed by pop_notes are nullified. Re-emit as a single consolidated note.
    #[external("private")]
    fn prove_min_points(threshold: Field) {
        let sender = self.msg_sender();
        // Safety: use caller's address (has registered public keys), not contract address
        unsafe { set_sender_for_tags(sender) };
        let options = NoteGetterOptions::new();
        let notes = self.storage.user_points.at(sender).pop_notes(options);
        let mut total: u64 = 0;
        for i in 0..notes.max_len() {
            if i < notes.len() {
                total += notes.get_unchecked(i).amount as u64;
            }
        }
        assert(total >= threshold as u64, "insufficient whisper points");
        // Re-emit consolidated note (pop_notes nullified the originals)
        let consolidated = PointNote { amount: total as Field };
        self.storage.user_points.at(sender).insert(consolidated).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    // =========================================================================
    // USERNAME -- Set during account creation, read on login
    // =========================================================================

    /// Set or update the caller's private username.
    /// The name is a FieldCompressedString-encoded value (max 31 bytes).
    /// Called as a background tx after account creation.
    #[external("private")]
    fn set_username(name: Field) {
        let sender = self.msg_sender();
        // Safety: use caller's address (has registered public keys), not contract address
        unsafe { set_sender_for_tags(sender) };
        let note = UsernameNote { name };
        self.storage.user_names.at(sender).insert(note).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    /// Read the caller's private username.
    /// Utility -- runs client-side in PXE, no proof.
    /// Returns the most recently inserted username note (latest = last in array).
    #[external("utility")]
    unconstrained fn get_my_username(owner: AztecAddress) -> pub Field {
        let options = NoteViewerOptions::new();
        let notes = self.storage.user_names.at(owner).view_notes(options);
        if notes.len() == 0 {
            0
        } else {
            // Return the last note (most recently inserted)
            notes.get_unchecked(notes.len() - 1).name
        }
    }

    // =========================================================================
    // ELIGIBILITY -- Certify creator eligibility via private point proof
    // =========================================================================

    /// Certify the caller is eligible to create duels (points >= threshold).
    /// Private function -- pops all point notes, verifies sum via IVC proof,
    /// then enqueues a public write of the eligibility flag.
    /// The server reads the public flag directly -- never sees point count.
    #[external("private")]
    fn certify_eligible(threshold: Field) {
        let sender = self.msg_sender();
        // Safety: use caller's address (has registered public keys), not contract address
        unsafe { set_sender_for_tags(sender) };

        // Pop all point notes and sum (same logic as prove_min_points)
        let options = NoteGetterOptions::new();
        let notes = self.storage.user_points.at(sender).pop_notes(options);
        let mut total: u64 = 0;
        for i in 0..notes.max_len() {
            if i < notes.len() {
                total += notes.get_unchecked(i).amount as u64;
            }
        }
        assert(total >= threshold as u64, "insufficient whisper points");

        // Re-emit consolidated point note (pop_notes nullified the originals)
        let consolidated = PointNote { amount: total as Field };
        self.storage.user_points.at(sender).insert(consolidated).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // Enqueue public flag write (private -> public call)
        self.enqueue_self.mark_eligible(sender.to_field());
    }

    /// Internal: write the eligibility flag to public storage.
    /// Only callable by the contract itself (enqueued from certify_eligible).
    #[external("public")]
    #[only_self]
    fn mark_eligible(user_id: Field) {
        self.storage.eligible_creators.at(user_id).write(true);
    }

    /// Check if a user is eligible to create duels.
    /// Utility -- reads public storage, no proof needed.
    #[external("utility")]
    unconstrained fn is_eligible(user_id: Field) -> pub bool {
        self.storage.eligible_creators.at(user_id).read()
    }

    // =========================================================================
    // V7: STAKING -- Lock points to curate which duels go live
    // =========================================================================
    //
    // Staking is intentionally PUBLIC. The staker's address, amount, and reward
    // are all visible. This is by design -- staking is a curation signal.
    // What stays private: votes, vote direction, points earned from voting.

    /// Stake points on a queued duel. Consumes private PointNotes and writes
    /// a public stake record. The staker's address is revealed -- this is
    /// intentional (staking = public curation).
    ///
    /// Flow: private (consume notes) -> public (write stake record)
    #[external("private")]
    fn stake_points(duel_id: Field, amount: u64) {
        let sender = self.msg_sender();
        // Safety: sender is the caller whose PXE is generating the proof
        unsafe { set_sender_for_tags(sender) };

        // Pop all PointNotes and verify sum >= amount
        let options = NoteGetterOptions::new();
        let notes = self.storage.user_points.at(sender).pop_notes(options);
        let mut sum: u64 = 0;
        for i in 0..notes.max_len() {
            if i < notes.len() {
                sum += notes.get_unchecked(i).amount as u64;
            }
        }
        assert(sum >= amount, "insufficient points for stake");

        // Re-emit change note if sum > amount (return the remainder)
        let change = sum - amount;
        if change > 0 {
            let change_note = PointNote { amount: change as Field };
            self.storage.user_points.at(sender).insert(change_note)
                .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
        }

        // Enqueue public stake record write
        self.enqueue_self._finalize_stake(duel_id, sender, amount);
    }

    /// Internal: write the public stake record after private note consumption.
    /// Verifies min stake and no existing stake for this duel.
    #[external("public")]
    #[only_self]
    fn _finalize_stake(duel_id: Field, staker: AztecAddress, amount: u64) {
        let min = self.storage.min_stake.read();
        assert(amount >= min, "below minimum stake");

        // Verify no existing active stake for this duel
        let existing = self.storage.stakes.at(duel_id).read();
        assert(existing.amount == 0, "duel already staked");

        self.storage.stakes.at(duel_id).write(StakeRecord {
            staker,
            amount,
            status: 0, // active
        });

        let total = self.storage.total_staked.read() + amount;
        self.storage.total_staked.write(total);
    }

    /// Keeper resolves a successful stake -- mints PointNotes back to staker.
    /// The keeper knows the staker address (public from stake action) and reward
    /// amount (computed server-side). This is a simple push model.
    ///
    /// The keeper's PXE generates the proof, but set_sender_for_tags(staker)
    /// ensures the PointNote is encrypted to the staker's keys.
    /// Requires pxe.registerRecipient(stakerCompleteAddress) before calling.
    #[external("private")]
    fn resolve_stake(duel_id: Field, staker: AztecAddress, total_return: u64) {
        // Only keeper can call -- verified via enqueued public check
        let caller = self.msg_sender();

        // Safety: staker address is public (from stake record), keeper's PXE has registered staker as recipient
        unsafe { set_sender_for_tags(staker) };
        let note = PointNote { amount: total_return as Field };
        self.storage.user_points.at(staker).insert(note)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // Enqueue public status update + keeper verification
        self.enqueue_self._mark_resolved(duel_id, caller);
    }

    /// Internal: mark stake as rewarded and verify caller is keeper.
    #[external("public")]
    #[only_self]
    fn _mark_resolved(duel_id: Field, caller: AztecAddress) {
        assert(caller == self.storage.keeper.read(), "only keeper can resolve");
        let mut stake = self.storage.stakes.at(duel_id).read();
        assert(stake.status == 0, "stake not active");
        stake.status = 1; // rewarded
        self.storage.stakes.at(duel_id).write(stake);
    }

    /// Keeper burns a stake when duel fails to meet vote threshold.
    /// No points returned -- they were already consumed during stake_points.
    #[external("public")]
    fn burn_stake(duel_id: Field) {
        assert(self.msg_sender() == self.storage.keeper.read(), "only keeper");
        let mut stake = self.storage.stakes.at(duel_id).read();
        assert(stake.status == 0, "stake not active");
        stake.status = 2; // burned
        self.storage.stakes.at(duel_id).write(stake);

        let burned = self.storage.total_burned.read() + stake.amount;
        self.storage.total_burned.write(burned);
    }

    /// Keeper-only: update staking parameters.
    #[external("public")]
    fn update_staking_params(new_min_stake: u64, new_min_votes_threshold: u64) {
        assert(self.msg_sender() == self.storage.keeper.read(), "only keeper");
        self.storage.min_stake.write(new_min_stake);
        self.storage.min_votes_threshold.write(new_min_votes_threshold);
    }

    // ===== Staking utility views =====

    /// Read the stake record for a duel. Public data -- anyone can read.
    #[external("utility")]
    unconstrained fn get_stake(duel_id: Field) -> pub StakeRecord {
        self.storage.stakes.at(duel_id).read()
    }

    /// Read platform staking stats.
    #[external("utility")]
    unconstrained fn get_staking_stats() -> pub (u64, u64) {
        (self.storage.total_staked.read(), self.storage.total_burned.read())
    }

    /// Read current staking parameters.
    #[external("utility")]
    unconstrained fn get_staking_params() -> pub (u64, u64) {
        (self.storage.min_stake.read(), self.storage.min_votes_threshold.read())
    }
}
