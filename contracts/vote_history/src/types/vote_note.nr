use aztec::{macros::notes::note, protocol::traits::Packable};

#[derive(Eq, Packable)]
#[note]
pub struct VoteNote {
    pub duel_id: Field,
    pub cloak_address: Field,
    pub direction: Field,  // 1 = agree, 0 = disagree
}
