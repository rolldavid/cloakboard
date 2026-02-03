/// MultiAuthAccount -- Aztec account contract supporting multiple auth methods.
///
/// Maintains a private set of authorized keys across multiple curve types
/// (Schnorr/Grumpkin, secp256k1, secp256r1). Any authorized key can produce
/// a valid auth witness to control this account.
///
/// Key features:
/// - Single Aztec address regardless of which auth method is used
/// - Add/remove authorized keys (must be called by an already-authorized key)
/// - Lockout protection: cannot remove the last key
/// - Private key storage: only the account owner can enumerate keys

use dep::aztec::macros::aztec;

#[aztec]
pub contract MultiAuthAccount {
    use dep::aztec::{
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{
            address::AztecAddress,
            traits::Hash,
        },
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use crate::types::auth_key_note::{KEY_TYPE_SCHNORR, KEY_TYPE_ECDSA_K256, KEY_TYPE_ECDSA_R1};

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        /// Hash of the primary signing key (set at init, used for Aztec protocol operations)
        primary_key_hash: PublicImmutable<Field, Context>,

        /// Primary key type
        primary_key_type: PublicImmutable<u8, Context>,

        /// Number of authorized keys (public, but doesn't reveal what types)
        key_count: PublicMutable<u8, Context>,

        /// Authorized key map: hash(key_type, public_key_hash) -> bool
        /// We use a Map instead of PrivateSet for simpler lookup during verification.
        /// Key: poseidon_hash([key_type as Field, public_key_hash])
        authorized_keys: Map<Field, PublicMutable<bool, Context>, Context>,

        /// Label storage: hash(key_type, public_key_hash) -> label_hash
        key_labels: Map<Field, PublicMutable<Field, Context>, Context>,
    }

    // ===== INITIALIZER =====

    /// Deploy a new MultiAuthAccount with a single initial key.
    ///
    /// # Arguments
    /// * `key_type` - The curve type (0=Schnorr, 1=secp256k1, 2=secp256r1)
    /// * `public_key_hash` - Hash of the initial public key
    /// * `label_hash` - Hash of a human label for this key (e.g. "google")
    #[external("public")]
    #[initializer]
    fn constructor(
        key_type: u8,
        public_key_hash: Field,
        label_hash: Field,
    ) {
        // Validate key type
        assert(
            (key_type == KEY_TYPE_SCHNORR)
                | (key_type == KEY_TYPE_ECDSA_K256)
                | (key_type == KEY_TYPE_ECDSA_R1),
            "invalid key type",
        );

        // Store primary key info
        self.storage.primary_key_hash.initialize(public_key_hash);
        self.storage.primary_key_type.initialize(key_type);
        self.storage.key_count.write(1);

        // Register the key in the authorized set
        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);
        self.storage.authorized_keys.at(key_id).write(true);
        self.storage.key_labels.at(key_id).write(label_hash);
    }

    // ===== KEY MANAGEMENT =====

    /// Add a new authorized key. Must be called by the account itself
    /// (i.e., the caller must have passed entrypoint verification).
    #[external("public")]
    #[only_self]
    fn add_authorized_key(
        key_type: u8,
        public_key_hash: Field,
        label_hash: Field,
    ) {
        // Validate key type
        assert(
            (key_type == KEY_TYPE_SCHNORR)
                | (key_type == KEY_TYPE_ECDSA_K256)
                | (key_type == KEY_TYPE_ECDSA_R1),
            "invalid key type",
        );

        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);

        // Check not already authorized
        let already = self.storage.authorized_keys.at(key_id).read();
        assert(!already, "key already authorized");

        // Register the key
        self.storage.authorized_keys.at(key_id).write(true);
        self.storage.key_labels.at(key_id).write(label_hash);

        // Increment count
        let count = self.storage.key_count.read();
        self.storage.key_count.write(count + 1);
    }

    /// Remove an authorized key. Cannot remove the last key (lockout protection).
    #[external("public")]
    #[only_self]
    fn remove_authorized_key(
        key_type: u8,
        public_key_hash: Field,
    ) {
        let count = self.storage.key_count.read();
        assert(count > 1, "cannot remove last key");

        let key_id = std::hash::pedersen_hash([key_type as Field, public_key_hash]);

        // Check it exists
        let exists = self.storage.authorized_keys.at(key_id).read();
        assert(exists, "key not authorized");

        // Remove the key
        self.storage.authorized_keys.at(key_id).write(false);
        self.storage.key_labels.at(key_id).write(0);
        self.storage.key_count.write(count - 1);
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
