use aztec::protocol_types::{
    address::AztecAddress,
    traits::{Deserialize, Serialize, Packable},
};
use compressed_string::FieldCompressedString;

#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct Proposal {
    pub id: u64,
    pub creator: AztecAddress,
    pub title: FieldCompressedString,
    pub description: FieldCompressedString,
    pub proposal_type: u8,
    pub target_address: AztecAddress,
    pub value: u128,
    pub start_block: u32,
    pub end_block: u32,
    pub executed: bool,
}

#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct VoteTally {
    pub yes_votes: u128,
    pub no_votes: u128,
    pub total_votes: u128,
    pub voter_count: u64,
}

impl VoteTally {
    pub fn new() -> Self {
        Self {
            yes_votes: 0,
            no_votes: 0,
            total_votes: 0,
            voter_count: 0,
        }
    }
}

/// Governor Bravo proposal with multi-target support.
/// Targets, values, and calldatas are stored as hashes for on-chain verification.
/// Full arrays are stored off-chain or via GovernorStorage pattern.
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct GovernorProposal {
    pub id: u64,
    pub proposer: AztecAddress,
    pub eta: u32,
    pub start_block: u32,
    pub end_block: u32,
    pub canceled: bool,
    pub executed: bool,
    /// Hash of (targets[], values[], calldatas[]) for on-chain verification
    pub actions_hash: Field,
    /// Description hash for proposal identification
    pub description_hash: Field,
    /// Number of targets in the proposal (for multi-target)
    pub target_count: u8,
    /// Proposal type: 0 = normal, 1 = council_election, 2 = emergency
    pub proposal_type: u8,
}
