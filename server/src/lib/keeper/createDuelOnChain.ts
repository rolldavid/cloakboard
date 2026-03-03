/**
 * On-Chain Duel Creation — Keeper-mediated contract calls to register duels on Aztec L2.
 *
 * - Singleton DuelCloak contract registration with keeper PXE
 * - Mutex to serialize on-chain duel creation (prevents duel_count race)
 * - createDuelOnChain(title, endBlock) → on-chain duel ID
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getKeeperWallet, getNode, getPaymentMethod, getKeeperAddress } from './wallet.js';
import { readDuelCount } from '../aztec/publicStorageReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// ─── Singleton contract registration ───

let _contract: Contract | null = null;
let _contractPromise: Promise<Contract> | null = null;

function loadDuelCloakArtifact() {
  const artifactPath = resolve(__dirname, '../aztec/artifacts/DuelCloak.json');
  const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  raw.transpiled = true;
  // Strip __aztec_nr_internals__ prefix — MUST match SDK-computed selectors
  if (raw.functions) {
    for (const fn of raw.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  return loadContractArtifact(raw);
}

async function getDuelCloakContract(): Promise<Contract> {
  if (_contract) return _contract;
  if (_contractPromise) return _contractPromise;

  _contractPromise = (async () => {
    const duelCloakAddress = process.env.VITE_DUELCLOAK_ADDRESS;
    if (!duelCloakAddress) throw new Error('VITE_DUELCLOAK_ADDRESS not set');

    const wallet = await getKeeperWallet();
    const node = await getNode();
    const addr = AztecAddress.fromString(duelCloakAddress);
    const artifact = loadDuelCloakArtifact();

    // Register contract instance with keeper PXE
    const instance = await node.getContract(addr);
    if (!instance) throw new Error(`DuelCloak contract not found on-chain at ${duelCloakAddress}`);

    try {
      await wallet.registerContract(instance as any, artifact as any);
      console.log('[createDuelOnChain] DuelCloak registered with keeper PXE');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (!msg.includes('already')) {
        console.warn('[createDuelOnChain] Registration warning:', msg);
      }
    }

    _contract = await Contract.at(addr, artifact, wallet);
    return _contract!;
  })();

  try {
    const result = await _contractPromise;
    return result;
  } catch (err) {
    _contractPromise = null; // Allow retry on failure
    throw err;
  }
}

// ─── Mutex for serialized on-chain creation ───

let _mutexPromise: Promise<void> = Promise.resolve();

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _mutexPromise;
  let resolve: () => void;
  _mutexPromise = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// ─── Main export ───

/**
 * Create a duel on-chain via the keeper wallet.
 * Returns the on-chain duel ID (duel_count before creation).
 *
 * @param title - Duel title text (encoded as 4 Fields)
 * @param endBlock - Server-computed end block number
 */
export async function createDuelOnChain(title: string, endBlock: number): Promise<number> {
  return withMutex(async () => {
    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    const contract = await getDuelCloakContract();
    const node = await getNode();
    const duelCloakAddress = AztecAddress.fromString(process.env.VITE_DUELCLOAK_ADDRESS!);
    const keeperAddress = getKeeperAddress();
    const paymentMethod = getPaymentMethod();

    // Read current duel_count (this will be the new duel's on-chain ID)
    const duelCount = await readDuelCount(node, duelCloakAddress);
    console.log(`[createDuelOnChain] duel_count=${duelCount}, endBlock=${endBlock} [${elapsed()}]`);

    const [p1, p2, p3, p4] = textToFields(title);

    const sendOpts: any = {
      ...(keeperAddress ? { from: keeperAddress } : {}),
      ...(paymentMethod ? { fee: { paymentMethod } } : {}),
      wait: NO_WAIT,
    };

    await contract.methods
      .submit_and_start_duel(p1, p2, p3, p4, endBlock)
      .send(sendOpts);

    console.log(`[createDuelOnChain] tx sent, onChainId=${duelCount} [${elapsed()}]`);
    return duelCount;
  });
}
