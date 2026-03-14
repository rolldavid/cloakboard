/**
 * POST /api/publish-account-class
 *
 * Publishes the MultiAuthAccount contract class on-chain using keeper.
 * Idempotent — returns early if class is already published.
 */

import { Router, type Request, type Response } from 'express';
import { requireKeeperOrUserAuth } from '../middleware/auth.js';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { getKeeperWallet, getNode, getPaymentMethod } from '../lib/keeper/wallet.js';

const router = Router();

let _artifact: any = null;
async function getMultiAuthArtifact(): Promise<any> {
  if (!_artifact) {
    const { readFileSync } = await import('fs');
    const { dirname, resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    // Artifacts are co-located in server/src/lib/aztec/artifacts/
    const artifactPath = resolve(dirname(__filename), '../lib/aztec/artifacts/MultiAuthAccount.json');
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    raw.transpiled = true;
    _artifact = loadContractArtifact(raw);
  }
  return _artifact;
}

router.post('/', requireKeeperOrUserAuth, async (req: Request, res: Response) => {
  if (!process.env.KEEPER_SECRET_KEY || !process.env.KEEPER_SIGNING_KEY || !process.env.KEEPER_SALT) {
    return res.status(500).json({ error: 'Keeper keys not configured' });
  }

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    console.log(`[publish-account-class] Starting... [${elapsed()}]`);

    const wallet = await getKeeperWallet();
    const node = await getNode();
    const artifact = await getMultiAuthArtifact();
    const paymentMethod = getPaymentMethod();

    // Check if class is already published
    const { getContractClassFromArtifact } = await import('@aztec/stdlib/contract');
    const contractClass = await getContractClassFromArtifact(artifact);
    const classId = contractClass.id.toString();

    try {
      const existing = await node.getContractClass(contractClass.id);
      if (existing) {
        console.log(`[publish-account-class] Already published: ${classId.slice(0, 14)}... [${elapsed()}]`);
        return res.json({ classId, alreadyPublished: true });
      }
    } catch {
      // Not found — continue to publish
    }

    // Publish the contract class
    console.log(`[publish-account-class] Publishing class... [${elapsed()}]`);
    const { publishContractClass } = await import('@aztec/aztec.js/deployment');

    const sendOpts: any = {};
    if (paymentMethod) sendOpts.fee = { paymentMethod };

    const { receipt } = await (await publishContractClass(wallet, artifact)).send(sendOpts);

    console.log(`[publish-account-class] Published: ${classId.slice(0, 14)}... [${elapsed()}]`);
    return res.json({ classId, alreadyPublished: false, txHash: receipt.txHash.toString() });
  } catch (err: any) {
    // Might already be published (race condition)
    if (err?.message?.includes('already registered') || err?.message?.includes('already published')) {
      return res.json({ classId: 'unknown', alreadyPublished: true });
    }
    console.error(`[publish-account-class] Error [${elapsed()}]:`, err?.message);
    return res.status(500).json({ error: 'Class publication failed' });
  }
});

export default router;
