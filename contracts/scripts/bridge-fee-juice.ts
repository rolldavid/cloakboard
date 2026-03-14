#!/usr/bin/env node
/**
 * Bridge fee juice from L1 (Sepolia) to L2 (testnet) for keeper.
 * Manual viem calls with proper gas, then extract claim data from receipt.
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { createLogger } from '@aztec/foundation/log';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createWalletClient, createPublicClient, http, parseAbi, parseEventLogs, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
const KEEPER_SECRET_KEY = process.env.KEEPER_SECRET_KEY!;
const KEEPER_SIGNING_KEY = process.env.KEEPER_SIGNING_KEY!;
const KEEPER_SALT = process.env.KEEPER_SALT!;
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY!;

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

// L1 contract addresses (from testnet node)
const FEE_JUICE_TOKEN = '0x762c132040fda6183066fa3b14d985ee55aa3c18' as Hex;
const FEE_JUICE_PORTAL = '0xd3361019e40026ce8a9745c19e67fd3acc10d596' as Hex;
const INBOX = '0xf1bb424ac888aa239f1e658b5bddabc65a1c94e6' as Hex;

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

const PORTAL_ABI = parseAbi([
  'function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) external returns (bytes32)',
]);

const INBOX_ABI = parseAbi([
  'event MessageSent(uint256 indexed l2BlockNumber, uint256 indexed index, bytes32 hash)',
]);

async function main() {
  console.log('Manual fee juice bridge from L1 to L2...\n');

  // Connect to L2 to get keeper address
  const node = createAztecNodeClient(NODE_URL);
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const salt = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const keeperAddress = accountManager.address ?? (accountManager as any).getAddress();
  console.log(`Keeper L2 address: ${keeperAddress.toString()}`);

  // Setup L1 clients
  const l1Account = privateKeyToAccount(`0x${SEPOLIA_PRIVATE_KEY}`);
  const l1Wallet = createWalletClient({
    account: l1Account,
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });
  const l1Public = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });

  console.log(`L1 account: ${l1Account.address}`);

  // Check FEE balance
  const balance = await l1Public.readContract({
    address: FEE_JUICE_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [l1Account.address],
  });
  console.log(`L1 FEE balance: ${balance.toString()} (${Number(balance) / 1e18} FEE)`);

  if (balance === 0n) {
    console.error('No FEE tokens! The SDK mint should have worked earlier.');
    console.error('Try requesting from faucet or mint manually.');
    process.exit(1);
  }

  const amount = balance > 500n * 10n ** 18n ? 500n * 10n ** 18n : balance;

  // Generate claim secret (same method as SDK)
  const { generateClaimSecret } = await import('@aztec/aztec.js/ethereum');
  const [claimSecret, claimSecretHash] = await generateClaimSecret();
  console.log(`\nClaim secret: ${claimSecret.toString()}`);
  console.log(`Claim secret hash: ${claimSecretHash.toString()}`);

  // Check and set approval
  const allowance = await l1Public.readContract({
    address: FEE_JUICE_TOKEN,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [l1Account.address, FEE_JUICE_PORTAL],
  });
  console.log(`Current allowance: ${allowance.toString()}`);

  if (allowance < amount) {
    console.log(`Approving ${amount} FEE for portal...`);
    const approveTx = await l1Wallet.writeContract({
      address: FEE_JUICE_TOKEN,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [FEE_JUICE_PORTAL, amount],
    });
    console.log(`Approve tx: ${approveTx}`);
    const approveReceipt = await l1Public.waitForTransactionReceipt({ hash: approveTx });
    console.log(`Approve confirmed: block ${approveReceipt.blockNumber}`);
  }

  // Deposit to Aztec
  console.log(`\nDepositing ${amount} FEE to L2 keeper...`);
  const depositTx = await l1Wallet.writeContract({
    address: FEE_JUICE_PORTAL,
    abi: PORTAL_ABI,
    functionName: 'depositToAztecPublic',
    args: [keeperAddress.toString() as Hex, amount, claimSecretHash.toString() as Hex],
  });
  console.log(`Deposit tx: ${depositTx}`);
  const depositReceipt = await l1Public.waitForTransactionReceipt({ hash: depositTx });
  console.log(`Deposit confirmed: block ${depositReceipt.blockNumber}`);

  // Extract messageLeafIndex from Inbox MessageSent event
  const messageSentLogs = parseEventLogs({
    abi: INBOX_ABI,
    logs: depositReceipt.logs,
  });

  let messageLeafIndex: bigint | undefined;
  for (const log of messageSentLogs) {
    if (log.eventName === 'MessageSent') {
      messageLeafIndex = (log.args as any).index;
      console.log(`Message leaf index: ${messageLeafIndex}`);
      break;
    }
  }

  if (messageLeafIndex === undefined) {
    console.log('Could not extract messageLeafIndex from logs. Dumping all logs:');
    for (const log of depositReceipt.logs) {
      console.log(JSON.stringify({ address: log.address, topics: log.topics, data: log.data }));
    }
  }

  console.log('\n=== CLAIM DATA (use with deploy-testnet.ts) ===');
  console.log(`CLAIM_AMOUNT=${amount.toString()}`);
  console.log(`CLAIM_SECRET=${claimSecret.toString()}`);
  console.log(`CLAIM_LEAF_INDEX=${messageLeafIndex?.toString() ?? 'UNKNOWN'}`);
  console.log(`\nRun deploy with:`);
  console.log(`CLAIM_SECRET=${claimSecret.toString()} CLAIM_LEAF_INDEX=${messageLeafIndex?.toString()} CLAIM_AMOUNT=${amount.toString()} npx tsx scripts/deploy-testnet.ts`);
  console.log(`\nWait 2-5 minutes for L1 message to propagate to L2 before running deploy.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Bridge failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
