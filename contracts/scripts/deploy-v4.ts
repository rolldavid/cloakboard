#!/usr/bin/env node
/**
 * DuelCloak V4 Upgrade Deployment
 *
 * Reuses existing keeper wallet, FPC, and MultiAuth class.
 * Only publishes the new V4 DuelCloak contract class and deploys a new instance.
 *
 * V4 changes: All view functions changed from #[external("public")] #[view] to
 * #[external("utility")] unconstrained — fixes empty return values from server-side
 * simulate() calls.
 *
 * Usage: cd contracts && npx tsx scripts/deploy-v4.ts
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee/testing';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getContractInstanceFromInstantiationParams, getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { publishContractClass } from '@aztec/aztec.js/deployment';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com';
const KEEPER_SECRET_KEY = process.env.KEEPER_SECRET_KEY!;
const KEEPER_SIGNING_KEY = process.env.KEEPER_SIGNING_KEY!;
const KEEPER_SALT = process.env.KEEPER_SALT!;
const KEEPER_ADDRESS = process.env.KEEPER_ADDRESS!;
const FPC_ADDRESS = process.env.VITE_SPONSORED_FPC_ADDRESS!;
const MULTI_AUTH_CLASS_ID = process.env.VITE_MULTI_AUTH_CLASS_ID!;

if (!KEEPER_SECRET_KEY || !KEEPER_SIGNING_KEY || !KEEPER_SALT) {
  console.error('Missing keeper keys in server/.env.local');
  process.exit(1);
}

async function loadArtifact(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  raw.transpiled = true;
  // Strip __aztec_nr_internals__ prefix (should already be stripped, but just in case)
  if (raw.functions) {
    for (const fn of raw.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  return loadContractArtifact(raw);
}

function patchWallet(wallet: any) {
  const pxe = wallet.pxe;
  if (!wallet.getContractClassMetadata) {
    wallet.getContractClassMetadata = async (id: any) => pxe.getContractClassMetadata(id);
  }
  if (!wallet.getContractMetadata) {
    wallet.getContractMetadata = async (addr: any) => pxe.getContractMetadata(addr);
  }
  return wallet;
}

async function main() {
  console.log('='.repeat(60));
  console.log('DuelCloak V4 Upgrade Deployment');
  console.log('='.repeat(60));
  console.log(`L2 Node: ${NODE_URL}`);
  console.log(`Keeper:  ${KEEPER_ADDRESS}`);
  console.log('');

  // Connect to node
  console.log('[1/4] Connecting to L2 node...');
  const node = createAztecNodeClient(NODE_URL);
  const blockNum = await node.getBlockNumber();
  console.log(`  Connected! Block: ${blockNum}`);

  // Restore keeper wallet
  console.log('[2/4] Restoring keeper wallet...');
  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const salt = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);
  const keeperAddress = AztecAddress.fromString(KEEPER_ADDRESS);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const patchedWallet = patchWallet(wallet);

  // Register keeper account
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const accountContract = accountManager.getAccountContract();
  const keeperInstance = accountManager.getInstance();
  const keeperArtifact = await accountContract.getContractArtifact();
  await wallet.registerContract(keeperInstance, keeperArtifact, secretKey);
  console.log(`  Keeper wallet restored: ${keeperAddress.toString()}`);

  // Register FPC
  const fpcAddress = AztecAddress.fromString(FPC_ADDRESS);
  const fpcCanonical = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) }
  );
  await wallet.registerContract(fpcCanonical, SponsoredFPCContract.artifact);
  const sponsoredPayment = new SponsoredFeePaymentMethod(fpcAddress);

  // Publish new V4 DuelCloak class
  console.log('[3/4] Publishing V4 DuelCloak class...');
  const artifactPath = resolve(__dirname, '../target/duel_cloak-duel_cloak.json');
  const duelCloakArtifact = await loadArtifact(artifactPath);

  const contractClass = await getContractClassFromArtifact(duelCloakArtifact);
  const classId = contractClass.id.toString();
  console.log(`  New class ID: ${classId}`);

  let published = false;
  try {
    const meta = await patchedWallet.getContractClassMetadata(contractClass.id);
    published = meta && meta.isContractClassPubliclyRegistered;
  } catch {}

  if (published) {
    console.log('  V4 class already published');
  } else {
    try {
      const tx = await publishContractClass(patchedWallet, duelCloakArtifact);
      await tx.send({ from: keeperAddress, fee: { paymentMethod: sponsoredPayment } });
      console.log('  V4 class published!');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Existing nullifier') || msg.includes('already registered') || msg.includes('app_logic_reverted')) {
        console.log('  V4 class already published (nullifier exists)');
      } else {
        throw err;
      }
    }
  }

  // Deploy new V4 DuelCloak instance
  console.log('[4/4] Deploying V4 DuelCloak instance...');
  const constructorArgs = [
    'DuelCloak',            // name: str<31>
    100,                    // duel_duration: u32
    1,                      // first_duel_block: u32
    true,                   // is_publicly_viewable: bool
    keeperAddress,          // keeper_address: AztecAddress
    BigInt(MULTI_AUTH_CLASS_ID), // allowed_account_class_id: Field
    0,                      // _tally_mode: u8 (unused, backward compat)
    keeperAddress,          // creator: AztecAddress
  ];

  const duelCloakDeploy = Contract.deploy(patchedWallet, duelCloakArtifact, constructorArgs);
  const duelCloakInstance = await duelCloakDeploy.getInstance({
    contractAddressSalt: Fr.random(),
  });
  console.log(`  Expected address: ${duelCloakInstance.address.toString()}`);

  let duelCloakAddress: string;
  try {
    const deployed = await duelCloakDeploy.send({
      skipClassPublication: true,
      skipInstancePublication: false,
      from: keeperAddress,
      fee: { paymentMethod: sponsoredPayment },
    });
    duelCloakAddress = deployed.address.toString();
    console.log(`  V4 DuelCloak deployed at: ${duelCloakAddress}`);
  } catch (deployErr: any) {
    // Check if it was actually deployed despite the error
    const onChain = await node.getContract(duelCloakInstance.address);
    if (onChain) {
      duelCloakAddress = duelCloakInstance.address.toString();
      console.log(`  V4 DuelCloak deployed at: ${duelCloakAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // Update .env.local files
  console.log('\nUpdating .env.local files...');

  // Update server/.env.local
  const serverEnvPath = resolve(__dirname, '../../server/.env.local');
  let serverEnv = readFileSync(serverEnvPath, 'utf-8');
  serverEnv = serverEnv.replace(
    /VITE_DUELCLOAK_ADDRESS=.*/,
    `VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}`
  );
  // Also update the class ID
  if (serverEnv.includes('VITE_DUELCLOAK_CLASS_ID=')) {
    serverEnv = serverEnv.replace(
      /VITE_DUELCLOAK_CLASS_ID=.*/,
      `VITE_DUELCLOAK_CLASS_ID=${classId}`
    );
  } else {
    serverEnv += `\nVITE_DUELCLOAK_CLASS_ID=${classId}\n`;
  }
  writeFileSync(serverEnvPath, serverEnv);
  console.log(`  Updated: ${serverEnvPath}`);

  // Update app/.env.local
  const appEnvPath = resolve(__dirname, '../../app/.env.local');
  let appEnv = readFileSync(appEnvPath, 'utf-8');
  appEnv = appEnv.replace(
    /VITE_DUELCLOAK_ADDRESS=.*/,
    `VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}`
  );
  if (appEnv.includes('VITE_DUELCLOAK_CLASS_ID=')) {
    appEnv = appEnv.replace(
      /VITE_DUELCLOAK_CLASS_ID=.*/,
      `VITE_DUELCLOAK_CLASS_ID=${classId}`
    );
  } else {
    appEnv += `\nVITE_DUELCLOAK_CLASS_ID=${classId}\n`;
  }
  writeFileSync(appEnvPath, appEnv);
  console.log(`  Updated: ${appEnvPath}`);

  console.log('');
  console.log('='.repeat(60));
  console.log('V4 DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`  NEW VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}`);
  console.log(`  NEW VITE_DUELCLOAK_CLASS_ID=${classId}`);
  console.log(`  KEEPER_ADDRESS=${KEEPER_ADDRESS}`);
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${FPC_ADDRESS}`);
  console.log(`  VITE_MULTI_AUTH_CLASS_ID=${MULTI_AUTH_CLASS_ID}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nDeployment failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
