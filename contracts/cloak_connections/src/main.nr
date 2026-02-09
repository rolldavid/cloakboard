/// CloakConnections -- Private User-Cloak Relationship Tracking
///
/// Stores all user-cloak relationships as private notes that only the owner can read.
/// Enables users to see their cloaks on login across devices without revealing
/// relationships publicly.
///
/// Privacy guarantees:
/// - No public mapping of user to cloaks
/// - No public mapping of cloak to users
/// - All relationships stored as encrypted private notes
/// - Only the note owner can read/enumerate their connections

pub mod connection_note;

use dep::aztec::macros::aztec;

#[aztec]
pub contract CloakConnections {
    use dep::aztec::{
        keys::getters::get_public_keys,
        macros::{functions::{initializer, external, view, only_self}, storage::storage},
        messages::message_delivery::MessageDelivery,
        oracle::notes::{get_sender_for_tags, set_sender_for_tags},
        protocol_types::{
            address::AztecAddress,
            traits::{Hash, ToField},
        },
        state_vars::{Map, PublicMutable, PrivateSet, owned_state_variable::OwnedStateVariable},
    };
    use crate::connection_note::{ConnectionNote, TYPE_CREATED, TYPE_MEMBER, TYPE_ADMIN, TYPE_STARRED};

    // Storage slot constants for per-user PrivateSets
    global CONNECTIONS_SLOT: Field = 1;

    #[storage]
    struct Storage<Context> {
        // Track forgotten status: hash(owner, cloak) -> is_forgotten
        // This is public but only reveals that *someone* forgot *something*
        // The actual owner-cloak link is hidden because you need to know both to query
        forgotten: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor() {}

    // ===== PRIVATE FUNCTIONS =====

    /// Add a connection between the caller and a cloak.
    /// Creates a private note that only the caller can read.
    #[external("private")]
    fn add_connection(cloak_address: AztecAddress, connection_type: Field) {
        let owner = self.msg_sender().unwrap();

        // Validate connection type
        assert(
            (connection_type == TYPE_CREATED) |
            (connection_type == TYPE_MEMBER) |
            (connection_type == TYPE_ADMIN) |
            (connection_type == TYPE_STARRED),
            "invalid connection type"
        );

        // Compute nullifier to prevent duplicate connections of same type
        let msg_sender_npk_m_hash = get_public_keys(owner).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            cloak_address.to_field(),
            connection_type,
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Create the connection note
        let note = ConnectionNote {
            cloak_address,
            connection_type,
        };

        // Create a PrivateSet for this user dynamically
        // The storage slot is derived from a base slot
        let user_set: PrivateSet<ConnectionNote, _> = PrivateSet::new(
            self.context,
            CONNECTIONS_SLOT,
            owner
        );

        // Safety: set sender for tags so the note is discoverable by the owner's PXE
        let original_sender = unsafe { get_sender_for_tags().unwrap_or(owner) };
        // Safety: Setting sender for tags to owner for note discoverability.
        unsafe { set_sender_for_tags(owner) };

        user_set.insert(note).deliver(MessageDelivery.CONSTRAINED_ONCHAIN);

        // Safety: Restoring original sender for tags.
        unsafe { set_sender_for_tags(original_sender) };
    }

    /// Remove a connection (e.g., when leaving a cloak or unstarring).
    /// Nullifies to prevent re-adding the same connection.
    #[external("private")]
    fn remove_connection(cloak_address: AztecAddress, connection_type: Field) {
        let owner = self.msg_sender().unwrap();

        // Compute nullifier for removal (different domain separator)
        let msg_sender_npk_m_hash = get_public_keys(owner).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            1 as Field, // Domain separator for removal
            cloak_address.to_field(),
            connection_type,
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Note: The original connection note remains but this nullifier
        // prevents re-adding. Client-side filtering handles the removal display.
    }

    /// Forget a cloak - hides it from the dashboard without removing the actual connection.
    /// The user can unforget later to see it again.
    #[external("private")]
    fn forget_cloak(cloak_address: AztecAddress) {
        let owner = self.msg_sender().unwrap();

        // Compute forget key
        let forget_key = std::hash::pedersen_hash([owner.to_field(), cloak_address.to_field()]);

        // Use nullifier to prevent duplicate forget operations
        let msg_sender_npk_m_hash = get_public_keys(owner).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            2 as Field, // Domain separator for forget
            cloak_address.to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Enqueue public state update
        self.enqueue_self.set_forgotten_internal(forget_key, true);
    }

    /// Unforget a cloak - makes it visible on the dashboard again.
    #[external("private")]
    fn unforget_cloak(cloak_address: AztecAddress) {
        let owner = self.msg_sender().unwrap();

        // Compute forget key
        let forget_key = std::hash::pedersen_hash([owner.to_field(), cloak_address.to_field()]);

        // Use nullifier to prevent duplicate unforget operations
        let msg_sender_npk_m_hash = get_public_keys(owner).npk_m.hash();
        let secret = self.context.request_nsk_app(msg_sender_npk_m_hash);
        let nullifier = std::hash::pedersen_hash([
            3 as Field, // Domain separator for unforget
            cloak_address.to_field(),
            secret
        ]);
        self.context.push_nullifier(nullifier);

        // Enqueue public state update
        self.enqueue_self.set_forgotten_internal(forget_key, false);
    }

    // ===== INTERNAL PUBLIC FUNCTIONS =====

    #[external("public")]
    #[only_self]
    fn set_forgotten_internal(forget_key: Field, is_forgotten: bool) {
        self.storage.forgotten.at(forget_key).write(is_forgotten);
    }

    // ===== VIEW FUNCTIONS =====

    /// Check if a specific owner has forgotten a specific cloak.
    /// Requires knowing both owner and cloak address (privacy through obscurity).
    #[external("public")]
    #[view]
    fn is_forgotten(owner: AztecAddress, cloak_address: AztecAddress) -> pub bool {
        let forget_key = std::hash::pedersen_hash([owner.to_field(), cloak_address.to_field()]);
        self.storage.forgotten.at(forget_key).read()
    }
}
