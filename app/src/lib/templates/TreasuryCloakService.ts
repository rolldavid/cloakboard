/**
 * Treasury Cloak Service
 *
 * Service for interacting with Treasury Management Cloak contracts.
 * Handles multi-sig spending, budget tracking, and treasury operations.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { TokenGateConfig } from '@/types/tokenGate';

/**
 * Treasury Cloak configuration for creation
 */
export interface TreasuryCloakConfig {
  name: string;
  description: string;

  // Multi-sig
  requiredSignatures: number;
  multisigThreshold: bigint; // Amount above which multi-sig is required

  // Governance
  votingDuration: number;
  quorumThreshold: number;

  // Privacy
  privacyPreset: 'maximum' | 'balanced' | 'transparent';
  tokenGate?: TokenGateConfig;

  // Visibility
  isPubliclySearchable: boolean;
  isPubliclyViewable: boolean;
}

/**
 * Spending categories
 */
export enum SpendingCategory {
  General = 0,
  Development = 1,
  Marketing = 2,
  Operations = 3,
  Grants = 4,
}

/**
 * Spending proposal information
 */
export interface SpendingProposal {
  id: number;
  creator: string;
  title: string;
  description: string;
  recipient: string;
  amount: bigint;
  asset: string;
  category: SpendingCategory;
  startBlock: number;
  endBlock: number;
  executed: boolean;
  signatureCount: number;
}

/**
 * Budget summary for a category
 */
export interface CategoryBudget {
  category: SpendingCategory;
  categoryName: string;
  allocated: bigint;
  spent: bigint;
  remaining: bigint;
}

/**
 * Treasury overview
 */
export interface TreasuryOverview {
  totalBalance: bigint;
  approximateBalance: bigint;
  assetBalances: Map<string, bigint>;
  signerCount: number;
  requiredSignatures: number;
  pendingProposals: number;
}

/**
 * Category name mapping
 */
function getCategoryName(category: SpendingCategory): string {
  switch (category) {
    case SpendingCategory.Development:
      return 'Development';
    case SpendingCategory.Marketing:
      return 'Marketing';
    case SpendingCategory.Operations:
      return 'Operations';
    case SpendingCategory.Grants:
      return 'Grants';
    default:
      return 'General';
  }
}

/**
 * Service for interacting with Treasury Cloak contracts
 */
