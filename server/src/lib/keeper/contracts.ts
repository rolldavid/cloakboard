/**
 * Shared keeper contract registration — eliminates duplicate artifact loading
 * and name-stripping logic across createDuelOnChain, keeperFinalize, and keeperStaking.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getKeeperWallet, getNode } from './wallet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Strip __aztec_nr_internals__ prefix from function names (MUST match SDK selectors). */
function loadAndCleanArtifact(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
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

// ─── DuelCloak singleton ───

let _duelCloakContract: Contract | null = null;
let _duelCloakPromise: Promise<Contract> | null = null;

export function getDuelCloakArtifact() {
  return loadAndCleanArtifact(resolve(__dirname, '../aztec/artifacts/DuelCloak.json'));
}

export async function getKeeperDuelCloakContract(): Promise<Contract> {
  if (_duelCloakContract) return _duelCloakContract;
  if (_duelCloakPromise) return _duelCloakPromise;

  _duelCloakPromise = (async () => {
    const duelCloakAddress = process.env.VITE_DUELCLOAK_ADDRESS;
    if (!duelCloakAddress) throw new Error('VITE_DUELCLOAK_ADDRESS not set');

    const wallet = await getKeeperWallet();
    const node = await getNode();
    const addr = AztecAddress.fromString(duelCloakAddress);
    const artifact = getDuelCloakArtifact();

    const instance = await node.getContract(addr);
    if (!instance) throw new Error(`DuelCloak contract not found on-chain at ${duelCloakAddress}`);

    try {
      await wallet.registerContract(instance as any, artifact as any);
      console.log('[keeper/contracts] DuelCloak registered with keeper PXE');
    } catch (err: any) {
      if (!err?.message?.includes('already')) {
        console.warn('[keeper/contracts] DuelCloak registration warning:', err?.message);
      }
    }

    _duelCloakContract = await Contract.at(addr, artifact, wallet);
    return _duelCloakContract!;
  })();

  try {
    return await _duelCloakPromise;
  } catch (err) {
    _duelCloakPromise = null;
    throw err;
  }
}

// ─── UserProfile singleton ───

let _userProfileContract: Contract | null = null;
let _userProfilePromise: Promise<Contract> | null = null;

export async function getKeeperUserProfileContract(): Promise<Contract> {
  if (_userProfileContract) return _userProfileContract;
  if (_userProfilePromise) return _userProfilePromise;

  _userProfilePromise = (async () => {
    const userProfileAddress = process.env.VITE_USER_PROFILE_ADDRESS;
    if (!userProfileAddress) throw new Error('VITE_USER_PROFILE_ADDRESS not set');

    const wallet = await getKeeperWallet();
    const node = await getNode();
    const addr = AztecAddress.fromString(userProfileAddress);
    const artifact = loadAndCleanArtifact(resolve(__dirname, '../aztec/artifacts/UserProfile.json'));

    const instance = await node.getContract(addr);
    if (!instance) throw new Error(`UserProfile contract not found on-chain at ${userProfileAddress}`);

    try {
      await wallet.registerContract(instance as any, artifact as any);
      console.log('[keeper/contracts] UserProfile registered with keeper PXE');
    } catch (err: any) {
      if (!err?.message?.includes('already')) {
        console.warn('[keeper/contracts] UserProfile registration warning:', err?.message);
      }
    }

    _userProfileContract = await Contract.at(addr, artifact, wallet);
    return _userProfileContract!;
  })();

  try {
    return await _userProfilePromise;
  } catch (err) {
    _userProfilePromise = null;
    throw err;
  }
}
