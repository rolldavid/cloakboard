/// AuthKeyNote -- stores an authorized key in the multi-auth account contract.
///
/// Each note represents a single authorized key that can produce valid
/// auth witnesses for the account.

use dep::aztec::protocol_types::{
    traits::{Serialize, Deserialize, Packable},
};

/// Key type constants
pub global KEY_TYPE_SCHNORR: u8 = 0;
pub global KEY_TYPE_ECDSA_K256: u8 = 1;  // secp256k1 (ETH)
pub global KEY_TYPE_ECDSA_R1: u8 = 2;    // secp256r1 (Passkey)

/// An authorized key stored as a private note.
///
/// Fields:
/// - key_type: which curve (0=Schnorr/Grumpkin, 1=secp256k1, 2=secp256r1)
/// - public_key_hash: hash of the public key bytes
/// - label_hash: hash of a human-readable label (e.g. "google", "eth:0xABC...")
#[derive(Deserialize, Serialize, Eq, Packable)]
pub struct AuthKeyNote {
    pub key_type: u8,
    pub public_key_hash: Field,
    pub label_hash: Field,
}
