/// VoteHistory Contract -- Private on-chain vote history
///
/// Records each user's vote direction per duel as encrypted private notes.
/// Only the voter's PXE can decrypt their VoteNotes -- the server, keeper,
/// and other users have zero access.
///
/// Privacy model:
/// - record_vote is a private function -- all inputs (duel_id, cloak_address,
///   direction) are hidden inside the ZK proof.
/// - The encrypted note is only decryptable by the voter's wallet keys.
/// - Account switching is safe: each user's PXE only sees their own notes.

use aztec::macros::aztec;

#[aztec]
pub contract VoteHistory {
    use aztec::{
        macros::{functions::external, storage::storage},
        protocol::address::AztecAddress,
        state_vars::{Owned, PrivateSet},
        note::note_viewer_options::NoteViewerOptions,
        messages::message_delivery::MessageDelivery,
        oracle::notes::set_sender_for_tags,
    };
    use crate::types::vote_note::VoteNote;

    #[storage]
    struct Storage<Context> {
        /// Private vote records per user (encrypted, only their PXE can read)
        user_votes: Owned<PrivateSet<VoteNote, Context>, Context>,
    }

    /// Record a vote privately. Fire-and-forget after vote proof confirms.
    /// All inputs are hidden in the ZK proof -- server cannot see which duel or direction.
    #[external("private")]
    fn record_vote(duel_id: Field, cloak_address: Field, direction: Field) {
        let sender = self.msg_sender();
        // Safety: use caller's address (has registered public keys), not contract address
        unsafe { set_sender_for_tags(sender) };
        let note = VoteNote { duel_id, cloak_address, direction };
        self.storage.user_votes.at(sender).insert(note).deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    /// Query vote direction for a specific duel on a specific cloak. Utility -- PXE-local, no proof.
    /// Must match BOTH duel_id AND cloak_address (duel_id is per-contract, not globally unique).
    /// Returns: 0 = disagree, 1 = agree, 2 = not found.
    #[external("utility")]
    unconstrained fn get_my_vote_for_duel(owner: AztecAddress, duel_id: Field, cloak_address: Field) -> pub Field {
        let options = NoteViewerOptions::new();
        let notes = self.storage.user_votes.at(owner).view_notes(options);
        let mut direction: Field = 2;
        for i in 0..notes.len() {
            let note = notes.get_unchecked(i);
            if (note.duel_id == duel_id) & (note.cloak_address == cloak_address) {
                direction = note.direction;
            }
        }
        direction
    }
}
