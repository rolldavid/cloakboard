// Cloak Registry -- On-Chain Name Uniqueness
//
// A singleton registry that maps name hashes to cloak contract addresses.
// Every cloak must register its name here during deployment.
// Names are stored as hashes for gas efficiency.
//
// The registry is permissionless: anyone can register a name for a new cloak,
// but a name hash can only be claimed once.

use dep::aztec::macros::aztec;

#[aztec]
pub contract CloakRegistry {
    use dep::aztec::{
        macros::{functions::{initializer, external, view}, storage::storage},
        protocol_types::{address::AztecAddress, traits::{ToField, Serialize}},
        state_vars::{Map, PublicMutable},
    };
    use dep::compressed_string::FieldCompressedString;

    #[storage]
    struct Storage<Context> {
        // name_hash -> cloak address (zero = not taken)
        name_to_cloak: Map<Field, PublicMutable<AztecAddress, Context>, Context>,

        // cloak address -> name_hash (reverse lookup)
        cloak_to_name: Map<AztecAddress, PublicMutable<Field, Context>, Context>,

        // Total number of registered cloaks
        cloak_count: PublicMutable<u64, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {
        self.storage.cloak_count.write(0);
    }

    // Register a cloak name. Reverts if the name hash is already taken.
    // `name` is the raw name (max 31 chars).
    // `cloak_address` is the deployed cloak contract address.
    #[external("public")]
    fn register(name: str<31>, cloak_address: AztecAddress) {
        let name_field = FieldCompressedString::from_string(name);
        let name_hash = std::hash::pedersen_hash([name_field.serialize()[0]]);

        // Ensure name is not already taken
        let existing = self.storage.name_to_cloak.at(name_hash).read();
        assert(existing.is_zero(), "name already registered");

        // Ensure cloak address is not zero
        assert(!cloak_address.is_zero(), "invalid cloak address");

        // Ensure this cloak does not already have a name
        let existing_name = self.storage.cloak_to_name.at(cloak_address).read();
        assert(existing_name == 0, "cloak already has a name");

        // Register
        self.storage.name_to_cloak.at(name_hash).write(cloak_address);
        self.storage.cloak_to_name.at(cloak_address).write(name_hash);

        let count = self.storage.cloak_count.read();
        self.storage.cloak_count.write(count + 1);
    }

    // ===== VIEW FUNCTIONS =====

    // Check if a name is available (returns true if NOT taken).
    #[external("public")]
    #[view]
    fn is_name_available(name: str<31>) -> pub bool {
        let name_field = FieldCompressedString::from_string(name);
        let name_hash = std::hash::pedersen_hash([name_field.serialize()[0]]);
        let existing = self.storage.name_to_cloak.at(name_hash).read();
        existing.is_zero()
    }

    // Get the cloak address for a given name. Returns zero address if not found.
    #[external("public")]
    #[view]
    fn get_cloak_by_name(name: str<31>) -> pub AztecAddress {
        let name_field = FieldCompressedString::from_string(name);
        let name_hash = std::hash::pedersen_hash([name_field.serialize()[0]]);
        self.storage.name_to_cloak.at(name_hash).read()
    }

    // Get the name hash registered for a cloak address. Returns 0 if not registered.
    #[external("public")]
    #[view]
    fn get_name_hash_by_cloak(cloak_address: AztecAddress) -> pub Field {
        self.storage.cloak_to_name.at(cloak_address).read()
    }

    // Get the total number of registered cloaks.
    #[external("public")]
    #[view]
    fn get_cloak_count() -> pub u64 {
        self.storage.cloak_count.read()
    }

    // Check if a name hash is taken (for clients that pre-compute the hash).
    #[external("public")]
    #[view]
    fn is_name_hash_taken(name_hash: Field) -> pub bool {
        let existing = self.storage.name_to_cloak.at(name_hash).read();
        !existing.is_zero()
    }
}
