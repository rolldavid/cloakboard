#!/usr/bin/env node
/**
 * DuelCloak Testnet Full Deployment
 *
 * Steps:
 * 1. Bridge fee juice from L1 (Sepolia) to L2 (testnet) for keeper
 * 2. Deploy SponsoredFPC (not available on testnet by default)
 * 3. Publish + deploy MultiAuthAccount class
 * 4. Deploy UserProfile V7 with constructor(keeperAddress)
 * 5. Deploy DuelCloak V8 with constructor(..., userProfileV7Address)
 * 6. Deploy VoteHistory
 * 7. Deploy LinkRegistry
 * 8. Link: UserProfile.set_authorized_caller(duelCloakAddress)
 * 9. Copy artifacts + update env files
 *
 * Usage: cd contracts && npx tsx scripts/deploy-testnet.ts
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getContractInstanceFromInstantiationParams, getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/stdlib/abi';
import { publishContractClass } from '@aztec/aztec.js/deployment';
import { FeeJuicePaymentMethodWithClaim } from '@aztec/aztec.js/fee';
import { createLogger } from '@aztec/foundation/log';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
// viem imports removed — L1 bridge done via separate script

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
const KEEPER_SECRET_KEY = process.env.KEEPER_SECRET_KEY!;
const KEEPER_SIGNING_KEY = process.env.KEEPER_SIGNING_KEY!;
const KEEPER_SALT = process.env.KEEPER_SALT!;
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY!;

// Faucet claim data — set these from the faucet response before running
const CLAIM_SECRET = process.env.CLAIM_SECRET || '';
const CLAIM_LEAF_INDEX = process.env.CLAIM_LEAF_INDEX || '';
const CLAIM_AMOUNT = process.env.CLAIM_AMOUNT || '1000000000000000000000'; // 1000 FEE default

if (!KEEPER_SECRET_KEY || !KEEPER_SIGNING_KEY || !KEEPER_SALT) {
  console.error('Missing keeper keys in server/.env.local');
  process.exit(1);
}
if (!SEPOLIA_PRIVATE_KEY) {
  console.error('Missing SEPOLIA_PRIVATE_KEY in server/.env.local');
  process.exit(1);
}

const logger = createLogger('deploy-testnet');

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

async function publishClass(patchedWallet: any, artifact: any, label: string, keeperAddress: AztecAddress) {
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
      // Keeper pays with its own fee juice balance (no SponsoredFPC during deploy)
      await tx.send({ from: keeperAddress });
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
  console.log('DuelCloak TESTNET Full Deployment');
  console.log('='.repeat(60));
  console.log(`L2 Node: ${NODE_URL}`);
  console.log('');

  // Step 1: Connect to L2 node
  console.log('[1/11] Connecting to L2 testnet node...');
  const node = createAztecNodeClient(NODE_URL);
  const blockNum = await node.getBlockNumber();
  console.log(`  Connected! Block: ${blockNum}`);

  // Step 2: Create EmbeddedWallet + restore keeper
  console.log('[2/11] Creating EmbeddedWallet...');
  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const salt = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const patchedWallet = patchWallet(wallet);

  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const keeperInstance = accountManager.getInstance();
  const keeperArtifact = await accountManager.getAccountContract().getContractArtifact();
  await wallet.registerContract(keeperInstance, keeperArtifact, secretKey);
  const keeperAddress = accountManager.address ?? (accountManager as any).getAddress();
  console.log(`  Keeper address: ${keeperAddress.toString()}`);

  // Step 3: Check fee juice balance (should be bridged already via manual L1 tx)
  console.log('[3/11] Checking fee juice balance...');
  const feeJuiceSlot = new Fr(1n); // FeeJuice balance storage slot
  const feeJuiceAddr = AztecAddress.fromString('0x0000000000000000000000000000000000000000000000000000000000000005');
  try {
    const bal = await node.getPublicStorageAt('latest', feeJuiceAddr, feeJuiceSlot);
    console.log(`  Fee juice balance check: ${bal.toBigInt()}`);
  } catch {
    console.log('  Could not check balance (non-fatal)');
  }
  console.log('  Fee juice was bridged via L1 deposit. If deployment fails with "Insufficient fee payer balance",');
  console.log('  wait for L1 block inclusion on L2 (a few minutes) and retry.');

  // Step 4: Deploy keeper account (if not already deployed)
  console.log('[4/11] Deploying keeper account...');
  // Skip if KEEPER_DEPLOYED env var is set (instance may not be publicly registered)
  const skipKeeperDeploy = process.env.KEEPER_DEPLOYED === 'true';
  let keeperDeployed = skipKeeperDeploy;
  if (!keeperDeployed) {
    try {
      const meta = await node.getContractMetadata(keeperAddress);
      keeperDeployed = meta && meta.isContractPubliclyDeployed;
    } catch {}
  }
  if (!keeperDeployed) {
    try {
      const inst = await node.getContract(keeperAddress);
      keeperDeployed = !!inst;
    } catch {}
  }
  if (keeperDeployed) {
    console.log('  Keeper already deployed (skipping)');
  } else {
    if (!CLAIM_SECRET || !CLAIM_LEAF_INDEX) {
      console.error('  ERROR: Keeper not deployed and no CLAIM_SECRET/CLAIM_LEAF_INDEX set.');
      console.error('  Get fee juice from faucet: curl -s -X POST "https://aztec-faucet.nethermind.io/api/drip" -H "Content-Type: application/json" -d \'{"address":"' + keeperAddress.toString() + '","asset":"fee-juice"}\'');
      console.error('  Then set CLAIM_SECRET and CLAIM_LEAF_INDEX env vars and re-run.');
      process.exit(1);
    }
    // Claim fee juice atomically with keeper deploy
    const claimPayment = new FeeJuicePaymentMethodWithClaim(keeperAddress, {
      claimAmount: BigInt(CLAIM_AMOUNT),
      claimSecret: Fr.fromHexString(CLAIM_SECRET),
      messageLeafIndex: BigInt(CLAIM_LEAF_INDEX),
    });
    const deployMethod = await accountManager.getDeployMethod();
    // from: AztecAddress.ZERO triggers self-deployment path:
    // deploys contract first (emitting signing key note), THEN calls entrypoint for fee
    await deployMethod.send({
      from: AztecAddress.ZERO,
      skipClassPublication: true,
      fee: { paymentMethod: claimPayment },
    });
    console.log('  Keeper account deployed with fee juice claim!');
  }

  // Step 5: Deploy SponsoredFPC (our own for fee tracking)
  console.log('[5/11] Deploying our own SponsoredFPC...');
  let fpcAddress: string;

  // Check if already deployed from a previous run
  const existingFpc = process.env.VITE_SPONSORED_FPC_ADDRESS;
  if (existingFpc && existingFpc.length > 10) {
    let fpcExists = false;
    try {
      const meta = await node.getContractMetadata(AztecAddress.fromString(existingFpc));
      fpcExists = meta && meta.isContractPubliclyDeployed;
    } catch {}
    if (fpcExists) {
      fpcAddress = existingFpc;
      console.log(`  SponsoredFPC already deployed: ${fpcAddress}`);
    } else {
      fpcAddress = '';
    }
  } else {
    fpcAddress = '';
  }

  if (!fpcAddress) {
    const fpcSalt = Fr.random();
    const fpcDeploy = Contract.deploy(patchedWallet, SponsoredFPCContract.artifact, []);
    const { contract: fpcDeployed } = await fpcDeploy.send({
      contractAddressSalt: fpcSalt,
      from: keeperAddress,
    });
    fpcAddress = fpcDeployed.address.toString();
    console.log(`  SponsoredFPC deployed (owned): ${fpcAddress}`);
  }

  // Register SponsoredFPC for later use (in app/server)
  const fpcAddr = AztecAddress.fromString(fpcAddress);
  try {
    const fpcInstance = await node.getContract(fpcAddr);
    if (fpcInstance) {
      await wallet.registerContract(fpcInstance as any, SponsoredFPCContract.artifact);
    }
  } catch {}

  // For deployment, use keeper's fee juice directly (SponsoredFPC has no balance yet)
  // After deploy, we'll bridge fee juice to SponsoredFPC for user-facing txs
  console.log('  Using keeper fee juice for remaining deployments (SponsoredFPC unfunded)');

  // Step 6: Deploy UserProfile
  console.log('[6/10] Publishing & deploying UserProfile...');
  const userProfileArtifactPath = resolve(__dirname, '../target/user_profile-user_profile.json');
  const userProfileArtifact = await loadArtifact(userProfileArtifactPath);
  const userProfileClassId = await publishClass(patchedWallet, userProfileArtifact, 'UserProfile V7', keeperAddress);

  const userProfileDeploy = Contract.deploy(patchedWallet, userProfileArtifact, [keeperAddress]);
  const userProfilePreInstance = await userProfileDeploy.getInstance({ contractAddressSalt: Fr.random() });
  console.log(`  Expected address: ${userProfilePreInstance.address.toString()}`);

  let userProfileAddress: string;
  try {
    const { contract: deployed } = await userProfileDeploy.send({
      skipClassPublication: true,
      from: keeperAddress,
      // Keeper pays with fee juice directly
    });
    userProfileAddress = deployed.address.toString();
    console.log(`  UserProfile V7 deployed at: ${userProfileAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(userProfilePreInstance.address);
    if (onChain) {
      userProfileAddress = userProfilePreInstance.address.toString();
      console.log(`  UserProfile V7 deployed at: ${userProfileAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // Step 7: Deploy DuelCloak
  console.log('[7/10] Publishing & deploying DuelCloak...');
  const duelCloakArtifactPath = resolve(__dirname, '../target/duel_cloak-duel_cloak.json');
  const duelCloakArtifact = await loadArtifact(duelCloakArtifactPath);
  const duelCloakClassId = await publishClass(patchedWallet, duelCloakArtifact, 'DuelCloak V8', keeperAddress);

  const userProfileAddr = AztecAddress.fromString(userProfileAddress);
  const constructorArgs = [
    'DuelCloak',          // name
    100,                  // duel_duration
    1,                    // first_duel_block
    true,                 // is_publicly_viewable
    keeperAddress,        // keeper_address
    0,                    // _tally_mode (unused)
    keeperAddress,        // creator
    0n, 0n, 0n, 0n,      // first_stmt_1..4 (skip inline duel)
    userProfileAddr,      // user_profile_address
  ];

  const duelCloakDeploy = Contract.deploy(patchedWallet, duelCloakArtifact, constructorArgs);
  const duelCloakPreInstance = await duelCloakDeploy.getInstance({ contractAddressSalt: Fr.random() });
  console.log(`  Expected address: ${duelCloakPreInstance.address.toString()}`);

  let duelCloakAddress: string;
  try {
    const { contract: deployed } = await duelCloakDeploy.send({
      skipClassPublication: true,
      from: keeperAddress,
      // Keeper pays with fee juice directly
    });
    duelCloakAddress = deployed.address.toString();
    console.log(`  DuelCloak V8 deployed at: ${duelCloakAddress}`);
  } catch (deployErr: any) {
    const onChain = await node.getContract(duelCloakPreInstance.address);
    if (onChain) {
      duelCloakAddress = duelCloakPreInstance.address.toString();
      console.log(`  DuelCloak V8 deployed at: ${duelCloakAddress} (verified on-chain)`);
    } else {
      throw deployErr;
    }
  }

  // Step 8: Deploy VoteHistory + LinkRegistry
  console.log('[8/10] Publishing & deploying VoteHistory + LinkRegistry...');

  const voteHistoryArtifactPath = resolve(__dirname, '../target/vote_history-vote_history.json');
  const voteHistoryArtifact = await loadArtifact(voteHistoryArtifactPath);
  const voteHistoryClassId = await publishClass(patchedWallet, voteHistoryArtifact, 'VoteHistory', keeperAddress);

  const vhDeploy = Contract.deploy(patchedWallet, voteHistoryArtifact, []);
  const { contract: vhDeployed } = await vhDeploy.send({
    contractAddressSalt: Fr.random(),
    skipClassPublication: true,
    from: keeperAddress,
    // Keeper pays with fee juice directly
  });
  const voteHistoryAddress = vhDeployed.address.toString();
  console.log(`  VoteHistory deployed at: ${voteHistoryAddress}`);

  const linkRegistryArtifactPath = resolve(__dirname, '../target/link_registry-link_registry.json');
  const linkRegistryArtifact = await loadArtifact(linkRegistryArtifactPath);
  const linkRegistryClassId = await publishClass(patchedWallet, linkRegistryArtifact, 'LinkRegistry', keeperAddress);

  const lrDeploy = Contract.deploy(patchedWallet, linkRegistryArtifact, []);
  const { contract: lrDeployed } = await lrDeploy.send({
    contractAddressSalt: Fr.random(),
    skipClassPublication: true,
    from: keeperAddress,
    // Keeper pays with fee juice directly
  });
  const linkRegistryAddress = lrDeployed.address.toString();
  console.log(`  LinkRegistry deployed at: ${linkRegistryAddress}`);

  // Step 9: Link contracts
  console.log('[9/10] Linking contracts: set_authorized_caller...');
  const duelCloakAddr = AztecAddress.fromString(duelCloakAddress);

  const upInstance = await node.getContract(userProfileAddr);
  if (upInstance) {
    await wallet.registerContract(upInstance, userProfileArtifact);
  }

  const userProfileContract = await Contract.at(userProfileAddr, userProfileArtifact, patchedWallet);
  await userProfileContract.methods.set_authorized_caller(duelCloakAddr).send({
    from: keeperAddress,
    // Keeper pays with fee juice directly
  });
  console.log(`  UserProfile.authorized_caller set to DuelCloak: ${duelCloakAddress}`);

  // Step 10: Copy artifacts + update env files
  console.log('[10/10] Copying artifacts and updating env files...');

  const artifactCopies = [
    [userProfileArtifactPath, 'UserProfile.json'],
    [duelCloakArtifactPath, 'DuelCloak.json'],
    [voteHistoryArtifactPath, 'VoteHistory.json'],
    [linkRegistryArtifactPath, 'LinkRegistry.json'],
  ];

  for (const [src, name] of artifactCopies) {
    copyArtifactClean(src, resolve(__dirname, `../../app/src/lib/aztec/artifacts/${name}`));
    copyArtifactClean(src, resolve(__dirname, `../../server/src/lib/aztec/artifacts/${name}`));
  }
  console.log('  Copied all artifacts to app and server');

  // Update env files
  const envFiles = [
    resolve(__dirname, '../../server/.env.local'),
    resolve(__dirname, '../../app/.env.local'),
  ];

  for (const envPath of envFiles) {
    let env = readFileSync(envPath, 'utf-8');
    env = updateEnvVar(env, 'VITE_AZTEC_NODE_URL', NODE_URL);
    env = updateEnvVar(env, 'VITE_SPONSORED_FPC_ADDRESS', fpcAddress);
    env = updateEnvVar(env, 'VITE_DUELCLOAK_ADDRESS', duelCloakAddress);
    env = updateEnvVar(env, 'VITE_DUELCLOAK_CLASS_ID', duelCloakClassId);
    env = updateEnvVar(env, 'VITE_USER_PROFILE_ADDRESS', userProfileAddress);
    env = updateEnvVar(env, 'VITE_VOTE_HISTORY_ADDRESS', voteHistoryAddress);
    env = updateEnvVar(env, 'VITE_LINK_REGISTRY_ADDRESS', linkRegistryAddress);
    writeFileSync(envPath, env);
    console.log(`  Updated: ${envPath}`);
  }

  // Update server-only env
  const serverEnvPath = resolve(__dirname, '../../server/.env.local');
  let serverEnv = readFileSync(serverEnvPath, 'utf-8');
  serverEnv = updateEnvVar(serverEnv, 'KEEPER_ADDRESS', keeperAddress.toString());
  writeFileSync(serverEnvPath, serverEnv);

  console.log('');
  console.log('='.repeat(60));
  console.log('TESTNET DEPLOYMENT COMPLETE!');
  console.log('='.repeat(60));
  console.log(`  VITE_AZTEC_NODE_URL=${NODE_URL}`);
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${fpcAddress}`);
  console.log(`  VITE_DUELCLOAK_ADDRESS=${duelCloakAddress}`);
  console.log(`  VITE_DUELCLOAK_CLASS_ID=${duelCloakClassId}`);
  console.log(`  VITE_USER_PROFILE_ADDRESS=${userProfileAddress}`);
  console.log(`  VITE_VOTE_HISTORY_ADDRESS=${voteHistoryAddress}`);
  console.log(`  VITE_LINK_REGISTRY_ADDRESS=${linkRegistryAddress}`);
  console.log(`  KEEPER_ADDRESS=${keeperAddress.toString()}`);
  console.log('');
  console.log('All contracts linked: DuelCloak V8 -> UserProfile V7 (authorized_caller)');
  console.log('Points awarded atomically during voting via cross-contract call.');
  console.log('Staking functions ready: stake_points, resolve_stake, burn_stake.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Set VITE_CREATE_DUEL_THRESHOLD=0 for bootstrapping (no points exist yet)');
  console.log('  2. Restart app and server to pick up new env vars');
  console.log('  3. Update Railway/Vercel env vars for production');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nDeployment failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
