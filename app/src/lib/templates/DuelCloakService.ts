/**
 * DuelCloak Service V3 — Privacy-preserving binary voting
 *
 * V3 Architecture — Trustless Private Voting:
 * - Statements: POST /api/submit-statement (instant, Postgres only)
 * - Duel advancement: POST /api/advance-duel (server-side, keeper on-chain)
 * - Voting: Browser-proved cast_vote (privacy requires it)
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

    const deployed = await Contract.deploy(this.wallet, artifact, [
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
        ...buildAuthHeaders(
          this.senderAddress ? { address: this.senderAddress.toString(), name: '' } : undefined,
        ),
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
   * Fast pre-check: simulate cast_vote to detect nullifier collision
   * without generating a full IVC proof. Returns true if the user
   * has already voted (nullifier exists), false otherwise.
   */
  async checkAlreadyVoted(duelId: number): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    try {
      await this.contract.methods.cast_vote(new Fr(BigInt(duelId)), true).simulate(this.simOpts());
      return false; // Simulation succeeded — no nullifier collision
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('nullifier') || msg.includes('already')) {
        return true;
      }
      // Other simulation errors (e.g. contract not deployed) — assume not voted
      console.warn('[checkAlreadyVoted] Simulation error (non-fatal):', msg);
      return false;
    }
  }

  async castVote(duelId: number, support: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    const t0 = Date.now();
    console.log(`[castVote] Starting: duel=${duelId}, support=${support}`);
    try {
      // Use NO_WAIT: resolve as soon as the IVC proof is generated and tx is sent
      // to the node. Mining confirmation (~30-60s) happens asynchronously.
      // The proof IS the privacy guarantee — no need to block the UI on mining.
      const txHash = await this.contract.methods.cast_vote(new Fr(BigInt(duelId)), support)
        .send({ ...this.sendOpts(), wait: NO_WAIT });
      console.log(`[castVote] Sent in ${((Date.now() - t0) / 1000).toFixed(1)}s, txHash: ${txHash}`);
    } catch (err: any) {
      console.error(`[castVote] Failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err?.message);
      throw err;
    }
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
    return Number(await this.contract.methods.get_duel_count().simulate(this.simOpts()));
  }

  async getStatementCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number(await this.contract.methods.get_statement_count().simulate(this.simOpts()));
  }

  async getActiveDuel(): Promise<DuelInfo> {
    if (!this.contract) throw new Error('Not connected');
    const result = await this.contract.methods.get_active_duel().simulate(this.simOpts());
    return this.parseDuel(result);
  }

  async getDuel(duelId: number): Promise<DuelInfo> {
    if (!this.contract) throw new Error('Not connected');
    const result = await this.contract.methods.get_duel(BigInt(duelId)).simulate(this.simOpts());
    return this.parseDuel(result);
  }

  async getMemberRole(member: AztecAddress): Promise<DuelRole> {
    if (!this.contract) throw new Error('Not connected');
    return Number(await this.contract.methods.get_member_role(member).simulate(this.simOpts())) as DuelRole;
  }

  async getMemberCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number(await this.contract.methods.get_member_count().simulate(this.simOpts()));
  }

  async getCouncilCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number(await this.contract.methods.get_council_count().simulate(this.simOpts()));
  }

  async getKeeper(): Promise<string> {
    if (!this.contract) throw new Error('Not connected');
    return (await this.contract.methods.get_keeper().simulate(this.simOpts())).toString();
  }

  async getIsPubliclyViewable(): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    return Boolean(await this.contract.methods.get_is_publicly_viewable().simulate(this.simOpts()));
  }

  async getCurrentDuelId(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number(await this.contract.methods.get_current_duel_id().simulate(this.simOpts()));
  }

  async getFirstDuelBlock(): Promise<number> {
    if (!this.contract) throw new Error('Not connected');
    return Number(await this.contract.methods.get_first_duel_block().simulate(this.simOpts()));
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
    const seconds = blocks * 6;
    if (seconds < 3600) return `~${Math.round(seconds / 60)} minutes`;
    if (seconds < 86400) return `~${Math.round(seconds / 3600)} hours`;
    return `~${Math.round(seconds / 86400)} days`;
  }
}
