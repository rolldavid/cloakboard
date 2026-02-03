/**
 * Privacy configuration types for Cloak
 *
 * Key principles:
 * 1. Privacy is a feature, not a default - users explicitly choose
 * 2. Privacy can only become MORE public, never less
 * 3. Vote choices are ALWAYS private (core principle)
 * 4. Voter identity is NEVER revealed (core principle)
 */

// ===== VISIBILITY LEVELS =====

/** General visibility level for most settings */
export type VisibilityLevel = 'hidden' | 'members-only' | 'public';

/** Numeric visibility for contract compatibility */
export type VisibilityNumeric = 0 | 1 | 2;

/** Count visibility options */
export type CountVisibility = 'hidden' | 'approximate' | 'exact';

/** Join event visibility options */
export type JoinVisibility = 'silent' | 'anonymous' | 'public';

/** Vote choice visibility options */
export type VoteChoiceVisibility = 'always-private' | 'revealed-after' | 'public';

/** Vote tally visibility options */
export type TallyVisibility = 'hidden-until-end' | 'live-anonymous' | 'live-public';

/** Voter identity visibility options */
export type VoterIdentityVisibility = 'never-shown' | 'after-vote' | 'always-shown';

/** Voting power display options */
export type VotingPowerVisibility = 'hidden' | 'tier-only' | 'exact';

/** Proposal author visibility options */
export type AuthorVisibility = 'anonymous-option' | 'revealed-after' | 'always-public';

/** Discussion attribution options */
export type DiscussionVisibility = 'anonymous' | 'username-only' | 'linked';

/** Transaction visibility options */
export type TransactionVisibility = 'hidden' | 'amounts-only' | 'full';

/** Recipient visibility options */
export type RecipientVisibility = 'hidden' | 'category-only' | 'full';

/** Activity feed visibility options */
export type ActivityVisibility = 'none' | 'aggregated' | 'detailed';

// ===== GROUPED SETTINGS =====

/** Membership privacy settings */
export interface MembershipPrivacy {
  /** Who can see the member list */
  memberList: VisibilityLevel;
  /** How member count is displayed */
  memberCount: CountVisibility;
  /** How join events are announced */
  joinAnnouncements: JoinVisibility;
}

/** Voting privacy settings */
export interface VotingPrivacy {
  /** When vote choices are revealed (typically always-private) */
  voteChoice: VoteChoiceVisibility;
  /** How vote tallies are shown during voting */
  liveTally: TallyVisibility;
  /** When voter identity is revealed (typically never-shown) */
  voterIdentity: VoterIdentityVisibility;
  /** How voting power is displayed */
  votingPower: VotingPowerVisibility;
}

/** Proposal privacy settings */
export interface ProposalPrivacy {
  /** When proposal author is revealed */
  authorVisibility: AuthorVisibility;
  /** Who can see proposal content */
  contentVisibility: VisibilityLevel;
  /** How discussions are attributed */
  discussions: DiscussionVisibility;
}

/** Treasury privacy settings */
export interface TreasuryPrivacy {
  /** How treasury balance is displayed */
  balance: CountVisibility;
  /** How transactions are displayed */
  transactions: TransactionVisibility;
  /** How recipients are displayed */
  recipients: RecipientVisibility;
}

/** Activity privacy settings */
export interface ActivityPrivacy {
  /** What activity is shown in feeds */
  feed: ActivityVisibility;
}

// ===== FULL PRIVACY SETTINGS =====

/** Complete privacy settings for a Cloak */
export interface PrivacySettings {
  membership: MembershipPrivacy;
  voting: VotingPrivacy;
  proposals: ProposalPrivacy;
  treasury: TreasuryPrivacy;
  activity: ActivityPrivacy;
}

// ===== CONTRACT FORMAT =====

/** Privacy config as stored in contract (all u8 values) */
export interface ContractPrivacyConfig {
  member_list_visibility: number;
  member_count_visibility: number;
  join_events_visibility: number;
  vote_choice_visibility: number;
  vote_tally_visibility: number;
  voter_identity_visibility: number;
  voting_power_visibility: number;
  proposal_author_visibility: number;
  proposal_content_visibility: number;
  discussion_visibility: number;
  balance_visibility: number;
  transaction_visibility: number;
  recipient_visibility: number;
  activity_feed_visibility: number;
}

// ===== PRESETS =====

/** Available privacy presets */
export type PrivacyPresetName =
  | 'maximum-privacy'
  | 'balanced'
  | 'transparent'
  | 'organization-cloak'
  | 'treasury-cloak'
  | 'workplace-cloak'
  | 'governor-bravo-cloak';

