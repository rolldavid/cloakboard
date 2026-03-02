/**
 * POST /api/deploy-account
 *
 * Server-side MultiAuthAccount deployment using keeper's wallet.
 * Receives ONLY public data — no secret keys ever leave the browser.
 *
 * The keeper sends the deployment transaction so the user doesn't need
 * to pay gas or run a prover.
 */

import { Router, type Request, type Response } from 'express';
import { requireKeeperOrUserAuth } from '../middleware/auth.js';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { Contract } from '@aztec/aztec.js/contracts';
import { getKeeperWallet, getKeeperAddress, getNode, getPaymentMethod } from '../lib/keeper/wallet.js';

const router = Router();

// Lazy-load artifact
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
  const {
    salt, publicKeys, deployer, initializationHash,
    currentContractClassId, originalContractClassId,
    keyType, primaryKeyHash, labelHash,
  } = req.body;

  if (!salt || !publicKeys || keyType === undefined || !primaryKeyHash || !labelHash) {
    return res.status(400).json({ error: 'Missing required fields: salt, publicKeys, keyType, primaryKeyHash, labelHash' });
  }
  if (![0, 1, 2].includes(keyType)) {
    return res.status(400).json({ error: 'Invalid keyType. Must be 0, 1, or 2' });
  }
  if (!process.env.KEEPER_SECRET_KEY || !process.env.KEEPER_SIGNING_KEY || !process.env.KEEPER_SALT) {
    return res.status(500).json({ error: 'Keeper keys not configured' });
  }

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    console.log(`[deploy-account] Starting deployment (keyType=${keyType})... [${elapsed()}]`);

    // 1. Get keeper wallet
    const wallet = await getKeeperWallet();
    const node = await getNode();
    const paymentMethod = getPaymentMethod();
    console.log(`[deploy-account] Keeper wallet ready [${elapsed()}]`);

    // 2. Load artifact
    const artifact = await getMultiAuthArtifact();
    const userSalt = Fr.fromString(salt);

    // 3. Deploy the account contract
    //    Constructor: (key_type: u8, primary_key_hash: Field, label_hash: Field)
    console.log(`[deploy-account] Deploying account contract... [${elapsed()}]`);

    const deployTx = Contract.deploy(wallet, artifact, [
      keyType,                            // key_type: u8
      Fr.fromString(primaryKeyHash),      // primary_key_hash: Field
      Fr.fromString(labelHash),           // label_hash: Field
    ]);

    // Pass contractAddressSalt so the contract is deployed at the address
    // the client expects (matching deployCloak.ts pattern).
    const sendOpts: any = {
      contractAddressSalt: userSalt,
      from: getKeeperAddress(),
      skipClassPublication: true,
      skipInstancePublication: false,
    };
    if (paymentMethod) sendOpts.fee = { paymentMethod };

    const deployed = await deployTx.send(sendOpts);
    const address = deployed.address.toString();
    console.log(`[deploy-account] Deployed at ${address.slice(0, 14)}... [${elapsed()}]`);

    // 4. Verify constructor ran by checking key_count
    let constructorConfirmed = false;
    try {
      const keyCount = await node.getPublicStorageAt('latest', AztecAddress.fromString(address), new Fr(5n));
      constructorConfirmed = keyCount.toBigInt() > 0n;
      console.log(`[deploy-account] Constructor confirmed: ${constructorConfirmed} [${elapsed()}]`);
    } catch (checkErr: any) {
      console.warn(`[deploy-account] Constructor check failed (non-fatal): ${checkErr?.message}`);
    }

    return res.json({
      address,
      success: true,
      constructorConfirmed,
    });
  } catch (err: any) {
    const msg = err?.message ?? '';
    // Handle "already deployed" gracefully
    if (msg.includes('already deployed') || msg.includes('instance exists')) {
      return res.json({
        address: 'alreadyDeployed',
        success: true,
        constructorConfirmed: true,
      });
    }
    console.error(`[deploy-account] Error [${elapsed()}]:`, msg);
    return res.status(500).json({ error: 'Account deployment failed', detail: msg });
  }
});

export default router;
