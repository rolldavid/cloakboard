use aztec::protocol::{
    address::AztecAddress,
    traits::{Deserialize, Serialize, Packable},
};

#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct RemovalProposal {
    pub id: u64,
    pub target: AztecAddress,
    pub proposer: AztecAddress,
    pub start_block: u32,
    pub end_block: u32,
    pub executed: bool,
    pub result: u8, // 0 = PENDING, 1 = REMOVED, 2 = KEPT
}
