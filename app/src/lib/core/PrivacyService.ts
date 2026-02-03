/**
 * Privacy Service
 *
 * Handles conversion between frontend privacy settings and contract format,
 * and provides utilities for privacy-aware UI rendering.
 */

import type {
  PrivacySettings,
  ContractPrivacyConfig,
  VisibilityLevel,
  CountVisibility,
  JoinVisibility,
  VoteChoiceVisibility,
  TallyVisibility,
  VoterIdentityVisibility,
  VotingPowerVisibility,
  AuthorVisibility,
  DiscussionVisibility,
  TransactionVisibility,
  RecipientVisibility,
  ActivityVisibility,
  PrivacyPresetName,
} from '@/types/privacy';

import { PRIVACY_PRESETS } from '@/types/privacy';

/**
 * Service for managing privacy settings
 */
export class PrivacyService {
  /**
   * Convert frontend privacy settings to contract format
   */
  toContractConfig(settings: PrivacySettings): ContractPrivacyConfig {
    return {
      member_list_visibility: this.mapVisibility(settings.membership.memberList),
      member_count_visibility: this.mapCountVisibility(settings.membership.memberCount),
      join_events_visibility: this.mapJoinVisibility(settings.membership.joinAnnouncements),
      vote_choice_visibility: this.mapVoteChoiceVisibility(settings.voting.voteChoice),
      vote_tally_visibility: this.mapTallyVisibility(settings.voting.liveTally),
      voter_identity_visibility: this.mapVoterIdentityVisibility(settings.voting.voterIdentity),
      voting_power_visibility: this.mapVotingPowerVisibility(settings.voting.votingPower),
      proposal_author_visibility: this.mapAuthorVisibility(settings.proposals.authorVisibility),
      proposal_content_visibility: this.mapVisibility(settings.proposals.contentVisibility),
      discussion_visibility: this.mapDiscussionVisibility(settings.proposals.discussions),
      balance_visibility: this.mapCountVisibility(settings.treasury.balance),
      transaction_visibility: this.mapTransactionVisibility(settings.treasury.transactions),
      recipient_visibility: this.mapRecipientVisibility(settings.treasury.recipients),
      activity_feed_visibility: this.mapActivityVisibility(settings.activity.feed),
    };
  }

  /**
   * Convert contract privacy config to frontend settings
   */
  fromContractConfig(config: ContractPrivacyConfig): PrivacySettings {
    return {
      membership: {
        memberList: this.unmapVisibility(config.member_list_visibility),
        memberCount: this.unmapCountVisibility(config.member_count_visibility),
        joinAnnouncements: this.unmapJoinVisibility(config.join_events_visibility),
      },
      voting: {
        voteChoice: this.unmapVoteChoiceVisibility(config.vote_choice_visibility),
        liveTally: this.unmapTallyVisibility(config.vote_tally_visibility),
        voterIdentity: this.unmapVoterIdentityVisibility(config.voter_identity_visibility),
        votingPower: this.unmapVotingPowerVisibility(config.voting_power_visibility),
      },
      proposals: {
        authorVisibility: this.unmapAuthorVisibility(config.proposal_author_visibility),
        contentVisibility: this.unmapVisibility(config.proposal_content_visibility),
        discussions: this.unmapDiscussionVisibility(config.discussion_visibility),
      },
      treasury: {
        balance: this.unmapCountVisibility(config.balance_visibility),
        transactions: this.unmapTransactionVisibility(config.transaction_visibility),
        recipients: this.unmapRecipientVisibility(config.recipient_visibility),
      },
      activity: {
        feed: this.unmapActivityVisibility(config.activity_feed_visibility),
      },
    };
  }

  /**
   * Get a privacy preset by name
   */
  getPreset(name: PrivacyPresetName): PrivacySettings {
    return PRIVACY_PRESETS[name];
  }

