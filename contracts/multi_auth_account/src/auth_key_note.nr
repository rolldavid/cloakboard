/// MultiAuthKeyNote -- stores the signing public key in a private note.
///
/// Used by the account's `is_valid_impl` to verify auth witnesses entirely
/// in private execution. Supports Schnorr (Grumpkin) and ECDSA (secp256k1/r1).
///
/// Layout:
///   key_type:   0=Schnorr, 1=ECDSA-K, 2=ECDSA-R
///   pk_field_1: Schnorr x  | ECDSA packed x[0..31]
///   pk_field_2: Schnorr y  | ECDSA x[31]
///   pk_field_3: Schnorr 0  | ECDSA packed y[0..31]
///   pk_field_4: Schnorr 0  | ECDSA y[31]

use dep::aztec::{macros::notes::note, protocol_types::traits::Packable};

#[derive(Eq)]
#[note]
pub struct MultiAuthKeyNote {
    pub key_type: Field,
    pub pk_field_1: Field,
    pub pk_field_2: Field,
    pub pk_field_3: Field,
    pub pk_field_4: Field,
}

impl Packable for MultiAuthKeyNote {
    let N: u32 = 5;

    fn pack(self) -> [Field; 5] {
        [self.key_type, self.pk_field_1, self.pk_field_2, self.pk_field_3, self.pk_field_4]
    }

    fn unpack(packed: [Field; 5]) -> Self {
        MultiAuthKeyNote {
            key_type: packed[0],
            pk_field_1: packed[1],
            pk_field_2: packed[2],
            pk_field_3: packed[3],
            pk_field_4: packed[4],
        }
    }
}
