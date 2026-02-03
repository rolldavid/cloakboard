/**
 * Workplace Organizing Cloak Service
 *
 * Service for interacting with Workplace Organizing Cloak contracts.
 * Designed for maximum privacy to protect workers.
 *
 * Key Privacy Features:
 * - Anonymous membership (no one knows who is a member)
 * - Secret ballot voting (results hidden until voting ends)
 * - Delayed result reveal
 * - No exact member counts
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { TokenGateConfig } from '@/types/tokenGate';

/**
 * Workplace Cloak configuration for creation
 */
export interface WorkplaceCloakConfig {
  name: string;
  description: string;

  // Governance
  votingDuration: number;
  quorumThreshold: number;
  resultDelay: number; // Blocks to wait before revealing results
  tokenGate?: TokenGateConfig;

  // Visibility
  isPubliclySearchable: boolean;
  isPubliclyViewable: boolean;
}

/**
 * Proposal categories
 */
export enum ProposalCategory {
  Compensation = 0,
  Hiring = 1,
  Policy = 2,
  Safety = 3,
  General = 4,
}

/**
 * Category permission levels
 */
export enum CategoryPermission {
  AllMembers = 0,
  ModeratorsPlus = 1,
  AdminOnly = 2,
}

/**
 * Workplace proposal information
 */
export interface WorkplaceProposal {
  id: number;
  creatorCommitment: string; // Anonymous author hash
  title: string;
  descriptionHash: string;
  category: ProposalCategory;
  startBlock: number;
  endBlock: number;
  executed: boolean;
  hideResultsUntilEnd: boolean;
}

/**
 * Vote tally (may be hidden until finalized)
 */
export interface VoteTally {
  yesVotes: bigint;
  noVotes: bigint;
  totalVotes: bigint;
  voterCount: number;
  isRevealed: boolean;
}

/**
 * User's membership state (stored locally, not on-chain)
 */
export interface MembershipState {
  isMember: boolean;
  joinSecret: Fr | null;
  membershipNullifier: string | null;
}

/**
 * Category name mapping
 */
function getCategoryName(category: ProposalCategory): string {
  switch (category) {
    case ProposalCategory.Compensation:
      return 'Compensation';
    case ProposalCategory.Hiring:
      return 'Hiring';
    case ProposalCategory.Policy:
      return 'Policy';
    case ProposalCategory.Safety:
      return 'Safety';
    default:
      return 'General';
  }
}

/**
 * Service for interacting with Workplace Cloak contracts
 */
