// Cloak Registry -- On-Chain Name Uniqueness + Reverse Name Lookup
//
// A singleton registry that maps name hashes to cloak contract addresses.
// Every cloak must register its name here during deployment.
//
// Names are stored as Pedersen hashes for uniqueness (name_to_cloak key),
// but the compressed name field is stored in cloak_to_name for reverse lookup.
//
// PRIVACY: This contract does NOT store deployer information.
// Creator tracking is handled by CloakMemberships (role=3).
//
// The registry is permissionless: anyone can register a name for a new cloak,
// but a name hash can only be claimed once.

use dep::aztec::macros::aztec;

#[aztec]
pub contract CloakRegistry {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        protocol_types::{
            address::AztecAddress,
            traits::{Hash, ToField, Serialize},
        },
        state_vars::{Map, PublicMutable},
    };
    use dep::compressed_string::FieldCompressedString;

    #[storage]
    struct Storage<Context> {
        // name_hash -> cloak address (zero = not taken)
        name_to_cloak: Map<Field, PublicMutable<AztecAddress, Context>, Context>,

        // cloak address -> compressed name field (reversible to string)
        cloak_to_name: Map<AztecAddress, PublicMutable<Field, Context>, Context>,

        // Total number of registered cloaks
        cloak_count: PublicMutable<u64, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor() {
        self.storage.cloak_count.write(0);
    }

    // ===== REGISTRATION (Private entry point) =====

    /// Register a cloak name.
    /// Uses a nullifier to prevent double-registration.
    /// `name` is the raw name (max 31 chars).
    /// `cloak_address` is the deployed cloak contract address.
    #[external("private")]
    fn register(name: str<31>, cloak_address: AztecAddress) {
        let caller = self.msg_sender().unwrap();

        // Compute nullifier to prevent double-registration of the same cloak
        let msg_sender_npk_m_hash = get_public_keys(caller).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            cloak_address.to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Compress the name and compute hash for public registration
        let name_field = FieldCompressedString::from_string(name);
        let name_field_value = name_field.serialize()[0];
        let name_hash = std::hash::pedersen_hash([name_field_value]);

        // Enqueue call to public function for name registration
        // Pass both name_hash (for uniqueness key) and name_field (for reverse lookup)
        self.enqueue_self.register_internal(name_hash, name_field_value, cloak_address);
    }

    /// Internal public function - checks uniqueness and stores name mapping.
    /// Stores the compressed name field (not the hash) in cloak_to_name for reverse lookup.
    #[external("public")]
    #[only_self]
    fn register_internal(name_hash: Field, name_field: Field, cloak_address: AztecAddress) {
        // Ensure name is not already taken
        let existing = self.storage.name_to_cloak.at(name_hash).read();
        assert(existing.is_zero(), "name already registered");

        // Ensure cloak address is not zero
        assert(!cloak_address.is_zero(), "invalid cloak address");

        // Ensure this cloak does not already have a name
        let existing_name = self.storage.cloak_to_name.at(cloak_address).read();
        assert(existing_name == 0, "cloak already has a name");

        // Register: name_hash -> cloak address (for uniqueness)
        self.storage.name_to_cloak.at(name_hash).write(cloak_address);
        // Register: cloak address -> compressed name field (for reverse lookup)
        self.storage.cloak_to_name.at(cloak_address).write(name_field);

        // Update global count
        let count = self.storage.cloak_count.read();
        self.storage.cloak_count.write(count + 1);
    }

    // ===== PUBLIC VIEW FUNCTIONS =====

    /// Check if a name is available (returns true if NOT taken).
    #[external("public")]
    #[view]
    fn is_name_available(name: str<31>) -> pub bool {
        let name_field = FieldCompressedString::from_string(name);
        let name_hash = std::hash::pedersen_hash([name_field.serialize()[0]]);
        let existing = self.storage.name_to_cloak.at(name_hash).read();
        existing.is_zero()
    }

    /// Get the cloak address for a given name. Returns zero address if not found.
    #[external("public")]
    #[view]
    fn get_cloak_by_name(name: str<31>) -> pub AztecAddress {
        let name_field = FieldCompressedString::from_string(name);
        let name_hash = std::hash::pedersen_hash([name_field.serialize()[0]]);
        self.storage.name_to_cloak.at(name_hash).read()
    }

    /// Get the compressed name field for a cloak address.
    /// Returns 0 if not registered. Client decompresses the field to a string.
    #[external("public")]
    #[view]
    fn get_cloak_name(cloak_address: AztecAddress) -> pub Field {
        self.storage.cloak_to_name.at(cloak_address).read()
    }

    /// Get the name field for a cloak address (alias for backward compat).
    /// NOTE: Now returns compressed name field instead of hash.
    #[external("public")]
    #[view]
    fn get_name_hash_by_cloak(cloak_address: AztecAddress) -> pub Field {
        self.storage.cloak_to_name.at(cloak_address).read()
    }

    /// Get the total number of registered cloaks.
    #[external("public")]
    #[view]
    fn get_cloak_count() -> pub u64 {
        self.storage.cloak_count.read()
    }

    /// Check if a name hash is taken (for clients that pre-compute the hash).
    #[external("public")]
    #[view]
    fn is_name_hash_taken(name_hash: Field) -> pub bool {
        let existing = self.storage.name_to_cloak.at(name_hash).read();
        !existing.is_zero()
    }
}
