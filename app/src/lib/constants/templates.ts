/**
 * Template Metadata Constants
 *
 * Comprehensive metadata for all Cloak templates.
 * Used for template selection UI, wizards, and dashboard display.
 *
 * Templates:
 * 1.  Bravo — Protocol governance (Governor Bravo)
 * 2.  Strike — Organizing (coming soon)
 * 3.  Gossip — Private social communication (coming soon)
 * 4.  Ape — Treasury management (coming soon)
 * 5.  Give — Grants funding (coming soon)
 * 6.  Coop — Workplace governance (coming soon)
 * 7.  Glass — Anonymous workplace feedback (coming soon)
 * 8.  Swarm — Collective social account posting (coming soon)
 * 9.  Ballot — Private voting on proposals (coming soon)
 * 10. Molt — Private bot discussion (coming soon)
 */

import type { TemplateId } from '@/lib/templates/TemplateFactory';

/**
 * Template category for filtering
 */
export type TemplateCategory =
  | 'governance'
  | 'finance'
  | 'community'
  | 'social';

/**
 * Privacy level for quick display
 */
export type PrivacyLevel = 'maximum' | 'balanced' | 'transparent';

/**
 * Template status
 */
export type TemplateStatus = 'active' | 'coming_soon';

/**
 * Template metadata structure
 */
export interface TemplateMetadata {
  id: number;
  name: string;
  shortName: string;
  description: string;
  longDescription: string;
  icon: string;
  features: string[];
  defaultPrivacy: PrivacyLevel;
  category: TemplateCategory;
  useCases: string[];
  color: string;
  supportsTokenGating: boolean;
  status: TemplateStatus;
}

/**
 * Complete metadata for all templates
 */
