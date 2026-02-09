/**
 * Organization Cloak Service
 *
 * Service for interacting with Organization Cloak contracts.
 * Handles domain-gated membership, proposals, and voting.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { PrivacySettings } from '@/types/privacy';
import type { TokenGateConfig } from '@/types/tokenGate';
import { PrivacyService } from '@/lib/core/PrivacyService';

/**
 * Organization Cloak configuration for creation
 */
export interface OrganizationCloakConfig {
  name: string;
  description: string;

  // Access control
  accessMethod: 'email-domain' | 'invite-only';
  emailDomain?: string;
  requireApproval: boolean;

  // Privacy
  privacyPreset: 'maximum' | 'balanced' | 'transparent';

  // Governance
  votingDuration: number; // in blocks
  quorumThreshold: number;
  allowStandardProposals: boolean;
  allowAnonymousProposals: boolean;
  tokenGate?: TokenGateConfig;

  // Visibility
  isPubliclyViewable: boolean;
}

/**
 * Member information
 */
export interface MemberInfo {
  address: string;
  votingPower: bigint;
  joinedAt: number;
  role: 'member' | 'moderator' | 'admin';
  usernameHash?: string;
}

/**
 * Pending member information
 */
export interface PendingMember {
  address: string;
  domainProofHash: string;
  usernameHash: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Proposal information
 */
export interface Proposal {
  id: number;
  creator: string;
  title: string;
  description: string;
  proposalType: number;
  targetAddress: string;
  value: bigint;
  startBlock: number;
  endBlock: number;
  executed: boolean;
  isAnonymous: boolean;
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
 * Map role number to string
 */
function mapRole(role: number): 'member' | 'moderator' | 'admin' {
  switch (role) {
    case 2:
      return 'admin';
    case 1:
      return 'moderator';
    default:
      return 'member';
  }
}

/**
 * Map status number to string
 */
function mapStatus(status: number): 'pending' | 'approved' | 'rejected' {
  switch (status) {
    case 1:
      return 'approved';
    case 2:
      return 'rejected';
    default:
      return 'pending';
  }
}

/**
 * Service for interacting with Organization Cloak contracts
 */
export class OrganizationCloakService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private cloakAddress: AztecAddress | null = null;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Connect to an existing Organization Cloak
   */
  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    this.contract = await Contract.at(cloakAddress, artifact, this.wallet);

  }

