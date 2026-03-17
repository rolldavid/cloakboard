#!/usr/bin/env node
/**
 * Deploy our own SponsoredFPC using the canonical artifact but a custom salt.
 *
 * Steps:
 * 1. Compute deterministic address from salt=42
 * 2. Bridge fee juice from L1 to that address
 * 3. Wait for L1->L2 propagation
 * 4. Deploy using FeeJuicePaymentMethodWithClaim (self-funding)
 * 5. Bridge more fee juice for ongoing operations
 * 6. Update env files
 *
 * Usage: cd contracts && npx tsx scripts/deploy-own-sponsored-fpc.ts
 */

import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getContractInstanceFromInstantiationParams, getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { Contract } from '@aztec/aztec.js/contracts';
import { publishContractClass } from '@aztec/aztec.js/deployment';
import { FeeJuicePaymentMethodWithClaim } from '@aztec/aztec.js/fee';
import { FeeJuiceContract } from '@aztec/aztec.js/protocol';
import { generateClaimSecret } from '@aztec/aztec.js/ethereum';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { createWalletClient, createPublicClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY!;
const KEEPER_SECRET_KEY = process.env.KEEPER_SECRET_KEY!;
const KEEPER_SIGNING_KEY = process.env.KEEPER_SIGNING_KEY!;
const KEEPER_SALT = process.env.KEEPER_SALT!;
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

const FEE_JUICE_TOKEN = '0x762c132040fda6183066fa3b14d985ee55aa3c18' as Hex;
const FEE_JUICE_PORTAL = '0xd3361019e40026ce8a9745c19e67fd3acc10d596' as Hex;
const INBOX = '0xf1bb424ac888aa239f1e658b5bddabc65a1c94e6' as Hex;

const OUR_SALT = new Fr(42n);
const BRIDGE_AMOUNT = 1_000_000n * 10n ** 18n; // 1M FEE

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const PORTAL_ABI = parseAbi([
  'function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) external returns (bytes32)',
]);

function updateEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`${key}=.*`);
  if (content.match(regex)) return content.replace(regex, `${key}=${value}`);
  return content + `\n${key}=${value}\n`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Deploy Own SponsoredFPC (canonical artifact, salt=42)');
  console.log('='.repeat(60));

  // Step 1: Compute address
  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: OUR_SALT },
  );
  const fpcAddress = instance.address.toString();
  console.log(`\nFPC address: ${fpcAddress}`);

  // Step 2: Bridge fee juice from L1
  console.log('\n[1/5] Bridging fee juice from L1...');
  const l1Account = privateKeyToAccount(`0x${SEPOLIA_PRIVATE_KEY}`);
  const l1Wallet = createWalletClient({ account: l1Account, chain: sepolia, transport: http(SEPOLIA_RPC) });
  const l1Public = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

  const balance = await l1Public.readContract({
    address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [l1Account.address],
  });
  console.log(`  L1 FEE balance: ${Number(balance) / 1e18} FEE`);

  const amount = balance > BRIDGE_AMOUNT ? BRIDGE_AMOUNT : balance;
  if (amount === 0n) {
    console.error('No FEE tokens on L1!');
    process.exit(1);
  }

  const [claimSecret, claimSecretHash] = await generateClaimSecret();
  console.log(`  Claim secret: ${claimSecret.toString()}`);

  // Approve portal
  const allowance = await l1Public.readContract({
    address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'allowance',
    args: [l1Account.address, FEE_JUICE_PORTAL],
  });
  if (allowance < amount) {
    console.log(`  Approving...`);
    const tx = await l1Wallet.writeContract({
      address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'approve',
      args: [FEE_JUICE_PORTAL, amount],
    });
    await l1Public.waitForTransactionReceipt({ hash: tx });
  }

  // Deposit to FPC address
  console.log(`  Depositing ${Number(amount) / 1e18} FEE to ${fpcAddress.slice(0, 14)}...`);
  const depositTx = await l1Wallet.writeContract({
    address: FEE_JUICE_PORTAL, abi: PORTAL_ABI, functionName: 'depositToAztecPublic',
    args: [fpcAddress as Hex, amount, claimSecretHash.toString() as Hex],
  });
  const receipt = await l1Public.waitForTransactionReceipt({ hash: depositTx });
  console.log(`  Deposit confirmed: block ${receipt.blockNumber}`);

  // Extract leaf index
  let messageLeafIndex: bigint = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === INBOX.toLowerCase() && log.data.length >= 66) {
      messageLeafIndex = BigInt('0x' + log.data.slice(2, 66));
      break;
    }
  }
  console.log(`  Leaf index: ${messageLeafIndex}`);

  // Step 3: Wait for propagation
  console.log('\n[2/5] Waiting 5 minutes for L1->L2 propagation...');
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));

  // Step 4: Connect to L2 and deploy
  console.log('\n[3/5] Connecting to L2...');
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  console.log(`  Block: ${await node.getBlockNumber()}`);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const keeperSalt = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);
  const acct = await wallet.createSchnorrAccount(secretKey, keeperSalt, signingKey, 'keeper');
  await wallet.registerContract(acct.getInstance(), await acct.getAccountContract().getContractArtifact(), secretKey);
  const keeperAddr = acct.address;
  console.log(`  Keeper: ${keeperAddr.toString()}`);

  // Publish class first (keeper pays from own balance... but needs FPC)
  // Actually, use the claim to pay for EVERYTHING
  console.log('\n[4/5] Publishing class + deploying instance...');

  const claim = {
    claimAmount: amount,
    claimSecret,
    messageLeafIndex,
  };

  // The FPC address is the fee payer AND the contract being deployed
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(
    AztecAddress.fromString(fpcAddress),
    claim,
  );

  // Register the instance with PXE before deploying
  await wallet.registerContract(instance, SponsoredFPCContract.artifact);

  // Publish class
  try {
    const patchedWallet = wallet as any;
    if (!patchedWallet.getContractClassMetadata) {
      patchedWallet.getContractClassMetadata = async (id: any) => (wallet as any).pxe.getContractClassMetadata(id);
    }
    if (!patchedWallet.getContractMetadata) {
      patchedWallet.getContractMetadata = async (addr: any) => (wallet as any).pxe.getContractMetadata(addr);
    }

    const contractClass = await getContractClassFromArtifact(SponsoredFPCContract.artifact);
    let published = false;
    try {
      const meta = await patchedWallet.getContractClassMetadata(contractClass.id);
      published = meta && meta.isContractClassPubliclyRegistered;
    } catch {}

    if (!published) {
      console.log('  Publishing class...');
      const classTx = await publishContractClass(patchedWallet, SponsoredFPCContract.artifact);
      await classTx.send({
        from: keeperAddr,
        fee: { paymentMethod },
      });
      console.log('  Class published!');
    } else {
      console.log('  Class already published');
    }
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg.includes('Existing nullifier') || msg.includes('already')) {
      console.log('  Class already published (nullifier)');
    } else {
      console.warn('  Class publish failed:', msg.slice(0, 100));
      console.warn('  Continuing with deploy...');
    }
  }

  // Deploy instance
  console.log('  Deploying instance...');
  try {
    const deploy = Contract.deploy(wallet, SponsoredFPCContract.artifact, []);
    const { contract: deployed } = await deploy.send({
      contractAddressSalt: OUR_SALT,
      skipClassPublication: true,
      from: keeperAddr,
      fee: { paymentMethod },
    });
    console.log(`  Deployed at: ${deployed.address.toString()}`);
  } catch (err: any) {
    // Check if it deployed despite the error
    const onChain = await node.getContract(AztecAddress.fromString(fpcAddress));
    if (onChain) {
      console.log(`  Deployed at: ${fpcAddress} (verified on-chain)`);
    } else {
      throw err;
    }
  }

  // Step 5: Update env files
  console.log('\n[5/5] Updating env files...');
  const envFiles = [
    resolve(__dirname, '../../server/.env.local'),
    resolve(__dirname, '../../app/.env.local'),
  ];
  for (const envPath of envFiles) {
    let env = readFileSync(envPath, 'utf-8');
    env = updateEnvVar(env, 'VITE_SPONSORED_FPC_ADDRESS', fpcAddress);
    writeFileSync(envPath, env);
    console.log(`  Updated: ${envPath}`);
  }

  // Verify balance
  const feeJuice = FeeJuiceContract.at(wallet);
  try {
    const { result: bal } = await feeJuice.methods
      .balance_of_public(AztecAddress.fromString(fpcAddress))
      .simulate({ from: keeperAddr });
    console.log(`\nFPC fee juice balance: ${Number(bal) / 1e18} FEE`);
  } catch {
    console.log('\nCould not read FPC balance (may need a block to finalize)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('OWN SPONSORED FPC DEPLOYED');
  console.log('='.repeat(60));
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${fpcAddress}`);
  console.log(`  Salt: 42`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
