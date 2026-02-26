use aztec::{
    macros::notes::note,
    protocol::traits::Packable,
};

/// Private note storing a vote direction (1 = agree, 0 = disagree).
/// No voter address field -- critical for privacy.
/// Per-duel slot separation ensures notes are partitioned by duel_id.
#[derive(Eq, Packable)]
#[note]
pub struct VoteNote {
    pub direction: Field,
}
