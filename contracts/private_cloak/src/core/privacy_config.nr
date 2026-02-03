/// Privacy configuration for all Cloak aspects
/// Each template can customize these settings
///
/// Visibility levels:
/// - 0: private/hidden - Only the user or contract sees
/// - 1: members-only/approximate - Visible to Cloak members
/// - 2: public/exact - Visible to everyone
///
/// Key principle: Privacy can only become MORE public, never less.
/// This protects members who joined with privacy expectations.

use dep::aztec::protocol_types::traits::{Serialize, Deserialize};

/// Privacy configuration for all Cloak aspects
#[derive(Serialize, Deserialize)]
pub struct PrivacyConfig {
    // ===== MEMBERSHIP PRIVACY =====
    /// Who can see the list of members
    /// 0=private (only each member knows they're a member)
    /// 1=members_only (members can see other members)
    /// 2=public (anyone can see member list)
    pub member_list_visibility: u8,

    /// How member count is displayed
    /// 0=hidden (count not shown)
    /// 1=approximate (rounded, e.g., "~50 members")
    /// 2=exact (precise count shown)
    pub member_count_visibility: u8,

    /// How join events are announced
    /// 0=silent (no announcement)
    /// 1=anonymous_announce ("A new member joined")
    /// 2=public ("@username joined")
    pub join_events_visibility: u8,

    // ===== VOTING PRIVACY =====
    /// When vote choices are revealed
    /// 0=always_private (never revealed)
    /// 1=revealed_after (revealed after voting ends)
    /// 2=public (immediately visible)
    pub vote_choice_visibility: u8,

    /// How vote tallies are displayed during voting
    /// 0=hidden_until_end (no live tally)
    /// 1=live_anonymous (shows totals, not who voted)
    /// 2=live_public (full transparency)
    pub vote_tally_visibility: u8,

    /// When voter identity is revealed
    /// 0=never_revealed (permanent anonymity)
    /// 1=revealed_after (revealed after voting ends)
    /// 2=public (immediately visible)
    pub voter_identity_visibility: u8,

    /// How voting power is displayed
    /// 0=hidden (not shown)
    /// 1=relative_tier ("High", "Medium", "Low")
    /// 2=exact (precise amount)
    pub voting_power_visibility: u8,

    // ===== PROPOSAL PRIVACY =====
    /// When proposal author is revealed
    /// 0=anonymous_option (author chooses)
    /// 1=revealed_after (revealed after voting)
    /// 2=always_public (immediately visible)
    pub proposal_author_visibility: u8,

    /// Who can see proposal content
    /// 0=members_only (private to members)
    /// 1=public_summary (title public, details members-only)
    /// 2=fully_public (everything public)
    pub proposal_content_visibility: u8,

    /// How discussions are attributed
    /// 0=anonymous (no attribution)
    /// 1=username_only (username shown)
    /// 2=linked_to_member (full member profile link)
    pub discussion_visibility: u8,

    // ===== TREASURY PRIVACY =====
    /// How treasury balance is displayed
    /// 0=hidden (not shown)
    /// 1=approximate (rounded)
    /// 2=exact (precise amount)
    pub balance_visibility: u8,

    /// How transactions are displayed
    /// 0=hidden (not shown)
    /// 1=amounts_only (amounts without details)
    /// 2=full_details (complete transaction info)
    pub transaction_visibility: u8,

    /// How recipients are displayed
    /// 0=hidden (not shown)
    /// 1=category_only ("Development", "Marketing")
    /// 2=full (recipient address/username)
    pub recipient_visibility: u8,

    // ===== ACTIVITY PRIVACY =====
    /// What activity is shown in feeds
    /// 0=none (no activity feed)
    /// 1=aggregated ("5 new votes today")
    /// 2=detailed (individual actions)
    pub activity_feed_visibility: u8,
}

impl PrivacyConfig {
    /// Create a new privacy config with all values set to private/hidden
    pub fn new() -> Self {
        Self {
            member_list_visibility: 0,
            member_count_visibility: 0,
            join_events_visibility: 0,
            vote_choice_visibility: 0,
            vote_tally_visibility: 0,
            voter_identity_visibility: 0,
            voting_power_visibility: 0,
            proposal_author_visibility: 0,
            proposal_content_visibility: 0,
            discussion_visibility: 0,
            balance_visibility: 0,
            transaction_visibility: 0,
            recipient_visibility: 0,
            activity_feed_visibility: 0,
        }
    }

