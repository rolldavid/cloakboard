/// MultiAuthAccount -- Aztec account contract supporting multiple auth methods.
///
/// Maintains a set of authorized keys across multiple curve types
/// (Schnorr/Grumpkin, secp256k1, secp256r1). Any authorized key can produce
/// a valid auth witness to control this account.
///
/// Key features:
/// - Single Aztec address regardless of which auth method is used
/// - Private entrypoint with on-chain signature verification
/// - Primary key hash stored in public storage (read cross-domain from private)
/// - Add/remove authorized keys (must be called by an already-authorized key)
/// - Lockout protection: cannot remove the last key

use aztec::macros::aztec;

// Key type constants
pub global KEY_TYPE_SCHNORR: u8 = 0;
pub global KEY_TYPE_ECDSA_K256: u8 = 1;
pub global KEY_TYPE_ECDSA_R1: u8 = 2;

#[aztec]
pub contract MultiAuthAccount {
    use aztec::{
        authwit::{
            account::AccountActions,
            auth::{compute_authwit_message_hash, compute_authwit_nullifier},
            entrypoint::app::AppPayload,
        },
        context::PrivateContext,
        hash::compute_siloed_nullifier,
        macros::{
            functions::{initializer, external, view, only_self, noinitcheck, allow_phase_change},
            storage::storage,
        },
        oracle::{
            auth_witness::get_auth_witness,
            get_nullifier_membership_witness::get_low_nullifier_membership_witness,
        },
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable, PublicImmutable},
    };

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        /// Hash of the primary signing key (pedersen_hash of key_type + pk fields)
        primary_key_hash: PublicImmutable<Field, Context>,

        /// Primary key type
        primary_key_type: PublicImmutable<u8, Context>,

        /// Number of authorized keys (public, does not reveal types)
        key_count: PublicMutable<u8, Context>,

        /// Authorized key map: pedersen_hash(key_type, public_key_hash) -> bool
        authorized_keys: Map<Field, PublicMutable<bool, Context>, Context>,

        /// Label storage: pedersen_hash(key_type, public_key_hash) -> label_hash
        key_labels: Map<Field, PublicMutable<Field, Context>, Context>,

        /// Display name hash (account-level, persists across all Cloaks)
        display_name_hash: PublicMutable<Field, Context>,
    }

    // ===== INITIALIZER =====

    /// Deploy a new MultiAuthAccount with a single initial key.
    /// The constructor is public -- all state is initialized in a single call.
    /// No private notes are created, enabling server-side deployment.
    #[external("public")]
    #[initializer]
    fn constructor(
        key_type: u8,
        primary_key_hash: Field,
        label_hash: Field,
    ) {
        assert(
            (key_type == 0) | (key_type == 1) | (key_type == 2),
            "invalid key type",
        );

        self.storage.primary_key_hash.initialize(primary_key_hash);
        self.storage.primary_key_type.initialize(key_type);
        self.storage.key_count.write(1);

        let key_id = std::hash::pedersen_hash([key_type as Field, primary_key_hash]);
        self.storage.authorized_keys.at(key_id).write(true);
        self.storage.key_labels.at(key_id).write(label_hash);
    }

    // ===== ENTRYPOINT =====

    /// Private entrypoint for all transactions from this account.
    /// Verifies the auth witness signature, then executes the bundled calls.
    #[external("private")]
    #[noinitcheck]
    #[allow_phase_change]
    fn entrypoint(app_payload: AppPayload, fee_payment_method: u8, cancellable: bool) {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.entrypoint(app_payload, fee_payment_method, cancellable);
    }

    /// Verify a private auth witness for cross-contract authorization.
    #[external("private")]
    #[noinitcheck]
    #[view]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    // ===== AUTH WITNESS VERIFICATION =====

    /// Verify the auth witness signature against the stored primary key.
    ///
    /// Reads primary_key_hash and primary_key_type from public storage via
    /// cross-domain read (PublicImmutable.read() from private context).
    ///
    /// The auth witness carries the public key fields so the contract can:
    /// 1. Verify the witness public key matches the stored hash
    /// 2. Use the public key to verify the signature
    ///
    /// Witness layout (from MultiAuthWitnessProvider):
    ///   witness[0]     = key_type (0=Schnorr, 1=ECDSA-K, 2=ECDSA-R)
    ///   witness[1..65] = 64-byte signature
    ///   witness[65]    = pk_field_1
    ///   witness[66]    = pk_field_2
    ///   witness[67]    = pk_field_3
    ///   witness[68]    = pk_field_4
    #[contract_library_method]
    fn is_valid_impl(context: &mut PrivateContext, outer_hash: Field) -> bool {
        let storage = Storage::init(context);

        // Cross-domain read: public storage -> private context
        let stored_key_hash = storage.primary_key_hash.read();
        let stored_key_type = storage.primary_key_type.read();

        // Safety: The witness is only used as a value that makes the signature
        // verification pass. It is safe to load from an unconstrained oracle.
        let witness: [Field; 69] = unsafe { get_auth_witness(outer_hash) };
        let witness_key_type = witness[0] as u8;

        // Verify witness key_type matches stored key
        assert(witness_key_type == stored_key_type, "key type mismatch");

        // Extract 64-byte signature
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i + 1] as u8;
        }

        // Extract public key fields from witness
        let pk_field_1 = witness[65];
        let pk_field_2 = witness[66];
        let pk_field_3 = witness[67];
        let pk_field_4 = witness[68];

        // Verify witness public key matches stored hash
        let computed_hash = std::hash::pedersen_hash(
            [witness_key_type as Field, pk_field_1, pk_field_2, pk_field_3, pk_field_4],
        );
        assert(computed_hash == stored_key_hash, "public key hash mismatch");

        if stored_key_type == 0 {
            // Schnorr: pk_field_1 = x, pk_field_2 = y (Grumpkin curve point)
            let pub_key = std::embedded_curve_ops::EmbeddedCurvePoint {
                x: pk_field_1,
                y: pk_field_2,
                is_infinite: false,
            };
            schnorr::verify_signature(pub_key, signature, outer_hash.to_be_bytes::<32>())
        } else {
            // ECDSA: unpack public key bytes from packed Fields
            let mut pub_x: [u8; 32] = [0; 32];
            let mut pub_y: [u8; 32] = [0; 32];

            // pk_field_1 holds x[0..31] as big-endian in a Field
            let part_x: [u8; 32] = pk_field_1.to_be_bytes();
            for i in 0..31 {
                pub_x[i] = part_x[i + 1];
            }
            // pk_field_2 holds x[31] as a single byte
            pub_x[31] = pk_field_2.to_be_bytes::<32>()[31];

            // pk_field_3 holds y[0..31], pk_field_4 holds y[31]
            let part_y: [u8; 32] = pk_field_3.to_be_bytes();
            for i in 0..31 {
                pub_y[i] = part_y[i + 1];
            }
            pub_y[31] = pk_field_4.to_be_bytes::<32>()[31];

            // ECDSA verification uses SHA-256 of the outer hash
            let outer_hash_bytes: [u8; 32] = outer_hash.to_be_bytes();
            let hashed_message: [u8; 32] = sha256::digest(outer_hash_bytes);

            if stored_key_type == 1 {
                std::ecdsa_secp256k1::verify_signature(pub_x, pub_y, signature, hashed_message)
            } else {
                std::ecdsa_secp256r1::verify_signature(pub_x, pub_y, signature, hashed_message)
            }
        }
    }

    /// Utility function for checking authwit validity without generating a proof.
    #[external("utility")]
    unconstrained fn lookup_validity(consumer: AztecAddress, inner_hash: Field) -> bool {
        let stored_key_hash = self.storage.primary_key_hash.read();
        let stored_key_type = self.storage.primary_key_type.read();

        let message_hash = compute_authwit_message_hash(
            consumer,
            self.context.chain_id(),
            self.context.version(),
            inner_hash,
        );

        let witness: [Field; 69] = get_auth_witness(message_hash);
        let witness_key_type = witness[0] as u8;

        let key_type_matches = witness_key_type == stored_key_type;

        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i + 1] as u8;
        }

        // Extract public key fields from witness
        let pk_field_1 = witness[65];
        let pk_field_2 = witness[66];
        let pk_field_3 = witness[67];
        let pk_field_4 = witness[68];

        // Verify witness public key matches stored hash
        let computed_hash = std::hash::pedersen_hash(
            [witness_key_type as Field, pk_field_1, pk_field_2, pk_field_3, pk_field_4],
        );
        let key_hash_matches = computed_hash == stored_key_hash;

        let sig_valid = if stored_key_type == 0 {
            let pub_key = std::embedded_curve_ops::EmbeddedCurvePoint {
                x: pk_field_1,
                y: pk_field_2,
                is_infinite: false,
            };
            schnorr::verify_signature(pub_key, signature, message_hash.to_be_bytes::<32>())
        } else {
            let mut pub_x: [u8; 32] = [0; 32];
            let mut pub_y: [u8; 32] = [0; 32];
            let part_x: [u8; 32] = pk_field_1.to_be_bytes();
            for i in 0..31 { pub_x[i] = part_x[i + 1]; }
            pub_x[31] = pk_field_2.to_be_bytes::<32>()[31];
            let part_y: [u8; 32] = pk_field_3.to_be_bytes();
            for i in 0..31 { pub_y[i] = part_y[i + 1]; }
            pub_y[31] = pk_field_4.to_be_bytes::<32>()[31];

            let outer_hash_bytes: [u8; 32] = message_hash.to_be_bytes();
            let hashed_message: [u8; 32] = sha256::digest(outer_hash_bytes);

            if stored_key_type == 1 {
                std::ecdsa_secp256k1::verify_signature(pub_x, pub_y, signature, hashed_message)
            } else {
                std::ecdsa_secp256r1::verify_signature(pub_x, pub_y, signature, hashed_message)
            }
        };

        // Check nullifier is not spent
        let nullifier = compute_authwit_nullifier(self.address, inner_hash);
        let siloed_nullifier = compute_siloed_nullifier(consumer, nullifier);
        let lower_wit = get_low_nullifier_membership_witness(
            self.context.block_header(),
            siloed_nullifier,
        );
        let is_not_spent = !(lower_wit.leaf_preimage.nullifier == siloed_nullifier);

        if !key_type_matches {
            false
        } else if !key_hash_matches {
            false
        } else if !sig_valid {
            false
        } else {
            is_not_spent
        }
    }

    // ===== KEY MANAGEMENT =====

    /// Add a new authorized key. Must be called by the account itself.
    #[external("public")]
    #[only_self]
    fn add_authorized_key(
        key_type: u8,
        public_key_hash: Field,
        label_hash: Field,
    ) {
        assert(
            (key_type == 0) | (key_type == 1) | (key_type == 2),
            "invalid key type",
        );

        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);

        let already = self.storage.authorized_keys.at(key_id).read();
        assert(!already, "key already authorized");

        self.storage.authorized_keys.at(key_id).write(true);
        self.storage.key_labels.at(key_id).write(label_hash);

        let count = self.storage.key_count.read();
        self.storage.key_count.write(count + 1);
    }

    /// Remove an authorized key. Cannot remove the last key.
    #[external("public")]
    #[only_self]
    fn remove_authorized_key(
        key_type: u8,
        public_key_hash: Field,
    ) {
        let count = self.storage.key_count.read();
        assert(count > 1, "cannot remove last key");

        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);

        let exists = self.storage.authorized_keys.at(key_id).read();
        assert(exists, "key not authorized");

        self.storage.authorized_keys.at(key_id).write(false);
        self.storage.key_labels.at(key_id).write(0);
        self.storage.key_count.write(count - 1);
    }

    // ===== DISPLAY NAME =====

    /// Set or update the account's display name hash. Must be called by the account itself.
    #[external("public")]
    #[only_self]
    fn set_display_name(name_hash: Field) {
        self.storage.display_name_hash.write(name_hash);
    }

    /// Get the display name hash for this account
    #[external("public")]
    #[view]
    fn get_display_name_hash() -> pub Field {
        self.storage.display_name_hash.read()
    }

    // ===== VIEW FUNCTIONS =====

    /// Check if a key is authorized
    #[external("public")]
    #[view]
    fn is_key_authorized(key_type: u8, public_key_hash: Field) -> pub bool {
        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);
        self.storage.authorized_keys.at(key_id).read()
    }

    /// Get the number of authorized keys
    #[external("public")]
    #[view]
    fn get_key_count() -> pub u8 {
        self.storage.key_count.read()
    }

    /// Get the primary key hash
    #[external("public")]
    #[view]
    fn get_primary_key_hash() -> pub Field {
        self.storage.primary_key_hash.read()
    }

    /// Get the primary key type
    #[external("public")]
    #[view]
    fn get_primary_key_type() -> pub u8 {
        self.storage.primary_key_type.read()
    }

    /// Get the label hash for a key
    #[external("public")]
    #[view]
    fn get_key_label(key_type: u8, public_key_hash: Field) -> pub Field {
        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);
        self.storage.key_labels.at(key_id).read()
    }
}
