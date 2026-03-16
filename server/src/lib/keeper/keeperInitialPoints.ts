/**
 * Keeper Initial Points — Grant 500 starting points to new users.
 *
 * grant_initial_points: private function on UserProfile contract.
 * Keeper's PXE generates the proof, PointNote encrypted to user.
 * Requires user's complete address to be registered with PXE.
 *
 * Uses the same UserProfile contract singleton as keeperStaking.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getKeeperWallet, getNode, getPaymentMethod, getKeeperAddress } from './wallet.js';
import { pool } from '../db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Singleton UserProfile contract registration ───

let _contract: Contract | null = null;
let _contractPromise: Promise<Contract> | null = null;

function loadUserProfileArtifact() {
  const artifactPath = resolve(__dirname, '../aztec/artifacts/UserProfile.json');
  const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  raw.transpiled = true;
  if (raw.functions) {
    for (const fn of raw.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  return loadContractArtifact(raw);
}

async function getUserProfileContract(): Promise<Contract> {
  if (_contract) return _contract;
  if (_contractPromise) return _contractPromise;

  _contractPromise = (async () => {
    const userProfileAddress = process.env.VITE_USER_PROFILE_ADDRESS;
    if (!userProfileAddress) throw new Error('VITE_USER_PROFILE_ADDRESS not set');

    const wallet = await getKeeperWallet();
    const node = await getNode();
    const addr = AztecAddress.fromString(userProfileAddress);
    const artifact = loadUserProfileArtifact();

    const instance = await node.getContract(addr);
    if (!instance) throw new Error(`UserProfile contract not found on-chain at ${userProfileAddress}`);

    try {
      await wallet.registerContract(instance as any, artifact as any);
      console.log('[keeperInitialPoints] UserProfile registered with keeper PXE');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (!msg.includes('already')) {
        console.warn('[keeperInitialPoints] Registration warning:', msg);
      }
    }

    _contract = await Contract.at(addr, artifact, wallet);
    return _contract!;
  })();

  try {
    return await _contractPromise;
  } catch (err) {
    _contractPromise = null;
    throw err;
  }
}

// ─── Initial points grant ───

const INITIAL_POINTS_AMOUNT = 500;

/**
 * Check if initial points have already been granted to an address (DB check).
 */
export async function isInitialPointsGranted(address: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM initial_point_grants WHERE address = $1',
    [address],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Grant initial points to a new user. Fire-and-forget on-chain call.
 * Records grant in DB to prevent double-granting.
 * On-chain contract also has its own double-grant check (belt + suspenders).
 */
export async function keeperGrantInitialPoints(userAddress: string): Promise<void> {
  // DB check first (fast, prevents unnecessary on-chain call)
  if (await isInitialPointsGranted(userAddress)) {
    console.log(`[keeperInitialPoints] Already granted to ${userAddress.slice(0, 14)}...`);
    return;
  }

  const contract = await getUserProfileContract();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();
  const wallet = await getKeeperWallet();
  const node = await getNode();

  const user = AztecAddress.fromString(userAddress);

  // Register user as sender so keeper PXE can look up their public keys for note encryption
  try {
    await wallet.registerSender(user, 'grant-recipient');
  } catch { /* non-fatal -- user may already be registered */ }

  const sendOpts: any = {
    ...(keeperAddress ? { from: keeperAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  await contract.methods
    .grant_initial_points(user, BigInt(INITIAL_POINTS_AMOUNT))
    .send(sendOpts);

  // Record in DB (ON CONFLICT DO NOTHING handles races)
  await pool.query(
    'INSERT INTO initial_point_grants (address) VALUES ($1) ON CONFLICT DO NOTHING',
    [userAddress],
  );

  console.log(`[keeperInitialPoints] grant_initial_points sent: user=${userAddress.slice(0, 14)}..., amount=${INITIAL_POINTS_AMOUNT}`);
}