export class WorkplaceCloakService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private cloakAddress: AztecAddress | null = null;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Connect to an existing Workplace Cloak
   */
  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    this.contract = await Contract.at(cloakAddress, artifact, this.wallet);

  }

  /**
   * Deploy a new Workplace Cloak
   */
  async deploy(
    config: WorkplaceCloakConfig,
    admin: AztecAddress,
    artifact: any,
    classId: Fr
  ): Promise<AztecAddress> {
    const deployTx = await Contract.deploy(this.wallet, artifact, [
      config.name,
      admin,
      config.votingDuration,
      config.quorumThreshold,
      config.resultDelay,
      // Token gating params
      config.tokenGate?.method === 'aztec-token' ? 2 : config.tokenGate?.method === 'erc20-token' ? 3 : config.tokenGate?.method === 'email-domain' ? 1 : 0,
      config.tokenGate?.aztecToken?.existingTokenAddress ?? '0x' + '0'.repeat(64),
      config.tokenGate?.aztecToken?.existingTokenAddress ?? '0x' + '0'.repeat(64),
      config.tokenGate?.erc20Token ? this.hashString(config.tokenGate.erc20Token.tokenAddress) : Fr.ZERO,
      config.tokenGate?.erc20Token ? BigInt(config.tokenGate.erc20Token.minMembershipBalance) : BigInt(0),
    ]).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.cloakAddress = deployed.address;
    this.contract = deployed;

    return this.cloakAddress;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.contract !== null;
  }

  // ===== MEMBERSHIP =====

  /**
   * Join the Cloak anonymously
   * Returns the join secret which must be stored locally
   */
  async joinAnonymously(): Promise<Fr> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    // Generate a random join secret
    const joinSecret = Fr.random();

    await this.contract.methods.join_anonymously(joinSecret).send({} as any).wait({ timeout: 120000 });

    return joinSecret;
  }

  /**
   * Leave the Cloak
   * Requires the join secret from when you joined
   */
  async leave(joinSecret: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.leave(joinSecret).send({} as any).wait({ timeout: 120000 });
  }

  // ===== PROPOSALS =====

  /**
   * Create an anonymous proposal
   * Requires join secret to prove membership
   */
  async createProposal(
    title: string,
    descriptionHash: Fr,
    category: ProposalCategory,
    joinSecret: Fr
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .create_proposal(title, descriptionHash, category, joinSecret)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Cast an anonymous vote
   * Requires join secret to prove membership
   */
  async castVote(proposalId: number, voteChoice: boolean, joinSecret: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .cast_vote(BigInt(proposalId), voteChoice, joinSecret)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Finalize voting and reveal results
   * Can be called by anyone after voting + delay period
   */
  async finalizeVoting(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.finalize_voting(BigInt(proposalId)).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Execute a passed proposal
   */
  async executeProposal(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .execute_proposal(BigInt(proposalId))
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== ADMIN FUNCTIONS =====

  /**
   * Transfer admin
   */
  async transferAdmin(newAdmin: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.transfer_admin(newAdmin).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Set category permission
   */
  async setCategoryPermission(
    category: ProposalCategory,
    permission: CategoryPermission
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .set_category_permission(category, permission)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Update governance settings
   */
  async updateGovernance(
    votingDuration: number,
    quorumThreshold: number,
    resultDelay: number
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .update_governance(votingDuration, quorumThreshold, resultDelay)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== VIEW FUNCTIONS =====

  /**
   * Get Cloak name
   */
  async getName(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_name().simulate({} as any);
    return result.toString();
  }

  /**
   * Get admin address
   */
  async getAdmin(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_admin().simulate({} as any);
    return result.toString();
  }

  /**
   * Get approximate member count (deliberately imprecise)
   */
  async getApproximateMemberCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_approximate_member_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Get proposal count
   */
  async getProposalCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_proposal_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Get proposal by ID
   */
  async getProposal(proposalId: number): Promise<WorkplaceProposal> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_proposal(BigInt(proposalId)).simulate({} as any);

    return {
      id: Number(result.id),
      creatorCommitment: result.creator_commitment.toString(),
      title: result.title.toString(),
      descriptionHash: result.description_hash.toString(),
      category: Number(result.category) as ProposalCategory,
      startBlock: Number(result.start_block),
      endBlock: Number(result.end_block),
      executed: Boolean(result.executed),
      hideResultsUntilEnd: Boolean(result.hide_results_until_end),
    };
  }

  /**
   * Get vote tally (may be hidden until finalized)
   */
  async getVoteTally(proposalId: number): Promise<VoteTally> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const [tally, finalized] = await Promise.all([
      this.contract.methods.get_vote_tally(BigInt(proposalId)).simulate({} as any),
      this.contract.methods.is_voting_finalized(BigInt(proposalId)).simulate({} as any),
    ]);

    return {
      yesVotes: BigInt(tally.yes_votes),
      noVotes: BigInt(tally.no_votes),
      totalVotes: BigInt(tally.total_votes),
      voterCount: Number(tally.voter_count),
      isRevealed: Boolean(finalized),
    };
  }

  /**
   * Check if voting is finalized for a proposal
   */
  async isVotingFinalized(proposalId: number): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.is_voting_finalized(BigInt(proposalId)).simulate({} as any);
  }

  /**
   * Get voting duration
   */
  async getVotingDuration(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_voting_duration().simulate({} as any);
    return Number(result);
  }

  /**
   * Get quorum threshold
   */
  async getQuorumThreshold(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_quorum_threshold().simulate({} as any);
    return Number(result);
  }

  /**
   * Get result delay (blocks after voting ends before results revealed)
   */
  async getResultDelay(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_result_delay().simulate({} as any);
    return Number(result);
  }

  /**
   * Get category permission
   */
  async getCategoryPermission(category: ProposalCategory): Promise<CategoryPermission> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_category_permission(category).simulate({} as any);
    return Number(result) as CategoryPermission;
  }

  // ===== TOKEN GATING =====

  /**
   * Join with Aztec token proof (mode 2)
   */
  async joinWithAztecToken(usernameHash: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .join_with_aztec_token(usernameHash)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Join with ERC20 proof (mode 3)
   */
  async joinWithERC20Proof(
    usernameHash: Fr,
    verifiedBalance: bigint,
    proofNullifier: Fr,
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .join_with_erc20_proof(usernameHash, verifiedBalance, proofNullifier)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Get membership mode
   */
  async getMembershipMode(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_membership_mode().simulate({} as any);
    return Number(result);
  }

  /**
   * Get token gate address
   */
  async getTokenGateAddress(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_token_gate_address().simulate({} as any);
    return result.toString();
  }

  /**
   * Get token address
   */
  async getTokenAddress(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_token_address().simulate({} as any);
    return result.toString();
  }

  /**
   * Get the Cloak address
   */
  getAddress(): string | null {
    return this.cloakAddress?.toString() ?? null;
  }

  // ===== HELPER FUNCTIONS =====

  /**
   * Get category name
   */
  static getCategoryName(category: ProposalCategory): string {
    return getCategoryName(category);
  }

  /**
   * Get all categories
   */
  /**
   * Hash a string for use in token gating
   */
  private hashString(str: string): Fr {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    let hash = BigInt(0);
    for (let i = 0; i < data.length; i++) {
      hash = (hash * BigInt(31) + BigInt(data[i])) % (BigInt(2) ** BigInt(254));
    }
    return new Fr(hash);
  }

  static getAllCategories(): Array<{ id: ProposalCategory; name: string }> {
    return [
      { id: ProposalCategory.Compensation, name: 'Compensation' },
      { id: ProposalCategory.Hiring, name: 'Hiring' },
      { id: ProposalCategory.Policy, name: 'Policy' },
      { id: ProposalCategory.Safety, name: 'Safety' },
      { id: ProposalCategory.General, name: 'General' },
    ];
  }
}
