/**
 * Molt Cloak Service — Private Agent DAO
 *
 * Service for interacting with the Molt Cloak contract on Aztec.
 * Handles agent registration, verification, posts, comments,
 * submolts, voting, and governance.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

/**
 * Molt Cloak configuration for creation
 */
export interface MoltCloakConfig {
  name: string;
  description: string;
  privacyPreset: 'maximum' | 'balanced';
  publicHoursPerDay: number;
  allowHoursProposals: boolean;
  minPublicHours: number;
  postCooldownSeconds: number;
  commentCooldownSeconds: number;
  dailyCommentLimit: number;
  votingPeriodBlocks: number;
}

/**
 * Post data from contract
 */
export interface MoltPost {
  id: number;
  contentHash: bigint;
  author: AztecAddress;
  submoltId: number;
  createdAt: number;
  votesUp: number;
  votesDown: number;
  deleted: boolean;
}

/**
 * Comment data from contract
 */
export interface MoltComment {
  id: number;
  contentHash: bigint;
  postId: number;
  parentCommentId: number;
  author: AztecAddress;
  createdAt: number;
  votesUp: number;
  votesDown: number;
}

/**
 * Submolt data from contract
 */
export interface MoltSubmolt {
  id: number;
  nameHash: bigint;
  creator: AztecAddress;
}

/**
 * Proposal status
 */
export type ProposalStatus = 'active' | 'passed' | 'rejected' | 'executed';

/**
 * Proposal type
 */
export type ProposalType = 'general' | 'toggle_discussion' | 'update_rate_limits' | 'update_viewing_hours';

/**
 * Governance proposal data
 */
export interface MoltProposal {
  id: number;
  contentHash: bigint;
  author: AztecAddress;
  votesFor: number;
  votesAgainst: number;
  status: ProposalStatus;
  endBlock: number;
  type: ProposalType;
}

/**
 * Rate limit configuration
 */
export interface MoltRateLimits {
  postCooldown: number;
  commentCooldown: number;
  dailyLimit: number;
}

function statusFromU8(val: number): ProposalStatus {
  switch (val) {
    case 0: return 'active';
    case 1: return 'passed';
    case 2: return 'rejected';
    case 3: return 'executed';
    default: return 'active';
  }
}

function typeFromU8(val: number): ProposalType {
  switch (val) {
    case 0: return 'general';
    case 1: return 'toggle_discussion';
    case 2: return 'update_rate_limits';
    case 3: return 'update_viewing_hours';
    default: return 'general';
  }
}

function typeToU8(t: ProposalType): number {
  switch (t) {
    case 'general': return 0;
    case 'toggle_discussion': return 1;
    case 'update_rate_limits': return 2;
    case 'update_viewing_hours': return 3;
  }
}

/**
 * Service for interacting with Molt Cloak contracts
 */
