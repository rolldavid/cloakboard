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
import { NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

import { getKeeperWallet, getNode, getPaymentMethod, getKeeperAddress } from '../keeper/wallet.js';
import { getKeeperUserProfileContract } from '../keeper/contracts.js';

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
  const contract = await getKeeperUserProfileContract();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();
  const wallet = await getKeeperWallet();
  const node = await getNode();

  const staker = AztecAddress.fromString(stakerAddress);

  // Register staker as recipient so keeper PXE can encrypt notes for them
  try {
    const stakerInstance = await node.getContract(staker);
    if (stakerInstance) {
      await wallet.registerAccount(staker as any).catch(() => {});
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
  const contract = await getKeeperUserProfileContract();
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
