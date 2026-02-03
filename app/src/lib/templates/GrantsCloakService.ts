/**
 * Grants Cloak Service
 *
 * Service for interacting with Grants Committee Cloak contracts.
 * Manages grant programs, applications, and milestone-based funding.
 *
 * Key Features:
 * - Grant programs with budgets and deadlines
 * - Anonymous grant applications
 * - Peer review scoring system
 * - Milestone-based disbursement
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { TokenGateConfig } from '@/types/tokenGate';

/**
 * Grants Cloak configuration for creation
 */
export interface GrantsCloakConfig {
  name: string;
  description: string;

  // Governance
  votingDuration: number;
  quorumThreshold: number;
  minReviewers: number;
  tokenGate?: TokenGateConfig;
}

/**
 * Application status enum
 */
export enum ApplicationStatus {
  Submitted = 0,
  UnderReview = 1,
  Approved = 2,
  Rejected = 3,
  Funded = 4,
  Completed = 5,
  Cancelled = 6,
}

/**
 * Grant program information
 */
export interface GrantProgram {
  id: number;
  creator: string;
  title: string;
  descriptionHash: string;
  totalBudget: bigint;
  remainingBudget: bigint;
  maxGrantSize: bigint;
  deadline: number;
  applicationCount: number;
  isActive: boolean;
}

/**
 * Grant application information
 */
export interface GrantApplication {
  id: number;
  programId: number;
  applicantCommitment: string;
  titleHash: string;
  descriptionHash: string;
  requestedAmount: bigint;
  status: ApplicationStatus;
  submittedAt: number;
  reviewCount: number;
  totalScore: number;
  disbursedAmount: bigint;
}

/**
 * Review information
 */
export interface Review {
  reviewer: string;
  score: number;
  commentHash: string;
  submittedAt: number;
}

/**
 * Milestone information
 */
export interface Milestone {
  applicationId: number;
  index: number;
  descriptionHash: string;
  amount: bigint;
  completed: boolean;
  approvedBy: string;
}

/**
 * Vote tally
 */
export interface VoteTally {
  yesVotes: bigint;
  noVotes: bigint;
  totalVotes: bigint;
  voterCount: number;
}

/**
 * Get application status name
 */
