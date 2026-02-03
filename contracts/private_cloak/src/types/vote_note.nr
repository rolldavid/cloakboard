use aztec::{
    macros::notes::note,
    protocol_types::traits::Packable,
};

/// @notice Note representing a vote cast on a proposal
/// @dev Used for private vote tracking before tally reveal
#[derive(Eq, Packable)]
#[note]
pub struct VoteNote {
    pub proposal_id: Field,
    pub vote_choice: bool,  // true = yes, false = no
    pub voting_power: u128,
}