  /**
   * Deploy a new Organization Cloak
   */
  async deploy(
    config: OrganizationCloakConfig,
    admin: AztecAddress,
    artifact: any,
    classId: Fr
  ): Promise<AztecAddress> {
    // Hash the domain
    const domainHash = config.emailDomain
      ? this.hashString(config.emailDomain)
      : Fr.ZERO;

    // Map privacy preset to number
    const privacyPreset =
      config.privacyPreset === 'maximum' ? 0 : config.privacyPreset === 'transparent' ? 2 : 1;

    // Deploy the contract
    const deployTx = await Contract.deploy(this.wallet, artifact, [
      config.name,
      admin,
      domainHash,
      config.requireApproval,
      config.votingDuration,
      config.quorumThreshold,
      privacyPreset,
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
   * Join with domain proof
   * @param domainProofHash Hash of the ZK domain proof
   * @param domainNullifier Nullifier from the domain proof
   * @param usernameHash Hash of the chosen username
   */
  async joinWithDomainProof(
    domainProofHash: Fr,
    domainNullifier: Fr,
    usernameHash: Fr
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .join_with_domain_proof(domainProofHash, domainNullifier, usernameHash)
      .send({} as any)
      .wait({ timeout: 120000 });


  }

  /**
   * Approve a pending member (admin only)
   */
  async approveMember(memberAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.approve_member(memberAddress).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Reject a pending member (admin only)
   */
  async rejectMember(memberAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.reject_member(memberAddress).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Leave the organization
   */
  async leave(): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.leave().send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Remove a member (admin only)
   */
  async removeMember(memberAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.remove_member(memberAddress).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Update member role (admin only)
   */
  async updateMemberRole(
    memberAddress: AztecAddress,
    newRole: 'member' | 'moderator' | 'admin'
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const roleNum = newRole === 'admin' ? 2 : newRole === 'moderator' ? 1 : 0;
    await this.contract.methods
      .update_member_role(memberAddress, roleNum)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== PROPOSALS =====

  /**
   * Create a standard proposal (author visible)
   */
  async createProposal(
    title: string,
    description: string,
    proposalType: number = 0
  ): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods
      .create_proposal(title, description, proposalType)
      .send({} as any)
      .wait({ timeout: 120000 });

    // Extract proposal ID from result
    return Number((result as any).returnValues?.[0] ?? 0);
  }

  /**
   * Create an anonymous proposal (author hidden)
   */
  async createAnonymousProposal(
    title: string,
    description: string,
    proposalType: number = 0
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .create_proposal_anonymous(title, description, proposalType)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Cast a private vote
   */
  async castVote(proposalId: number, voteChoice: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .cast_vote(BigInt(proposalId), voteChoice)
      .send({} as any)
      .wait({ timeout: 120000 });
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
   * Transfer admin role
   */
  async transferAdmin(newAdmin: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.transfer_admin(newAdmin).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Set whether approval is required for new members
   */
  async setRequireApproval(requireApproval: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .set_require_approval(requireApproval)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Update governance settings
   */
  async updateGovernanceSettings(
    votingDuration: number,
    quorumThreshold: number,
    allowStandard: boolean,
    allowAnonymous: boolean
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .update_governance_settings(votingDuration, quorumThreshold, allowStandard, allowAnonymous)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Lock privacy configuration permanently
   */
  async lockPrivacy(): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.lock_privacy().send({} as any).wait({ timeout: 120000 });
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
   * Get allowed domain hash
   */
  async getDomainHash(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_domain_hash().simulate({} as any);
    return result.toString();
  }

  /**
   * Check if approval is required
   */
  async requiresApproval(): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.requires_approval().simulate({} as any);
  }

  /**
   * Get member count (respects privacy settings)
   */
  async getMemberCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_member_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Get pending member count
   */
  async getPendingCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_pending_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Check if address is a member
   */
  async isMember(address: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.is_member(address).simulate({} as any);
  }

  /**
   * Get member info
   */
  async getMemberInfo(address: AztecAddress): Promise<MemberInfo | null> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_member_info(address).simulate({} as any);

    if (Number(result.voting_power) === 0) {
      return null;
    }

    return {
      address: address.toString(),
      votingPower: BigInt(result.voting_power),
      joinedAt: Number(result.joined_at),
      role: mapRole(Number(result.role)),
    };
  }

  /**
   * Get pending member info
   */
  async getPendingMember(address: AztecAddress): Promise<PendingMember | null> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_pending_member(address).simulate({} as any);

    if (Number(result.requested_at) === 0) {
      return null;
    }

    return {
      address: address.toString(),
      domainProofHash: result.domain_proof_hash.toString(),
      usernameHash: result.username_hash.toString(),
      requestedAt: Number(result.requested_at),
      status: mapStatus(Number(result.status)),
    };
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
  async getProposal(proposalId: number): Promise<Proposal> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_proposal(BigInt(proposalId)).simulate({} as any);

    return {
      id: Number(result.id),
      creator: result.creator.toString(),
      title: result.title.toString(),
      description: result.description.toString(),
      proposalType: Number(result.proposal_type),
      targetAddress: result.target_address.toString(),
      value: BigInt(result.value),
      startBlock: Number(result.start_block),
      endBlock: Number(result.end_block),
      executed: Boolean(result.executed),
      isAnonymous: result.creator.toString() === '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
  }

  /**
   * Get vote tally (respects privacy settings)
   */
  async getVoteTally(proposalId: number): Promise<VoteTally> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_vote_tally(BigInt(proposalId)).simulate({} as any);

    return {
      yesVotes: BigInt(result.yes_votes),
      noVotes: BigInt(result.no_votes),
      totalVotes: BigInt(result.total_votes),
      voterCount: Number(result.voter_count),
    };
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
   * Check if privacy is locked
   */
  async isPrivacyLocked(): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.is_privacy_locked().simulate({} as any);
  }

  // ===== UTILITY =====

  /**
   * Hash a string for use as domain hash or username
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
   * Get the Cloak address
   */
  getAddress(): string | null {
    return this.cloakAddress?.toString() ?? null;
  }
}
