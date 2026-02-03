import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { Fr } from '@aztec/aztec.js/fields';
import { getSponsoredFpcAddress as getSponsoredFpcAddressFromConfig, getConfig } from '../config/config.js';
import type { Wallet } from '@aztec/aztec.js';

/**
 * Get SponsoredFPC contract instance from configured address
 */
export async function getSponsoredFPCInstance(wallet: Wallet) {
  const config = getConfig();
  const fpcAddress = getSponsoredFpcAddressFromConfig();

  if (!fpcAddress) {
    throw new Error(`No FPC address configured for ${config.environment}`);
  }

  console.log(`Using Sponsored FPC at: ${fpcAddress}`);

  const address = AztecAddress.fromString(fpcAddress);
  return SponsoredFPCContract.at(address, wallet);
}

/**
 * Get a SponsoredFPC contract instance by computing from artifact
 * Used for registering contracts before they exist
 */
export async function getSponsoredFPCInstanceFromParams() {
  const fpcAddress = getSponsoredFpcAddressFromConfig();

  if (!fpcAddress) {
    throw new Error(`No FPC address configured`);
  }

  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) }
  );

  return instance;
}

/**
 * Get the configured FPC address
 */
export function getSponsoredFPCAddress(): AztecAddress | null {
  const address = getSponsoredFpcAddressFromConfig();
  if (!address) return null;
  return AztecAddress.fromString(address);
}

/**
 * Check if an FPC is configured for the current environment
 */
export function hasFPCConfigured(): boolean {
  return !!getSponsoredFpcAddressFromConfig();
}
