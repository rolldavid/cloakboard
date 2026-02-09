/**
 * Starred Cloaks Service — Private Note Storage
 *
 * Service for interacting with the StarredCloaks contract on Aztec.
 * Allows users to privately star/unstar cloaks. The star/unstar operations
 * use nullifiers for privacy - observers cannot link transactions to specific
 * star actions.
 *
 * Note: The actual starred addresses are stored in public state (for gas efficiency),
 * but the nullifier-based approach ensures that:
 * - The same user cannot star the same cloak twice
 * - Transaction observers cannot determine which cloak is being starred
 *
 * The client maintains a local cache of starred addresses in localStorage
 * for fast lookups without needing to enumerate on-chain state.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';

/**
 * Service for managing privately starred cloaks
 */
export class StarredCloaksService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private contractAddress: AztecAddress | null = null;
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

  /**
   * Connect to an existing StarredCloaks contract
   */
  async connect(contractAddress: AztecAddress, artifact: any): Promise<void> {
    this.contractAddress = contractAddress;
    this.contract = await Contract.at(contractAddress, artifact, this.wallet);
  }

  /**
   * Check if connected to a contract
   */
  isConnected(): boolean {
    return this.contract !== null;
  }

  /**
   * Get the contract address
   */
  getAddress(): AztecAddress | null {
    return this.contractAddress;
  }

  private assertConnected(): Contract {
    if (!this.contract) throw new Error('StarredCloaksService not connected');
    return this.contract;
  }

  // ===== STARRING FUNCTIONS =====

  /**
   * Star a cloak - creates a record via private function with nullifier
   * @param cloakAddress The address of the cloak to star
   * @returns Transaction hash
   */
  async star(cloakAddress: AztecAddress): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods
      .star(cloakAddress)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  /**
   * Unstar a cloak - removes the star record via private function
   * @param cloakAddress The address of the cloak to unstar
   * @returns Transaction hash
   */
  async unstar(cloakAddress: AztecAddress): Promise<string> {
    const contract = this.assertConnected();
    const tx = await contract.methods
      .unstar(cloakAddress)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
    return tx.txHash.toString();
  }

  /**
   * Check if a specific cloak is starred by a specific owner
   * @param owner The owner address to check
   * @param cloakAddress The cloak address to check
   * @returns True if starred, false otherwise
   */
  async isStarred(owner: AztecAddress, cloakAddress: AztecAddress): Promise<boolean> {
    const contract = this.assertConnected();
    const result = await contract.methods
      .is_starred(owner, cloakAddress)
      .simulate(this.simOpts());
    return Boolean(result);
  }

  /**
   * Check if a cloak is starred by the current user
   * @param cloakAddress The cloak address to check
   * @returns True if starred, false otherwise
   */
  async isStarredByMe(cloakAddress: AztecAddress): Promise<boolean> {
    if (!this.senderAddress) {
      throw new Error('No sender address set');
    }
    return this.isStarred(this.senderAddress, cloakAddress);
  }

  /**
   * Get the star count for an owner
   * @param owner The owner address
   * @returns Number of stars
   */
  async getStarCount(owner: AztecAddress): Promise<number> {
    const contract = this.assertConnected();
    const result = await contract.methods
      .get_star_count(owner)
      .simulate(this.simOpts());
    return Number(result);
  }

  /**
   * Check multiple cloaks to see which are starred by the current user
   * This is useful for syncing the local cache with on-chain state
   * @param cloakAddresses Array of cloak addresses to check
   * @returns Array of addresses that are starred
   */
  async filterStarred(cloakAddresses: AztecAddress[]): Promise<string[]> {
    if (!this.senderAddress) {
      throw new Error('No sender address set');
    }

    const results: string[] = [];
    for (const addr of cloakAddresses) {
      try {
        const starred = await this.isStarred(this.senderAddress, addr);
        if (starred) {
          results.push(addr.toString());
        }
      } catch {
        // If check fails, assume not starred
      }
    }
    return results;
  }
}

// Global service instance cache - survives tab navigation
let globalStarredService: StarredCloaksService | null = null;
let globalServiceContractAddress: string | null = null;

/**
 * Get or create a cached StarredCloaksService instance
 */
export async function getStarredCloaksService(
  wallet: Wallet,
  contractAddress: AztecAddress,
  artifact: any,
  senderAddress?: AztecAddress,
  paymentMethod?: any
): Promise<StarredCloaksService> {
  const addressStr = contractAddress.toString();

  // Return cached service if it exists and matches the contract address
  if (globalStarredService && globalServiceContractAddress === addressStr) {
    return globalStarredService;
  }

  // Create new service
  const service = new StarredCloaksService(wallet, senderAddress, paymentMethod);
  await service.connect(contractAddress, artifact);

  // Cache it
  globalStarredService = service;
  globalServiceContractAddress = addressStr;

  return service;
}

/**
 * Clear the cached service (call on logout/disconnect)
 */
export function clearStarredCloaksService(): void {
  globalStarredService = null;
  globalServiceContractAddress = null;
}
