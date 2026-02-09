use aztec::{
    macros::notes::note,
    protocol_types::traits::Packable,
};

/// @notice Note representing a starred cloak for a user
/// @dev Stored in the user's private set - only they can see their stars
#[derive(Eq, Packable)]
#[note]
pub struct StarNote {
    /// The address of the cloak that was starred
    pub cloak_address: aztec::protocol_types::address::AztecAddress,
}