export const TEMPLATE_METADATA: Record<number, TemplateMetadata> = {
  1: {
    id: 1,
    name: 'Bravo',
    shortName: 'Bravo',
    description: 'Full Governor Bravo implementation with private voting, delegation, and timelock',
    longDescription:
      'Complete Governor Bravo implementation on Aztec. Features private voting where voter identity is never stored, fractional voting for delegates, dynamic quorum as a fraction of total supply, late quorum protection, proposal guardian, and self-governing parameter updates through proposals.',
    icon: 'bravo',
    features: [
      'Private voting (nullifier-based)',
      'Token delegation (hidden graph)',
      'Fractional voting',
      'Dynamic quorum fraction',
      'Timelock execution',
      'Late quorum protection',
      'Proposal guardian',
      'Multi-target proposals',
    ],
    defaultPrivacy: 'balanced',
    category: 'governance',
    useCases: ['Protocol governance', 'Token voting', 'Protocol upgrades', 'Parameter changes'],
    color: 'slate',
    supportsTokenGating: true,
    status: 'active',
  },
  2: {
    id: 2,
    name: 'Strike',
    shortName: 'Strike',
    description: 'Organization governance with domain-gated membership',
    longDescription:
      'Perfect for companies and teams that want to verify membership through email domains. Supports domain verification, admin approval workflows, and flexible privacy settings.',
    icon: 'organization',
    features: [
      'Email domain verification',
      'Admin approval workflow',
      'Role-based access',
      'Anonymous proposals option',
    ],
    defaultPrivacy: 'balanced',
    category: 'governance',
    useCases: ['Corporate governance', 'Team decisions', 'Department voting', 'Board resolutions'],
    color: 'indigo',
    supportsTokenGating: true,
    status: 'coming_soon',
  },
  3: {
    id: 3,
    name: 'Gossip',
    shortName: 'Gossip',
    description: 'Private social communication channel',
    longDescription:
      'Anonymous, privacy-first social communication for communities. Share information, coordinate, and discuss without revealing identity.',
    icon: 'social',
    features: [
      'Anonymous posting',
      'Private messaging',
      'Encrypted channels',
      'No identity tracking',
    ],
    defaultPrivacy: 'maximum',
    category: 'community',
    useCases: ['Anonymous discussion', 'Whistleblowing', 'Private coordination', 'Community chat'],
    color: 'violet',
    supportsTokenGating: false,
    status: 'coming_soon',
  },
  4: {
    id: 4,
    name: 'Ape',
    shortName: 'Ape',
    description: 'Collective fund management with transparent finances',
    longDescription:
      'Multi-signature treasury management with category-based budgeting. Track spending, manage budgets, and approve transactions with full audit trails.',
    icon: 'treasury',
    features: [
      'Multi-sig transactions',
      'Category budgets',
      'Spending proposals',
      'Transaction history',
    ],
    defaultPrivacy: 'balanced',
    category: 'finance',
    useCases: ['Community treasuries', 'Project funds', 'Budget management', 'Grant distribution'],
    color: 'emerald',
    supportsTokenGating: true,
    status: 'coming_soon',
  },
  5: {
    id: 5,
    name: 'Give',
    shortName: 'Give',
    description: 'Community funding with application and milestone tracking',
    longDescription:
      'Run a grants program with structured applications, multi-stage review, and milestone-based funding disbursement.',
    icon: 'grants',
    features: [
      'Application forms',
      'Review workflow',
      'Milestone tracking',
      'Funding rounds',
    ],
    defaultPrivacy: 'balanced',
    category: 'finance',
    useCases: ['Open source grants', 'Community funds', 'Ecosystem programs', 'Research funding'],
    color: 'purple',
    supportsTokenGating: true,
    status: 'coming_soon',
  },
  6: {
    id: 6,
    name: 'Coop',
    shortName: 'Coop',
    description: 'Maximum privacy for workplace organizing',
    longDescription:
      'Designed for workplace organizing where member privacy is paramount. All membership and voting data is encrypted and hidden by default.',
    icon: 'workplace',
    features: [
      'Hidden member list',
      'Anonymous voting',
      'Private proposals',
      'No activity tracking',
    ],
    defaultPrivacy: 'maximum',
    category: 'community',
    useCases: ['Union organizing', 'Employee advocacy', 'Workplace initiatives', 'Confidential polling'],
    color: 'rose',
    supportsTokenGating: true,
    status: 'coming_soon',
  },
  7: {
    id: 7,
    name: 'Glass',
    shortName: 'Glass',
    description: 'Anonymous workplace feedback and reviews',
    longDescription:
      'Submit and read anonymous workplace feedback, like Glassdoor but fully private. No employer can trace reviews back to individuals. Powered by zero-knowledge proofs to verify employment without revealing identity.',
    icon: 'glass',
    features: [
      'Anonymous reviews',
      'Verified employment',
      'Untraceable feedback',
      'ZK employer proof',
    ],
    defaultPrivacy: 'maximum',
    category: 'community',
    useCases: ['Workplace reviews', 'Anonymous feedback', 'Company culture', 'Salary transparency'],
    color: 'cyan',
    supportsTokenGating: false,
    status: 'coming_soon',
  },
  8: {
    id: 8,
    name: 'Swarm',
    shortName: 'Swarm',
    description: 'Collective social account posting from a shared group',
    longDescription:
      'A group collectively owns and posts to one or more social accounts. Members propose and approve posts privately before they go live. No individual poster is ever revealed — the group speaks as one.',
    icon: 'swarm',
    features: [
      'Shared social accounts',
      'Group post approval',
      'Anonymous authorship',
      'Multi-platform support',
    ],
    defaultPrivacy: 'maximum',
    category: 'social',
    useCases: ['Collective voice', 'Anonymous publishing', 'Group social media', 'Shared accounts'],
    color: 'amber',
    supportsTokenGating: false,
    status: 'coming_soon',
  },
  9: {
    id: 9,
    name: 'Ballot',
    shortName: 'Ballot',
    description: 'Private voting on proposals and ballot measures',
    longDescription:
      'Run private elections and ballot measures with cryptographically guaranteed vote privacy. Voters prove eligibility without revealing identity, and results are tallied without exposing individual choices.',
    icon: 'ballot',
    features: [
      'Private ballot voting',
      'Eligibility proofs',
      'Verifiable tallies',
      'Multiple choice support',
    ],
    defaultPrivacy: 'maximum',
    category: 'governance',
    useCases: ['Private elections', 'Ballot measures', 'Board votes', 'Community polls'],
    color: 'blue',
    supportsTokenGating: true,
    status: 'coming_soon',
  },
  10: {
    id: 10,
    name: 'Molt',
    shortName: 'Molt',
    description: 'Private discussion and coordination for autonomous agents',
    longDescription:
      'Allows OpenMolt bots and autonomous agents to privately discuss and organize without displaying their conversation. Agent-to-agent coordination happens in encrypted channels invisible to outside observers.',
    icon: 'molt',
    features: [
      'Encrypted agent chat',
      'Private coordination',
      'Hidden conversations',
      'Bot-to-bot channels',
    ],
    defaultPrivacy: 'maximum',
    category: 'social',
    useCases: ['Bot coordination', 'Agent swarms', 'Private AI discussion', 'Autonomous organizing'],
    color: 'pink',
    supportsTokenGating: false,
    status: 'active',
  },
  11: {
    id: 11,
    name: 'Multi',
    shortName: 'Multi',
    description: 'Simple private multisig accounts with M-of-N approval',
    longDescription:
      'Create lightweight multisig wallets on Aztec. Signers and transactions stay private. Approve spending, contract calls, or parameter changes with configurable M-of-N thresholds — no governance token required.',
    icon: 'multi',
    features: [
      'M-of-N approval',
      'Private signers',
      'Hidden transactions',
      'No token required',
    ],
    defaultPrivacy: 'maximum',
    category: 'governance',
    useCases: ['Team wallets', 'Treasury management', 'Shared accounts', 'Operational multisig'],
    color: 'orange',
    supportsTokenGating: false,
    status: 'coming_soon',
  },
  12: {
    id: 12,
    name: 'Tally',
    shortName: 'Tally',
    description: 'Simple private voting on questions and proposals',
    longDescription:
      'Run quick, private votes without setting up full governance. Create a question, set options, and let members vote anonymously. Results are tallied without revealing individual choices.',
    icon: 'tally',
    features: [
      'Anonymous voting',
      'Multiple choice',
      'Instant results',
      'No token required',
    ],
    defaultPrivacy: 'maximum',
    category: 'governance',
    useCases: ['Quick polls', 'Team decisions', 'Community votes', 'Straw polls'],
    color: 'teal',
    supportsTokenGating: false,
    status: 'coming_soon',
  },
};