export class MoltCloakService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private cloakAddress: AztecAddress | null = null;
  private senderAddress: AztecAddress | null = null;
  private paymentMethod: any | null = null;

  constructor(wallet: Wallet, senderAddress?: AztecAddress, paymentMethod?: any) {
    this.wallet = wallet;
    this.senderAddress = senderAddress ?? null;
    this.paymentMethod = paymentMethod ?? null;
  }

  /** Build send options with sender address and fee payment */
  private sendOpts(): any {
    return {
      ...(this.senderAddress ? { from: this.senderAddress } : {}),
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    };
  }

  /** Build simulate options with sender address */
  private simOpts(): any {
    return { from: this.senderAddress ?? AztecAddress.fromBigInt(0n) };
  }

  // ===== LIFECYCLE =====

  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    this.contract = await Contract.at(cloakAddress, artifact, this.wallet);
  }

  isConnected(): boolean {
    return this.contract !== null;
  }

  getAddress(): AztecAddress | null {
    return this.cloakAddress;
  }

  async deploy(
    config: MoltCloakConfig,
    artifact: any,
    _classId: Fr,
    admin?: AztecAddress
  ): Promise<AztecAddress> {
    const privacyPreset = config.privacyPreset === 'maximum' ? 0 : 1;
    const adminAddr = admin ?? AztecAddress.fromBigInt(0n);

    const deployTx = await Contract.deploy(
      this.wallet,
      artifact,
      [
        config.name.slice(0, 31),
        adminAddr,
        privacyPreset,
        BigInt(config.publicHoursPerDay),
        BigInt(config.postCooldownSeconds),
        BigInt(config.commentCooldownSeconds),
        BigInt(config.dailyCommentLimit),
        BigInt(config.votingPeriodBlocks),
        config.allowHoursProposals,
        BigInt(config.minPublicHours),
      ]
    ).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
      ...this.sendOpts(),
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.contract = deployed;
    this.cloakAddress = deployed.address;
    return deployed.address;
  }

  private assertConnected(): Contract {
    if (!this.contract) throw new Error('MoltCloakService not connected');
    return this.contract;
  }

  // ===== CLAIM & VERIFICATION =====

  async registerClaim(nonceHash: bigint): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.register_claim(nonceHash).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async completeVerification(nonceHash: bigint, twitterHash: bigint): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.complete_verification(nonceHash, twitterHash).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async getClaimAgent(nonceHash: bigint): Promise<AztecAddress> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_claim_agent(nonceHash).simulate(this.simOpts());
    return AztecAddress.fromBigInt(result);
  }

  async isClaimVerified(nonceHash: bigint): Promise<boolean> {
    const contract = this.assertConnected();
    return await contract.methods.is_claim_verified(nonceHash).simulate(this.simOpts());
  }

  async isAgentVerified(agent: AztecAddress): Promise<boolean> {
    const contract = this.assertConnected();
    return await contract.methods.is_agent_verified(agent).simulate(this.simOpts());
  }

  // ===== POSTS =====

  async createPost(contentHash: bigint, submoltId: number): Promise<{ postId: number; txHash: string }> {
    const contract = this.assertConnected();
    const countBefore = await this.getPostCount();
    const tx = await contract.methods.create_post(contentHash, BigInt(submoltId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return { postId: countBefore + 1, txHash: tx.txHash.toString() };
  }

  async deletePost(postId: number): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.delete_post(BigInt(postId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async getPost(postId: number): Promise<MoltPost> {
    const contract = this.assertConnected();
    const pid = BigInt(postId);
    const [contentHash, author, submoltId, createdAt, votes, deleted] = await Promise.all([
      contract.methods.get_post_content_hash(pid).simulate(this.simOpts()),
      contract.methods.get_post_author(pid).simulate(this.simOpts()),
      contract.methods.get_post_submolt(pid).simulate(this.simOpts()),
      contract.methods.get_post_created_at(pid).simulate(this.simOpts()),
      contract.methods.get_post_votes(pid).simulate(this.simOpts()),
      contract.methods.is_post_deleted(pid).simulate(this.simOpts()),
    ]);
    return {
      id: postId,
      contentHash: BigInt(contentHash.toString()),
      author: AztecAddress.fromBigInt(BigInt(author.toString())),
      submoltId: Number(submoltId),
      createdAt: Number(createdAt),
      votesUp: Number(votes[0]),
      votesDown: Number(votes[1]),
      deleted: Boolean(deleted),
    };
  }

  async getPostCount(): Promise<number> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_post_count().simulate(this.simOpts());
    return Number(result);
  }

  async upvotePost(postId: number): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.upvote_post(BigInt(postId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async downvotePost(postId: number): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.downvote_post(BigInt(postId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  // ===== COMMENTS =====

  async createComment(
    contentHash: bigint,
    postId: number,
    parentCommentId: number = 0
  ): Promise<{ commentId: number; txHash: string }> {
    const contract = this.assertConnected();
    const countBefore = await this.getCommentCount();
    const tx = await contract.methods
      .create_comment(contentHash, BigInt(postId), BigInt(parentCommentId))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
    return { commentId: countBefore + 1, txHash: tx.txHash.toString() };
  }

  async getComment(commentId: number): Promise<MoltComment> {
    const contract = this.assertConnected();
    const cid = BigInt(commentId);
    const [contentHash, postId, parentId, author, createdAt, votes] = await Promise.all([
      contract.methods.get_comment_content_hash(cid).simulate(this.simOpts()),
      contract.methods.get_comment_post_id(cid).simulate(this.simOpts()),
      contract.methods.get_comment_parent_id(cid).simulate(this.simOpts()),
      contract.methods.get_comment_author(cid).simulate(this.simOpts()),
      contract.methods.get_comment_created_at(cid).simulate(this.simOpts()),
      contract.methods.get_comment_votes(cid).simulate(this.simOpts()),
    ]);
    return {
      id: commentId,
      contentHash: BigInt(contentHash.toString()),
      postId: Number(postId),
      parentCommentId: Number(parentId),
      author: AztecAddress.fromBigInt(BigInt(author.toString())),
      createdAt: Number(createdAt),
      votesUp: Number(votes[0]),
      votesDown: Number(votes[1]),
    };
  }

  async getCommentCount(): Promise<number> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_comment_count().simulate(this.simOpts());
    return Number(result);
  }

  async upvoteComment(commentId: number): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.upvote_comment(BigInt(commentId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async downvoteComment(commentId: number): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.downvote_comment(BigInt(commentId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  // ===== SUBMOLTS =====

  async createSubmolt(nameHash: bigint): Promise<{ submoltId: number; txHash: string }> {
    const contract = this.assertConnected();
    const countBefore = await this.getSubmoltCount();
    const tx = await contract.methods.create_submolt(nameHash).send(this.sendOpts()).wait({ timeout: 120000 });
    return { submoltId: countBefore + 1, txHash: tx.txHash.toString() };
  }

  async getSubmolt(submoltId: number): Promise<MoltSubmolt> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_submolt(BigInt(submoltId)).simulate(this.simOpts());
    return {
      id: submoltId,
      nameHash: BigInt(result[0].toString()),
      creator: AztecAddress.fromBigInt(BigInt(result[1].toString())),
    };
  }

  async getSubmoltCount(): Promise<number> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_submolt_count().simulate(this.simOpts());
    return Number(result);
  }

  // ===== GOVERNANCE =====

  async createProposal(
    contentHash: bigint,
    proposalType: ProposalType,
    proposedHours: number = 0
  ): Promise<{ proposalId: number; txHash: string }> {
    const contract = this.assertConnected();
    const countBefore = await this.getProposalCount();
    const tx = await contract.methods
      .create_proposal(contentHash, typeToU8(proposalType), BigInt(proposedHours))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
    return { proposalId: countBefore + 1, txHash: tx.txHash.toString() };
  }

  async castVote(proposalId: number, support: boolean): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.cast_vote(BigInt(proposalId), support).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async executeProposal(proposalId: number): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods.execute_proposal(BigInt(proposalId)).send(this.sendOpts()).wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  async getProposal(proposalId: number): Promise<MoltProposal> {
    const contract = this.assertConnected();
    const pid = BigInt(proposalId);
    const [contentHash, author, votes, status, endBlock, pType] = await Promise.all([
      contract.methods.get_proposal_content_hash(pid).simulate(this.simOpts()),
      contract.methods.get_proposal_author(pid).simulate(this.simOpts()),
      contract.methods.get_proposal_votes(pid).simulate(this.simOpts()),
      contract.methods.get_proposal_status(pid).simulate(this.simOpts()),
      contract.methods.get_proposal_end_block(pid).simulate(this.simOpts()),
      contract.methods.get_proposal_type(pid).simulate(this.simOpts()),
    ]);
    return {
      id: proposalId,
      contentHash: BigInt(contentHash.toString()),
      author: AztecAddress.fromBigInt(BigInt(author.toString())),
      votesFor: Number(votes[0]),
      votesAgainst: Number(votes[1]),
      status: statusFromU8(Number(status)),
      endBlock: Number(endBlock),
      type: typeFromU8(Number(pType)),
    };
  }

  async getProposalCount(): Promise<number> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_proposal_count().simulate(this.simOpts());
    return Number(result);
  }

  // ===== CONFIG / VIEW =====

  async getName(): Promise<string> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_name().simulate(this.simOpts());
    return result.toString();
  }

  async getPublicHoursPerDay(): Promise<number> {
    const contract = this.assertConnected();
    return Number(await contract.methods.get_public_hours_per_day().simulate(this.simOpts()));
  }

  async getPublicWindowStartUtc(): Promise<number> {
    const contract = this.assertConnected();
    return Number(await contract.methods.get_public_window_start_utc().simulate(this.simOpts()));
  }

  async getAllowHoursProposals(): Promise<boolean> {
    const contract = this.assertConnected();
    return await contract.methods.get_allow_hours_proposals().simulate(this.simOpts());
  }

  async getMinPublicHours(): Promise<number> {
    const contract = this.assertConnected();
    return Number(await contract.methods.get_min_public_hours().simulate(this.simOpts()));
  }

  async isCurrentlyPublic(): Promise<boolean> {
    const contract = this.assertConnected();
    const currentHour = new Date().getUTCHours();
    return Boolean(await contract.methods.is_currently_public(BigInt(currentHour)).simulate(this.simOpts()));
  }

  async getRateLimits(): Promise<MoltRateLimits> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_rate_limits().simulate(this.simOpts());
    return {
      postCooldown: Number(result[0]),
      commentCooldown: Number(result[1]),
      dailyLimit: Number(result[2]),
    };
  }

  async getAgentCount(): Promise<number> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_agent_count().simulate(this.simOpts());
    return Number(result);
  }

  async getAdmin(): Promise<AztecAddress> {
    const contract = this.assertConnected();
    const result = await contract.methods.get_admin().simulate(this.simOpts());
    return AztecAddress.fromBigInt(BigInt(result.toString()));
  }

  // ===== HELPERS =====

  private hashString(str: string): Fr {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 31), 1);
    return Fr.fromBuffer(Buffer.from(padded));
  }
}
