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

  /**
   * Consolidate all PointNotes into a single note.
   * Calls prove_min_points(0) which pops all notes, sums them, and re-emits one.
   * This prevents note count from exceeding MAX_NOTES_PER_PAGE (10), which would
   * cause get_my_points to silently return an incomplete total.
   * Fire-and-forget with NO_WAIT.
   */
  async consolidatePoints(): Promise<void> {
    if (!this.contract) throw new Error('UserProfile not connected');
    await this.contract.methods.prove_min_points(new Fr(0n)).send({ ...this.sendOpts(), wait: NO_WAIT });
  }

  // ===== ELIGIBILITY =====

  /**
   * Certify that the caller is eligible to create duels (points >= threshold).
   * Private function -- pops all point notes, verifies sum via IVC proof,
   * re-emits consolidated note, and enqueues a public write of the eligibility flag.
   * The server reads the public flag directly -- never sees point count.
   */
  async certifyEligible(threshold: number): Promise<void> {
    if (!this.contract) throw new Error('UserProfile not connected');
    // Without NO_WAIT, .send() resolves after the tx is mined (same pattern as proveMinPoints)
    await this.contract.methods
      .certify_eligible(new Fr(BigInt(threshold)))
      .send(this.sendOpts());
  }

  /**
   * Check if a user is eligible to create duels.
   * Utility -- reads public storage, no proof needed.
   */
  async isEligible(userAddress: string): Promise<boolean> {
    if (!this.contract) throw new Error('UserProfile not connected');
    const userField = AztecAddress.fromString(userAddress).toField();
    return await this.contract.methods.is_eligible(userField).simulate();
  }
}
