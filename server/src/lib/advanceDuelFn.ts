/**
 * advanceDuelForCloak — direct function invocation for advancing a duel.
 *
 * Extracted from the /api/advance-duel route handler so that keeperCron
 * can call it directly instead of making an internal HTTP request.
 * This avoids circular auth issues (LOW-4 from security review).
 */

import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { getNextAvailableStatement, markStatementOnChain, markStatementUsed } from './db/statements.js';
import { advanceSchedule } from './db/duelSchedule.js';
import { upsertDuelSnapshot } from './db/duelSnapshotSync.js';
import { insertTimelineSnapshot } from './db/voteTimeline.js';
import { getKeeperWallet, getKeeperAddress, getPaymentMethod } from './keeper/wallet.js';
import { getKeeperStore } from './keeper/store.js';

// Lazy-load DuelCloak artifact
let _artifact: any = null;
async function getDuelCloakArtifact(): Promise<any> {
  if (!_artifact) {
    const { readFileSync } = await import('fs');
    const { dirname, resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const artifactPath = resolve(dirname(__filename), './aztec/artifacts/DuelCloak.json');
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    raw.transpiled = true;
    _artifact = loadContractArtifact(raw);
  }
  return _artifact;
}

function textToFieldParts(text: string): [Fr, Fr, Fr, Fr] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const padded = new Uint8Array(124);
  padded.set(bytes.subarray(0, 124));

  const parts: Fr[] = [];
  for (let i = 0; i < 4; i++) {
    const chunk = padded.subarray(i * 31, (i + 1) * 31);
    let value = BigInt(0);
    for (const byte of chunk) {
      value = (value << BigInt(8)) | BigInt(byte);
    }
    parts.push(new Fr(value));
  }

  return parts as [Fr, Fr, Fr, Fr];
}

async function computeStatementHash(parts: [Fr, Fr, Fr, Fr]): Promise<Fr> {
  const { pedersenHash } = await import('@aztec/foundation/crypto/pedersen');
  return pedersenHash(parts);
}

export interface AdvanceDuelResult {
  status: 'success' | 'skipped';
  reason?: string;
  duelId?: number;
  statementId?: number;
  statementHash?: string;
}

