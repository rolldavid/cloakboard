/**
 * VoteHistory Service -- Private on-chain vote history
 *
 * Records vote direction (agree/disagree) per duel as encrypted private notes.
 * Only the voter's PXE can decrypt -- server/keeper cannot read.
 *
 * Privacy model:
 * - record_vote is a private function (ZK proof, all inputs hidden)
 * - get_my_vote_for_duel is unconstrained (PXE-local, no proof, instant)
 * - Account switching: fresh PXE = fresh keys = only new user's notes visible
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

export class VoteHistoryService {
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
   * Connect to a deployed VoteHistory contract instance.
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

  /**
   * Record a vote on-chain privately. Fire-and-forget after vote proof confirms.
   * Private function -- generates ZK proof, all inputs hidden.
   * Uses NO_WAIT: resolves after proof + send (~10-15s), not after mining (~60s).
   */
  async recordVote(duelId: number, cloakAddress: string, direction: 'agree' | 'disagree'): Promise<void> {
    if (!this.contract) throw new Error('VoteHistory not connected');
    const dir = direction === 'agree' ? 1 : 0;
    await this.contract.methods
      .record_vote(
        new Fr(BigInt(duelId)),
        AztecAddress.fromString(cloakAddress),
        new Fr(BigInt(dir)),
      )
      .send({ ...this.sendOpts(), wait: NO_WAIT });
  }

  /**
   * Query vote direction for a specific duel on a specific cloak.
   * Utility -- PXE-local, no proof, instant.
   * Must match both duelId AND cloakAddress (duelId is per-contract, not globally unique).
   * Returns 'agree', 'disagree', or null (not found).
   */
  async getMyVoteForDuel(duelId: number, cloakAddress: string): Promise<'agree' | 'disagree' | null> {
    if (!this.contract) throw new Error('VoteHistory not connected');
    const owner = this.senderAddress ?? this.wallet.getAddress();
    const result = await this.contract.methods
      .get_my_vote_for_duel(owner, new Fr(BigInt(duelId)), AztecAddress.fromString(cloakAddress))
      .simulate({ from: owner });
    const val = Number(result);
    if (val === 1) return 'agree';
    if (val === 0) return 'disagree';
    return null;
  }
}
