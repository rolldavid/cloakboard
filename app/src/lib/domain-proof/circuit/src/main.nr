use jwt::JWT;

global MAX_PARTIAL_DATA_LENGTH: u32 = 640;
global MAX_DOMAIN_LENGTH: u32 = 64;
global MAX_EMAIL_LENGTH: u32 = 128;
global MAX_SUB_LENGTH: u32 = 64;

// Verify JWT RSA-2048/SHA-256 signature and prove email domain membership.
//
// Adapted from stealthnote circuit. Instead of ephemeral key binding, we bind
// to the user's Aztec account address and generate a nullifier for double-join
// prevention.
fn main(
    // JWT data (private, never revealed)
    partial_data: BoundedVec<u8, MAX_PARTIAL_DATA_LENGTH>,
    partial_hash: [u32; 8],
    full_data_length: u32,
    base64_decode_offset: u32,
    // RSA public key (public, verifier checks this is Google's key)
    jwt_pubkey_modulus_limbs: pub [u128; 18],
    // RSA signature + reduction params (private)
    jwt_pubkey_redc_params_limbs: [u128; 18],
    jwt_signature_limbs: [u128; 18],
    // Sub claim for nullifier (private)
    sub_bytes: BoundedVec<u8, MAX_SUB_LENGTH>,
    // Account address for commitment (private)
    account_address: Field,
    // Public outputs
    domain: pub BoundedVec<u8, MAX_DOMAIN_LENGTH>,
    nullifier: pub Field,
    account_commitment: pub Field,
) {
    // 1. Verify JWT RSA-2048/SHA-256 signature using partial hash precomputation
    let jwt = JWT::init_with_partial_hash(
        partial_data,
        partial_hash,
        full_data_length,
        base64_decode_offset,
        jwt_pubkey_modulus_limbs,
        jwt_pubkey_redc_params_limbs,
        jwt_signature_limbs,
    );
    jwt.verify();

    // 2. Assert email_verified == true
    jwt.assert_claim_bool("email_verified".as_bytes(), true);

    // 3. Extract email and verify domain matches public input
    let email: BoundedVec<u8, MAX_EMAIL_LENGTH> = jwt.get_claim_string("email".as_bytes());
    // Safety: domain_start is verified by the '@' assertion and domain byte checks below
    let domain_start = unsafe { get_domain_start_index(email) };

    // Verify '@' precedes the domain
    assert(email.storage()[domain_start - 1] == 64, "char before domain is not '@'");

    // Verify domain bytes match
    for i in 0..MAX_DOMAIN_LENGTH {
        assert(
            email.storage()[domain_start + i] == domain.storage()[i],
            "domain mismatch",
        );
    }

    // 4. Verify sub claim matches private input (for nullifier binding)
    let jwt_sub: BoundedVec<u8, MAX_SUB_LENGTH> = jwt.get_claim_string("sub".as_bytes());
    assert(jwt_sub.len() == sub_bytes.len(), "sub length mismatch");
    for i in 0..MAX_SUB_LENGTH {
        if (i as u32) < jwt_sub.len() as u32 {
            assert(jwt_sub.storage()[i] == sub_bytes.storage()[i], "sub mismatch");
        }
    }

    // 5. Compute and verify nullifier = pedersen(sub_field, domain_field)
    //    This prevents the same Google user from joining the same domain-gated Cloak twice
    let sub_field = bytes_to_field(sub_bytes.storage(), sub_bytes.len() as u32);
    let domain_field = bytes_to_field(domain.storage(), domain.len() as u32);
    let computed_nullifier = std::hash::pedersen_hash([sub_field, domain_field]);
    assert(nullifier == computed_nullifier, "invalid nullifier");

    // 6. Compute and verify account_commitment = pedersen(account_address, domain_field)
    //    This binds the proof to the user's Aztec identity
    let computed_commitment = std::hash::pedersen_hash([account_address, domain_field]);
    assert(account_commitment == computed_commitment, "invalid account commitment");
}

// Convert a byte array to a Field element by treating bytes as a big-endian integer
fn bytes_to_field<let N: u32>(bytes: [u8; N], len: u32) -> Field {
    let mut result: Field = 0;
    for i in 0..N {
        if i < len {
            result = result * 256 + bytes[i] as Field;
        }
    }
    result
}

unconstrained fn get_domain_start_index(email: BoundedVec<u8, MAX_EMAIL_LENGTH>) -> u32 {
    let mut domain_start_index = 0;
    for i in 0..MAX_EMAIL_LENGTH {
        if email.storage()[i] == ("@".as_bytes())[0] {
            domain_start_index = i + 1;
            break;
        }
    }
    domain_start_index
}
