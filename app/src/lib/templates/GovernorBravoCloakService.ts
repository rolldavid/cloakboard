/**
 * Governor Bravo Cloak Service — Full Privacy Implementation
 *
 * Service for interacting with the Governor Bravo contract on Aztec.
 * Implements all OpenZeppelin Governor features with full privacy:
 *
 * - GovernorCore: propose, execute, cancel, castVote, state machine
 * - GovernorSettings: governance-updatable parameters
 * - GovernorVotes + GovernorVotesQuorumFraction: dynamic quorum
 * - GovernorCountingSimple: For/Against/Abstain (private)
 * - GovernorCountingFractional: split voting power
 * - GovernorTimelockControl: queue/execute with delay
 * - GovernorStorage: on-chain proposal details
 * - GovernorPreventLateQuorum: deadline extension
 * - GovernorProposalGuardian: guardian cancellation
 * - Multi-target proposals: batched execution
 * - Private delegation: hidden delegation graph
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { TokenGateConfig } from '@/types/tokenGate';

/**
 * Governor Bravo Cloak configuration for creation
 */
export interface GovernorBravoCloakConfig {
  name: string;
  description: string;
  governanceToken: AztecAddress;

  // GovernorSettings
  votingDelay: number;
  votingPeriod: number;
  proposalThreshold: bigint;

  // GovernorVotesQuorumFraction
  quorumNumerator: bigint;
  quorumDenominator: bigint; // default 100

  // GovernorPreventLateQuorum
  lateQuorumExtension: number;

  // GovernorTimelockControl
  timelockDelay: number;

  // GovernorProposalGuardian
  proposalGuardian: AztecAddress;

  // Token gating
  tokenGate?: TokenGateConfig;

  // Council configuration
  cloakMode: 0 | 1 | 2;
  councilMembers?: string[];      // up to 12 addresses
  councilThreshold?: number;
  emergencyThreshold?: number;    // mode 2 only

  // Visibility
  isPubliclyViewable?: boolean;   // true = open, false = closed (token holders only)
}

/**
 * Proposal state enum (Governor Bravo / OZ compatible)
 */
export enum ProposalState {
  Pending = 0,
  Active = 1,
  Canceled = 2,
  Defeated = 3,
  Succeeded = 4,
  Queued = 5,
  Expired = 6,
  Executed = 7,
}

/**
 * Vote support types
 */
export enum VoteSupport {
  Against = 0,
  For = 1,
  Abstain = 2,
}

/**
 * Bravo proposal information (matches GovernorProposal struct)
 */
export interface BravoProposal {
  id: number;
  proposer: string;
  eta: number;
  startBlock: number;
  endBlock: number;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  canceled: boolean;
  executed: boolean;
  actionsHash: string;
  descriptionHash: string;
  targetCount: number;
}

/**
 * Fractional vote parameters
 */
export interface FractionalVoteParams {
  forWeight: bigint;
  againstWeight: bigint;
  abstainWeight: bigint;
}

/**
 * Proposal details (on-chain stored via GovernorStorage)
 */
export interface ProposalDetails {
  id: number;
  actionsHash: string;
  descriptionHash: string;
  targetCount: number;
  state: ProposalState;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  startBlock: number;
  endBlock: number;
  eta: number;
}

/**
 * Delegation info
 */
export interface DelegationInfo {
  delegate: string;
  votingPower: bigint;
  delegatedPower: bigint;
  totalVotes: bigint;
}

/**
 * Governance parameters
 */
export interface GovernanceParams {
  votingDelay: number;
  votingPeriod: number;
  proposalThreshold: bigint;
  quorumNumerator: bigint;
  quorumDenominator: bigint;
  lateQuorumExtension: number;
  timelockDelay: number;
  proposalGuardian: string;
}