  /**
   * Validate that new settings only increase visibility (never decrease)
   * Returns true if the change is valid
   */
  validatePrivacyIncrease(current: PrivacySettings, proposed: PrivacySettings): boolean {
    const currentContract = this.toContractConfig(current);
    const proposedContract = this.toContractConfig(proposed);

    return (
      proposedContract.member_list_visibility >= currentContract.member_list_visibility &&
      proposedContract.member_count_visibility >= currentContract.member_count_visibility &&
      proposedContract.join_events_visibility >= currentContract.join_events_visibility &&
      proposedContract.vote_choice_visibility >= currentContract.vote_choice_visibility &&
      proposedContract.vote_tally_visibility >= currentContract.vote_tally_visibility &&
      proposedContract.voter_identity_visibility >= currentContract.voter_identity_visibility &&
      proposedContract.voting_power_visibility >= currentContract.voting_power_visibility &&
      proposedContract.proposal_author_visibility >= currentContract.proposal_author_visibility &&
      proposedContract.proposal_content_visibility >= currentContract.proposal_content_visibility &&
      proposedContract.discussion_visibility >= currentContract.discussion_visibility &&
      proposedContract.balance_visibility >= currentContract.balance_visibility &&
      proposedContract.transaction_visibility >= currentContract.transaction_visibility &&
      proposedContract.recipient_visibility >= currentContract.recipient_visibility &&
      proposedContract.activity_feed_visibility >= currentContract.activity_feed_visibility
    );
  }

  /**
   * Get fields that would be reduced (invalid changes)
   */
  getInvalidChanges(current: PrivacySettings, proposed: PrivacySettings): string[] {
    const currentContract = this.toContractConfig(current);
    const proposedContract = this.toContractConfig(proposed);
    const invalid: string[] = [];

    if (proposedContract.member_list_visibility < currentContract.member_list_visibility)
      invalid.push('Member list visibility');
    if (proposedContract.member_count_visibility < currentContract.member_count_visibility)
      invalid.push('Member count visibility');
    if (proposedContract.join_events_visibility < currentContract.join_events_visibility)
      invalid.push('Join events visibility');
    if (proposedContract.vote_choice_visibility < currentContract.vote_choice_visibility)
      invalid.push('Vote choice visibility');
    if (proposedContract.vote_tally_visibility < currentContract.vote_tally_visibility)
      invalid.push('Vote tally visibility');
    if (proposedContract.voter_identity_visibility < currentContract.voter_identity_visibility)
      invalid.push('Voter identity visibility');
    if (proposedContract.voting_power_visibility < currentContract.voting_power_visibility)
      invalid.push('Voting power visibility');
    if (proposedContract.proposal_author_visibility < currentContract.proposal_author_visibility)
      invalid.push('Proposal author visibility');
    if (proposedContract.proposal_content_visibility < currentContract.proposal_content_visibility)
      invalid.push('Proposal content visibility');
    if (proposedContract.discussion_visibility < currentContract.discussion_visibility)
      invalid.push('Discussion visibility');
    if (proposedContract.balance_visibility < currentContract.balance_visibility)
      invalid.push('Balance visibility');
    if (proposedContract.transaction_visibility < currentContract.transaction_visibility)
      invalid.push('Transaction visibility');
    if (proposedContract.recipient_visibility < currentContract.recipient_visibility)
      invalid.push('Recipient visibility');
    if (proposedContract.activity_feed_visibility < currentContract.activity_feed_visibility)
      invalid.push('Activity feed visibility');

    return invalid;
  }

  /**
   * Check if user can see content based on visibility and their membership
   */
  canView(visibility: VisibilityLevel, isMember: boolean): boolean {
    if (visibility === 'public') return true;
    if (visibility === 'members-only') return isMember;
    return false; // hidden
  }

  /**
   * Format a count based on visibility settings
   */
  formatCount(count: number, visibility: CountVisibility): string | null {
    switch (visibility) {
      case 'hidden':
        return null;
      case 'approximate':
        // Round to nearest 10
        const approx = Math.round(count / 10) * 10;
        return approx === 0 ? '< 10' : `~${approx}`;
      case 'exact':
        return count.toString();
    }
  }

  // ===== MAPPING HELPERS =====

  private mapVisibility(v: VisibilityLevel): number {
    return v === 'hidden' ? 0 : v === 'members-only' ? 1 : 2;
  }

