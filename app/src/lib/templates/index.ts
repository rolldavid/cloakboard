/**
 * Cloak Template Services
 *
 * Templates:
 * 1. Protocol Governance (Governor Bravo)
 * 2. Organizing
 * 3. Gossip (placeholder)
 * 4. Treasury
 * 5. Grants Funding
 * 6. Workplace Governance
 */

// Template Factory
export {
  createServiceForTemplate,
  connectToCloak,
  isValidTemplateId,
  getTemplateName,
  getTemplateDescription,
  getDefaultPrivacy,
  getAllTemplateIds,
  getTemplatesByPrivacy,
  TEMPLATE_SERVICES,
  type TemplateId,
  type ServiceForTemplate,
  type AnyCloakService,
} from './TemplateFactory';

export { GovernorBravoCloakService, ProposalState, VoteSupport } from './GovernorBravoCloakService';
export type {
  GovernorBravoCloakConfig,
  BravoProposal,
  DelegationInfo,
  GovernanceParams,
  FractionalVoteParams,
  ProposalDetails,
} from './GovernorBravoCloakService';

export { OrganizationCloakService } from './OrganizationCloakService';
export type {
  OrganizationCloakConfig,
  MemberInfo,
  PendingMember,
  Proposal,
  VoteTally,
} from './OrganizationCloakService';

export { TreasuryCloakService, SpendingCategory } from './TreasuryCloakService';
export type {
  TreasuryCloakConfig,
  SpendingProposal,
  CategoryBudget,
  TreasuryOverview,
} from './TreasuryCloakService';

export { GrantsCloakService, ApplicationStatus } from './GrantsCloakService';
export type {
  GrantsCloakConfig,
  GrantProgram,
  GrantApplication,
  Review as GrantReview,
  Milestone as GrantMilestone,
} from './GrantsCloakService';

export { WorkplaceCloakService, ProposalCategory, CategoryPermission } from './WorkplaceCloakService';
export type {
  WorkplaceCloakConfig,
  WorkplaceProposal,
  MembershipState,
} from './WorkplaceCloakService';

/**
 * Template IDs and metadata
 */
export const CLOAK_TEMPLATES = {
  1: {
    id: 1,
    name: 'Protocol Governance',
    description: 'Full Governor Bravo implementation with private voting, delegation, and timelock',
    defaultPrivacy: 'balanced',
    features: ['private-voting', 'delegation', 'timelock', 'fractional-voting', 'quorum-fraction', 'late-quorum-protection', 'proposal-guardian', 'multi-target-proposals'],
    supportsTokenGating: true,
  },
  2: {
    id: 2,
    name: 'Organizing',
    description: 'Organization governance with domain-gated membership',
    defaultPrivacy: 'balanced',
    features: ['domain-gating', 'approval-workflow', 'anonymous-proposals'],
    supportsTokenGating: true,
  },
  3: {
    id: 3,
    name: 'Gossip',
    description: 'Private social communication channel (placeholder)',
    defaultPrivacy: 'maximum',
    features: ['private-messaging', 'anonymous-posts'],
    supportsTokenGating: false,
  },
  4: {
    id: 4,
    name: 'Treasury',
    description: 'Collective fund management with transparent finances',
    defaultPrivacy: 'balanced',
    features: ['multi-sig', 'spending-limits', 'budget-proposals'],
    supportsTokenGating: true,
  },
  5: {
    id: 5,
    name: 'Grants Funding',
    description: 'Community funding with application and milestone tracking',
    defaultPrivacy: 'balanced',
    features: ['applications', 'review-process', 'milestone-tracking'],
    supportsTokenGating: true,
  },
  6: {
    id: 6,
    name: 'Workplace Governance',
    description: 'Maximum privacy for workplace organizing',
    defaultPrivacy: 'maximum',
    features: ['anonymous-join', 'private-discussions', 'protected-voting'],
    supportsTokenGating: true,
  },
} as const;

export type LocalTemplateId = keyof typeof CLOAK_TEMPLATES;
export type TemplateInfo = (typeof CLOAK_TEMPLATES)[LocalTemplateId];
