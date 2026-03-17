/**
 * Keeper Finalize — On-chain finalize_duel and refund_duel via keeper wallet.
 *
 * finalize_duel: public function, records winning direction after duel ends
 * refund_duel: public function, marks duel as refunded (tie/insufficient votes)
 *
 * Both are fire-and-forget with NO_WAIT.
 */

import { Fr } from '@aztec/foundation/curves/bn254';
import { NO_WAIT } from '@aztec/aztec.js/contracts';

import { getPaymentMethod, getKeeperAddress } from './wallet.js';
import { getKeeperDuelCloakContract } from './contracts.js';

// ─── Keeper finalization functions ───

/**
 * Finalize a duel on-chain — records the winning direction.
 * Binary: 1 = agree wins, 0 = disagree wins.
 * Multi/level: winning option/level index.
 */
export async function keeperFinalizeDuel(
  onChainId: number,
  winningDirection: number,
): Promise<void> {
  const contract = await getKeeperDuelCloakContract();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();

  const sendOpts: any = {
    ...(keeperAddress ? { from: keeperAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  await contract.methods
    .finalize_duel(new Fr(BigInt(onChainId)), new Fr(BigInt(winningDirection)))
    .send(sendOpts);

  console.log(`[keeperFinalize] finalize_duel sent: onChainId=${onChainId}, winning=${winningDirection}`);
}

/**
 * Refund a duel on-chain — marks as refunded (tie or insufficient votes).
 */
export async function keeperRefundDuel(onChainId: number): Promise<void> {
  const contract = await getKeeperDuelCloakContract();
  const keeperAddress = getKeeperAddress();
  const paymentMethod = getPaymentMethod();

  const sendOpts: any = {
    ...(keeperAddress ? { from: keeperAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  await contract.methods
    .refund_duel(new Fr(BigInt(onChainId)))
    .send(sendOpts);

  console.log(`[keeperFinalize] refund_duel sent: onChainId=${onChainId}`);
}
