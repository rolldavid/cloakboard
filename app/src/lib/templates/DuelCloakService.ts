/**
 * DuelCloak Service V3 — Privacy-preserving binary voting
 *
 * V3 Architecture — Trustless Private Voting:
 * - Statements: POST /api/submit-statement (instant, Postgres only)
 * - Duel advancement: POST /api/advance-duel (server-side, keeper on-chain)
 * - Voting: Browser-proved cast_market_vote (privacy requires it)
 * - Tally: REAL-TIME — agree/disagree counters updated directly by voter's
 *   enqueued public call. No keeper tally. No VoteNotes. No trusted third party.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { apiUrl } from '@/lib/api';
import { buildAuthHeaders } from '@/lib/api/authToken';

// Re-export pure types/constants so existing imports from this file still work
export { DuelRole, MAX_STATEMENT_LENGTH } from './duelTypes';
export type { DuelInfo, DuelCloakConfig, RemovalProposalInfo } from './duelTypes';

import { MAX_STATEMENT_LENGTH, DuelRole } from './duelTypes';
import type { DuelInfo, DuelCloakConfig } from './duelTypes';

const CHARS_PER_FIELD = 25;

export function textToFields(text: string): [Fr, Fr, Fr, Fr] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text.slice(0, MAX_STATEMENT_LENGTH));
  const parts: Fr[] = [];
  for (let p = 0; p < 4; p++) {
    const start = p * CHARS_PER_FIELD;
    const end = Math.min(start + CHARS_PER_FIELD, bytes.length);
    let value = 0n;
    for (let i = start; i < end; i++) value = (value << 8n) | BigInt(bytes[i]);
    parts.push(new Fr(value));
  }
  return parts as [Fr, Fr, Fr, Fr];
}

export function fieldsToText(parts: [bigint | Fr, bigint | Fr, bigint | Fr, bigint | Fr]): string {
  const allBytes: number[] = [];
  for (const part of parts) {
    const val = typeof part === 'bigint' ? part : part.toBigInt();
    if (val === 0n) continue;
    const bytes: number[] = [];
    let v = val;
    while (v > 0n) { bytes.unshift(Number(v & 0xFFn)); v >>= 8n; }
    allBytes.push(...bytes);
  }
  return new TextDecoder().decode(new Uint8Array(allBytes));
}

export class DuelCloakService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private cloakAddress: AztecAddress | null = null;
  private senderAddress: AztecAddress | null = null;
  private paymentMethod: any | null = null;
  private membershipsContract: Contract | null = null;

  constructor(wallet: Wallet, senderAddress?: AztecAddress, paymentMethod?: any) {
    this.wallet = wallet;
    this.senderAddress = senderAddress ?? null;
    this.paymentMethod = paymentMethod ?? null;
  }

  async configureMembershipsTracking(membershipsAddress: AztecAddress, membershipsArtifact: any): Promise<void> {
    const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
    this.membershipsContract = wrapContractWithCleanNames(
      await Contract.at(membershipsAddress, membershipsArtifact, this.wallet),
    );
  }

  private syncMembership(user: AztecAddress, role: number): void {
    if (!this.membershipsContract || !this.cloakAddress) return;
    const cloak = this.cloakAddress;
    const contract = this.membershipsContract;
    const opts = this.sendOpts();
    contract.methods.add_membership(user, cloak, role).send(opts).catch(() => {});
  }

  private sendOpts(): any {
    return {
      ...(this.senderAddress ? { from: this.senderAddress } : {}),
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    };
  }

  private simOpts(): any {
    return this.senderAddress ? { from: this.senderAddress } : {};
  }

  async connect(cloakAddress: AztecAddress, artifact: any): Promise<void> {
    this.cloakAddress = cloakAddress;
    const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
    this.contract = wrapContractWithCleanNames(await Contract.at(cloakAddress, artifact, this.wallet));
  }

  async deploy(config: DuelCloakConfig, artifact: any, _classId: Fr, options?: { skipClassPublication?: boolean }): Promise<AztecAddress> {
    const keeperAddr = config.keeperAddress || import.meta.env.VITE_KEEPER_ADDRESS || '';
    if (!keeperAddr) throw new Error('Keeper address is required');
    if (!config.accountClassId) throw new Error('Account class ID is required');

    const creatorAddr = config.creatorAddress
      ? AztecAddress.fromString(config.creatorAddress) : this.senderAddress;

    const { contract: deployed } = await Contract.deploy(this.wallet, artifact, [
      config.name, config.duelDuration, config.firstDuelBlock,
      config.visibility === 'open', AztecAddress.fromString(keeperAddr),
      new Fr(BigInt(config.accountClassId)), config.tallyMode ?? 0, creatorAddr,
    ]).send({
      contractAddressSalt: Fr.random(),
      skipClassPublication: options?.skipClassPublication ?? false,
      ...this.sendOpts(),
    } as any);

    this.cloakAddress = deployed.address;
    const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
    this.contract = wrapContractWithCleanNames(deployed);
    return this.cloakAddress;
  }

  isConnected(): boolean { return this.contract !== null; }
  getAddress(): string | null { return this.cloakAddress?.toString() ?? null; }

  // ===== MEMBERSHIP =====
  async inviteMember(member: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.invite_member(member).send(this.sendOpts());
    this.syncMembership(member, 1);
  }

  async inviteCouncil(member: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.invite_council(member).send(this.sendOpts());
    this.syncMembership(member, 2);
  }

  // ===== COUNCIL REMOVAL =====
  async proposeRemoval(target: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.propose_removal(target).send(this.sendOpts());
  }

  async voteOnRemoval(removalId: number, keep: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.vote_on_removal(BigInt(removalId), keep).send(this.sendOpts());
  }

  async executeRemoval(removalId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.execute_removal(BigInt(removalId)).send(this.sendOpts());
  }

  // ===== V2: STATEMENTS (via API) =====
  async submitStatement(text: string): Promise<void> {
    if (!this.cloakAddress) throw new Error('Not connected');
    const response = await fetch(apiUrl('/api/submit-statement'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({ cloakAddress: this.cloakAddress.toString(), text: text.trim() }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Submit statement failed (${response.status})`);
    }
  }

  async advanceDuel(): Promise<void> {
    if (!this.cloakAddress) throw new Error('Not connected');
    const response = await fetch(apiUrl('/api/advance-duel'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({ cloakAddress: this.cloakAddress.toString() }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Advance duel failed (${response.status})`);
    }
  }

  // ===== VOTING (V3: trustless, no keeper) =====

  /**
   * Fast pre-check: simulate the vote call to detect nullifier collision
   * without generating a full IVC proof (~2-3s vs ~11s for proof).
   * All three vote types share nullifier hash(duel_id, nhk_app_secret).
   * We simulate the correct function per type so the contract doesn't
   * reject before reaching the nullifier emission.
   */
  async checkAlreadyVoted(duelId: number | bigint, type: 'binary' | 'multi' | 'level' = 'binary'): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    try {
      const id = new Fr(BigInt(duelId));
      if (type === 'multi') {
        await this.contract.methods.cast_market_vote_option(id, new Fr(0n), 5n, new Fr(0n)).simulate(this.simOpts());
      } else if (type === 'level') {
        await this.contract.methods.cast_market_vote_level(id, new Fr(1n), 5n, new Fr(0n)).simulate(this.simOpts());
      } else {
        await this.contract.methods.cast_market_vote(id, true, 5n, new Fr(0n)).simulate(this.simOpts());
      }
      return false; // Simulation succeeded — no nullifier collision
    } catch (err: any) {
      const msg = err?.message ?? '';
      // Only treat as "already voted" if the error specifically mentions
      // duplicate siloed nullifier (the vote nullifier already exists on-chain).
      // Nullifier conflicts with PENDING txs are NOT "already voted" — they're
      // transient conflicts that should not lock the user out.
      if (msg.includes('duplicate siloed nullifier') || msg.includes('already exists in tree')) {
        return true;
      }
      // Other errors (pending tx conflicts, duel ended, contract not found) — assume not voted
      console.warn('[checkAlreadyVoted] Simulation error (non-fatal):', msg);
      return false;
    }
  }

  /**
   * Send a vote tx via NO_WAIT with automatic retry on nullifier conflicts.
   *
   * Nullifier errors from stale PXE state (PointNotes consumed by a recent tx
   * that the PXE hasn't synced yet) are retryable — after a delay the PXE
   * syncs the block, discovers spent notes, and re-proves with fresh notes.
   *
   * If the retry fails with the same error, it's a genuine duplicate vote
   * and we surface the error.
   */
  private async sendVote(label: string, call: () => any): Promise<void> {
    const t0 = Date.now();
    try {
      const { txHash } = await call().send({ ...this.sendOpts(), wait: NO_WAIT });
      console.log(`[${label}] Sent in ${((Date.now() - t0) / 1000).toFixed(1)}s, txHash: ${txHash}`);
    } catch (err: any) {
      const msg = err?.message ?? '';
      // IndexedDB transaction expired — PXE internal state was stale (e.g. after account switch).
      // Short retry gives PXE time to re-establish database connections.
      const isIdbError = msg.includes('IDBObjectStore') || msg.includes('TransactionInactiveError');
      if (isIdbError) {
        console.warn(`[${label}] IndexedDB stale, retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3_000));
        try {
          const { txHash } = await call().send({ ...this.sendOpts(), wait: NO_WAIT });
          console.log(`[${label}] IDB retry succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s, txHash: ${txHash}`);
          return;
        } catch (retryErr: any) {
          console.error(`[${label}] IDB retry failed:`, retryErr?.message);
          throw retryErr;
        }
      }

      // Block header stale — proof was built against a block that's no longer available.
      // Happens when PXE queue delays proof submission. Immediate retry with fresh proof.
      const isStaleBlock = msg.includes('Block header not found') || msg.includes('block header not found');
      if (isStaleBlock) {
        console.warn(`[${label}] Block header stale, retrying immediately...`);
        try {
          const { txHash } = await call().send({ ...this.sendOpts(), wait: NO_WAIT });
          console.log(`[${label}] Stale block retry succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s, txHash: ${txHash}`);
          return;
        } catch (retryErr: any) {
          console.error(`[${label}] Stale block retry failed:`, retryErr?.message);
          throw retryErr;
        }
      }

      // Fee payer has no balance — surface a clear error instead of cryptic nullifier message
      const isFeeError = msg.includes('Minimum required fee') || msg.includes('got: 0')
        || msg.includes('insufficient fee') || msg.includes('fee payer');
      if (isFeeError) {
        throw new Error('Transaction failed: not enough gas to process this transaction. Please try again later.');
      }

      const isNullifierConflict = msg.includes('Nullifier conflict with existing tx')
        || msg.includes('Existing nullifier');

      if (isNullifierConflict) {
        // Check if the nullifier conflict is actually caused by a fee error (combined error message)
        if (msg.includes('Minimum required fee') || msg.includes('got: 0')) {
          throw new Error('Transaction failed: not enough gas to process this transaction. Please try again later.');
        }
        // Wait for pending tx to mine + PXE to sync the new block.
        // Testnet block time is ~68s, so wait 75s to ensure the conflicting
        // tx has mined and the PXE has synced the new nullifiers.
        const delay = 75_000;
        console.warn(`[${label}] Nullifier conflict, retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        try {
          const { txHash } = await call().send({ ...this.sendOpts(), wait: NO_WAIT });
          console.log(`[${label}] Retry succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s, txHash: ${txHash}`);
          return;
        } catch (retryErr: any) {
          // Second retry — in case first retry hit another pending block
          const retryMsg = retryErr?.message ?? '';
          if (retryMsg.includes('Nullifier conflict') || retryMsg.includes('Existing nullifier')) {
            console.warn(`[${label}] Still conflicting, second retry in ${delay / 1000}s...`);
            await new Promise((r) => setTimeout(r, delay));
            try {
              const { txHash } = await call().send({ ...this.sendOpts(), wait: NO_WAIT });
              console.log(`[${label}] Second retry succeeded in ${((Date.now() - t0) / 1000).toFixed(1)}s, txHash: ${txHash}`);
              return;
            } catch (retryErr2: any) {
              console.error(`[${label}] Second retry failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, retryErr2?.message);
              throw retryErr2;
            }
          }
          console.error(`[${label}] Retry failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, retryMsg);
          throw retryErr;
        }
      }
      console.error(`[${label}] Failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, msg);
      throw err;
    }
  }

  // ===== V9/V10: MARKET VOTING =====
  async castMarketVote(duelId: number, support: boolean, stakeAmount: number, dbDuelId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    console.log(`[castMarketVote] Starting: duel=${duelId}, support=${support}, stake=${stakeAmount}`);
    await this.sendVote('castMarketVote', () =>
      this.contract!.methods.cast_market_vote(
        new Fr(BigInt(duelId)), support, BigInt(stakeAmount),
        new Fr(BigInt(dbDuelId)),
      ));
  }

  async castMarketVoteOption(duelId: bigint, optionIndex: bigint, stakeAmount: bigint, dbDuelId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    console.log(`[castMarketVoteOption] Starting: duel=${duelId}, option=${optionIndex}, stake=${stakeAmount}`);
    await this.sendVote('castMarketVoteOption', () =>
      this.contract!.methods.cast_market_vote_option(
        new Fr(duelId), new Fr(optionIndex), stakeAmount,
        new Fr(BigInt(dbDuelId)),
      ));
  }

  async castMarketVoteLevel(duelId: bigint, level: bigint, stakeAmount: bigint, dbDuelId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    console.log(`[castMarketVoteLevel] Starting: duel=${duelId}, level=${level}, stake=${stakeAmount}`);
    await this.sendVote('castMarketVoteLevel', () =>
      this.contract!.methods.cast_market_vote_level(
        new Fr(duelId), new Fr(level), stakeAmount,
        new Fr(BigInt(dbDuelId)),
      ));
  }

  // ===== V9: CLAIM REWARD / REFUND =====
  async claimReward(duelId: number, direction: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    console.log(`[claimReward] Starting: duel=${duelId}, direction=${direction}`);
    await this.contract.methods.claim_reward(
      new Fr(BigInt(duelId)), new Fr(BigInt(direction)),
    ).send({ ...this.sendOpts(), wait: NO_WAIT });
  }

  async claimRefund(duelId: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    console.log(`[claimRefund] Starting: duel=${duelId}`);
    await this.contract.methods.claim_refund(
      new Fr(BigInt(duelId)),
    ).send({ ...this.sendOpts(), wait: NO_WAIT });
  }

  // ===== V9: UTILITY VIEWS =====
  async getMyVoteStakeNotes(): Promise<Array<{ duelId: number; direction: number; stakeAmount: number; dbDuelId: number }>> {
    if (!this.contract) throw new Error('Not connected');
    const owner = this.senderAddress ?? (this.wallet as any).getAddress();
    const { result } = await this.contract.methods
      .get_my_vote_stakes(owner)
      .simulate(this.simOpts());
    // Result is [Field; 41] — packed as [count, (duel_id, direction, stake_amount, db_duel_id) x N]
    const notes: Array<{ duelId: number; direction: number; stakeAmount: number; dbDuelId: number }> = [];
    const arr = Array.isArray(result) ? result : [];
    const count = Number(BigInt(arr[0] ?? 0));
    for (let i = 0; i < count && i < 10; i++) {
      const base = 1 + i * 4;
      const duelId = Number(BigInt(arr[base]));
      const direction = Number(BigInt(arr[base + 1]));
      const stakeAmount = Number(BigInt(arr[base + 2]));
      const dbDuelId = Number(BigInt(arr[base + 3]));
      notes.push({ duelId, direction, stakeAmount, dbDuelId });
    }
    return notes;
  }

  async getDuelOutcome(duelId: number): Promise<number | null> {
    if (!this.contract) throw new Error('Not connected');
    const { result } = await this.contract.methods
      .get_duel_outcome(new Fr(BigInt(duelId)))
      .simulate(this.simOpts());
    return Number(BigInt(result));
  }

  async isDuelFinalized(duelId: number): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    const { result } = await this.contract.methods
      .is_duel_finalized(new Fr(BigInt(duelId)))
      .simulate(this.simOpts());
    return Boolean(result);
  }

  // ===== CONFIG =====
  async updateDuelDuration(newDuration: number): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.update_duel_duration(newDuration).send(this.sendOpts());
  }

  async updateVisibility(isPubliclyViewable: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.methods.update_visibility(isPubliclyViewable).send(this.sendOpts());
  }

  // ===== VIEW FUNCTIONS =====
  async getDuelCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_duel_count().simulate(this.simOpts())).result);
  }

  async getStatementCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_statement_count().simulate(this.simOpts())).result);
  }

  async getActiveDuel(): Promise<DuelInfo> {
    if (!this.contract) throw new Error('Not connected');
    const { result } = await this.contract.methods.get_active_duel().simulate(this.simOpts());
    return this.parseDuel(result);
  }

  async getDuel(duelId: number): Promise<DuelInfo> {
    if (!this.contract) throw new Error('Not connected');
    const { result } = await this.contract.methods.get_duel(BigInt(duelId)).simulate(this.simOpts());
    return this.parseDuel(result);
  }

  async getMemberRole(member: AztecAddress): Promise<DuelRole> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_member_role(member).simulate(this.simOpts())).result) as DuelRole;
  }

  async getMemberCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_member_count().simulate(this.simOpts())).result);
  }

  async getCouncilCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_council_count().simulate(this.simOpts())).result);
  }

  async getKeeper(): Promise<string> {
    if (!this.contract) throw new Error('Not connected');
    return (await this.contract.methods.get_keeper().simulate(this.simOpts())).result.toString();
  }

  async getIsPubliclyViewable(): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    return Boolean((await this.contract.methods.get_is_publicly_viewable().simulate(this.simOpts())).result);
  }

  async getCurrentDuelId(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_current_duel_id().simulate(this.simOpts())).result);
  }

  async getFirstDuelBlock(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number((await this.contract.methods.get_first_duel_block().simulate(this.simOpts())).result);
  }

  // ===== HELPERS =====
  private parseDuel(result: any): DuelInfo {
    const text = fieldsToText([
      result.statement_part_1, result.statement_part_2,
      result.statement_part_3, result.statement_part_4,
    ]);
    return {
      id: Number(result.id),
      statementText: text,
      startBlock: Number(result.start_block),
      endBlock: Number(result.end_block),
      totalVotes: Number(result.total_votes),
      agreeVotes: Number(result.agree_votes),
      disagreeVotes: Number(result.disagree_votes),
      isTallied: Boolean(result.is_tallied),
      startedBy: result.started_by?.toString?.() ?? '',
    };
  }

  static async hashStatement(parts: [Fr, Fr, Fr, Fr]): Promise<Fr> {
    const { pedersenHash } = await import('@aztec/foundation/crypto/pedersen');
    return pedersenHash(parts);
  }

  static async hashStatementText(text: string): Promise<Fr> {
    return DuelCloakService.hashStatement(textToFields(text));
  }

  static blocksToApproxTime(blocks: number): string {
    const seconds = blocks * 30;
    if (seconds < 3600) return `~${Math.round(seconds / 60)} minutes`;
    if (seconds < 86400) return `~${Math.round(seconds / 3600)} hours`;
    return `~${Math.round(seconds / 86400)} days`;
  }
}
