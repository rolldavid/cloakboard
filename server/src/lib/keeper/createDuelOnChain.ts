/**
 * On-Chain Duel Creation — Keeper-mediated contract calls to register duels on Aztec L2.
 *
 * - Singleton DuelCloak contract registration with keeper PXE
 * - Mutex to serialize on-chain duel creation (prevents duel_count race)
 * - createDuelOnChain(title, endBlock) → on-chain duel ID
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

import { getNode, getPaymentMethod, getKeeperAddress } from './wallet.js';
import { getKeeperDuelCloakContract } from './contracts.js';
import { readDuelCount } from '../aztec/publicStorageReader.js';

// ─── Text encoding (same as client-side DuelCloakService.textToFields) ───
const CHARS_PER_FIELD = 25;
const MAX_STATEMENT_LENGTH = 100;

function textToFields(text: string): [Fr, Fr, Fr, Fr] {
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

// ─── Mutex for serialized on-chain creation ───

let _mutexPromise: Promise<void> = Promise.resolve();

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _mutexPromise;
  let resolve: () => void;
  _mutexPromise = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// ─── Local ID tracking (NO_WAIT means on-chain duel_count is stale) ───

let _nextExpectedId: number | null = null;

/**
 * Reset the local ID tracker. Call when on_chain_ids are cleared (e.g., contract redeploy).
 */
export function resetLocalIdTracker(): void {
  _nextExpectedId = null;
}

/**
 * Get the highest ID we've locally assigned (or null if no local tracking yet).
 * Used by syncOnChainTallies to avoid clearing IDs that are valid but not yet mined.
 */
export function getHighestAssignedId(): number | null {
  return _nextExpectedId !== null ? _nextExpectedId - 1 : null;
}

// ─── Main export ───

/**
 * Create a duel on-chain via the keeper wallet.
 * Returns the on-chain duel ID (duel_count before creation).
 *
 * Uses local tracking to assign sequential IDs because NO_WAIT means
 * the on-chain duel_count hasn't incremented when the next call reads it.
 *
 * @param title - Duel title text (encoded as 4 Fields)
 * @param endBlock - Server-computed end block number
 */
export async function createDuelOnChain(title: string, endBlock: number): Promise<number> {
  return withMutex(async () => {
    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    const contract = await getKeeperDuelCloakContract();
    const node = await getNode();
    const duelCloakAddress = AztecAddress.fromString(process.env.VITE_DUELCLOAK_ADDRESS!);
    const keeperAddress = getKeeperAddress();
    const paymentMethod = getPaymentMethod();

    // Read on-chain duel_count, then use the higher of on-chain vs local tracker.
    // This handles: (a) fresh start — use on-chain, (b) sequential sends — use local.
    const onChainCount = await readDuelCount(node, duelCloakAddress);
    const duelCount = _nextExpectedId !== null
      ? Math.max(onChainCount, _nextExpectedId)
      : onChainCount;
    console.log(`[createDuelOnChain] onChain=${onChainCount} local=${_nextExpectedId} → id=${duelCount}, endBlock=${endBlock} [${elapsed()}]`);

    const [p1, p2, p3, p4] = textToFields(title);

    const sendOpts: any = {
      ...(keeperAddress ? { from: keeperAddress } : {}),
      ...(paymentMethod ? { fee: { paymentMethod } } : {}),
      wait: NO_WAIT,
    };

    await contract.methods
      .submit_and_start_duel(p1, p2, p3, p4, endBlock)
      .send(sendOpts);

    // Increment local tracker for next call
    _nextExpectedId = duelCount + 1;

    console.log(`[createDuelOnChain] tx sent, onChainId=${duelCount} [${elapsed()}]`);
    return duelCount;
  });
}
