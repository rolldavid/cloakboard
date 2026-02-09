/**
 * Cloak Registry Service — On-Chain Name Uniqueness + Reverse Name Lookup
 *
 * Interacts with the CloakRegistry contract to ensure cloak names are globally unique
 * and to resolve cloak names from addresses.
 *
 * Features:
 * - Name → Cloak mapping: PUBLIC (for uniqueness checks and search)
 * - Cloak → Name mapping: PUBLIC (compressed field, client decompresses)
 * - Private registration: Uses nullifier to prevent double-registration
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { wrapContractWithCleanNames } from '@/lib/aztec/contracts';

/**
 * Decompress a Field value (from FieldCompressedString) back to a UTF-8 string.
 * FieldCompressedString packs up to 31 bytes of a string into a single Field element.
 * The bytes are stored big-endian in the field.
 */
export function decompressFieldToString(fieldValue: bigint): string {
  if (fieldValue === 0n) return '';

  // Convert the bigint to a 31-byte big-endian buffer
  const bytes = new Uint8Array(31);
  let val = fieldValue;
  for (let i = 30; i >= 0; i--) {
    bytes[i] = Number(val & 0xffn);
    val >>= 8n;
  }

  // Trim trailing null bytes and decode as UTF-8
  let end = 31;
  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }

  return new TextDecoder().decode(bytes.slice(0, end));
}

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

  /** Build options for simulate (view) calls. */
  private simOpts(): any {
    return this.senderAddress ? { from: this.senderAddress } : {};
  }

  /** Build send options. */
  private sendOpts(): any {
    return {
      ...(this.senderAddress ? { from: this.senderAddress } : {}),
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    };
  }

  async connect(registryAddress: AztecAddress, artifact: any): Promise<void> {
    this.contract = wrapContractWithCleanNames(await Contract.at(registryAddress, artifact, this.wallet));
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

  // ===== PUBLIC VIEW FUNCTIONS (Name lookup) =====

  /**
   * Check if a cloak name is available (not yet registered).
   */
  async isNameAvailable(name: string): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to registry');
    const paddedName = name.slice(0, 31).padEnd(31, '\0');
    const result = await this.contract.methods
      .is_name_available(paddedName)
      .simulate(this.simOpts());
    return Boolean(result);
  }

  /**
   * Get the cloak address for a given name. Returns null if not found.
   */
  async getCloakByName(name: string): Promise<string | null> {
    if (!this.contract) throw new Error('Not connected to registry');
    const paddedName = name.slice(0, 31).padEnd(31, '\0');
    const result = await this.contract.methods
      .get_cloak_by_name(paddedName)
      .simulate(this.simOpts());
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
      .simulate(this.simOpts());
    return Number(result);
  }

  /**
   * Check if a name hash is already taken.
   */
  async isNameHashTaken(nameHash: Fr): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to registry');
    const result = await this.contract.methods
      .is_name_hash_taken(nameHash)
      .simulate(this.simOpts());
    return Boolean(result);
  }

  /**
   * Get the compressed name field for a cloak address and decompress it.
   * Returns null if the cloak is not registered.
   */
  async getCloakName(cloakAddress: AztecAddress): Promise<string | null> {
    if (!this.contract) throw new Error('Not connected to registry');
    const result = await this.contract.methods
      .get_cloak_name(cloakAddress)
      .simulate(this.simOpts());
    const fieldValue = BigInt(result.toString());
    if (fieldValue === 0n) return null;
    return decompressFieldToString(fieldValue);
  }

  /**
   * Get the name field for a cloak address (backward compat).
   * NOTE: Now returns compressed name field instead of hash.
   */
  async getNameHashByCloak(cloakAddress: AztecAddress): Promise<string | null> {
    if (!this.contract) throw new Error('Not connected to registry');
    const result = await this.contract.methods
      .get_name_hash_by_cloak(cloakAddress)
      .simulate(this.simOpts());
    const hash = result.toString();
    return hash === '0' ? null : hash;
  }

  // ===== REGISTRATION (Private function) =====

  /**
   * Register a cloak name after successful deployment.
   * This is a PRIVATE function - uses nullifier to prevent double-registration.
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
}
