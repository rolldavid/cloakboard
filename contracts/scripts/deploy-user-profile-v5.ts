#!/usr/bin/env node
/**
 * UserProfile V5 Contract Deployment — Eligibility Flag
 *
 * Reuses existing keeper wallet and FPC.
 * Publishes updated UserProfile class (with eligible_creators Map)
 * and deploys a new instance.
 *
 * NOTE: Redeploying UserProfile loses existing on-chain points (devnet-acceptable).
 * Users re-earn points through voting.
 *
 * Usage: cd contracts && npx tsx scripts/deploy-user-profile-v5.ts
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
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

if (!KEEPER_SECRET_KEY || !KEEPER_SIGNING_KEY || !KEEPER_SALT) {
  console.error('Missing keeper keys in server/.env.local');
  process.exit(1);
}

async function loadArtifact(path: string) {
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
  console.log('UserProfile V5 Contract Deployment (Eligibility Flag)');
  console.log('='.repeat(60));
  console.log(`L2 Node: ${NODE_URL}`);
  console.log(`Keeper:  ${KEEPER_ADDRESS}`);
  console.log('');

  // Connect to node
  console.log('[1/5] Connecting to L2 node...');
  const node = createAztecNodeClient(NODE_URL);
  const blockNum = await node.getBlockNumber();
  console.log(`  Connected! Block: ${blockNum}`);

  // Restore keeper wallet
  console.log('[2/5] Restoring keeper wallet...');
  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const salt = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);
  const keeperAddress = AztecAddress.fromString(KEEPER_ADDRESS);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const patchedWallet = patchWallet(wallet);

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
    { salt: new Fr(0) },
  );
  await wallet.registerContract(fpcCanonical, SponsoredFPCContract.artifact);
  const sponsoredPayment = new SponsoredFeePaymentMethod(fpcAddress);

  // Publish UserProfile V5 class
  console.log('[3/5] Publishing UserProfile V5 class...');
  const artifactPath = resolve(__dirname, '../target/user_profile-user_profile.json');
  const userProfileArtifact = await loadArtifact(artifactPath);

  const contractClass = await getContractClassFromArtifact(userProfileArtifact);
  const classId = contractClass.id.toString();
  console.log(`  Class ID: ${classId}`);

  let published = false;
  try {
    const meta = await patchedWallet.getContractClassMetadata(contractClass.id);
    published = meta && meta.isContractClassPubliclyRegistered;
  } catch {}

  if (published) {
    console.log('  UserProfile V5 class already published');
  } else {
    try {
      const tx = await publishContractClass(patchedWallet, userProfileArtifact);
      await tx.send({ from: keeperAddress, fee: { paymentMethod: sponsoredPayment } });
      console.log('  UserProfile V5 class published!');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Existing nullifier') || msg.includes('already registered') || msg.includes('app_logic_reverted')) {
        console.log('  UserProfile V5 class already published (nullifier exists)');
      } else {
        throw err;
      }
    }
  }

  // Deploy UserProfile V5 instance (no constructor args)
  console.log('[4/5] Deploying UserProfile V5 instance...');
  const userProfileDeploy = Contract.deploy(patchedWallet, userProfileArtifact, []);
  const userProfileInstance = await userProfileDeploy.getInstance({
    contractAddressSalt: Fr.random(),
  });
  console.log(`  Expected address: ${userProfileInstance.address.toString()}`);

  let userProfileAddress: string;
  try {
    const deployed = await userProfileDeploy.send({
      skipClassPublication: true,
      skipInstancePublication: false,
      from: keeperAddress,
      fee: { paymentMethod: sponsoredPayment },
    });
    userProfileAddress = deployed.address.toString();
    console.log(`  UserProfile V5 deployed at: ${userProfileAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(userProfileInstance.address);
    if (onChain) {
      userProfileAddress = userProfileInstance.address.toString();
      console.log(`  UserProfile V5 deployed at: ${userProfileAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // Copy artifact to app and server
  console.log('[5/5] Copying artifacts and updating .env files...');
  const strippedJson = readFileSync(artifactPath, 'utf-8');
  const parsed = JSON.parse(strippedJson);
  parsed.transpiled = true;
  if (parsed.functions) {
    for (const fn of parsed.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  const cleanJson = JSON.stringify(parsed);

  const appArtifactPath = resolve(__dirname, '../../app/src/lib/aztec/artifacts/UserProfile.json');
  writeFileSync(appArtifactPath, cleanJson);
  console.log(`  Copied artifact to: ${appArtifactPath}`);

  const serverArtifactPath = resolve(__dirname, '../../server/src/lib/aztec/artifacts/UserProfile.json');
  writeFileSync(serverArtifactPath, cleanJson);
  console.log(`  Copied artifact to: ${serverArtifactPath}`);

  // Update .env.local files
  const envFiles = [
    resolve(__dirname, '../../server/.env.local'),
    resolve(__dirname, '../../app/.env.local'),
  ];

  for (const envPath of envFiles) {
    let env = readFileSync(envPath, 'utf-8');
    if (env.includes('VITE_USER_PROFILE_ADDRESS=')) {
      env = env.replace(/VITE_USER_PROFILE_ADDRESS=.*/, `VITE_USER_PROFILE_ADDRESS=${userProfileAddress}`);
    } else {
      env = env.trimEnd() + `\nVITE_USER_PROFILE_ADDRESS=${userProfileAddress}\n`;
    }
    writeFileSync(envPath, env);
    console.log(`  Updated: ${envPath}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('USERPROFILE V5 DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`  VITE_USER_PROFILE_ADDRESS=${userProfileAddress}`);
  console.log(`  UserProfile V5 Class ID: ${classId}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart app and server to pick up new env vars');
  console.log('  2. Existing on-chain points are lost (devnet-acceptable)');
  console.log('  3. Users re-earn points through voting');
  console.log('  4. After 10+ votes, eligibility is certified automatically');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nDeployment failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