export class TreasuryCloakService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private cloakAddress: AztecAddress | null = null;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Connect to an existing Treasury Cloak
   */
  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    this.contract = await Contract.at(cloakAddress, artifact, this.wallet);

  }

  /**
   * Deploy a new Treasury Cloak
   */
  async deploy(
    config: TreasuryCloakConfig,
    admin: AztecAddress,
    artifact: any,
    classId: Fr
  ): Promise<AztecAddress> {
    const privacyPreset =
      config.privacyPreset === 'maximum' ? 0 : config.privacyPreset === 'transparent' ? 2 : 1;

    const deployTx = await Contract.deploy(this.wallet, artifact, [
      config.name,
      admin,
      config.requiredSignatures,
      config.votingDuration,
      config.quorumThreshold,
      config.multisigThreshold,
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
   * Add a member (admin only)
   */
  async addMember(memberAddress: AztecAddress, votingPower: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .add_member(memberAddress, votingPower)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Remove a member (admin only)
   */
  async removeMember(memberAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.remove_member(memberAddress).send({} as any).wait({ timeout: 120000 });
  }

  // ===== MULTI-SIG MANAGEMENT =====

  /**
   * Add a signer (admin only)
   */
  async addSigner(signerAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.add_signer(signerAddress).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Remove a signer (admin only)
   */
  async removeSigner(signerAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.remove_signer(signerAddress).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Set required signatures (admin only)
   */
  async setRequiredSignatures(required: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .set_required_signatures(required)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== SPENDING PROPOSALS =====

  /**
   * Create a spending proposal
   */
  async createSpendingProposal(
    title: string,
    description: string,
    recipient: AztecAddress,
    amount: bigint,
    asset: AztecAddress,
    category: SpendingCategory
  ): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods
      .create_spending_proposal(title, description, recipient, amount, asset, category)
      .send({} as any)
      .wait({ timeout: 120000 });

    return Number((result as any).returnValues?.[0] ?? 0);
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
   * Sign a spending proposal (for multi-sig)
   */
  async signProposal(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.sign_proposal(BigInt(proposalId)).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Execute a spending proposal
   */
  async executeSpendingProposal(proposalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .execute_spending_proposal(BigInt(proposalId))
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  // ===== BUDGET MANAGEMENT =====

  /**
   * Set budget for a category (admin only)
   */
  async setCategoryBudget(category: SpendingCategory, amount: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods
      .set_category_budget(category, amount)
      .send({} as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Set spending limit for a member (admin only)
   */
  async setSpendingLimit(member: AztecAddress, limit: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.set_spending_limit(member, limit).send({} as any).wait({ timeout: 120000 });
  }

  // ===== DEPOSIT FUNCTIONS =====

  /**
   * Deposit native asset to treasury
   */
  async deposit(amount: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.deposit(amount).send({} as any).wait({ timeout: 120000 });
  }

  /**
   * Deposit ERC20 token to treasury
   */
  async depositAsset(asset: AztecAddress, amount: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    await this.contract.methods.deposit_asset(asset, amount).send({} as any).wait({ timeout: 120000 });
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
   * Get member count
   */
  async getMemberCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_member_count().simulate({} as any);
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
   * Check if address is a signer
   */
  async isSigner(address: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.is_signer(address).simulate({} as any);
  }

  /**
   * Get signer count
   */
  async getSignerCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_signer_count().simulate({} as any);
    return Number(result);
  }

  /**
   * Get required signatures
   */
  async getRequiredSignatures(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_required_signatures().simulate({} as any);
    return Number(result);
  }

  /**
   * Get treasury balance (respects privacy settings)
   */
  async getTreasuryBalance(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_treasury_balance().simulate({} as any);
    return BigInt(result);
  }

  /**
   * Get exact treasury balance
   */
  async getExactBalance(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_exact_balance().simulate({} as any);
    return BigInt(result);
  }

  /**
   * Get asset balance
   */
  async getAssetBalance(asset: AztecAddress): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_asset_balance(asset).simulate({} as any);
    return BigInt(result);
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
  async getProposal(proposalId: number): Promise<SpendingProposal> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const result = await this.contract.methods.get_proposal(BigInt(proposalId)).simulate({} as any);

    return {
      id: Number(result.id),
      creator: result.creator.toString(),
      title: result.title.toString(),
      description: result.description.toString(),
      recipient: result.recipient.toString(),
      amount: BigInt(result.amount),
      asset: result.asset.toString(),
      category: Number(result.category) as SpendingCategory,
      startBlock: Number(result.start_block),
      endBlock: Number(result.end_block),
      executed: Boolean(result.executed),
      signatureCount: Number(result.signature_count),
    };
  }

  /**
   * Get category budget summary
   */
  async getCategoryBudget(category: SpendingCategory): Promise<CategoryBudget> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const [allocated, spent] = await Promise.all([
      this.contract.methods.get_category_budget(category).simulate({} as any),
      this.contract.methods.get_category_spent(category).simulate({} as any),
    ]);

    const allocatedBigInt = BigInt(allocated);
    const spentBigInt = BigInt(spent);

    return {
      category,
      categoryName: getCategoryName(category),
      allocated: allocatedBigInt,
      spent: spentBigInt,
      remaining: allocatedBigInt - spentBigInt,
    };
  }

  /**
   * Get all category budgets
   */
  async getAllCategoryBudgets(): Promise<CategoryBudget[]> {
    const categories = [
      SpendingCategory.General,
      SpendingCategory.Development,
      SpendingCategory.Marketing,
      SpendingCategory.Operations,
      SpendingCategory.Grants,
    ];

    return Promise.all(categories.map((cat) => this.getCategoryBudget(cat)));
  }

  /**
   * Get treasury overview
   */
  async getTreasuryOverview(): Promise<TreasuryOverview> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    const [totalBalance, signerCount, requiredSignatures, proposalCount] = await Promise.all([
      this.getExactBalance(),
      this.getSignerCount(),
      this.getRequiredSignatures(),
      this.getProposalCount(),
    ]);

    // Count pending proposals
    let pendingProposals = 0;
    for (let i = 0; i < proposalCount; i++) {
      const proposal = await this.getProposal(i);
      if (!proposal.executed) {
        pendingProposals++;
      }
    }

    return {
      totalBalance,
      approximateBalance: await this.getTreasuryBalance(),
      assetBalances: new Map(), // Would need to track assets separately
      signerCount,
      requiredSignatures,
      pendingProposals,
    };
  }

  /**
   * Check if address has signed a proposal
   */
  async hasSigned(proposalId: number, signer: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to Cloak');

    return this.contract.methods.has_signed(BigInt(proposalId), signer).simulate({} as any);
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

  // ===== UTILITY =====

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
   * Get the Cloak address
   */
  getAddress(): string | null {
    return this.cloakAddress?.toString() ?? null;
  }
}
