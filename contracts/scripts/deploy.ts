#!/usr/bin/env node
/**
 * DuelCloak Full Deployment
 *
 * 1. Generate keeper keys (Schnorr account)
 * 2. Bridge FeeJuice from Sepolia L1 to keeper on L2
 * 3. Deploy keeper account (pays fee from bridged claim)
 * 4. Deploy SponsoredFPC (keeper pays fee)
 * 5. Bridge FeeJuice to SponsoredFPC
 * 6. Publish MultiAuthAccount class
 * 7. Deploy DuelCloak contract
 * 8. Write .env.local with all addresses and keys
 *
 * Usage: cd contracts && npx tsx scripts/deploy.ts
 *
 * Requires SEPOLIA_PRIVATE_KEY in ../.env.local
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AccountManager } from '@aztec/aztec.js/wallet';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee/testing';
import { FeeJuicePaymentMethodWithClaim } from '@aztec/aztec.js/fee';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getContractInstanceFromInstantiationParams, getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { L1FeeJuicePortalManager } from '@aztec/aztec.js/ethereum';
import { createExtendedL1Client } from '@aztec/ethereum/client';
import { createLogger } from '@aztec/foundation/log';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { publishContractClass } from '@aztec/aztec.js/deployment';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { sepolia } from 'viem/chains';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Try root .env.local first, then server/.env.local
config({ path: resolve(__dirname, '../../.env.local') });
if (!process.env.SEPOLIA_PRIVATE_KEY) {
  config({ path: resolve(__dirname, '../../server/.env.local') });
}

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com';
const L1_RPC = process.env.SEPOLIA_RPC_URL || 'https://1rpc.io/sepolia';
const L1_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;

if (!L1_PRIVATE_KEY) {
  console.error('Missing SEPOLIA_PRIVATE_KEY in .env.local');
  process.exit(1);
}

const logger = createLogger('deploy');

async function loadArtifact(path: string) {
  const mod = await import(path, { with: { type: 'json' } });
  const raw = mod.default as any;
  raw.transpiled = true;
  // Strip __aztec_nr_internals__ prefix from function names (required for selector matching)
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

async function publishClass(wallet: any, artifact: any, name: string, paymentMethod: any, fromAddress?: any) {
  const contractClass = await getContractClassFromArtifact(artifact);
  const classId = contractClass.id.toString();
  console.log(`  Class ID: ${classId}`);

  let published = false;
  try {
    const meta = await wallet.getContractClassMetadata(contractClass.id);
    published = meta && meta.isContractClassPubliclyRegistered;
  } catch {}

  if (published) {
    console.log(`  ${name} class already published`);
    return classId;
  }

  try {
    const tx = await publishContractClass(wallet, artifact);
    await tx.send({ from: fromAddress || AztecAddress.ZERO, fee: { paymentMethod } });
    console.log(`  ${name} class published!`);
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg.includes('Existing nullifier') || msg.includes('already registered') || msg.includes('app_logic_reverted')) {
      console.log(`  ${name} class already published (nullifier exists)`);
    } else {
      throw err;
    }
  }

  return classId;
}

async function main() {
  console.log('='.repeat(60));
  console.log('DuelCloak Full Deployment');
  console.log('='.repeat(60));
  console.log(`L2 Node: ${NODE_URL}`);
  console.log(`L1 RPC:  ${L1_RPC}`);
  console.log('');

  // ================================================================
  // STEP 1: Connect + generate keeper keys
  // ================================================================
  console.log('[1/8] Connecting to L2 node + generating keeper keys...');
  const node = createAztecNodeClient(NODE_URL);
  const blockNum = await node.getBlockNumber();
  console.log(`  Connected! Block: ${blockNum}`);

  const secretKey = Fr.random();
  const salt = Fr.random();
  const signingKey = GrumpkinScalar.random();

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const patchedWallet = patchWallet(wallet);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const accountContract = accountManager.getAccountContract();
  const keeperAddress = accountManager.address;
  console.log(`  Keeper address: ${keeperAddress.toString()}`);

  // ================================================================
  // STEP 2: Bridge FeeJuice from Sepolia to keeper
  // ================================================================
  console.log('[2/8] Bridging FeeJuice from L1 to keeper...');
  const l1Key = L1_PRIVATE_KEY.startsWith('0x') ? L1_PRIVATE_KEY : `0x${L1_PRIVATE_KEY}`;
  const l1Client = createExtendedL1Client([L1_RPC], l1Key, sepolia);
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger);

  console.log(`  Minting & bridging to ${keeperAddress.toString()}...`);
  const claim = await portalManager.bridgeTokensPublic(keeperAddress, undefined, true);
  console.log(`  Bridge tx mined! Claim amount: ${claim.claimAmount.toString()}`);

  // ================================================================
  // STEP 3: Deploy keeper account (claims bridged FeeJuice as fee)
  // ================================================================
  console.log('[3/8] Deploying keeper account...');
  const keeperContractInstance = accountManager.getInstance();
  const keeperArtifact = await accountContract.getContractArtifact();
  await wallet.registerContract(keeperContractInstance, keeperArtifact, secretKey);
  console.log('  Keeper registered in PXE');

  console.log('  Waiting for L1->L2 message...');
  const deployMethod = await accountManager.getDeployMethod();
  const claimPayment = new FeeJuicePaymentMethodWithClaim(keeperAddress, claim);

  const MAX_RETRIES = 30;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await deployMethod.send({
        from: AztecAddress.ZERO,
        skipClassPublication: false,
        skipInstancePublication: false,
        fee: { paymentMethod: claimPayment },
      });
      console.log('  Keeper account deployed!');
      break;
    } catch (err: any) {
      if (err.message?.includes('No L1 to L2 message found') && attempt < MAX_RETRIES) {
        const blk = await node.getBlockNumber();
        console.log(`  L1->L2 message not yet available (block ${blk}), retry ${attempt}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 15_000));
      } else {
        throw err;
      }
    }
  }

  // Verify keeper deployed
  const keeperOnChain = await node.getContract(keeperAddress);
  if (!keeperOnChain) {
    console.error('ERROR: Keeper account not deployed on-chain!');
    process.exit(1);
  }
  console.log('  Keeper confirmed on-chain');

  // ================================================================
  // STEP 4: Deploy SponsoredFPC (keeper pays fee)
  // ================================================================
  console.log('[4/8] Deploying SponsoredFPC...');
  const fpcCanonical = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) }
  );
  const fpcAddress = fpcCanonical.address;
  console.log(`  Canonical FPC address: ${fpcAddress.toString()}`);

  const existingFpc = await node.getContract(fpcAddress);
  if (existingFpc) {
    console.log('  SponsoredFPC already deployed');
  } else {
    const deployed = await Contract.deploy(wallet, SponsoredFPCContract.artifact, [])
      .send({
        contractAddressSalt: new Fr(0),
        universalDeploy: true,
        skipClassPublication: false,
        skipInstancePublication: false,
        from: keeperAddress,
      });
    console.log(`  SponsoredFPC deployed at: ${deployed.address.toString()}`);
  }

  // Register FPC with wallet
  await wallet.registerContract(fpcCanonical, SponsoredFPCContract.artifact);
  const sponsoredPayment = new SponsoredFeePaymentMethod(fpcAddress);

  // ================================================================
  // STEP 5: Bridge FeeJuice to SponsoredFPC
  // ================================================================
  console.log('[5/8] Bridging FeeJuice to SponsoredFPC...');
  const fpcBalance = await getFeeJuiceBalance(fpcAddress, node);
  console.log(`  Current FPC balance: ${fpcBalance.toString()}`);

  if (fpcBalance === 0n) {
    console.log('  Minting & bridging to FPC...');
    const fpcClaim = await portalManager.bridgeTokensPublic(fpcAddress, undefined, true);
    console.log(`  Bridge tx mined! Claim amount: ${fpcClaim.claimAmount.toString()}`);
    console.log('  FPC will receive funds once L2 processes the L1 message.');
    // Wait a bit for the L1->L2 message
    console.log('  Waiting 60s for L2 to process...');
    await new Promise(r => setTimeout(r, 60_000));
  } else {
    console.log('  FPC already funded');
  }

  // ================================================================
  // STEP 6: Publish MultiAuthAccount class
  // ================================================================
  console.log('[6/8] Publishing MultiAuthAccount class...');
  const multiAuthArtifact = await loadArtifact('../target/multi_auth_account-MultiAuthAccount.json');
  const multiAuthClassId = await publishClass(patchedWallet, multiAuthArtifact, 'MultiAuthAccount', sponsoredPayment, keeperAddress);

  // ================================================================
  // STEP 7: Deploy DuelCloak contract
  // ================================================================
  console.log('[7/8] Deploying DuelCloak contract...');
  const duelCloakArtifact = await loadArtifact('../target/duel_cloak-duel_cloak.json');

  // Publish DuelCloak class
  await publishClass(patchedWallet, duelCloakArtifact, 'DuelCloak', sponsoredPayment, keeperAddress);

  // Deploy instance with public constructor
  const constructorArgs = [
    'DuelCloak',           // name: str<31>
    100,                   // duel_duration: u32 (~10 min at 6s blocks)
    1,                     // first_duel_block: u32
    true,                  // is_publicly_viewable: bool
    keeperAddress,         // keeper_address: AztecAddress
    BigInt(multiAuthClassId!), // allowed_account_class_id: Field
    0,                     // tally_mode: u8 (0 = open/live)
    keeperAddress,         // creator: AztecAddress
  ];

  const duelCloakDeploy = Contract.deploy(patchedWallet, duelCloakArtifact, constructorArgs);
  const duelCloakInstance = await duelCloakDeploy.getInstance({
    contractAddressSalt: Fr.random(),
  });
  console.log(`  Expected address: ${duelCloakInstance.address.toString()}`);

  let duelCloakAddress: string;
  try {
    // Try with SponsoredFPC first, fall back to no fee payment
    let sendOpts: any = {
      skipClassPublication: true,
      skipInstancePublication: false,
      from: keeperAddress,
      fee: { paymentMethod: sponsoredPayment },
    };
    let deployed: any;
    try {
      deployed = await duelCloakDeploy.send(sendOpts);
    } catch (e: any) {
      console.log(`  SponsoredFPC deploy failed: ${e?.message?.slice(0, 100)}`);
      console.log('  Retrying without SponsoredFPC (keeper pays gas directly)...');
      const duelCloakDeploy2 = Contract.deploy(patchedWallet, duelCloakArtifact, constructorArgs);
      deployed = await duelCloakDeploy2.send({
        skipClassPublication: true,
        skipInstancePublication: false,
        from: keeperAddress,
      } as any);
    }
    duelCloakAddress = deployed.address.toString();
    console.log(`  DuelCloak deployed at: ${duelCloakAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(duelCloakInstance.address);
    if (onChain) {
      duelCloakAddress = duelCloakInstance.address.toString();
      console.log(`  DuelCloak deployed at: ${duelCloakAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // ================================================================
  // STEP 8: Write .env.local
  // ================================================================
  console.log('[8/8] Writing .env.local...');

  const apiSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const envContent = `# Aztec Network
VITE_AZTEC_NODE_URL=${NODE_URL}
VITE_SPONSORED_FPC_ADDRESS=${fpcAddress.toString()}
VITE_DEFAULT_NETWORK=devnet

# Devnet: fake proofs accepted (TestCircuitVerifier always returns valid)
VITE_FAKE_PROOFS=true

# Contract addresses
VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}
VITE_MULTI_AUTH_CLASS_ID=${multiAuthClassId}

# Keeper (server-side only -- NEVER expose to client)
KEEPER_SECRET_KEY=${secretKey.toString()}
KEEPER_SIGNING_KEY=${signingKey.toString()}
KEEPER_SALT=${salt.toString()}
KEEPER_ADDRESS=${keeperAddress.toString()}
KEEPER_API_SECRET=${apiSecret}

# Sepolia L1
SEPOLIA_PRIVATE_KEY=${L1_PRIVATE_KEY}

# Database
DATABASE_URL=postgresql://postgres:ZTnGnWoSHXodvwwpOSwUWRxQuILFjpvr@crossover.proxy.rlwy.net:11484/railway

# Server
PORT=3001
`;

  // Write to server/.env.local (with keeper keys)
  const serverEnvPath = resolve(__dirname, '../../server/.env.local');
  const serverEnv = envContent + `\nVITE_GOOGLE_CLIENT_ID=691982892294-uk2vnc9oemujo6nsoqrspk5nu99qr8bt.apps.googleusercontent.com\n`;
  writeFileSync(serverEnvPath, serverEnv);
  console.log(`  Written to: ${serverEnvPath}`);

  // Write to app/.env.local (client-safe vars only + Google client ID)
  const appEnvContent = `# Aztec Network
VITE_AZTEC_NODE_URL=${NODE_URL}
VITE_SPONSORED_FPC_ADDRESS=${fpcAddress.toString()}
VITE_DEFAULT_NETWORK=devnet

# Devnet: fake proofs accepted (TestCircuitVerifier always returns valid)
VITE_FAKE_PROOFS=false

# Contract addresses
VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}
VITE_MULTI_AUTH_CLASS_ID=${multiAuthClassId}

# Google OAuth
VITE_GOOGLE_CLIENT_ID=691982892294-uk2vnc9oemujo6nsoqrspk5nu99qr8bt.apps.googleusercontent.com
`;
  const appEnvPath = resolve(__dirname, '../../app/.env.local');
  writeFileSync(appEnvPath, appEnvContent);
  console.log(`  Written to: ${appEnvPath}`);

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`  KEEPER_ADDRESS=${keeperAddress.toString()}`);
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${fpcAddress.toString()}`);
  console.log(`  VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}`);
  console.log(`  VITE_MULTI_AUTH_CLASS_ID=${multiAuthClassId}`);
  console.log(`  KEEPER_API_SECRET=${apiSecret}`);

  return {
    keeperAddress: keeperAddress.toString(),
    fpcAddress: fpcAddress.toString(),
    duelCloakAddress,
    multiAuthClassId,
  };
}

main()
  .then(result => {
    console.log('\n' + JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('\nDeployment failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
