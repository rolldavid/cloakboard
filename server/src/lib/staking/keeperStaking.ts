/**
 * Keeper Staking — On-chain resolve_stake and burn_stake via keeper wallet.
 *
 * resolve_stake: private function (mints PointNotes to staker), uses NO_WAIT
 * burn_stake: public function (marks stake as burned), uses NO_WAIT
 *
 * Both are fire-and-forget — the DB is the source of truth for resolution status.
 * On-chain calls ensure contract state stays in sync.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getKeeperWallet, getNode, getPaymentMethod, getKeeperAddress } from '../keeper/wallet.js';

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
      console.log('[keeperStaking] UserProfile registered with keeper PXE');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (!msg.includes('already')) {
        console.warn('[keeperStaking] Registration warning:', msg);
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

// ─── Keeper staking functions ───

/**
 * Resolve a successful stake — mints points back to staker via keeper.
 * Private function: keeper's PXE generates the proof, PointNote encrypted to staker.
 * Requires staker's complete address to be registered with PXE.
 */
export async function keeperResolveStake(
  duelId: number,
  stakerAddress: string,
  totalReturn: number,
): Promise<void> {
  const contract = await getUserProfileContract();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();
  const wallet = await getKeeperWallet();
  const node = await getNode();

  const staker = AztecAddress.fromString(stakerAddress);

  // Register staker as recipient so keeper PXE can encrypt notes for them
  try {
    const stakerInstance = await node.getContract(staker);
    if (stakerInstance) {
      // Register the staker's account contract so we can send them notes
      const completeAddr = await node.getRegisteredAccountPublicKeysHash(staker).catch(() => null);
      if (completeAddr) {
        await wallet.registerAccount(staker as any).catch(() => {});
      }
    }
  } catch { /* non-fatal — staker may already be registered */ }

  const sendOpts: any = {
    ...(keeperAddress ? { from: keeperAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  await contract.methods
    .resolve_stake(new Fr(BigInt(duelId)), staker, BigInt(totalReturn))
    .send(sendOpts);

  console.log(`[keeperStaking] resolve_stake sent: duel=${duelId}, staker=${stakerAddress.slice(0, 14)}..., return=${totalReturn}`);
}

/**
 * Burn a failed stake — marks stake as burned in public storage.
 * Public function: no private note emission, just public state update.
 */
export async function keeperBurnStake(duelId: number): Promise<void> {
  const contract = await getUserProfileContract();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();

  const sendOpts: any = {
    ...(keeperAddress ? { from: keeperAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  await contract.methods
    .burn_stake(new Fr(BigInt(duelId)))
    .send(sendOpts);

  console.log(`[keeperStaking] burn_stake sent: duel=${duelId}`);
}