/** Privacy presets for common use cases */
export const PRIVACY_PRESETS: Record<PrivacyPresetName, PrivacySettings> = {
  'maximum-privacy': {
    membership: { memberList: 'hidden', memberCount: 'hidden', joinAnnouncements: 'silent' },
    voting: { voteChoice: 'always-private', liveTally: 'hidden-until-end', voterIdentity: 'never-shown', votingPower: 'hidden' },
    proposals: { authorVisibility: 'anonymous-option', contentVisibility: 'members-only', discussions: 'anonymous' },
    treasury: { balance: 'hidden', transactions: 'hidden', recipients: 'hidden' },
    activity: { feed: 'none' },
  },
  'balanced': {
    membership: { memberList: 'members-only', memberCount: 'exact', joinAnnouncements: 'anonymous' },
    voting: { voteChoice: 'always-private', liveTally: 'live-anonymous', voterIdentity: 'never-shown', votingPower: 'tier-only' },
    proposals: { authorVisibility: 'always-public', contentVisibility: 'public', discussions: 'username-only' },
    treasury: { balance: 'approximate', transactions: 'amounts-only', recipients: 'category-only' },
    activity: { feed: 'aggregated' },
  },
  'transparent': {
    membership: { memberList: 'public', memberCount: 'exact', joinAnnouncements: 'public' },
    voting: { voteChoice: 'always-private', liveTally: 'live-public', voterIdentity: 'never-shown', votingPower: 'exact' },
    proposals: { authorVisibility: 'always-public', contentVisibility: 'public', discussions: 'linked' },
    treasury: { balance: 'exact', transactions: 'full', recipients: 'full' },
    activity: { feed: 'detailed' },
  },
  'organization-cloak': {
    membership: { memberList: 'members-only', memberCount: 'exact', joinAnnouncements: 'anonymous' },
    voting: { voteChoice: 'always-private', liveTally: 'live-anonymous', voterIdentity: 'never-shown', votingPower: 'tier-only' },
    proposals: { authorVisibility: 'always-public', contentVisibility: 'public', discussions: 'username-only' },
    treasury: { balance: 'approximate', transactions: 'amounts-only', recipients: 'category-only' },
    activity: { feed: 'aggregated' },
  },
  'treasury-cloak': {
    membership: { memberList: 'members-only', memberCount: 'exact', joinAnnouncements: 'anonymous' },
    voting: { voteChoice: 'always-private', liveTally: 'live-public', voterIdentity: 'never-shown', votingPower: 'exact' },
    proposals: { authorVisibility: 'always-public', contentVisibility: 'public', discussions: 'username-only' },
    treasury: { balance: 'exact', transactions: 'full', recipients: 'full' },
    activity: { feed: 'detailed' },
  },
  'workplace-cloak': {
    membership: { memberList: 'hidden', memberCount: 'hidden', joinAnnouncements: 'silent' },
    voting: { voteChoice: 'always-private', liveTally: 'hidden-until-end', voterIdentity: 'never-shown', votingPower: 'hidden' },
    proposals: { authorVisibility: 'anonymous-option', contentVisibility: 'members-only', discussions: 'anonymous' },
    treasury: { balance: 'hidden', transactions: 'hidden', recipients: 'hidden' },
    activity: { feed: 'none' },
  },
  'governor-bravo-cloak': {
    membership: { memberList: 'public', memberCount: 'exact', joinAnnouncements: 'public' },
    voting: { voteChoice: 'always-private', liveTally: 'live-public', voterIdentity: 'never-shown', votingPower: 'exact' },
    proposals: { authorVisibility: 'always-public', contentVisibility: 'public', discussions: 'linked' },
    treasury: { balance: 'exact', transactions: 'full', recipients: 'full' },
    activity: { feed: 'detailed' },
  },
};

// ===== TEMPLATE DEFAULTS =====

/** Default privacy preset for each Cloak template */
export const TEMPLATE_DEFAULT_PRIVACY: Record<string, PrivacyPresetName> = {
  'organization': 'organization-cloak',
  'treasury': 'treasury-cloak',
  'workplace': 'workplace-cloak',
  'investment-club': 'balanced',
  'grants': 'balanced',
  'governor-bravo': 'governor-bravo-cloak',
  'collector': 'balanced',
  'service-guild': 'balanced',
  'social-club': 'balanced',
  'research': 'balanced',
};

// ===== LABELS FOR UI =====

/** Human-readable labels for visibility levels */
export const VISIBILITY_LABELS: Record<VisibilityLevel, string> = {
  'hidden': 'Private',
  'members-only': 'Members Only',
  'public': 'Public',
};

/** Descriptions for privacy presets */
export const PRESET_DESCRIPTIONS: Record<PrivacyPresetName, string> = {
  'maximum-privacy': 'Everything hidden. Best for sensitive operations where anonymity is critical.',
  'balanced': 'Reasonable defaults. Vote choices always private, but member info visible to each other.',
  'transparent': 'Maximum visibility for public accountability. Vote choices still private.',
  'organization-cloak': 'Balanced privacy for company/team governance with domain verification.',
  'treasury-cloak': 'Transparent financial operations with private voting.',
  'workplace-cloak': 'Maximum privacy to protect workers during organizing.',
  'governor-bravo-cloak': 'Transparent governance compatible with Governor Bravo standard.',
};
