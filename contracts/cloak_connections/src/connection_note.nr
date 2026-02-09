/// ConnectionNote -- stores a user's connection to a cloak as a private note.
///
/// Each note represents one relationship between a user and a cloak.
/// Only the note owner can read/enumerate their connections.
///
/// Connection types:
///   0 = CREATED  - User deployed/created this cloak
///   1 = MEMBER   - User is a member of this cloak
///   2 = ADMIN    - User is an admin of this cloak
///   3 = STARRED  - User starred this cloak

use dep::aztec::{
    macros::notes::note,
    protocol_types::{
        address::AztecAddress,
        traits::{Packable, ToField, FromField},
    },
};

// Connection type constants
pub global TYPE_CREATED: Field = 0;
pub global TYPE_MEMBER: Field = 1;
pub global TYPE_ADMIN: Field = 2;
pub global TYPE_STARRED: Field = 3;

#[derive(Eq)]
#[note]
pub struct ConnectionNote {
    /// The cloak contract address
    pub cloak_address: AztecAddress,
    /// The type of connection (0=created, 1=member, 2=admin, 3=starred)
    pub connection_type: Field,
}

impl Packable for ConnectionNote {
    let N: u32 = 2;

    fn pack(self) -> [Field; 2] {
        [self.cloak_address.to_field(), self.connection_type]
    }

    fn unpack(packed: [Field; 2]) -> Self {
        ConnectionNote {
            cloak_address: AztecAddress::from_field(packed[0]),
            connection_type: packed[1],
        }
    }
}
