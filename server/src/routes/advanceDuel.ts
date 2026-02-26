/**
 * POST /api/advance-duel
 *
 * Reads next statement from Postgres, keeper calls submit_and_start_duel on-chain.
 * V5: merged into a single tx (was 2 txs: submit_statement_hash + start_duel).
 */

import { Router, type Request, type Response } from 'express';
import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { getNextAvailableStatement, markStatementOnChain, markStatementUsed } from '../lib/db/statements';
import { advanceSchedule } from '../lib/db/duelSchedule';
import { upsertDuelSnapshot } from '../lib/db/duelSnapshotSync';
import { insertTimelineSnapshot } from '../lib/db/voteTimeline';
import { getKeeperWallet, getKeeperAddress, getPaymentMethod } from '../lib/keeper/wallet';
import { getKeeperStore } from '../lib/keeper/store';

const router = Router();

// Lazy-load DuelCloak artifact
let _artifact: any = null;
async function getDuelCloakArtifact(): Promise<any> {
  if (!_artifact) {
    const { readFileSync } = await import('fs');
    const { dirname, resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const artifactPath = resolve(dirname(__filename), '../lib/aztec/artifacts/DuelCloak.json');
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    raw.transpiled = true;
    _artifact = loadContractArtifact(raw);
  }
  return _artifact;
}

/**
 * Encode a statement string into 4 Field elements (31 bytes each, 124 chars max).
 * Matches the on-chain Pedersen hash: pedersen_hash([part1, part2, part3, part4])
 */
function textToFieldParts(text: string): [Fr, Fr, Fr, Fr] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  // Pad to 124 bytes
  const padded = new Uint8Array(124);
  padded.set(bytes.subarray(0, 124));

  const parts: Fr[] = [];
  for (let i = 0; i < 4; i++) {
    const chunk = padded.subarray(i * 31, (i + 1) * 31);
    // Convert 31 bytes to a BigInt (big-endian)
    let value = BigInt(0);
    for (const byte of chunk) {
      value = (value << BigInt(8)) | BigInt(byte);
    }
    parts.push(new Fr(value));
  }

  return parts as [Fr, Fr, Fr, Fr];
}

/**
 * Compute Pedersen hash of 4 field elements (must match on-chain std::hash::pedersen_hash)
 */
async function computeStatementHash(parts: [Fr, Fr, Fr, Fr]): Promise<Fr> {
  // Use the async WASM-based Pedersen from Aztec foundation
  const { pedersenHash } = await import('@aztec/foundation/crypto/pedersen');
  return pedersenHash(parts);
}

router.post('/', async (req: Request, res: Response) => {
  const { cloakAddress } = req.body;

  if (!cloakAddress || typeof cloakAddress !== 'string') {
    return res.status(400).json({ error: 'Missing cloakAddress' });
  }

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    // 1. Get next statement from pool
    const statement = await getNextAvailableStatement(cloakAddress);
    if (!statement) {
      return res.json({ status: 'skipped', reason: 'No statements in pool' });
    }
    console.log(`[advance-duel] Statement "${statement.statement_text.slice(0, 30)}..." for ${cloakAddress.slice(0, 14)}... [${elapsed()}]`);

    // 2. Encode text to 4 Field parts + compute Pedersen hash
    const parts = textToFieldParts(statement.statement_text);
    const hash = await computeStatementHash(parts);
    console.log(`[advance-duel] Hash computed: ${hash.toString().slice(0, 14)}... [${elapsed()}]`);

    // 3. Get keeper wallet + load contract
    const wallet = await getKeeperWallet();
    const keeperAddress = getKeeperAddress();
    const paymentMethod = getPaymentMethod();
    const artifact = await getDuelCloakArtifact();

    // Register contract with PXE if needed
    const cloakAddr = AztecAddress.fromString(cloakAddress);
    const { getNode } = await import('../lib/keeper/wallet.js');
    const node = await getNode();
    try {
      const instance = await node.getContract(cloakAddr);
      if (instance) {
        await wallet.registerContract(instance as any, artifact as any);
      }
    } catch { /* non-fatal — may already be registered */ }

    const contract = await Contract.at(cloakAddr, artifact, wallet);
    console.log(`[advance-duel] Contract loaded [${elapsed()}]`);

    const sendOpts: any = { from: keeperAddress };
    if (paymentMethod) sendOpts.fee = { paymentMethod };

    // 4. Submit + start duel in a single tx (saves ~30s vs two separate txs)
    console.log(`[advance-duel] Submitting and starting duel... [${elapsed()}]`);
    await contract.methods.submit_and_start_duel(parts[0], parts[1], parts[2], parts[3]).send(sendOpts);
    console.log(`[advance-duel] Duel started [${elapsed()}]`);

    await markStatementOnChain(cloakAddress, statement.statement_hash);

    // 6. Get duel ID from the snapshot count (new duel = previous count)
    let duelId = 0;
    try {
      const { getSnapshotCount } = await import('../lib/db/duelSnapshotSync');
      duelId = await getSnapshotCount(cloakAddress);
    } catch { /* use 0 as fallback */ }

    // 7. Mark statement as used and advance schedule
    await markStatementUsed(cloakAddress, statement.statement_hash, duelId);
    await advanceSchedule(cloakAddress);

    // 8. Create duel snapshot in DB
    const store = getKeeperStore();
    const entry = await store.get(cloakAddress);
    await upsertDuelSnapshot({
      cloakAddress,
      cloakName: entry?.cloakName || '',
      cloakSlug: entry?.cloakSlug || '',
      duelId,
      statementText: statement.statement_text,
      startBlock: 0,
      endBlock: 0,
      totalVotes: 0,
      agreeVotes: 0,
      disagreeVotes: 0,
      isTallied: false,
    });

    // 9. Insert initial 50% timeline snapshot
    await insertTimelineSnapshot(cloakAddress, duelId, 0, 0, 0);

    console.log(`[advance-duel] Duel #${duelId} started for ${cloakAddress.slice(0, 14)}... [${elapsed()}]`);

    return res.json({
      status: 'success',
      duelId,
      statementId: statement.id,
      statementHash: statement.statement_hash,
    });
  } catch (err: any) {
    console.error(`[advance-duel] Error [${elapsed()}]:`, err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
