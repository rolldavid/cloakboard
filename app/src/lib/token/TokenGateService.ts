/**
 * Token Gate Service
 *
 * Deploys and manages token gate contracts for Aztec native token gating.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

/** Token gate deployment configuration */
export interface TokenGateDeployConfig {
  tokenAddress: string;
  cloakAddress: string;
  minBalance: string;
  minProposerBalance: string;
}

/**
 * Service for token gate contracts
 */
export class TokenGateService {
  private wallet: Wallet;
  private contract: Contract | null = null;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Deploy a new token gate contract
   */
  async deploy(config: TokenGateDeployConfig, artifact: any): Promise<string> {
    const deployTx = await Contract.deploy(this.wallet, artifact, [
      config.tokenAddress,
      config.cloakAddress,
      BigInt(config.minBalance),
      BigInt(config.minProposerBalance),
    ]).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.contract = deployed;

    return deployed.address.toString();
  }

  /**
   * Connect to an existing token gate
   */
  async connect(address: AztecAddress, artifact: any): Promise<void> {
    this.contract = await Contract.at(address, artifact, this.wallet);
  }

  /**
   * Verify membership (checks token balance meets minimum)
   */
  async verifyMembership(contextId: bigint): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected');
    const result = await this.contract.methods
      .verify_membership(contextId)
      .send({} as any)
      .wait({ timeout: 120000 });
    return BigInt((result as any).returnValues?.[0] ?? 0);
  }

  /**
   * Get the minimum balance required for membership
   */
  async getMinBalance(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected');
    const result = await this.contract.methods.get_min_balance().simulate({} as any);
    return BigInt(result);
  }

  /**
   * Get the minimum balance required for proposing
   */
  async getMinProposerBalance(): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected');
    const result = await this.contract.methods.get_min_proposer_balance().simulate({} as any);
    return BigInt(result);
  }

  /**
   * Update thresholds (Cloak-only)
   */
  async updateThresholds(minBalance: bigint, minProposerBalance: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods
      .update_thresholds(minBalance, minProposerBalance)
      .send({} as any)
      .wait({ timeout: 120000 });
  }
}
