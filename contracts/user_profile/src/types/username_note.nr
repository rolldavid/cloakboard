use aztec::{macros::notes::note, protocol::traits::Packable};

/// Stores a username as a FieldCompressedString-encoded value.
/// Max 31 bytes (31 ASCII chars). Packed big-endian into a single Field.
#[derive(Eq, Packable)]
#[note]
pub struct UsernameNote {
    pub name: Field,
}
