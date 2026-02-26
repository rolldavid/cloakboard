/**
 * POST /api/deploy-cloak
 *
 * Server-side DuelCloak deployment using keeper's Schnorr account.
 * The DuelCloak constructor is public so the keeper can deploy it.
 * Also creates duel_schedule entry for auto-advance.
 */

import { Router, type Request, type Response } from 'express';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { Contract } from '@aztec/aztec.js/contracts';
import { upsertDuelSchedule } from '../lib/db/duelSchedule.js';
import { getKeeperWallet, getKeeperAddress, getPaymentMethod } from '../lib/keeper/wallet.js';
import { getKeeperStore } from '../lib/keeper/store.js';
import { pool } from '../lib/db/pool.js';

const router = Router();

// Lazy-load artifact
let _artifact: any = null;
async function getDuelCloakArtifact(): Promise<any> {
  if (!_artifact) {
    const { readFileSync } = await import('fs');
    const { dirname, resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    // Artifacts are co-located in server/src/lib/aztec/artifacts/
    const artifactPath = resolve(dirname(__filename), '../lib/aztec/artifacts/DuelCloak.json');
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    raw.transpiled = true;
    _artifact = loadContractArtifact(raw);
  }
  return _artifact;
}

router.post('/', async (req: Request, res: Response) => {
  const { name, duelDuration, firstDuelBlock, visibility, accountClassId, tallyMode, creatorAddress } = req.body;

  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name' });
  if (typeof duelDuration !== 'number') return res.status(400).json({ error: 'Missing duelDuration' });
  if (typeof firstDuelBlock !== 'number') return res.status(400).json({ error: 'Missing firstDuelBlock' });
  if (!creatorAddress) return res.status(400).json({ error: 'Missing creatorAddress' });

  if (!process.env.KEEPER_SECRET_KEY || !process.env.KEEPER_SIGNING_KEY || !process.env.KEEPER_SALT) {
    return res.status(500).json({ error: 'Keeper keys not configured' });
  }

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    console.log(`[deploy-cloak] Starting deployment of "${name}"... [${elapsed()}]`);

    // 1. Get keeper wallet (lazily initializes node + EmbeddedWallet)
    const wallet = await getKeeperWallet();
    const keeperAddress = getKeeperAddress();
    const paymentMethod = getPaymentMethod();
    console.log(`[deploy-cloak] Keeper wallet ready [${elapsed()}]`);

    // 2. Load artifact
    const artifact = await getDuelCloakArtifact();
    console.log(`[deploy-cloak] Artifact loaded [${elapsed()}]`);

    // 3. Resolve the allowed account class ID (client may send a label; always prefer env var)
    const resolvedClassId = process.env.VITE_MULTI_AUTH_CLASS_ID
      || (accountClassId?.startsWith('0x') ? accountClassId : '0x0');

    // 4. Resolve the creator address (fallback to zero if display-only short hash)
    let creatorAddr: AztecAddress;
    try {
      creatorAddr = AztecAddress.fromString(creatorAddress);
    } catch {
      console.warn(`[deploy-cloak] Invalid creator address "${creatorAddress?.slice(0, 20)}...", using zero`);
      creatorAddr = AztecAddress.ZERO;
    }

    // 5. Deploy DuelCloak contract
    //    Constructor: (name: str<31>, duel_duration: u32, first_duel_block: u32,
    //                  is_publicly_viewable: bool, keeper_address: AztecAddress,
    //                  allowed_account_class_id: Field, tally_mode: u8, creator: AztecAddress)
    const isPublic = visibility !== 'private';
    const resolvedTallyMode = tallyMode ?? 0;

    // 5. Compute deterministic address FIRST (no RPC needed — sub-second)
    console.log(`[deploy-cloak] Computing contract address... [${elapsed()}]`);
    const constructorArgs = [
      name,                                            // name: str<31>
      duelDuration,                                    // duel_duration: u32
      firstDuelBlock,                                  // first_duel_block: u32
      isPublic,                                        // is_publicly_viewable: bool
      keeperAddress,                                   // keeper_address: AztecAddress
      Fr.fromString(resolvedClassId),                  // allowed_account_class_id: Field
      resolvedTallyMode,                               // tally_mode: u8
      creatorAddr,                                     // creator: AztecAddress
    ];

    const salt = Fr.random();
    const deployTx = Contract.deploy(wallet, artifact, constructorArgs);
    const instance = await deployTx.getInstance({
      contractAddressSalt: salt,
      skipClassPublication: true,
    });
    const address = instance.address.toString();
    console.log(`[deploy-cloak] Address computed: ${address.slice(0, 14)}... [${elapsed()}]`);

    // 6. Create DB records + respond IMMEDIATELY (before tx is sent/mined)
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    try {
      const intervalSeconds = duelDuration * 6;
      const firstDuelAt = new Date(Date.now() + Math.max(0, firstDuelBlock) * 6000);
      await upsertDuelSchedule(address, intervalSeconds, firstDuelAt);
    } catch (schedErr: any) {
      console.warn(`[deploy-cloak] Schedule creation failed (non-fatal): ${schedErr?.message}`);
    }

    try {
      const store = getKeeperStore();
      await store.add({
        cloakAddress: address,
        cloakName: name,
        cloakSlug: slug,
        tallyMode: resolvedTallyMode,
        senderAddresses: [],
      });
    } catch (storeErr: any) {
      console.warn(`[deploy-cloak] Keeper store registration failed (non-fatal): ${storeErr?.message}`);
    }

    try {
      await pool.query(
        `INSERT INTO council_members (cloak_address, user_address, role)
         VALUES ($1, $2, 3)
         ON CONFLICT (cloak_address, user_address) DO NOTHING`,
        [address, creatorAddress],
      );
    } catch (dbErr: any) {
      console.warn(`[deploy-cloak] Council record failed (non-fatal): ${dbErr?.message}`);
    }

    // Respond to client NOW — deploy tx runs in background
    console.log(`[deploy-cloak] Responding to client [${elapsed()}]`);
    res.json({ address, txHash: '' });

    // 7. Fire-and-forget: deploy tx (prove + send + mine) in background
    (async () => {
      try {
        const sendOpts: any = {
          contractAddressSalt: salt,
          from: keeperAddress,
          skipClassPublication: true,
          skipInstancePublication: false,
        };
        if (paymentMethod) sendOpts.fee = { paymentMethod };

        console.log(`[deploy-cloak] Sending deploy tx in background... [${elapsed()}]`);
        await deployTx.send(sendOpts);
        console.log(`[deploy-cloak] Deploy tx confirmed [${elapsed()}]`);
      } catch (deployErr: any) {
        console.error(`[deploy-cloak] Background deploy failed: ${deployErr?.message}`);
      }

      // After deploy confirms, start the first duel
      try {
        // Wait for statements to arrive from client
        await new Promise(r => setTimeout(r, 5000));
        console.log(`[deploy-cloak] Starting first duel for ${address.slice(0, 14)}...`);
        const port = process.env.PORT || 3001;
        const advanceResp = await fetch(`http://localhost:${port}/api/advance-duel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cloakAddress: address }),
        });
        const advanceResult = await advanceResp.json();
        console.log(`[deploy-cloak] First duel result:`, advanceResult.status, advanceResult.reason || '');
      } catch (advErr: any) {
        console.warn(`[deploy-cloak] First duel advance failed (non-fatal): ${advErr?.message}`);
      }
    })();

    return;
  } catch (err: any) {
    console.error(`[deploy-cloak] Error [${elapsed()}]:`, err?.message);
    return res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
});

export default router;
