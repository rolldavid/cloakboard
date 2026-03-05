/// UserProfile Contract V6 -- Private cross-cloak user state
///
/// Stores data that belongs to the USER across all cloaks:
/// - Whisper points (private PointNotes, only owner can read)
/// - Username (private UsernameNote, only owner can read)
///
/// V6: Points are RESTRICTED -- only the authorized DuelCloak contract can award
/// points via cross-contract private call. This prevents arbitrary self-awarding.
/// Privacy is preserved: the voter's address stays in private context.
///
/// Privacy model:
/// - All storage is private (PrivateSet). Only the note owner's PXE can decrypt.
/// - The server and keeper have ZERO access to points or usernames stored here.
/// - Usernames are revealed when users take public actions (comments) -- the client
///   sends the plaintext to the server, which caches it for display.
/// - Points are never revealed to the server.

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
    }

    // =========================================================================
    // INITIALIZER
    // =========================================================================

    #[external("public")]
    #[initializer]
    fn constructor(keeper_address: AztecAddress) {
        self.storage.keeper.initialize(keeper_address);
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
}
