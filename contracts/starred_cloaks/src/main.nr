pub mod types;

use dep::aztec::macros::aztec;

#[aztec]
pub contract StarredCloaks {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, internal, view, only_self}, storage::storage},
        protocol_types::{
            address::AztecAddress,
            traits::{Hash, ToField},
        },
        state_vars::{Map, PublicMutable},
    };

    // ===== STORAGE =====
    // Using a Map-based approach similar to MultiAuthAccount.
    // Each star is stored as: hash(owner, cloak_address) -> bool
    // This allows O(1) lookup for "is starred" checks.
    // To enumerate, the client keeps track of starred addresses locally.
    #[storage]
    struct Storage<Context> {
        /// Maps hash(owner, cloak_address) -> is_starred
        stars: Map<Field, PublicMutable<bool, Context>, Context>,
        /// Counter per user (for debugging/info only)
        star_counts: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
    }

    // ===== INITIALIZER =====
    // Contract has no state to initialize - just needed for deployment
    #[external("public")]
    #[initializer]
    fn constructor() {}

    // ===== PRIVATE FUNCTIONS =====

    /// Star a cloak - creates a record that only the sender can verify ownership of
    /// Uses a nullifier to prevent double-starring the same cloak
    #[external("private")]
    fn star(cloak_address: AztecAddress) {
        let sender = self.msg_sender().unwrap();

        // Compute nullifier to prevent double-starring
        // Derived from (sender, cloak_address) so each user can only star a cloak once
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            cloak_address.to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Enqueue the public state update
        self.enqueue_self.add_star_internal(sender, cloak_address);
    }

    /// Unstar a cloak - removes the star record
    /// Uses a different nullifier domain to prevent replay
    #[external("private")]
    fn unstar(cloak_address: AztecAddress) {
        let sender = self.msg_sender().unwrap();

        // Compute nullifier for unstar operation (different domain)
        let msg_sender_npk_m_hash = get_public_keys(sender).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        // Add a domain separator (1) to differentiate from star nullifier
        let nullifier = std::hash::pedersen_hash([
            1 as Field,
            cloak_address.to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Enqueue the public state update
        self.enqueue_self.remove_star_internal(sender, cloak_address);
    }

    // ===== INTERNAL PUBLIC FUNCTIONS =====

    #[external("public")]
    #[only_self]
    fn add_star_internal(owner: AztecAddress, cloak_address: AztecAddress) {
        let star_id = std::hash::pedersen_hash([owner.to_field(), cloak_address.to_field()]);

        // Check not already starred
        let already_starred = self.storage.stars.at(star_id).read();
        assert(!already_starred, "already starred");

        // Add the star
        self.storage.stars.at(star_id).write(true);

        // Increment count
        let count = self.storage.star_counts.at(owner).read();
        self.storage.star_counts.at(owner).write(count + 1);
    }

    #[external("public")]
    #[only_self]
    fn remove_star_internal(owner: AztecAddress, cloak_address: AztecAddress) {
        let star_id = std::hash::pedersen_hash([owner.to_field(), cloak_address.to_field()]);

        // Check is starred
        let is_starred = self.storage.stars.at(star_id).read();
        assert(is_starred, "not starred");

        // Remove the star
        self.storage.stars.at(star_id).write(false);

        // Decrement count
        let count = self.storage.star_counts.at(owner).read();
        if count > 0 {
            self.storage.star_counts.at(owner).write(count - 1);
        }
    }

    // ===== VIEW FUNCTIONS =====

    /// Check if a specific cloak is starred by a specific owner
    #[external("public")]
    #[view]
    fn is_starred(owner: AztecAddress, cloak_address: AztecAddress) -> pub bool {
        let star_id = std::hash::pedersen_hash([owner.to_field(), cloak_address.to_field()]);
        self.storage.stars.at(star_id).read()
    }

    /// Get the star count for an owner
    #[external("public")]
    #[view]
    fn get_star_count(owner: AztecAddress) -> pub u32 {
        self.storage.star_counts.at(owner).read()
    }
}
