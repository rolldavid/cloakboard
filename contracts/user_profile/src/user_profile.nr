/// UserProfile Contract -- Private cross-cloak user state
///
/// Stores data that belongs to the USER across all cloaks:
/// - Whisper points (private PointNotes, only owner can read)
/// - Username (private UsernameNote, only owner can read)
/// - Future: starred cloaks, council memberships, badges
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
        macros::{functions::external, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Owned, PrivateSet},
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
    }

    // =========================================================================
    // POINTS -- Called as a background tx after voting confirms
    // =========================================================================

    /// Add whisper points to the caller's private balance.
    /// Called by the client after a vote is confirmed on DuelCloak.
    /// No cross-contract call -- this is a separate transaction.
    #[external("private")]
    fn add_points(amount: Field) {
        let sender = self.msg_sender();
        // Safety: use caller's address (has registered public keys), not contract address
        unsafe { set_sender_for_tags(sender) };
        let note = PointNote { amount };
        self.storage.user_points.at(sender).insert(note).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
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
}
