#!/usr/bin/env node
/**
 * Deploy AppFPC -- App-gated sponsored fee payment contract.
 *
 * 1. Publish AppFPC class
 * 2. Deploy AppFPC instance with keeper as admin
 * 3. Bridge fee juice from L1 Sepolia to AppFPC on L2
 * 4. Update env files with new address
 *
 * Usage: cd contracts && npx tsx scripts/deploy-app-fpc.ts
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { publishContractClass } from '@aztec/aztec.js/deployment';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee/testing';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
const KEEPER_SECRET_KEY = process.env.KEEPER_SECRET_KEY!;
const KEEPER_SIGNING_KEY = process.env.KEEPER_SIGNING_KEY!;
const KEEPER_SALT = process.env.KEEPER_SALT!;
const KEEPER_ADDRESS = process.env.KEEPER_ADDRESS!;
// Original SponsoredFPC (canonical, salt=0) — used to pay for AppFPC deployment
const OLD_FPC_ADDRESS = '0x11a66804e6ba7f0a37f43e6da2820f53db80dc391295827288b718f17bf92bf9';

if (!KEEPER_SECRET_KEY || !KEEPER_SIGNING_KEY || !KEEPER_SALT) {
  console.error('Missing keeper keys in server/.env.local');
  process.exit(1);
}

function loadArtifact(path: string) {
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

function updateEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`${key}=.*`);
  if (content.match(regex)) {
    return content.replace(regex, `${key}=${value}`);
  }
  return content + `\n${key}=${value}\n`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('AppFPC Deployment -- App-Gated Sponsored Fee Payment');
  console.log('='.repeat(60));
  console.log(`L2 Node: ${NODE_URL}`);
  console.log(`Keeper:  ${KEEPER_ADDRESS}`);
  console.log('');

  // 1. Connect
  console.log('[1/5] Connecting to L2 node...');
  const node = createAztecNodeClient(NODE_URL);
  const blockNum = await node.getBlockNumber();
  console.log(`  Connected! Block: ${blockNum}`);

  // 2. Restore keeper wallet
  console.log('[2/5] Restoring keeper wallet...');
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
  console.log(`  Keeper restored: ${keeperAddress.toString()}`);

  // Register old SponsoredFPC for paying deploy fees
  const fpcAddress = AztecAddress.fromString(OLD_FPC_ADDRESS);
  const fpcCanonical = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) },
  );
  await wallet.registerContract(fpcCanonical, SponsoredFPCContract.artifact);
  const sponsoredPayment = new SponsoredFeePaymentMethod(fpcAddress);

  // 3. Publish AppFPC class
  console.log('[3/5] Publishing AppFPC class...');
  const artifactPath = resolve(__dirname, '../target/app_fpc-AppFPC.json');
  const artifact = loadArtifact(artifactPath);
  const contractClass = await getContractClassFromArtifact(artifact);
  const classId = contractClass.id.toString();
  console.log(`  Class ID: ${classId}`);

  let published = false;
  try {
    const meta = await patchedWallet.getContractClassMetadata(contractClass.id);
    published = meta && meta.isContractClassPubliclyRegistered;
  } catch {}

  if (published) {
    console.log(`  Class already published`);
  } else {
    try {
      const tx = await publishContractClass(patchedWallet, artifact);
      await tx.send({ from: keeperAddress, fee: { paymentMethod: sponsoredPayment } });
      console.log(`  Class published!`);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Existing nullifier') || msg.includes('already')) {
        console.log(`  Class already published (nullifier exists)`);
      } else {
        throw err;
      }
    }
  }

  // 4. Deploy AppFPC instance
  console.log('[4/5] Deploying AppFPC instance...');
  const deploy = Contract.deploy(patchedWallet, artifact, [keeperAddress]);
  const instance = await deploy.getInstance({ contractAddressSalt: Fr.random() });
  console.log(`  Expected address: ${instance.address.toString()}`);

  let appFpcAddress: string;
  try {
    const { contract: deployed } = await deploy.send({
      skipClassPublication: true,
      skipInstancePublication: false,
      from: keeperAddress,
      fee: { paymentMethod: sponsoredPayment },
    });
    appFpcAddress = deployed.address.toString();
    console.log(`  AppFPC deployed at: ${appFpcAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(instance.address);
    if (onChain) {
      appFpcAddress = instance.address.toString();
      console.log(`  AppFPC deployed at: ${appFpcAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // 5. Update env files
  console.log('[5/5] Updating env files...');
  const envFiles = [
    resolve(__dirname, '../../server/.env.local'),
    resolve(__dirname, '../../app/.env.local'),
  ];

  for (const envPath of envFiles) {
    let env = readFileSync(envPath, 'utf-8');
    env = updateEnvVar(env, 'VITE_SPONSORED_FPC_ADDRESS', appFpcAddress);
    writeFileSync(envPath, env);
    console.log(`  Updated: ${envPath}`);
  }

  // Copy artifact to app and server
  const cleanArtifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  cleanArtifact.transpiled = true;
  if (cleanArtifact.functions) {
    for (const fn of cleanArtifact.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  const appDest = resolve(__dirname, '../../app/src/lib/aztec/artifacts/AppFPC.json');
  const serverDest = resolve(__dirname, '../../server/src/lib/aztec/artifacts/AppFPC.json');
  writeFileSync(appDest, JSON.stringify(cleanArtifact));
  writeFileSync(serverDest, JSON.stringify(cleanArtifact));
  console.log(`  Copied artifact to app and server`);

  console.log('');
  console.log('='.repeat(60));
  console.log('AppFPC DEPLOYMENT COMPLETE');
  console.log('='.repeat(60));
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${appFpcAddress}`);
  console.log(`  AppFPC Class ID: ${classId}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Bridge fee juice to the new AppFPC address');
  console.log('  2. Server needs to approve users via AppFPC.approve(userAddress)');
  console.log('  3. Update frontend FeePaymentMethod to call sponsor() instead of sponsor_unconditionally()');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nDeployment failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
