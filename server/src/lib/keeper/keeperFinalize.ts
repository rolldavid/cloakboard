/**
 * Keeper Finalize — On-chain finalize_duel and refund_duel via keeper wallet.
 *
 * finalize_duel: public function, records winning direction after duel ends
 * refund_duel: public function, marks duel as refunded (tie/insufficient votes)
 *
 * Both are fire-and-forget with NO_WAIT.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, NO_WAIT } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getKeeperWallet, getNode, getPaymentMethod, getKeeperAddress } from './wallet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Singleton DuelCloak contract registration ───

let _contract: Contract | null = null;
let _contractPromise: Promise<Contract> | null = null;

function loadDuelCloakArtifact() {
  const artifactPath = resolve(__dirname, '../aztec/artifacts/DuelCloak.json');
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

async function getDuelCloakContract(): Promise<Contract> {
  if (_contract) return _contract;
  if (_contractPromise) return _contractPromise;

  _contractPromise = (async () => {
    const duelCloakAddress = process.env.VITE_DUELCLOAK_ADDRESS;
    if (!duelCloakAddress) throw new Error('VITE_DUELCLOAK_ADDRESS not set');

    const wallet = await getKeeperWallet();
    const node = await getNode();
    const addr = AztecAddress.fromString(duelCloakAddress);
    const artifact = loadDuelCloakArtifact();

    const instance = await node.getContract(addr);
    if (!instance) throw new Error(`DuelCloak contract not found on-chain at ${duelCloakAddress}`);

    try {
      await wallet.registerContract(instance as any, artifact as any);
      console.log('[keeperFinalize] DuelCloak registered with keeper PXE');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (!msg.includes('already')) {
        console.warn('[keeperFinalize] Registration warning:', msg);
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
  const contract = await getDuelCloakContract();
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
  const contract = await getDuelCloakContract();
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
