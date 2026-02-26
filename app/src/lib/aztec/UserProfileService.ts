/**
 * UserProfile Service — Private cross-cloak user state
 *
 * Interacts with the UserProfile contract to manage:
 * - Private whisper points (PointNotes encrypted to user)
 * - Private username (UsernameNote encrypted to user)
 *
 * Privacy model:
 * - All reads are unconstrained (PXE-local, no proof, fast)
 * - Only the note owner's PXE can decrypt — server/keeper cannot read
 * - add_points and set_username are private functions (generate ZK proofs)
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { fieldToUsername, usernameToField } from '@/lib/username/generator';

export class UserProfileService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private senderAddress: AztecAddress | null = null;
  private paymentMethod: any | null = null;

  constructor(wallet: Wallet, senderAddress?: AztecAddress, paymentMethod?: any) {
    this.wallet = wallet;
    this.senderAddress = senderAddress ?? null;
    this.paymentMethod = paymentMethod ?? null;
  }

  private sendOpts(): any {
    return {
      ...(this.senderAddress ? { from: this.senderAddress } : {}),
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    };
  }

  /**
   * Connect to a deployed UserProfile contract instance.
   */
  async connect(contractAddress: AztecAddress, artifact: any): Promise<void> {
    const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
    this.contract = wrapContractWithCleanNames(
      await Contract.at(contractAddress, artifact, this.wallet),
    );
  }

  isConnected(): boolean {
    return this.contract !== null;
  }

  // ===== WHISPER POINTS =====

  /**
   * Add whisper points to the caller's private balance.
   * This is a PRIVATE function — generates a ZK proof.
   * Called as a background tx after a vote is confirmed.
   */
  async addPoints(amount: number): Promise<void> {
    if (!this.contract) throw new Error('UserProfile not connected');
    // NO_WAIT: resolve after proof + send, don't block on mining
    await this.contract.methods.add_points(new Fr(BigInt(amount))).send({ ...this.sendOpts(), wait: NO_WAIT });
  }

  /**
   * Read the caller's total private whisper points.
   * Unconstrained — runs client-side in PXE, no proof, fast.
   * Only the note owner's PXE can decrypt these.
   */
  async getMyPoints(): Promise<number> {
    if (!this.contract) throw new Error('UserProfile not connected');
    const owner = this.senderAddress ?? this.wallet.getAddress();
    const result = await this.contract.methods.get_my_points(owner).simulate({ from: owner });
    return Number(result);
  }

  // ===== USERNAME =====

  /**
   * Set the caller's private username on-chain.
   * This is a PRIVATE function — generates a ZK proof.
   * Called as a background tx during account creation.
   */
  async setUsername(name: string): Promise<void> {
    if (!this.contract) throw new Error('UserProfile not connected');
    const nameField = new Fr(usernameToField(name));
    // NO_WAIT: resolve after proof + send, don't block on mining
    await this.contract.methods.set_username(nameField).send({ ...this.sendOpts(), wait: NO_WAIT });
  }

  /**
   * Read the caller's private username from on-chain notes.
   * Unconstrained — runs client-side in PXE, no proof, fast.
   * Returns empty string if no username set.
   */
  async getMyUsername(): Promise<string> {
    if (!this.contract) throw new Error('UserProfile not connected');
    const owner = this.senderAddress ?? this.wallet.getAddress();
    const result = await this.contract.methods.get_my_username(owner).simulate({ from: owner });
    const field = typeof result === 'bigint' ? result : BigInt(result.toString());
    return fieldToUsername(field);
  }

  /**
   * Generate a ZK proof that the caller's points >= threshold.
   * Future use: gate features behind point thresholds.
   */
  async proveMinPoints(threshold: number): Promise<void> {
    if (!this.contract) throw new Error('UserProfile not connected');
    await this.contract.methods.prove_min_points(new Fr(BigInt(threshold))).send(this.sendOpts());
  }
}