function getProposalStateName(state: ProposalState): string {
  const names: Record<ProposalState, string> = {
    [ProposalState.Pending]: 'Pending',
    [ProposalState.Active]: 'Active',
    [ProposalState.Canceled]: 'Canceled',
    [ProposalState.Defeated]: 'Defeated',
    [ProposalState.Succeeded]: 'Succeeded',
    [ProposalState.Queued]: 'Queued',
    [ProposalState.Expired]: 'Expired',
    [ProposalState.Executed]: 'Executed',
  };
  return names[state] ?? 'Unknown';
}

function getVoteSupportName(support: VoteSupport): string {
  const names: Record<VoteSupport, string> = {
    [VoteSupport.Against]: 'Against',
    [VoteSupport.For]: 'For',
    [VoteSupport.Abstain]: 'Abstain',
  };
  return names[support] ?? 'Unknown';
}

/**
 * Service for interacting with Governor Bravo Cloak contracts
 */
export class GovernorBravoCloakService {
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

  /** Build options for simulate calls. */
  private simOpts(): any {
    return this.senderAddress ? { from: this.senderAddress } : {};
  }

  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
    this.contract = wrapContractWithCleanNames(await Contract.at(cloakAddress, artifact, this.wallet));
  }

  async deploy(
    config: GovernorBravoCloakConfig,
    artifact: any,
    _classId: Fr,
    options?: { skipClassRegistration?: boolean }
  ): Promise<AztecAddress> {
    const membershipMode = config.tokenGate?.method === 'aztec-token' ? 0
      : config.tokenGate?.method === 'erc20-token' ? 1 : 0;

    // Pad council members to 12 with zero addresses
    const councilMembers: AztecAddress[] = [];
    const rawMembers = config.councilMembers ?? [];
    for (let i = 0; i < 12; i++) {
      if (i < rawMembers.length && rawMembers[i]) {
        councilMembers.push(AztecAddress.fromString(rawMembers[i]));
      } else {
        councilMembers.push(AztecAddress.fromBigInt(0n));
      }
    }

    // Use AztecAddress.ZERO as `from` to route through signerless/default entrypoint.
    // This avoids the "Failed to get a note" error when the account's signing key
    // note hasn't been synced. The constructor still receives the correct admin
    // via the proposalGuardian and governanceToken parameters.
    const deployTx = await Contract.deploy(this.wallet, artifact, [
      config.name,
      config.governanceToken,
      config.votingDelay,
      config.votingPeriod,
      config.proposalThreshold,
      config.quorumNumerator,
      config.quorumDenominator || 100n,
      config.lateQuorumExtension,
      config.timelockDelay,
      config.proposalGuardian,
      membershipMode,
      config.tokenGate?.aztecToken?.existingTokenAddress
        ? AztecAddress.fromString(config.tokenGate.aztecToken.existingTokenAddress)
        : AztecAddress.fromBigInt(0n),
      config.tokenGate?.erc20Token ? this.hashString(config.tokenGate.erc20Token.tokenAddress) : Fr.ZERO,
      config.tokenGate?.erc20Token ? BigInt(config.tokenGate.erc20Token.minMembershipBalance) : 0n,
      config.cloakMode ?? 0,
      councilMembers,
      rawMembers.length,
      config.councilThreshold ?? 1,
      config.emergencyThreshold ?? 0,
      config.isPubliclyViewable ?? true,
    ]).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: options?.skipClassRegistration ?? false,
      skipPublicDeployment: false,
      from: AztecAddress.ZERO,  // Use signerless entrypoint to avoid note lookup issues
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.cloakAddress = deployed.address;
    const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
    this.contract = wrapContractWithCleanNames(deployed);
    return this.cloakAddress;
  }

  isConnected(): boolean {
    return this.contract !== null;
  }

  getAddress(): string | null {
    return this.cloakAddress?.toString() ?? null;
  }

  // ===== TOKEN GATING =====

  async joinWithTokenProof(balanceCommitment: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .join_with_token_proof(balanceCommitment)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  async joinWithERC20Proof(verifiedBalance: bigint, proofNullifier: Fr): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .join_with_erc20_proof(verifiedBalance, proofNullifier)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  // ===== DELEGATION =====

  async delegate(delegatee: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods.delegate(delegatee).send(this.sendOpts()).wait({ timeout: 120000 });
  }

  async removeDelegation(): Promise<void> {
    await this.delegate(AztecAddress.fromBigInt(0n));
  }

  // ===== PROPOSALS =====

  async propose(
    actionsHash: Fr,
    descriptionHash: Fr,
    targetCount: number
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .propose(actionsHash, descriptionHash, targetCount)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  async proposeBatch(
    targets: AztecAddress[],
    values: bigint[],
    calldataHashes: Fr[],
    descriptionHash: Fr
  ): Promise<void> {
    const actionsHash = this.hashActions(targets, values, calldataHashes);
    await this.propose(actionsHash, descriptionHash, targets.length);
  }

  async cancel(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods.cancel(BigInt(proposalId)).send(this.sendOpts()).wait({ timeout: 120000 });
  }

  // ===== VOTING =====

  async castVote(proposalId: number, support: VoteSupport): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .cast_vote(BigInt(proposalId), support)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  async castVoteWithReason(
    proposalId: number,
    support: VoteSupport,
    reason: string
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const reasonHash = this.hashString(reason);
    await this.contract.methods
      .cast_vote_with_reason(BigInt(proposalId), support, reasonHash)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  async castFractionalVote(
    proposalId: number,
    params: FractionalVoteParams
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .cast_fractional_vote(
        BigInt(proposalId),
        params.forWeight,
        params.againstWeight,
        params.abstainWeight
      )
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  // ===== EXECUTION =====

  async queue(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods.queue(BigInt(proposalId)).send(this.sendOpts()).wait({ timeout: 120000 });
  }

  async execute(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods.execute(BigInt(proposalId)).send(this.sendOpts()).wait({ timeout: 120000 });
  }

  // ===== VIEW FUNCTIONS =====

  async getName(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_name().simulate(this.simOpts());
    return result.toString();
  }

  async getProposalCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_proposal_count().simulate(this.simOpts());
    return Number(result);
  }

  async getProposal(proposalId: number): Promise<BravoProposal> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods.get_proposal(BigInt(proposalId), this.senderAddress).simulate(this.simOpts());
    const [forVotes, againstVotes, abstainVotes] = await this.getProposalVotes(proposalId);

    return {
      id: Number(result.id),
      proposer: result.proposer.toString(),
      eta: Number(result.eta),
      startBlock: Number(result.start_block),
      endBlock: Number(result.end_block),
      forVotes,
      againstVotes,
      abstainVotes,
      canceled: Boolean(result.canceled),
      executed: Boolean(result.executed),
      actionsHash: result.actions_hash.toString(),
      descriptionHash: result.description_hash.toString(),
      targetCount: Number(result.target_count),
    };
  }

  async getProposalVotes(proposalId: number): Promise<[bigint, bigint, bigint]> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods.proposal_votes(BigInt(proposalId), this.senderAddress).simulate(this.simOpts());
    return [BigInt(result[0]), BigInt(result[1]), BigInt(result[2])];
  }

  async getProposalState(proposalId: number): Promise<ProposalState> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods.proposal_state(BigInt(proposalId), this.senderAddress).simulate(this.simOpts());
    return Number(result) as ProposalState;
  }

  async getProposalDetails(proposalId: number): Promise<ProposalDetails> {
    const [proposal, state] = await Promise.all([
      this.getProposal(proposalId),
      this.getProposalState(proposalId),
    ]);

    return {
      id: proposal.id,
      actionsHash: proposal.actionsHash,
      descriptionHash: proposal.descriptionHash,
      targetCount: proposal.targetCount,
      state,
      forVotes: proposal.forVotes,
      againstVotes: proposal.againstVotes,
      abstainVotes: proposal.abstainVotes,
      startBlock: proposal.startBlock,
      endBlock: proposal.endBlock,
      eta: proposal.eta,
    };
  }

  async getVotes(account: AztecAddress): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods.get_votes(account, this.senderAddress).simulate(this.simOpts());
    return BigInt(result);
  }

  async getDelegate(account: AztecAddress): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods.get_delegate(account, this.senderAddress).simulate(this.simOpts());
    return result.toString();
  }

  async getPastVotes(account: AztecAddress, blockNumber: number): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods
      .get_past_votes(account, blockNumber, this.senderAddress)
      .simulate(this.simOpts());
    return BigInt(result);
  }

  async getDelegationInfo(account: AztecAddress): Promise<DelegationInfo> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const [delegate, votes, effectiveVotes] = await Promise.all([
      this.getDelegate(account),
      this.contract.methods.get_effective_votes(account).simulate(this.simOpts()),
      this.getVotes(account),
    ]);
    const ownPower = effectiveVotes;
    const delegatedPower = votes > ownPower ? votes - ownPower : 0n;
    return {
      delegate,
      votingPower: votes,
      delegatedPower,
      totalVotes: votes,
    };
  }

  async getQuorumNumerator(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_quorum_numerator().simulate(this.simOpts());
    return BigInt(result);
  }

  async getQuorumDenominator(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_quorum_denominator().simulate(this.simOpts());
    return BigInt(result);
  }

  async getQuorum(blockNumber: number): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.quorum(blockNumber).simulate(this.simOpts());
    return BigInt(result);
  }

  async getLateQuorumExtension(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_late_quorum_extension().simulate(this.simOpts());
    return Number(result);
  }

  async getProposalGuardian(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_proposal_guardian().simulate(this.simOpts());
    return result.toString();
  }

  async getProposalThreshold(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_proposal_threshold().simulate(this.simOpts());
    return BigInt(result);
  }

  async getGovernanceParams(): Promise<GovernanceParams> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const [
      votingDelay, votingPeriod, proposalThreshold,
      quorumNumerator, quorumDenominator,
      lateQuorumExtension, timelockDelay, proposalGuardian
    ] = await Promise.all([
      this.contract.methods.get_voting_delay().simulate(this.simOpts()),
      this.contract.methods.get_voting_period().simulate(this.simOpts()),
      this.contract.methods.get_proposal_threshold().simulate(this.simOpts()),
      this.contract.methods.get_quorum_numerator().simulate(this.simOpts()),
      this.contract.methods.get_quorum_denominator().simulate(this.simOpts()),
      this.contract.methods.get_late_quorum_extension().simulate(this.simOpts()),
      this.contract.methods.get_timelock_delay().simulate(this.simOpts()),
      this.contract.methods.get_proposal_guardian().simulate(this.simOpts()),
    ]);

    return {
      votingDelay: Number(votingDelay),
      votingPeriod: Number(votingPeriod),
      proposalThreshold: BigInt(proposalThreshold),
      quorumNumerator: BigInt(quorumNumerator),
      quorumDenominator: BigInt(quorumDenominator),
      lateQuorumExtension: Number(lateQuorumExtension),
      timelockDelay: Number(timelockDelay),
      proposalGuardian: proposalGuardian.toString(),
    };
  }

  async getMembershipMode(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_membership_mode().simulate(this.simOpts());
    return Number(result);
  }

  async getTokenGateAddress(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_token_gate_address().simulate(this.simOpts());
    return result.toString();
  }

  async getGovernanceToken(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_governance_token().simulate(this.simOpts());
    return result.toString();
  }

  async getTotalVotingPower(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    if (!this.senderAddress) throw new Error('Caller address required for closed cloaks');
    const result = await this.contract.methods.get_total_voting_power(this.senderAddress).simulate(this.simOpts());
    return BigInt(result);
  }

  async canPropose(account: AztecAddress): Promise<boolean> {
    const [votes, threshold] = await Promise.all([
      this.getVotes(account),
      this.getProposalThreshold(),
    ]);
    return votes >= threshold;
  }

  async getActiveProposals(): Promise<BravoProposal[]> {
    const count = await this.getProposalCount();
    const proposals: BravoProposal[] = [];
    for (let i = 0; i < count; i++) {
      const state = await this.getProposalState(i);
      if (state === ProposalState.Active || state === ProposalState.Pending) {
        proposals.push(await this.getProposal(i));
      }
    }
    return proposals;
  }

  async getAllProposals(): Promise<BravoProposal[]> {
    const count = await this.getProposalCount();
    const proposals: BravoProposal[] = [];
    for (let i = 0; i < count; i++) {
      proposals.push(await this.getProposal(i));
    }
    return proposals;
  }

  async hashProposal(actionsHash: Fr, descriptionHash: Fr): Promise<string> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods
      .hash_proposal(actionsHash, descriptionHash)
      .simulate(this.simOpts());
    return result.toString();
  }

  // ===== COUNCIL OPERATIONS =====

  async councilApprove(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .council_approve(BigInt(proposalId))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  async emergencyExecute(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .emergency_execute(BigInt(proposalId))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  async emergencyCancel(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .emergency_cancel(BigInt(proposalId))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  // ===== COUNCIL VIEW FUNCTIONS =====

  async getCloakMode(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_cloak_mode().simulate(this.simOpts());
    return Number(result);
  }

  async getCouncilMembers(): Promise<string[]> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const count = await this.getCouncilCount();
    const members: string[] = [];
    for (let i = 0; i < count; i++) {
      const result = await this.contract.methods.get_council_member(i).simulate(this.simOpts());
      members.push(result.toString());
    }
    return members;
  }

  async getCouncilCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_council_count().simulate(this.simOpts());
    return Number(result);
  }

  async getCouncilThreshold(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_council_threshold().simulate(this.simOpts());
    return Number(result);
  }

  async getEmergencyThreshold(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_emergency_threshold().simulate(this.simOpts());
    return Number(result);
  }

  async isCouncilMember(address: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.is_council_member(address).simulate(this.simOpts());
    return Boolean(result);
  }

  async getCouncilApprovalCount(proposalId: number): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_council_approval_count(BigInt(proposalId)).simulate(this.simOpts());
    return Number(result);
  }

  // ===== VISIBILITY =====

  async getIsPubliclyViewable(): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    const result = await this.contract.methods.get_is_publicly_viewable().simulate(this.simOpts());
    return Boolean(result);
  }

  /**
   * Update visibility setting (only callable via governance proposal)
   * @param isPubliclyViewable - true for open (anyone can view), false for closed (members only)
   */
  async updateVisibility(isPubliclyViewable: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');
    await this.contract.methods
      .update_visibility(isPubliclyViewable)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  // ===== HELPERS =====

  private hashString(str: string): Fr {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    let hash = 0n;
    for (let i = 0; i < data.length; i++) {
      hash = (hash * 31n + BigInt(data[i])) % (2n ** 254n);
    }
    return new Fr(hash);
  }

  private hashActions(targets: AztecAddress[], values: bigint[], calldataHashes: Fr[]): Fr {
    let hash = 0n;
    for (let i = 0; i < targets.length; i++) {
      const targetField = BigInt(targets[i].toString());
      hash = (hash * 31n + targetField + values[i] + BigInt(calldataHashes[i].toString())) % (2n ** 254n);
    }
    return new Fr(hash);
  }

  static getProposalStateName(state: ProposalState): string {
    return getProposalStateName(state);
  }

  static getVoteSupportName(support: VoteSupport): string {
    return getVoteSupportName(support);
  }

  static canQueue(state: ProposalState): boolean {
    return state === ProposalState.Succeeded;
  }

  static canExecute(state: ProposalState): boolean {
    return state === ProposalState.Queued;
  }

  static isVotingActive(state: ProposalState): boolean {
    return state === ProposalState.Active;
  }
}
