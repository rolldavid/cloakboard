//! VotingPowerSet - Based on BalanceSet from aztec-standards
//! Manages private voting power using UintNote pattern

use aztec::{
    context::{PrivateContext, UtilityContext},
    note::{
        note_getter_options::{NoteGetterOptions, SortOrder},
        note_interface::NoteProperties,
        note_message::MaybeNoteMessage,
        note_viewer_options::NoteViewerOptions,
        retrieved_note::RetrievedNote,
    },
    protocol_types::{
        address::AztecAddress,
        constants::MAX_NOTE_HASH_READ_REQUESTS_PER_CALL,
        traits::Packable,
    },
    state_vars::{owned_state_variable::OwnedStateVariable, PrivateSet},
};
use std::ops::Add;
use crate::types::membership_note::MembershipNote;

pub struct VotingPowerSet<Context> {
    pub set: PrivateSet<MembershipNote, Context>,
}

impl<Context> OwnedStateVariable<Context> for VotingPowerSet<Context> {
    fn new(context: Context, storage_slot: Field, owner: AztecAddress) -> Self {
        Self { set: PrivateSet::new(context, storage_slot, owner) }
    }
}

impl VotingPowerSet<UtilityContext> {
    pub unconstrained fn balance_of(self: Self) -> u128 {
        self.balance_of_with_offset(0)
    }

    pub unconstrained fn balance_of_with_offset(self: Self, offset: u32) -> u128 {
        let mut balance = 0 as u128;
        let options = NoteViewerOptions::<MembershipNote, <MembershipNote as Packable>::N>::new()
            .set_offset(offset);
        let notes = self.set.view_notes(options);
        for i in 0..options.limit {
            if i < notes.len() {
                balance = balance + notes.get_unchecked(i).value;
            }
        }
        if notes.len() == options.limit {
            balance = balance + self.balance_of_with_offset(offset + options.limit);
        }
        balance
    }
}

impl VotingPowerSet<&mut PrivateContext> {
    pub fn add(self: Self, addend: u128) -> MaybeNoteMessage<MembershipNote> {
        let maybe_new_note = if addend == 0 as u128 {
            Option::none()
        } else {
            let addend_note = MembershipNote { value: addend };
            Option::some(self.set.insert(addend_note).get_new_note())
        };
        MaybeNoteMessage::new(maybe_new_note, self.set.context)
    }

    pub fn sub(self: Self, amount: u128) -> MaybeNoteMessage<MembershipNote> {
        let subtracted = self.try_sub(amount, MAX_NOTE_HASH_READ_REQUESTS_PER_CALL);
        assert(subtracted >= amount, "Voting power too low");
        self.add(subtracted - amount)
    }

    pub fn try_sub(self: Self, target_amount: u128, max_notes: u32) -> u128 {
        let options = NoteGetterOptions::with_preprocessor(preprocess_notes_min_sum, target_amount)
            .sort(MembershipNote::properties().value, SortOrder.DESC)
            .set_limit(max_notes);
        let notes = self.set.pop_notes(options);

        let mut subtracted = 0 as u128;
        for i in 0..options.limit {
            if i < notes.len() {
                let note = notes.get_unchecked(i);
                subtracted = subtracted + note.value;
            }
        }
        subtracted
    }
}

pub fn preprocess_notes_min_sum(
    notes: [Option<RetrievedNote<MembershipNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL],
    min_sum: u128,
) -> [Option<RetrievedNote<MembershipNote>>; MAX_NOTE_HASH_READ_REQUESTS_PER_CALL] {
    let mut selected = [Option::none(); MAX_NOTE_HASH_READ_REQUESTS_PER_CALL];
    let mut sum = 0 as u128;
    for i in 0..notes.len() {
        if notes[i].is_some() & sum < min_sum {
            let retrieved_note = notes[i].unwrap_unchecked();
            selected[i] = Option::some(retrieved_note);
            sum = sum.add(retrieved_note.note.value);
        }
    }
    selected
}
