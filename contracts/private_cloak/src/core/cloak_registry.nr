/// Cloak Registry Contract
///
/// Central registry for tracking Cloaks and user memberships.
/// Follows the EasyPrivateVoting pattern - uses public storage for most data,
/// with privacy achieved through controlled access and optional private views.
///
/// Features:
/// - Register new Cloaks
/// - Track user memberships (public count, with optional private enumeration)
/// - Resolve friendly IDs to contract addresses
/// - Track total Cloaks in the system

use dep::aztec::macros::aztec;

#[aztec]
pub contract CloakRegistry {
    use dep::aztec::{
        macros::{functions::{initializer, external, view}, storage::storage},
        protocol_types::{address::AztecAddress, traits::ToField},
        state_vars::{Map, PublicMutable},
    };

    // ===== CONSTANTS =====

    /// Maximum Cloaks a single user can be a member of
    global MAX_CLOAKS_PER_USER: u64 = 50;

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // Registry admin
        admin: PublicMutable<AztecAddress, Context>,

        // ===== CLOAK TRACKING =====
        // Cloak address -> public info (name_hash, template_id, created_at, is_active)
        cloak_name_hashes: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        cloak_template_ids: Map<AztecAddress, PublicMutable<u8, Context>, Context>,
        cloak_created_at: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        cloak_is_active: Map<AztecAddress, PublicMutable<bool, Context>, Context>,

        // Cloak address -> creator address
        cloak_creators: Map<AztecAddress, PublicMutable<AztecAddress, Context>, Context>,

        // Cloak address -> member count
        cloak_member_counts: Map<AztecAddress, PublicMutable<u64, Context>, Context>,

        // Friendly ID hash -> Cloak address (for URL-friendly lookups)
        friendly_id_to_cloak: Map<Field, PublicMutable<AztecAddress, Context>, Context>,

        // Total Cloaks registered
        total_cloaks: PublicMutable<u64, Context>,

        // ===== USER MEMBERSHIP TRACKING =====
        // User address -> number of Cloaks they belong to
        user_cloak_counts: Map<AztecAddress, PublicMutable<u64, Context>, Context>,

        // User -> Cloak membership (user, cloak) -> membership info
        // Stored as: Map<user, Map<cloak, membership_type>>
        // membership_type: 0=not_member, 1=member, 2=admin, 3=creator
        user_memberships: Map<AztecAddress, Map<AztecAddress, PublicMutable<u8, Context>, Context>, Context>,

        // Nullifier tracking to prevent duplicate membership claims
        // Stores hash of (user, cloak) pairs that have been registered
        membership_nullifiers: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.total_cloaks.write(0);
    }

    // ===== CLOAK REGISTRATION =====

    /// Register a new Cloak in the registry
    /// Called by Cloak contracts during deployment
    #[external("public")]
    fn register_cloak(
        cloak_address: AztecAddress,
        name_hash: Field,
        friendly_id_hash: Field,
        template_id: u8,
        creator: AztecAddress,
    ) {
        // Check Cloak is not already registered
        let existing_creator = self.storage.cloak_creators.at(cloak_address).read();
        assert(existing_creator.is_zero(), "Cloak already registered");

        // Check friendly ID is not taken
        let existing_cloak = self.storage.friendly_id_to_cloak.at(friendly_id_hash).read();
        assert(existing_cloak.is_zero(), "Friendly ID already taken");

        // Store Cloak info
        self.storage.cloak_name_hashes.at(cloak_address).write(name_hash);
        self.storage.cloak_template_ids.at(cloak_address).write(template_id);
        self.storage.cloak_created_at.at(cloak_address).write(self.context.block_number());
        self.storage.cloak_is_active.at(cloak_address).write(true);
        self.storage.cloak_creators.at(cloak_address).write(creator);
        self.storage.cloak_member_counts.at(cloak_address).write(1); // Creator is first member

        // Map friendly ID to address
        self.storage.friendly_id_to_cloak.at(friendly_id_hash).write(cloak_address);

        // Increment total Cloaks
        let count = self.storage.total_cloaks.read();
        self.storage.total_cloaks.write(count + 1);

        // Register creator membership
        self.storage.user_memberships.at(creator).at(cloak_address).write(3); // 3 = creator
        let user_count = self.storage.user_cloak_counts.at(creator).read();
        self.storage.user_cloak_counts.at(creator).write(user_count + 1);
    }

    // ===== MEMBERSHIP MANAGEMENT =====

    /// Record that a user has joined a Cloak
    /// Called by Cloak contracts when someone joins
    #[external("public")]
    fn add_membership(
        user: AztecAddress,
        cloak_address: AztecAddress,
        membership_type: u8, // 1=member, 2=admin
    ) {
        // Verify caller is the Cloak itself (only Cloaks can update their memberships)
        let caller = self.msg_sender().unwrap();
        assert(caller.eq(cloak_address), "only Cloak can update membership");

        // Check membership type is valid (1=member, 2=admin, not 0 or 3)
        assert((membership_type == 1) | (membership_type == 2), "invalid membership type");

        // Check user is not already a member
        let existing = self.storage.user_memberships.at(user).at(cloak_address).read();
        assert(existing == 0, "already a member");

        // Check user has not exceeded max Cloaks
        let user_count = self.storage.user_cloak_counts.at(user).read();
        assert(user_count < MAX_CLOAKS_PER_USER, "too many Cloaks");

        // Create nullifier to prevent duplicate claims
        let nullifier_hash = std::hash::pedersen_hash([user.to_field(), cloak_address.to_field()]);
        let _nullifier_used = self.storage.membership_nullifiers.at(nullifier_hash).read();
        assert(!_nullifier_used, "membership already claimed");
        self.storage.membership_nullifiers.at(nullifier_hash).write(true);

        // Record membership
        self.storage.user_memberships.at(user).at(cloak_address).write(membership_type);
        self.storage.user_cloak_counts.at(user).write(user_count + 1);

        // Increment Cloak member count
        let cloak_count = self.storage.cloak_member_counts.at(cloak_address).read();
        self.storage.cloak_member_counts.at(cloak_address).write(cloak_count + 1);
    }

    /// Remove a user membership from a Cloak
    /// Called by Cloak contracts when someone leaves or is removed
    #[external("public")]
    fn remove_membership(user: AztecAddress, cloak_address: AztecAddress) {
        // Verify caller is the Cloak itself
        let caller = self.msg_sender().unwrap();
        assert(caller.eq(cloak_address), "only Cloak can update membership");

        // Check user is a member
        let existing = self.storage.user_memberships.at(user).at(cloak_address).read();
        assert(existing > 0, "not a member");

        // Remove membership
        self.storage.user_memberships.at(user).at(cloak_address).write(0);

        // Decrement counts
        let user_count = self.storage.user_cloak_counts.at(user).read();
        if user_count > 0 {
            self.storage.user_cloak_counts.at(user).write(user_count - 1);
        }

        let cloak_count = self.storage.cloak_member_counts.at(cloak_address).read();
        if cloak_count > 0 {
            self.storage.cloak_member_counts.at(cloak_address).write(cloak_count - 1);
        }
    }

    /// Update a user membership type (e.g., promote to admin)
    #[external("public")]
    fn update_membership_type(
        user: AztecAddress,
        cloak_address: AztecAddress,
        new_type: u8,
    ) {
        // Verify caller is the Cloak itself
        let caller = self.msg_sender().unwrap();
        assert(caller.eq(cloak_address), "only Cloak can update membership");

        // Check user is a member
        let existing = self.storage.user_memberships.at(user).at(cloak_address).read();
        assert(existing > 0, "not a member");

        // Update type (can be 1=member, 2=admin, or 3=creator)
        assert((new_type >= 1) & (new_type <= 3), "invalid membership type");
        self.storage.user_memberships.at(user).at(cloak_address).write(new_type);
    }

    // ===== VIEW FUNCTIONS =====

    #[external("public")]
    #[view]
    fn get_cloak_info(cloak_address: AztecAddress) -> pub (Field, u8, u32, bool, AztecAddress, u64) {
        let name_hash = self.storage.cloak_name_hashes.at(cloak_address).read();
        let template_id = self.storage.cloak_template_ids.at(cloak_address).read();
        let created_at = self.storage.cloak_created_at.at(cloak_address).read();
        let is_active = self.storage.cloak_is_active.at(cloak_address).read();
        let creator = self.storage.cloak_creators.at(cloak_address).read();
        let member_count = self.storage.cloak_member_counts.at(cloak_address).read();

        (name_hash, template_id, created_at, is_active, creator, member_count)
    }

    #[external("public")]
    #[view]
    fn resolve_friendly_id(friendly_id_hash: Field) -> pub AztecAddress {
        self.storage.friendly_id_to_cloak.at(friendly_id_hash).read()
    }

    #[external("public")]
    #[view]
    fn get_user_membership(user: AztecAddress, cloak_address: AztecAddress) -> pub u8 {
        self.storage.user_memberships.at(user).at(cloak_address).read()
    }

    #[external("public")]
    #[view]
    fn get_user_cloak_count(user: AztecAddress) -> pub u64 {
        self.storage.user_cloak_counts.at(user).read()
    }

    #[external("public")]
    #[view]
    fn get_cloak_member_count(cloak_address: AztecAddress) -> pub u64 {
        self.storage.cloak_member_counts.at(cloak_address).read()
    }

    #[external("public")]
    #[view]
    fn get_total_cloaks() -> pub u64 {
        self.storage.total_cloaks.read()
    }

    #[external("public")]
    #[view]
    fn is_cloak_registered(cloak_address: AztecAddress) -> pub bool {
        let creator = self.storage.cloak_creators.at(cloak_address).read();
        !creator.is_zero()
    }

    // ===== ADMIN FUNCTIONS =====

    /// Deactivate a Cloak (admin only - for moderation)
    #[external("public")]
    fn deactivate_cloak(cloak_address: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "only admin");

        self.storage.cloak_is_active.at(cloak_address).write(false);
    }

    /// Reactivate a Cloak (admin only)
    #[external("public")]
    fn reactivate_cloak(cloak_address: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "only admin");

        self.storage.cloak_is_active.at(cloak_address).write(true);
    }

    /// Transfer admin role
    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "only admin");

        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    #[view]
    fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }
}