function getApplicationStatusName(status: ApplicationStatus): string {
  switch (status) {
    case ApplicationStatus.Submitted:
      return 'Submitted';
    case ApplicationStatus.UnderReview:
      return 'Under Review';
    case ApplicationStatus.Approved:
      return 'Approved';
    case ApplicationStatus.Rejected:
      return 'Rejected';
    case ApplicationStatus.Funded:
      return 'Funded';
    case ApplicationStatus.Completed:
      return 'Completed';
    case ApplicationStatus.Cancelled:
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

/**
 * Service for interacting with Grants Cloak contracts
 */
export class GrantsCloakService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private cloakAddress: AztecAddress | null = null;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Connect to an existing Grants Cloak
   */
  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    this.contract = await Contract.at(cloakAddress, artifact, this.wallet);

  }

  /**
   * Deploy a new Grants Cloak
   */
  async deploy(
    config: GrantsCloakConfig,
    admin: AztecAddress,
    artifact: any,
    classId: Fr
  ): Promise<AztecAddress> {
    const deployTx = await Contract.deploy(this.wallet, artifact, [
      config.name,
      admin,
      config.votingDuration,
      config.quorumThreshold,
      config.minReviewers,
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

  // ===== GRANT PROGRAMS =====

  /**
   * Create a new grant program
   */
  async createProgram(
    title: string,
    descriptionHash: Fr,
    totalBudget: bigint,
    maxGrantSize: bigint,
    deadline: number
  ): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods
      .create_program(title, descriptionHash, totalBudget, maxGrantSize, deadline)
      .send({} as any)
      .wait({ timeout: 120000 });

    return Number((result as any).returnValues[0]);
  }

  /**
   * Close a grant program
   */
  async closeProgram(programId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.close_program(BigInt(programId)).send({} as any).wait({ timeout: 120000 });
  }

  // ===== APPLICATIONS =====

  /**
   * Submit an anonymous grant application
   * Returns the application secret which must be stored locally
   */
  async submitApplication(
    programId: number,
    titleHash: Fr,
    descriptionHash: Fr,
    requestedAmount: bigint
  ): Promise<Fr> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    // Generate a random application secret for anonymity
    const applicationSecret = Fr.random();

    await this.contract.methods
      .submit_application(BigInt(programId), titleHash, descriptionHash, requestedAmount, applicationSecret)
      .send({} as any)
      .wait({ timeout: 120000 });

    return applicationSecret;
  }

  /**
   * Cancel application (requires application secret)
   */
  async cancelApplication(applicationId: number, applicationSecret: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .cancel_application(BigInt(applicationId), applicationSecret)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== REVIEWS =====

  /**
   * Submit a review for an application (reviewers only)
   */
  async submitReview(applicationId: number, score: number, commentHash: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .submit_review(BigInt(applicationId), score, commentHash)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== VOTING =====

  /**
   * Vote on an application (private)
   */
  async voteApplication(applicationId: number, approve: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .vote_application(BigInt(applicationId), approve)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Finalize voting on an application
   */
  async finalizeVoting(applicationId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .finalize_voting(BigInt(applicationId))
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== MILESTONES =====

  /**
   * Add milestone to approved application
   */
  async addMilestone(applicationId: number, descriptionHash: Fr, amount: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .add_milestone(BigInt(applicationId), descriptionHash, amount)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Approve and disburse milestone
   */
  async approveMilestone(applicationId: number, milestoneIndex: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .approve_milestone(BigInt(applicationId), milestoneIndex)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== ADMIN =====

  /**
   * Add a reviewer
   */
  async addReviewer(reviewer: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.add_reviewer(reviewer).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Remove a reviewer
   */
  async removeReviewer(reviewer: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.remove_reviewer(reviewer).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Transfer admin
   */
  async transferAdmin(newAdmin: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.transfer_admin(newAdmin).send({} as any).wait({ timeout: 120000 });
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
   * Get program count
   */
  async getProgramCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_program_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Get program by ID
   */
  async getProgram(programId: number): Promise<GrantProgram> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_program(BigInt(programId)).simulate({} as any);

    return {
      id: Number(result.id),
      creator: result.creator.toString(),
      title: result.title.toString(),
      descriptionHash: result.description_hash.toString(),
      totalBudget: BigInt(result.total_budget),
      remainingBudget: BigInt(result.remaining_budget),
      maxGrantSize: BigInt(result.max_grant_size),
      deadline: Number(result.deadline),
      applicationCount: Number(result.application_count),
      isActive: Boolean(result.is_active),
    };
  }

  /**
   * Get application count
   */
  async getApplicationCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_application_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Get application by ID
   */
  async getApplication(applicationId: number): Promise<GrantApplication> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_application(BigInt(applicationId)).simulate({} as any);

    return {
      id: Number(result.id),
      programId: Number(result.program_id),
      applicantCommitment: result.applicant_commitment.toString(),
      titleHash: result.title_hash.toString(),
      descriptionHash: result.description_hash.toString(),
      requestedAmount: BigInt(result.requested_amount),
      status: Number(result.status) as ApplicationStatus,
      submittedAt: Number(result.submitted_at),
      reviewCount: Number(result.review_count),
      totalScore: Number(result.total_score),
      disbursedAmount: BigInt(result.disbursed_amount),
    };
  }

  /**
   * Get vote tally for an application
   */
  async getVoteTally(applicationId: number): Promise<VoteTally> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_vote_tally(BigInt(applicationId)).simulate({} as any);

    return {
      yesVotes: BigInt(result.yes_votes),
      noVotes: BigInt(result.no_votes),
      totalVotes: BigInt(result.total_votes),
      voterCount: Number(result.voter_count),
    };
  }

  /**
   * Check if address is a reviewer
   */
  async isReviewer(address: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.is_reviewer(address).simulate({} as any);
  }

  /**
   * Get all active programs
   */
  async getActivePrograms(): Promise<GrantProgram[]> {
    const count = await this.getProgramCount();
    const programs: GrantProgram[] = [];

    for (let i = 0; i < count; i++) {
      const program = await this.getProgram(i);
      if (program.isActive) {
        programs.push(program);
      }
    }

    return programs;
  }

  /**
   * Get applications for a program
   */
  async getApplicationsForProgram(programId: number): Promise<GrantApplication[]> {
    const count = await this.getApplicationCount();
    const applications: GrantApplication[] = [];

    for (let i = 0; i < count; i++) {
      const app = await this.getApplication(i);
      if (app.programId === programId) {
        applications.push(app);
      }
    }

    return applications;
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

  /**
   * Get application status name
   */
  static getApplicationStatusName(status: ApplicationStatus): string {
    return getApplicationStatusName(status);
  }

  /**
   * Calculate average review score
   */
  static calculateAverageScore(application: GrantApplication): number {
    if (application.reviewCount === 0) return 0;
    return application.totalScore / application.reviewCount;
  }
}
