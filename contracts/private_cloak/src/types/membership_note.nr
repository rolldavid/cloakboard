use aztec::{
    macros::notes::note,
    protocol_types::traits::Packable,
};

/// @notice Note representing membership with voting power
/// @dev Similar to UintNote from aztec-standards but with membership context
#[derive(Eq, Packable)]
#[note]
pub struct MembershipNote {
    pub value: u128,  // voting power
}