  private unmapVisibility(n: number): VisibilityLevel {
    return n === 0 ? 'hidden' : n === 1 ? 'members-only' : 'public';
  }

  private mapCountVisibility(v: CountVisibility): number {
    return v === 'hidden' ? 0 : v === 'approximate' ? 1 : 2;
  }

  private unmapCountVisibility(n: number): CountVisibility {
    return n === 0 ? 'hidden' : n === 1 ? 'approximate' : 'exact';
  }

  private mapJoinVisibility(v: JoinVisibility): number {
    return v === 'silent' ? 0 : v === 'anonymous' ? 1 : 2;
  }

  private unmapJoinVisibility(n: number): JoinVisibility {
    return n === 0 ? 'silent' : n === 1 ? 'anonymous' : 'public';
  }

  private mapVoteChoiceVisibility(v: VoteChoiceVisibility): number {
    return v === 'always-private' ? 0 : v === 'revealed-after' ? 1 : 2;
  }

  private unmapVoteChoiceVisibility(n: number): VoteChoiceVisibility {
    return n === 0 ? 'always-private' : n === 1 ? 'revealed-after' : 'public';
  }

  private mapTallyVisibility(v: TallyVisibility): number {
    return v === 'hidden-until-end' ? 0 : v === 'live-anonymous' ? 1 : 2;
  }

  private unmapTallyVisibility(n: number): TallyVisibility {
    return n === 0 ? 'hidden-until-end' : n === 1 ? 'live-anonymous' : 'live-public';
  }

  private mapVoterIdentityVisibility(v: VoterIdentityVisibility): number {
    return v === 'never-shown' ? 0 : v === 'after-vote' ? 1 : 2;
  }

  private unmapVoterIdentityVisibility(n: number): VoterIdentityVisibility {
    return n === 0 ? 'never-shown' : n === 1 ? 'after-vote' : 'always-shown';
  }

  private mapVotingPowerVisibility(v: VotingPowerVisibility): number {
    return v === 'hidden' ? 0 : v === 'tier-only' ? 1 : 2;
  }

  private unmapVotingPowerVisibility(n: number): VotingPowerVisibility {
    return n === 0 ? 'hidden' : n === 1 ? 'tier-only' : 'exact';
  }

  private mapAuthorVisibility(v: AuthorVisibility): number {
    return v === 'anonymous-option' ? 0 : v === 'revealed-after' ? 1 : 2;
  }

  private unmapAuthorVisibility(n: number): AuthorVisibility {
    return n === 0 ? 'anonymous-option' : n === 1 ? 'revealed-after' : 'always-public';
  }

  private mapDiscussionVisibility(v: DiscussionVisibility): number {
    return v === 'anonymous' ? 0 : v === 'username-only' ? 1 : 2;
  }

  private unmapDiscussionVisibility(n: number): DiscussionVisibility {
    return n === 0 ? 'anonymous' : n === 1 ? 'username-only' : 'linked';
  }

  private mapTransactionVisibility(v: TransactionVisibility): number {
    return v === 'hidden' ? 0 : v === 'amounts-only' ? 1 : 2;
  }

  private unmapTransactionVisibility(n: number): TransactionVisibility {
    return n === 0 ? 'hidden' : n === 1 ? 'amounts-only' : 'full';
  }

  private mapRecipientVisibility(v: RecipientVisibility): number {
    return v === 'hidden' ? 0 : v === 'category-only' ? 1 : 2;
  }

  private unmapRecipientVisibility(n: number): RecipientVisibility {
    return n === 0 ? 'hidden' : n === 1 ? 'category-only' : 'full';
  }

  private mapActivityVisibility(v: ActivityVisibility): number {
    return v === 'none' ? 0 : v === 'aggregated' ? 1 : 2;
  }

  private unmapActivityVisibility(n: number): ActivityVisibility {
    return n === 0 ? 'none' : n === 1 ? 'aggregated' : 'detailed';
  }
}

// Export singleton instance
export const privacyService = new PrivacyService();
