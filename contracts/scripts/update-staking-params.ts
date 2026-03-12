#!/usr/bin/env node
/**
 * Update on-chain staking parameters via keeper.
 * Usage: cd contracts && npx tsx scripts/update-staking-params.ts
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee/testing';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

async function main() {
  const node = createAztecNodeClient(process.env.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com');
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });

  const secretKey = Fr.fromHexString(process.env.KEEPER_SECRET_KEY || '');
  const salt = Fr.fromHexString(process.env.KEEPER_SALT || '');
  const signingKey = GrumpkinScalar.fromHexString(process.env.KEEPER_SIGNING_KEY || '');
  const keeperAddress = AztecAddress.fromString(process.env.KEEPER_ADDRESS || '');
  const fpcAddress = AztecAddress.fromString(process.env.VITE_SPONSORED_FPC_ADDRESS || '');

  const am = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  await wallet.registerContract(am.getInstance(), await am.getAccountContract().getContractArtifact(), secretKey);

  const fpcCanonical = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(0) });
  await wallet.registerContract(fpcCanonical, SponsoredFPCContract.artifact);
  const payment = new SponsoredFeePaymentMethod(fpcAddress);

  const upAddr = AztecAddress.fromString(process.env.VITE_USER_PROFILE_ADDRESS || '');
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../target/user_profile-user_profile.json'), 'utf-8'));
  raw.transpiled = true;
  if (raw.functions) {
    for (const fn of raw.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  const artifact = loadContractArtifact(raw);

  const inst = await node.getContract(upAddr);
  if (inst) await wallet.registerContract(inst as any, artifact as any);

  const contract = await Contract.at(upAddr, artifact, wallet);
  console.log('Calling update_staking_params(10, 10)...');
  await contract.methods.update_staking_params(10, 10).send({
    from: keeperAddress,
    fee: { paymentMethod: payment },
  });
  console.log('Done! min_stake=10, min_votes_threshold=10');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
