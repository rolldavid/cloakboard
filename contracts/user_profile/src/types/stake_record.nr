use aztec::protocol::{
    address::AztecAddress,
    traits::{Deserialize, Serialize, Packable},
};

/// Public stake record for a duel -- staker identity is intentionally public
/// (staking is a public curation signal, not a private opinion).
///
/// Status: 0 = active, 1 = rewarded, 2 = burned
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct StakeRecord {
    pub staker: AztecAddress,
    pub amount: u64,
    pub status: u8,
}
