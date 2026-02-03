/**
 * Cloak Registry Service — On-Chain Name Uniqueness
 *
 * Interacts with the CloakRegistry contract to ensure cloak names are globally unique.
 * Every cloak deployment should register its name here after successful deployment.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

export class CloakRegistryService {
  private contract: Contract | null = null;
  private wallet: Wallet;
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

  async connect(registryAddress: AztecAddress, artifact: any): Promise<void> {
    this.contract = await Contract.at(registryAddress, artifact, this.wallet);
  }

  async deploy(artifact: any): Promise<AztecAddress> {
    const deployTx = await Contract.deploy(this.wallet, artifact, []).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
      ...this.sendOpts(),
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.contract = deployed;
    return deployed.address;
  }

  isConnected(): boolean {
    return this.contract !== null;
  }

  /**
   * Check if a cloak name is available (not yet registered).
   */
  async isNameAvailable(name: string): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to registry');
    const paddedName = name.slice(0, 31).padEnd(31, '\0');
    const result = await this.contract.methods
      .is_name_available(paddedName)
      .simulate({} as any);
    return Boolean(result);
  }

  /**
   * Register a cloak name after successful deployment.
   * Reverts on-chain if the name is already taken.
   */
  async register(name: string, cloakAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to registry');
    const paddedName = name.slice(0, 31).padEnd(31, '\0');
    await this.contract.methods
      .register(paddedName, cloakAddress)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  /**
   * Get the cloak address for a given name. Returns null if not found.
   */
  async getCloakByName(name: string): Promise<string | null> {
    if (!this.contract) throw new Error('Not connected to registry');
    const paddedName = name.slice(0, 31).padEnd(31, '\0');
    const result = await this.contract.methods
      .get_cloak_by_name(paddedName)
      .simulate({} as any);
    const addr = result.toString();
    const zeroAddr = '0x0000000000000000000000000000000000000000000000000000000000000000';
    return addr === zeroAddr ? null : addr;
  }

  /**
   * Get the total number of registered cloaks.
   */
  async getCloakCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to registry');
    const result = await this.contract.methods
      .get_cloak_count()
      .simulate({} as any);
    return Number(result);
  }
}
