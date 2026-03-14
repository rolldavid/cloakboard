#!/usr/bin/env node
/**
 * DuelCloak V8 + UserProfile V6 Combined Deployment
 *
 * Deploy order:
 * 1. Deploy UserProfile V6 with constructor(keeperAddress) -- no authorized_caller yet
 * 2. Deploy DuelCloak V8 with constructor(..., userProfileV6Address)
 * 3. Call UserProfile.set_authorized_caller(duelCloakV8Address) via keeper -- links them
 *
 * Reuses existing keeper wallet, FPC, and account class.
 * Copies artifacts to app/src/lib/aztec/artifacts/ and server/src/lib/aztec/artifacts/.
 *
 * Usage: cd contracts && npx tsx scripts/deploy-v8-combined.ts
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
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
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
  // Strip __aztec_nr_internals__ prefix -- MUST match SDK-computed selectors
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

function updateEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`${key}=.*`);
  if (content.match(regex)) {
    return content.replace(regex, `${key}=${value}`);
  }
  return content + `\n${key}=${value}\n`;
}

function copyArtifactClean(srcPath: string, destPath: string) {
  const raw = JSON.parse(readFileSync(srcPath, 'utf-8'));
  raw.transpiled = true;
  if (raw.functions) {
    for (const fn of raw.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  writeFileSync(destPath, JSON.stringify(raw));
}

async function publishClass(patchedWallet: any, artifact: any, label: string, keeperAddress: AztecAddress, sponsoredPayment: any) {
  const contractClass = await getContractClassFromArtifact(artifact);
  const classId = contractClass.id.toString();
  console.log(`  Class ID: ${classId}`);

  let published = false;
  try {
    const meta = await patchedWallet.getContractClassMetadata(contractClass.id);
    published = meta && meta.isContractClassPubliclyRegistered;
  } catch {}

  if (published) {
    console.log(`  ${label} class already published`);
  } else {
    try {
      const tx = await publishContractClass(patchedWallet, artifact);
      await tx.send({ from: keeperAddress, fee: { paymentMethod: sponsoredPayment } });
      console.log(`  ${label} class published!`);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Existing nullifier') || msg.includes('already registered') || msg.includes('app_logic_reverted')) {
        console.log(`  ${label} class already published (nullifier exists)`);
      } else {
        throw err;
      }
    }
  }

  return classId;
}

async function main() {
  console.log('='.repeat(60));
  console.log('DuelCloak V8 + UserProfile V6 Combined Deployment');
  console.log('='.repeat(60));
  console.log(`L2 Node: ${NODE_URL}`);
  console.log(`Keeper:  ${KEEPER_ADDRESS}`);
  console.log('');

  // Step 1: Connect to L2 node
  console.log('[1/8] Connecting to L2 node...');
  const node = createAztecNodeClient(NODE_URL);
  const blockNum = await node.getBlockNumber();
  console.log(`  Connected! Block: ${blockNum}`);

  // Step 2: Restore keeper wallet
  console.log('[2/8] Restoring keeper wallet...');
  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const salt = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);
  const keeperAddress = AztecAddress.fromString(KEEPER_ADDRESS);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const patchedWallet = patchWallet(wallet);

  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const keeperInstance = accountManager.getInstance();
  const keeperArtifact = await accountManager.getAccountContract().getContractArtifact();
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

  // Step 3: Publish UserProfile V6 class
  console.log('[3/8] Publishing UserProfile V6 class...');
  const userProfileArtifactPath = resolve(__dirname, '../target/user_profile-user_profile.json');
  const userProfileArtifact = await loadArtifact(userProfileArtifactPath);
  const userProfileClassId = await publishClass(patchedWallet, userProfileArtifact, 'UserProfile V6', keeperAddress, sponsoredPayment);

  // Step 4: Deploy UserProfile V6 instance
  console.log('[4/8] Deploying UserProfile V6 instance...');
  const userProfileDeploy = Contract.deploy(patchedWallet, userProfileArtifact, [keeperAddress]);
  const userProfileInstance = await userProfileDeploy.getInstance({
    contractAddressSalt: Fr.random(),
  });
  console.log(`  Expected address: ${userProfileInstance.address.toString()}`);

  let userProfileAddress: string;
  try {
    const { contract: deployed } = await userProfileDeploy.send({
      skipClassPublication: true,
      skipInstancePublication: false,
      from: keeperAddress,
      fee: { paymentMethod: sponsoredPayment },
    });
    userProfileAddress = deployed.address.toString();
    console.log(`  UserProfile V6 deployed at: ${userProfileAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(userProfileInstance.address);
    if (onChain) {
      userProfileAddress = userProfileInstance.address.toString();
      console.log(`  UserProfile V6 deployed at: ${userProfileAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // Step 5: Publish DuelCloak V8 class
  console.log('[5/8] Publishing DuelCloak V8 class...');
  const duelCloakArtifactPath = resolve(__dirname, '../target/duel_cloak-duel_cloak.json');
  const duelCloakArtifact = await loadArtifact(duelCloakArtifactPath);
  const duelCloakClassId = await publishClass(patchedWallet, duelCloakArtifact, 'DuelCloak V8', keeperAddress, sponsoredPayment);

  // Step 6: Deploy DuelCloak V8 instance (with UserProfile address)
  console.log('[6/8] Deploying DuelCloak V8 instance...');
  const userProfileAddr = AztecAddress.fromString(userProfileAddress);
  const constructorArgs = [
    'DuelCloak',                    // name: str<31>
    100,                            // duel_duration: u32 (fallback, V7+ uses per-duel end_block)
    1,                              // first_duel_block: u32
    true,                           // is_publicly_viewable: bool
    keeperAddress,                  // keeper_address: AztecAddress
    BigInt(MULTI_AUTH_CLASS_ID),    // allowed_account_class_id: Field
    0,                              // _tally_mode: u8 (unused, backward compat)
    keeperAddress,                  // creator: AztecAddress
    0n,                             // first_stmt_1: Field (no inline first duel)
    0n,                             // first_stmt_2: Field
    0n,                             // first_stmt_3: Field
    0n,                             // first_stmt_4: Field
    userProfileAddr,                // user_profile_address: AztecAddress (V8)
  ];

  const duelCloakDeploy = Contract.deploy(patchedWallet, duelCloakArtifact, constructorArgs);
  const duelCloakInstance = await duelCloakDeploy.getInstance({
    contractAddressSalt: Fr.random(),
  });
  console.log(`  Expected address: ${duelCloakInstance.address.toString()}`);

  let duelCloakAddress: string;
  try {
    const { contract: deployed } = await duelCloakDeploy.send({
      skipClassPublication: true,
      skipInstancePublication: false,
      from: keeperAddress,
      fee: { paymentMethod: sponsoredPayment },
    });
    duelCloakAddress = deployed.address.toString();
    console.log(`  DuelCloak V8 deployed at: ${duelCloakAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(duelCloakInstance.address);
    if (onChain) {
      duelCloakAddress = duelCloakInstance.address.toString();
      console.log(`  DuelCloak V8 deployed at: ${duelCloakAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // Step 7: Link contracts -- set DuelCloak as authorized caller on UserProfile
  console.log('[7/8] Linking contracts: set_authorized_caller...');
  const duelCloakAddr = AztecAddress.fromString(duelCloakAddress);

  // Register UserProfile contract in wallet so we can call it
  const upInstance = await node.getContract(userProfileAddr);
  if (upInstance) {
    await wallet.registerContract(upInstance, userProfileArtifact);
  }

  const userProfileContract = await Contract.at(userProfileAddr, userProfileArtifact, patchedWallet);
  await userProfileContract.methods.set_authorized_caller(duelCloakAddr).send({
    from: keeperAddress,
    fee: { paymentMethod: sponsoredPayment },
  });
  console.log(`  UserProfile.authorized_caller set to DuelCloak V8: ${duelCloakAddress}`);

  // Step 8: Copy artifacts + update env files
  console.log('[8/8] Copying artifacts and updating env files...');

  // Copy UserProfile artifact (with name stripping)
  const appUserProfileDest = resolve(__dirname, '../../app/src/lib/aztec/artifacts/UserProfile.json');
  const serverUserProfileDest = resolve(__dirname, '../../server/src/lib/aztec/artifacts/UserProfile.json');
  copyArtifactClean(userProfileArtifactPath, appUserProfileDest);
  copyArtifactClean(userProfileArtifactPath, serverUserProfileDest);
  console.log(`  Copied UserProfile artifact to app and server`);

  // Copy DuelCloak artifact (with name stripping + transpiled flag)
  const appDuelCloakDest = resolve(__dirname, '../../app/src/lib/aztec/artifacts/DuelCloak.json');
  const serverDuelCloakDest = resolve(__dirname, '../../server/src/lib/aztec/artifacts/DuelCloak.json');
  copyArtifactClean(duelCloakArtifactPath, appDuelCloakDest);
  copyArtifactClean(duelCloakArtifactPath, serverDuelCloakDest);
  console.log(`  Copied DuelCloak artifact to app and server`);

  // Update env files
  const envFiles = [
    resolve(__dirname, '../../server/.env.local'),
    resolve(__dirname, '../../app/.env.local'),
  ];

  for (const envPath of envFiles) {
    let env = readFileSync(envPath, 'utf-8');
    env = updateEnvVar(env, 'VITE_DUELCLOAK_ADDRESS', duelCloakAddress);
    env = updateEnvVar(env, 'VITE_DUELCLOAK_CLASS_ID', duelCloakClassId);
    env = updateEnvVar(env, 'VITE_USER_PROFILE_ADDRESS', userProfileAddress);
    writeFileSync(envPath, env);
    console.log(`  Updated: ${envPath}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('V8 COMBINED DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`  VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}`);
  console.log(`  VITE_DUELCLOAK_CLASS_ID=${duelCloakClassId}`);
  console.log(`  VITE_USER_PROFILE_ADDRESS=${userProfileAddress}`);
  console.log(`  UserProfile V6 Class ID: ${userProfileClassId}`);
  console.log(`  KEEPER_ADDRESS=${KEEPER_ADDRESS}`);
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${FPC_ADDRESS}`);
  console.log('');
  console.log('Both contracts linked: DuelCloak V8 -> UserProfile V6 (authorized_caller)');
  console.log('Points are now awarded atomically during voting via cross-contract call.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart app and server to pick up new env vars');
  console.log('  2. Existing on-chain points are lost (devnet-acceptable)');
  console.log('  3. Bootstrap eligible accounts via browser console (see plan Phase 1)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nDeployment failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