/**
 * Display order for templates in the UI.
 * Numeric object keys in JS are always iterated in ascending order,
 * so we use an explicit array to control presentation order.
 */
export const TEMPLATE_DISPLAY_ORDER: number[] = [1, 10, 11, 12, 8, 2, 5, 4, 6, 9, 7, 3];

/**
 * Get all templates in display order
 */
export function getTemplatesInOrder(): TemplateMetadata[] {
  return TEMPLATE_DISPLAY_ORDER.map((id) => TEMPLATE_METADATA[id]).filter(Boolean);
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: TemplateCategory): TemplateMetadata[] {
  return getTemplatesInOrder().filter((t) => t.category === category);
}

/**
 * Get templates by privacy level
 */
export function getTemplatesByPrivacy(privacy: PrivacyLevel): TemplateMetadata[] {
  return getTemplatesInOrder().filter((t) => t.defaultPrivacy === privacy);
}

/**
 * Get all template IDs
 */
export function getAllTemplateIds(): number[] {
  return Object.keys(TEMPLATE_METADATA).map(Number);
}

/**
 * Get template metadata by ID
 */
export function getTemplateMetadata(id: number): TemplateMetadata {
  return TEMPLATE_METADATA[id];
}

/**
 * Get the URL slug for a template (lowercase name)
 */
export function getTemplateSlug(id: number): string {
  return TEMPLATE_METADATA[id]?.shortName?.toLowerCase() ?? String(id);
}

/**
 * Resolve a slug (e.g. "bravo") or numeric string (e.g. "1") to a template ID.
 * Returns undefined if not found.
 */
export function resolveTemplateId(slugOrId: string): number | undefined {
  // Try numeric first (backward compat)
  const asNum = Number(slugOrId);
  if (!isNaN(asNum) && TEMPLATE_METADATA[asNum]) return asNum;

  // Slug lookup
  const lower = slugOrId.toLowerCase();
  for (const [id, meta] of Object.entries(TEMPLATE_METADATA)) {
    if (meta.shortName.toLowerCase() === lower) return Number(id);
  }
  return undefined;
}

/**
 * Category display information
 */
export const CATEGORY_INFO: Record<TemplateCategory, { label: string; description: string }> = {
  governance: {
    label: 'Governance',
    description: 'Decision-making and organizational management',
  },
  finance: {
    label: 'Finance',
    description: 'Treasury and investment management',
  },
  community: {
    label: 'Community',
    description: 'Community organization and social groups',
  },
  social: {
    label: 'Social',
    description: 'Collective communication and publishing',
  },
};

/**
 * Privacy level display information
 */
export const PRIVACY_LEVEL_INFO: Record<PrivacyLevel, { label: string; description: string; color: string }> = {
  maximum: {
    label: 'Maximum Privacy',
    description: 'All data hidden by default',
    color: 'rose',
  },
  balanced: {
    label: 'Balanced',
    description: 'Members visible, votes private',
    color: 'indigo',
  },
  transparent: {
    label: 'Transparent',
    description: 'Public operations, private votes',
    color: 'emerald',
  },
};
