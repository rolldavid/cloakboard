/**
 * POST /api/deploy-cloak
 *
 * Server-side DuelCloak deployment using keeper's Schnorr account.
 * The DuelCloak constructor is public so the keeper can deploy it.
 * V6: Constructor inlines the first duel — no separate advance-duel tx needed.
 * Statements are accepted in the deploy request and inserted to DB immediately.
 */

import { Router, type Request, type Response } from 'express';
import { requireKeeperOrUserAuth } from '../middleware/auth.js';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { Contract } from '@aztec/aztec.js/contracts';
import { upsertDuelSchedule } from '../lib/db/duelSchedule.js';
import { getKeeperWallet, getKeeperAddress, getPaymentMethod } from '../lib/keeper/wallet.js';
import { getKeeperStore } from '../lib/keeper/store.js';
import { pool } from '../lib/db/pool.js';
import { insertStatement, markStatementOnChain, markStatementUsed } from '../lib/db/statements.js';
import { upsertDuelSnapshot } from '../lib/db/duelSnapshotSync.js';
import { insertTimelineSnapshot } from '../lib/db/voteTimeline.js';

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

/**
 * Encode a statement string into 4 Field elements (31 bytes each, 124 chars max).
 * Matches the on-chain Pedersen hash: pedersen_hash([part1, part2, part3, part4])
 */
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

router.post('/', requireKeeperOrUserAuth, async (req: Request, res: Response) => {
  const { name, duelDuration, firstDuelBlock, visibility, accountClassId, tallyMode, creatorAddress, statements } = req.body;

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

    const isPublic = visibility !== 'private';
    const resolvedTallyMode = tallyMode ?? 0;

    // 5. Determine first statement for inline duel creation
    //    If firstDuelBlock > 0 (future start date), pass zeros — keeper cron handles it later
    const statementsArr: string[] = Array.isArray(statements) ? statements.filter((s: any) => typeof s === 'string' && s.trim()) : [];
    const firstStatementText = statementsArr.length > 0 && firstDuelBlock === 0 ? statementsArr[0].trim() : '';
    let firstStmtParts: [Fr, Fr, Fr, Fr];
    if (firstStatementText) {
      firstStmtParts = textToFieldParts(firstStatementText);
      console.log(`[deploy-cloak] First statement inlined: "${firstStatementText.slice(0, 30)}..." [${elapsed()}]`);
    } else {
      firstStmtParts = [Fr.ZERO, Fr.ZERO, Fr.ZERO, Fr.ZERO];
    }

    // 6. Compute deterministic address FIRST (no RPC needed — sub-second)
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
      firstStmtParts[0],                               // first_stmt_1: Field
      firstStmtParts[1],                               // first_stmt_2: Field
      firstStmtParts[2],                               // first_stmt_3: Field
      firstStmtParts[3],                               // first_stmt_4: Field
    ];

    const salt = Fr.random();
    const deployTx = Contract.deploy(wallet, artifact, constructorArgs);
    const instance = await deployTx.getInstance({
      contractAddressSalt: salt,
      skipClassPublication: true,
    });
    const address = instance.address.toString();
    console.log(`[deploy-cloak] Address computed: ${address.slice(0, 14)}... [${elapsed()}]`);

    // 7. Create DB records + insert statements BEFORE responding
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
      const creatorName = (req.headers['x-user-name'] as string) || (req.body.creatorName as string) || null;
      await pool.query(
        `INSERT INTO council_members (cloak_address, user_address, username, role)
         VALUES ($1, $2, $3, 3)
         ON CONFLICT (cloak_address, user_address) DO UPDATE SET username = COALESCE($3, council_members.username)`,
        [address, creatorAddress, creatorName],
      );
    } catch (dbErr: any) {
      console.warn(`[deploy-cloak] Council record failed (non-fatal): ${dbErr?.message}`);
    }

    // Insert all statements to DB immediately (before responding to client)
    for (const text of statementsArr) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      try {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(trimmed);
        const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
        const hashHex = '0x' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        await insertStatement(address, hashHex, trimmed);
      } catch (stmtErr: any) {
        console.warn(`[deploy-cloak] Statement insert failed (non-fatal): ${stmtErr?.message}`);
      }
    }
    console.log(`[deploy-cloak] ${statementsArr.length} statements inserted to DB [${elapsed()}]`);

    // Respond to client NOW — deploy tx runs in background
    console.log(`[deploy-cloak] Responding to client [${elapsed()}]`);
    res.json({ address, txHash: '' });

    // 8. Fire-and-forget: deploy tx (prove + send + mine) in background
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
        return;
      }

      // If first duel was inlined in constructor, create DB snapshot directly
      if (firstStatementText) {
        try {
          // Mark first statement as on-chain + used
          const encoder = new TextEncoder();
          const bytes = encoder.encode(firstStatementText);
          const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
          const hashHex = '0x' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
          await markStatementOnChain(address, hashHex);
          await markStatementUsed(address, hashHex, 0);

          // Create duel snapshot in DB
          await upsertDuelSnapshot({
            cloakAddress: address,
            cloakName: name,
            cloakSlug: slug,
            duelId: 0,
            statementText: firstStatementText,
            startBlock: 0,
            endBlock: 0,
            totalVotes: 0,
            agreeVotes: 0,
            disagreeVotes: 0,
            isTallied: false,
          });

          // Insert initial 50% timeline snapshot
          await insertTimelineSnapshot(address, 0, 0, 0, 0);

          console.log(`[deploy-cloak] First duel snapshot created for ${address.slice(0, 14)}... [${elapsed()}]`);
        } catch (snapErr: any) {
          console.warn(`[deploy-cloak] First duel snapshot failed (non-fatal): ${snapErr?.message}`);
        }
      } else {
        // No inline duel — fall back to advance-duel via keeper cron
        console.log(`[deploy-cloak] No inline duel (future start or no statements), keeper cron will handle [${elapsed()}]`);
      }
    })();

    return;
  } catch (err: any) {
    console.error(`[deploy-cloak] Error [${elapsed()}]:`, err?.message);
    return res.status(500).json({ error: 'Cloak deployment failed' });
  }
});

export default router;