    /// Validate that new config only increases visibility (never decreases)
    /// Returns true if the change is valid
    pub fn validate_increase(self, new_config: PrivacyConfig) -> bool {
        // Each field can only stay the same or increase
        (new_config.member_list_visibility >= self.member_list_visibility)
            & (new_config.member_count_visibility >= self.member_count_visibility)
            & (new_config.join_events_visibility >= self.join_events_visibility)
            & (new_config.vote_choice_visibility >= self.vote_choice_visibility)
            & (new_config.vote_tally_visibility >= self.vote_tally_visibility)
            & (new_config.voter_identity_visibility >= self.voter_identity_visibility)
            & (new_config.voting_power_visibility >= self.voting_power_visibility)
            & (new_config.proposal_author_visibility >= self.proposal_author_visibility)
            & (new_config.proposal_content_visibility >= self.proposal_content_visibility)
            & (new_config.discussion_visibility >= self.discussion_visibility)
            & (new_config.balance_visibility >= self.balance_visibility)
            & (new_config.transaction_visibility >= self.transaction_visibility)
            & (new_config.recipient_visibility >= self.recipient_visibility)
            & (new_config.activity_feed_visibility >= self.activity_feed_visibility)
    }
}

/// Pre-built privacy presets for common use cases
pub mod presets {
    use super::PrivacyConfig;

    /// Maximum privacy - everything hidden
    /// Use case: Workplace organizing, sensitive operations
    pub fn maximum_privacy() -> PrivacyConfig {
        PrivacyConfig {
            member_list_visibility: 0,
            member_count_visibility: 0,
            join_events_visibility: 0,
            vote_choice_visibility: 0,
            vote_tally_visibility: 0,
            voter_identity_visibility: 0,
            voting_power_visibility: 0,
            proposal_author_visibility: 0,
            proposal_content_visibility: 0,
            discussion_visibility: 0,
            balance_visibility: 0,
            transaction_visibility: 0,
            recipient_visibility: 0,
            activity_feed_visibility: 0,
        }
    }

    /// Balanced privacy - reasonable defaults for most Cloaks
    /// Vote choices ALWAYS private, but other info visible to members
    pub fn balanced() -> PrivacyConfig {
        PrivacyConfig {
            member_list_visibility: 0,      // always private — membership never exposed
            member_count_visibility: 2,     // exact count public
            join_events_visibility: 1,      // anonymous announcements
            vote_choice_visibility: 0,      // ALWAYS private
            vote_tally_visibility: 1,       // live anonymous tally
            voter_identity_visibility: 0,   // NEVER revealed
            voting_power_visibility: 1,     // show tiers only
            proposal_author_visibility: 2,  // authors public
            proposal_content_visibility: 2, // proposals public
            discussion_visibility: 1,       // username-only
            balance_visibility: 1,          // approximate balance
            transaction_visibility: 1,      // amounts only
            recipient_visibility: 1,        // category only
            activity_feed_visibility: 1,    // aggregated
        }
    }

    /// Transparent - maximum visibility (but votes still private!)
    /// Use case: Public protocols, transparent governance
    pub fn transparent() -> PrivacyConfig {
        PrivacyConfig {
            member_list_visibility: 0,      // always private — membership never exposed
            member_count_visibility: 2,     // exact count
            join_events_visibility: 2,      // public join events
            vote_choice_visibility: 0,      // STILL private (core principle)
            vote_tally_visibility: 2,       // live public tally
            voter_identity_visibility: 0,   // STILL never revealed
            voting_power_visibility: 2,     // exact power shown
            proposal_author_visibility: 2,  // authors public
            proposal_content_visibility: 2, // fully public
            discussion_visibility: 2,       // linked to members
            balance_visibility: 2,          // exact balance
            transaction_visibility: 2,      // full details
            recipient_visibility: 2,        // full recipient info
            activity_feed_visibility: 2,    // detailed feed
        }
    }

    /// Organization Cloak default - domain-gated, balanced privacy
    pub fn organization_cloak() -> PrivacyConfig {
        balanced()
    }

    /// Treasury Cloak default - slightly more transparent for financial accountability
    pub fn treasury_cloak() -> PrivacyConfig {
        PrivacyConfig {
            member_list_visibility: 0,
            member_count_visibility: 2,
            join_events_visibility: 1,
            vote_choice_visibility: 0,
            vote_tally_visibility: 2,       // Live public tally for accountability
            voter_identity_visibility: 0,
            voting_power_visibility: 2,     // Exact voting power for transparency
            proposal_author_visibility: 2,
            proposal_content_visibility: 2,
            discussion_visibility: 1,
            balance_visibility: 2,          // Exact balance for treasury
            transaction_visibility: 2,      // Full transaction details
            recipient_visibility: 2,        // Full recipient info
            activity_feed_visibility: 2,
        }
    }

    /// Workplace Cloak default - maximum privacy for worker protection
    pub fn workplace_cloak() -> PrivacyConfig {
        maximum_privacy()
    }

    /// Governor Bravo Cloak default - transparent governance (votes still private)
    pub fn governor_bravo_cloak() -> PrivacyConfig {
        transparent()
    }
}

