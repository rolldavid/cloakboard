/// Base Cloak Contract
///
/// Provides core functionality shared by all Cloak templates:
/// - Privacy configuration management
/// - Username <-> Address mapping
/// - Privacy-aware getters
/// - Membership management foundation
///
/// Templates extend this by adding template-specific features.

use dep::aztec::macros::aztec;

#[aztec]
pub contract BaseCloak {
    use dep::aztec::{
        macros::{functions::{initializer, external, view}, storage::storage},
        protocol_types::address::AztecAddress,
        state_vars::{Map, PublicMutable, PublicImmutable},
    };
    use dep::compressed_string::FieldCompressedString;
    use crate::core::privacy_config::presets;

    // ===== STORAGE =====

    #[storage]
    struct Storage<Context> {
        // ===== CLOAK IDENTITY =====
        name: PublicImmutable<FieldCompressedString, Context>,
        admin: PublicMutable<AztecAddress, Context>,

        // ===== PRIVACY CONFIGURATION =====
        // Store each privacy setting separately for easier access
        // Membership privacy
        priv_member_list: PublicMutable<u8, Context>,
        priv_member_count: PublicMutable<u8, Context>,
        priv_join_events: PublicMutable<u8, Context>,
        // Voting privacy
        priv_vote_choice: PublicMutable<u8, Context>,
        priv_vote_tally: PublicMutable<u8, Context>,
        priv_voter_identity: PublicMutable<u8, Context>,
        priv_voting_power: PublicMutable<u8, Context>,
        // Proposal privacy
        priv_proposal_author: PublicMutable<u8, Context>,
        priv_proposal_content: PublicMutable<u8, Context>,
        priv_discussion: PublicMutable<u8, Context>,
        // Treasury privacy
        priv_balance: PublicMutable<u8, Context>,
        priv_transaction: PublicMutable<u8, Context>,
        priv_recipient: PublicMutable<u8, Context>,
        // Activity privacy
        priv_activity_feed: PublicMutable<u8, Context>,
        // Lock status
        privacy_locked: PublicMutable<bool, Context>,

        // ===== MEMBERSHIP (Public counts, like EasyPrivateVoting) =====
        member_count: PublicMutable<u64, Context>,
        approximate_member_count: PublicMutable<u64, Context>,

        // Member info: address -> (voting_power, role, joined_at)
        member_voting_power: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        member_role: Map<AztecAddress, PublicMutable<u8, Context>, Context>,
        member_joined_at: Map<AztecAddress, PublicMutable<u32, Context>, Context>,
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn constructor(
        name: str<31>,
        admin: AztecAddress,
        privacy_preset: u8, // 0=maximum, 1=balanced, 2=transparent
    ) {
        self.storage.name.initialize(FieldCompressedString::from_string(name));
        self.storage.admin.write(admin);

        // Initialize privacy config based on preset
        let config = if privacy_preset == 0 {
            presets::maximum_privacy()
        } else if privacy_preset == 2 {
            presets::transparent()
        } else {
            presets::balanced()
        };

        // Store privacy settings
        // Member list is always private (hardcoded to 0) — membership is never exposed
        self.storage.priv_member_list.write(0);
        self.storage.priv_member_count.write(config.member_count_visibility);
        self.storage.priv_join_events.write(config.join_events_visibility);
        self.storage.priv_vote_choice.write(config.vote_choice_visibility);
        self.storage.priv_vote_tally.write(config.vote_tally_visibility);
        self.storage.priv_voter_identity.write(config.voter_identity_visibility);
        self.storage.priv_voting_power.write(config.voting_power_visibility);
        self.storage.priv_proposal_author.write(config.proposal_author_visibility);
        self.storage.priv_proposal_content.write(config.proposal_content_visibility);
        self.storage.priv_discussion.write(config.discussion_visibility);
        self.storage.priv_balance.write(config.balance_visibility);
        self.storage.priv_transaction.write(config.transaction_visibility);
        self.storage.priv_recipient.write(config.recipient_visibility);
        self.storage.priv_activity_feed.write(config.activity_feed_visibility);
        self.storage.privacy_locked.write(false);

        // Initialize counts
        self.storage.member_count.write(0);
        self.storage.approximate_member_count.write(0);

        // Add admin as first member
        self.storage.member_voting_power.at(admin).write(1);
        self.storage.member_role.at(admin).write(2); // 2 = admin
        self.storage.member_joined_at.at(admin).write(self.context.block_number());
        self.storage.member_count.write(1);
        self.storage.approximate_member_count.write(10); // Approximate to 10
    }

    // ===== PRIVACY CONFIGURATION =====

    /// Update a specific privacy setting (admin only)
    /// Can only increase visibility, never decrease
    #[external("public")]
    fn update_privacy_setting(setting_id: u8, new_value: u8) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");
        assert(!self.storage.privacy_locked.read(), "privacy locked");

        // Member list visibility is always 0 (private) and cannot be changed
        assert(setting_id != 0, "member list visibility cannot be changed");

        // Get current value (inlined get_privacy_setting_internal)
        let current = if setting_id == 0 { self.storage.priv_member_list.read() }
        else if setting_id == 1 { self.storage.priv_member_count.read() }
        else if setting_id == 2 { self.storage.priv_join_events.read() }
        else if setting_id == 3 { self.storage.priv_vote_choice.read() }
        else if setting_id == 4 { self.storage.priv_vote_tally.read() }
        else if setting_id == 5 { self.storage.priv_voter_identity.read() }
        else if setting_id == 6 { self.storage.priv_voting_power.read() }
        else if setting_id == 7 { self.storage.priv_proposal_author.read() }
        else if setting_id == 8 { self.storage.priv_proposal_content.read() }
        else if setting_id == 9 { self.storage.priv_discussion.read() }
        else if setting_id == 10 { self.storage.priv_balance.read() }
        else if setting_id == 11 { self.storage.priv_transaction.read() }
        else if setting_id == 12 { self.storage.priv_recipient.read() }
        else if setting_id == 13 { self.storage.priv_activity_feed.read() }
        else { 0 };

        assert(new_value >= current, "cannot reduce privacy");

        // Update the setting (inlined set_privacy_setting_internal)
        if setting_id == 0 { self.storage.priv_member_list.write(new_value); }
        else if setting_id == 1 { self.storage.priv_member_count.write(new_value); }
        else if setting_id == 2 { self.storage.priv_join_events.write(new_value); }
        else if setting_id == 3 { self.storage.priv_vote_choice.write(new_value); }
        else if setting_id == 4 { self.storage.priv_vote_tally.write(new_value); }
        else if setting_id == 5 { self.storage.priv_voter_identity.write(new_value); }
        else if setting_id == 6 { self.storage.priv_voting_power.write(new_value); }
        else if setting_id == 7 { self.storage.priv_proposal_author.write(new_value); }
        else if setting_id == 8 { self.storage.priv_proposal_content.write(new_value); }
        else if setting_id == 9 { self.storage.priv_discussion.write(new_value); }
        else if setting_id == 10 { self.storage.priv_balance.write(new_value); }
        else if setting_id == 11 { self.storage.priv_transaction.write(new_value); }
        else if setting_id == 12 { self.storage.priv_recipient.write(new_value); }
        else if setting_id == 13 { self.storage.priv_activity_feed.write(new_value); }
    }

    /// Lock privacy configuration permanently
    #[external("public")]
    fn lock_privacy() {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.privacy_locked.write(true);
    }

    /// Check if privacy is locked
    #[external("public")]
    #[view]
    fn is_privacy_locked() -> pub bool {
        self.storage.privacy_locked.read()
    }

    // ===== PRIVACY-AWARE GETTERS =====

    /// Get member count based on privacy settings
    #[external("public")]
    #[view]
    fn get_member_count() -> pub u64 {
        let visibility = self.storage.priv_member_count.read();

        if visibility == 0 {
            0 // Hidden
        } else if visibility == 1 {
            self.storage.approximate_member_count.read()
        } else {
            self.storage.member_count.read()
        }
    }

    /// Get exact member count (for internal use)
    #[external("public")]
    #[view]
    fn get_exact_member_count() -> pub u64 {
        self.storage.member_count.read()
    }

    // ===== MEMBERSHIP MANAGEMENT =====

    /// Add a member (admin only)
    #[external("public")]
    fn add_member(new_member: AztecAddress, voting_power: u128) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        // Check not already a member
        let existing_power = self.storage.member_voting_power.at(new_member).read();
        let is_new = existing_power == 0;

        // Set member info
        self.storage.member_voting_power.at(new_member).write(voting_power);
        self.storage.member_role.at(new_member).write(1); // 1 = member
        self.storage.member_joined_at.at(new_member).write(self.context.block_number());

        // Update counts
        if is_new {
            let count = self.storage.member_count.read();
            self.storage.member_count.write(count + 1);

            // Inlined update_approximate_count(count + 1)
            let exact_count = count + 1;
            let approximate = if exact_count < 10 {
                10
            } else {
                ((exact_count + 5) / 10) * 10
            };
            self.storage.approximate_member_count.write(approximate);
        }
    }

    /// Remove a member (admin only)
    #[external("public")]
    fn remove_member(member: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        // Check is a member
        let existing_power = self.storage.member_voting_power.at(member).read();
        assert(existing_power > 0, "not a member");

        // Clear member info
        self.storage.member_voting_power.at(member).write(0);
        self.storage.member_role.at(member).write(0);

        // Update counts
        let count = self.storage.member_count.read();
        if count > 0 {
            self.storage.member_count.write(count - 1);

            // Inlined update_approximate_count(count - 1)
            let exact_count = count - 1;
            let approximate = if exact_count < 10 {
                10
            } else {
                ((exact_count + 5) / 10) * 10
            };
            self.storage.approximate_member_count.write(approximate);
        }
    }

    /// Update member role (admin only)
    #[external("public")]
    fn update_member_role(member: AztecAddress, new_role: u8) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        // Check is a member
        let existing_power = self.storage.member_voting_power.at(member).read();
        assert(existing_power > 0, "not a member");

        self.storage.member_role.at(member).write(new_role);
    }

    /// Check if an address is a member
    #[external("public")]
    #[view]
    fn is_member(address: AztecAddress) -> pub bool {
        self.storage.member_voting_power.at(address).read() > 0
    }

    /// Get member's voting power
    #[external("public")]
    #[view]
    fn get_voting_power(member: AztecAddress) -> pub u128 {
        self.storage.member_voting_power.at(member).read()
    }

    /// Get member's role
    #[external("public")]
    #[view]
    fn get_member_role(member: AztecAddress) -> pub u8 {
        self.storage.member_role.at(member).read()
    }

    // ===== ADMIN FUNCTIONS =====

    /// Transfer admin role
    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        let caller = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        assert(caller.eq(admin), "not admin");

        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    #[view]
    fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn get_name() -> pub FieldCompressedString {
        self.storage.name.read()
    }
}
