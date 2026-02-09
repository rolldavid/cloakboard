/// CloakMemberships - Public User-Cloak Relationship Tracking with Roles
///
/// Stores PUBLIC mappings of which users are members of which cloaks,
/// including their role (member, admin, creator).
/// This enables fast, reliable queries without PXE note discovery.
///
/// Privacy: Membership is public (like ERC20 token holdings).
/// Actions (voting, delegation, proposals) remain private in the cloak contracts.

use dep::aztec::macros::aztec;

#[aztec]
pub contract CloakMemberships {
    use dep::aztec::{
        macros::{functions::{initializer, external, view}, storage::storage},
        protocol_types::address::AztecAddress,
        state_vars::{Map, PublicMutable},
    };

    // Role constants
    global ROLE_NONE: u8 = 0;
    global ROLE_MEMBER: u8 = 1;
    global ROLE_ADMIN: u8 = 2;
    global ROLE_CREATOR: u8 = 3;

    // Maximum cloaks per user (can be increased if needed)
    global MAX_USER_CLOAKS: u32 = 50;
    // Maximum members per cloak (for pagination)
    global MAX_CLOAK_MEMBERS: u32 = 1000;

    #[storage]
    struct Storage<Context> {
        // Track membership count per user
        user_cloak_count: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        // user -> index -> cloak_address (for enumeration)
        user_cloaks: Map<AztecAddress, Map<u32, PublicMutable<AztecAddress, Context>, Context>, Context>,
        // user -> cloak -> role (0=none, 1=member, 2=admin, 3=creator)
        membership_role: Map<AztecAddress, Map<AztecAddress, PublicMutable<u8, Context>, Context>, Context>,

        // Track member count per cloak
        cloak_member_count: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
        // cloak -> index -> user_address (for enumeration)
        cloak_members: Map<AztecAddress, Map<u32, PublicMutable<AztecAddress, Context>, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {
        // No initialization needed - maps start empty
    }

    /// Add a membership relationship with a role (user joins a cloak)
    /// role must be 1 (member), 2 (admin), or 3 (creator)
    /// Can be called by the user themselves or by a cloak contract
    #[external("public")]
    fn add_membership(user: AztecAddress, cloak: AztecAddress, role: u8) {
        // Validate role is 1-3
        assert(role >= ROLE_MEMBER, "role must be >= 1");
        assert(role <= ROLE_CREATOR, "role must be <= 3");

        let existing_role = self.storage.membership_role.at(user).at(cloak).read();

        if existing_role == ROLE_NONE {
            // New membership -- add to enumeration lists
            self.storage.membership_role.at(user).at(cloak).write(role);

            // Add to user's cloak list
            let user_count = self.storage.user_cloak_count.at(user).read();
            assert(user_count < MAX_USER_CLOAKS, "User has too many cloaks");
            self.storage.user_cloaks.at(user).at(user_count).write(cloak);
            self.storage.user_cloak_count.at(user).write(user_count + 1);

            // Add to cloak's member list
            let cloak_count = self.storage.cloak_member_count.at(cloak).read();
            assert(cloak_count < MAX_CLOAK_MEMBERS, "Cloak has too many members");
            self.storage.cloak_members.at(cloak).at(cloak_count).write(user);
            self.storage.cloak_member_count.at(cloak).write(cloak_count + 1);
        } else {
            // Existing membership -- just update the role
            self.storage.membership_role.at(user).at(cloak).write(role);
        }
    }

    /// Remove a membership relationship (user leaves a cloak)
    #[external("public")]
    fn remove_membership(user: AztecAddress, cloak: AztecAddress) {
        // Check if actually a member - only proceed if they are
        let role = self.storage.membership_role.at(user).at(cloak).read();
        if role != ROLE_NONE {
            // Set role to NONE
            self.storage.membership_role.at(user).at(cloak).write(ROLE_NONE);

            // Note: We don't remove from the lists to keep indices stable
            // The membership_role check is the source of truth
            // Lists may contain stale entries that should be filtered client-side
        }
    }

    /// Check if a user is a member of a cloak (backward compatible -- returns role > 0)
    #[external("public")]
    #[view]
    fn check_membership(user: AztecAddress, cloak: AztecAddress) -> pub bool {
        self.storage.membership_role.at(user).at(cloak).read() > ROLE_NONE
    }

    /// Get the role of a user in a cloak (0=none, 1=member, 2=admin, 3=creator)
    #[external("public")]
    #[view]
    fn get_member_role(user: AztecAddress, cloak: AztecAddress) -> pub u8 {
        self.storage.membership_role.at(user).at(cloak).read()
    }

    /// Get the number of cloaks a user is associated with
    #[external("public")]
    #[view]
    fn get_user_cloak_count(user: AztecAddress) -> pub u32 {
        self.storage.user_cloak_count.at(user).read()
    }

    /// Get a cloak address at a specific index for a user
    #[external("public")]
    #[view]
    fn get_user_cloak_at(user: AztecAddress, index: u32) -> pub AztecAddress {
        self.storage.user_cloaks.at(user).at(index).read()
    }

    /// Get the number of members in a cloak
    #[external("public")]
    #[view]
    fn get_cloak_member_count(cloak: AztecAddress) -> pub u32 {
        self.storage.cloak_member_count.at(cloak).read()
    }

    /// Get a member address at a specific index for a cloak
    #[external("public")]
    #[view]
    fn get_cloak_member_at(cloak: AztecAddress, index: u32) -> pub AztecAddress {
        self.storage.cloak_members.at(cloak).at(index).read()
    }
}