export async function advanceDuelForCloak(cloakAddress: string): Promise<AdvanceDuelResult> {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  // 1. Get next statement from pool
  const statement = await getNextAvailableStatement(cloakAddress);
  if (!statement) {
    return { status: 'skipped', reason: 'No statements in pool' };
  }
  console.log(`[advance-duel-fn] Statement "${statement.statement_text.slice(0, 30)}..." for ${cloakAddress.slice(0, 14)}... [${elapsed()}]`);

  // 2. Encode text to 4 Field parts + compute Pedersen hash
  const parts = textToFieldParts(statement.statement_text);
  const hash = await computeStatementHash(parts);
  console.log(`[advance-duel-fn] Hash computed: ${hash.toString().slice(0, 14)}... [${elapsed()}]`);

  // 3. Get keeper wallet + load contract
  const wallet = await getKeeperWallet();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();
  const artifact = await getDuelCloakArtifact();

  const cloakAddr = AztecAddress.fromString(cloakAddress);
  const { getNode } = await import('./keeper/wallet.js');
  const node = await getNode();
  try {
    const instance = await node.getContract(cloakAddr);
    if (instance) {
      await wallet.registerContract(instance as any, artifact as any);
    }
  } catch { /* non-fatal */ }

  const contract = await Contract.at(cloakAddr, artifact, wallet);
  console.log(`[advance-duel-fn] Contract loaded [${elapsed()}]`);

  // Pre-check: verify previous duel has ended on-chain before sending tx
  // This avoids wasting 30+ seconds on a tx that will revert
  try {
    const { readDuelCount, readDuelDirect } = await import('./aztec/publicStorageReader.js');
    const duelCount = await readDuelCount(node, cloakAddr);
    if (duelCount > 0) {
      const blockNumber = await node.getBlockNumber();
      const prevDuel = await readDuelDirect(node, cloakAddr, duelCount - 1);
      if (blockNumber <= prevDuel.endBlock) {
        console.log(`[advance-duel-fn] Previous duel #${duelCount - 1} not ended yet (block ${blockNumber} <= endBlock ${prevDuel.endBlock}), skipping [${elapsed()}]`);
        return { status: 'skipped', reason: `Previous duel not ended (block ${blockNumber} <= ${prevDuel.endBlock})` };
      }
      console.log(`[advance-duel-fn] Previous duel ended (block ${blockNumber} > endBlock ${prevDuel.endBlock}), proceeding [${elapsed()}]`);
    }
  } catch (err: any) {
    console.warn(`[advance-duel-fn] Pre-check failed (proceeding anyway): ${err?.message}`);
  }

  const sendOpts: any = { from: keeperAddress };
  if (paymentMethod) sendOpts.fee = { paymentMethod };

  // 4. Submit + start duel in a single tx
  console.log(`[advance-duel-fn] Submitting and starting duel... [${elapsed()}]`);
  try {
    await contract.methods.submit_and_start_duel(parts[0], parts[1], parts[2], parts[3]).send(sendOpts);
  } catch (txErr: any) {
    const msg = txErr?.message || String(txErr);
    console.error(`[advance-duel-fn] TX REVERTED for ${cloakAddress.slice(0, 14)}...: ${msg.slice(0, 300)} [${elapsed()}]`);
    throw txErr;
  }
  console.log(`[advance-duel-fn] Duel started [${elapsed()}]`);

  await markStatementOnChain(cloakAddress, statement.statement_hash);

  // 6. Read actual duel ID from on-chain
  let duelId = 0;
  try {
    const { readCurrentDuelId } = await import('./aztec/publicStorageReader.js');
    duelId = await readCurrentDuelId(node, cloakAddr);
    console.log(`[advance-duel-fn] On-chain current_duel_id = ${duelId} [${elapsed()}]`);
  } catch (err: any) {
    console.warn(`[advance-duel-fn] Could not read current_duel_id: ${err?.message}, falling back to snapshot count`);
    try {
      const { getSnapshotCount } = await import('./db/duelSnapshotSync.js');
      duelId = await getSnapshotCount(cloakAddress);
    } catch { /* use 0 */ }
  }

  // 7. Mark statement as used and advance schedule
  await markStatementUsed(cloakAddress, statement.statement_hash, duelId);
  await advanceSchedule(cloakAddress);

  // 8. Read blocks back from on-chain
  let startBlock = 0;
  let endBlock = 0;
  try {
    const { readDuelDirect } = await import('./aztec/publicStorageReader.js');
    const duelData = await readDuelDirect(node, cloakAddr, duelId);
    startBlock = duelData.startBlock;
    endBlock = duelData.endBlock;
    console.log(`[advance-duel-fn] Blocks: start=${startBlock}, end=${endBlock} [${elapsed()}]`);
  } catch (err: any) {
    console.warn(`[advance-duel-fn] Could not read blocks from chain: ${err?.message}`);
  }

  // 9. Create duel snapshot in DB
  const store = getKeeperStore();
  const entry = await store.get(cloakAddress);
  await upsertDuelSnapshot({
    cloakAddress,
    cloakName: entry?.cloakName || '',
    cloakSlug: entry?.cloakSlug || '',
    duelId,
    statementText: statement.statement_text,
    startBlock,
    endBlock,
    totalVotes: 0,
    agreeVotes: 0,
    disagreeVotes: 0,
    isTallied: false,
  });

  // 10. Insert initial timeline snapshot
  await insertTimelineSnapshot(cloakAddress, duelId, 0, 0, 0);

  console.log(`[advance-duel-fn] Duel #${duelId} started for ${cloakAddress.slice(0, 14)}... [${elapsed()}]`);

  return {
    status: 'success',
    duelId,
    statementId: statement.id,
    statementHash: statement.statement_hash,
  };
}
