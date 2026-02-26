use aztec::protocol::{
    address::AztecAddress,
    traits::{Deserialize, Serialize, Packable},
};

#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct Duel {
    pub id: u64,
    pub statement_part_1: Field,
    pub statement_part_2: Field,
    pub statement_part_3: Field,
    pub statement_part_4: Field,
    pub start_block: u32,
    pub end_block: u32,
    pub total_votes: u64,
    pub agree_votes: u64,
    pub disagree_votes: u64,
    pub is_tallied: bool,
    pub started_by: AztecAddress,
}
