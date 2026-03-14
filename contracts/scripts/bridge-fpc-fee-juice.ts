#!/usr/bin/env node
/**
 * Bridge fee juice from L1 (Sepolia) to L2 (testnet) for the SponsoredFPC.
 * Uses our own generateClaimSecret() for hash compatibility with SDK claim.
 */

import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { FeeJuiceContract } from '@aztec/aztec.js/protocol';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createWalletClient, createPublicClient, http, parseAbi, parseEventLogs, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
const FPC_ADDRESS = process.env.VITE_SPONSORED_FPC_ADDRESS!;
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY!;
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

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
  if (!FPC_ADDRESS) {
    console.error('VITE_SPONSORED_FPC_ADDRESS not set');
    process.exit(1);
  }

  const bridgeOnly = process.argv.includes('--bridge-only');
  const claimOnly = process.argv.includes('--claim-only');

  console.log('Fee juice bridge for SponsoredFPC\n');

  // Setup L1 clients
  const l1Account = privateKeyToAccount(`0x${SEPOLIA_PRIVATE_KEY}`);
  const l1Wallet = createWalletClient({ account: l1Account, chain: sepolia, transport: http(SEPOLIA_RPC) });
  const l1Public = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
  console.log(`L1 account: ${l1Account.address}`);

  let claimSecret: any, claimSecretHash: any, messageLeafIndex: bigint | undefined;
  let amount: bigint;

  if (!claimOnly) {
    // Check L1 FEE balance
    const balance = await l1Public.readContract({
      address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [l1Account.address],
    });
    console.log(`L1 FEE balance: ${balance.toString()} (${Number(balance) / 1e18} FEE)`);

    if (balance === 0n) {
      console.error('No FEE tokens on L1! Need Sepolia FEE tokens first.');
      process.exit(1);
    }

    // Bridge up to 500 FEE
    amount = balance > 500n * 10n ** 18n ? 500n * 10n ** 18n : balance;

    // Generate SDK-compatible claim secret
    const { generateClaimSecret } = await import('@aztec/aztec.js/ethereum');
    [claimSecret, claimSecretHash] = await generateClaimSecret();
    console.log(`\nClaim secret: ${claimSecret.toString()}`);
    console.log(`Claim secret hash: ${claimSecretHash.toString()}`);

    // Approve portal
    const allowance = await l1Public.readContract({
      address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'allowance',
      args: [l1Account.address, FEE_JUICE_PORTAL],
    });
    if (allowance < amount) {
      console.log(`Approving ${amount} FEE for portal...`);
      const approveTx = await l1Wallet.writeContract({
        address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'approve',
        args: [FEE_JUICE_PORTAL, amount],
      });
      await l1Public.waitForTransactionReceipt({ hash: approveTx });
      console.log('Approved.');
    }

    // Deposit to FPC address on L2
    const fpcHex = FPC_ADDRESS as Hex;
    console.log(`\nDepositing ${Number(amount) / 1e18} FEE to FPC ${FPC_ADDRESS.slice(0, 14)}...`);
    const depositTx = await l1Wallet.writeContract({
      address: FEE_JUICE_PORTAL, abi: PORTAL_ABI, functionName: 'depositToAztecPublic',
      args: [fpcHex, amount, claimSecretHash.toString() as Hex],
    });
    console.log(`Deposit tx: ${depositTx}`);
    const depositReceipt = await l1Public.waitForTransactionReceipt({ hash: depositTx });
    console.log(`Deposit confirmed: block ${depositReceipt.blockNumber}`);

    // Extract messageLeafIndex from Inbox log data (v4.1.0-rc.2 format)
    // Inbox is at INBOX address, leaf index is in the first 32 bytes of data
    for (const log of depositReceipt.logs) {
      if (log.address.toLowerCase() === INBOX.toLowerCase() && log.data.length >= 66) {
        const indexHex = '0x' + log.data.slice(2, 66);
        messageLeafIndex = BigInt(indexHex);
        console.log(`Message leaf index: ${messageLeafIndex}`);
        break;
      }
    }

    console.log('\n=== CLAIM DATA ===');
    console.log(`CLAIM_AMOUNT=${amount.toString()}`);
    console.log(`CLAIM_SECRET=${claimSecret.toString()}`);
    console.log(`CLAIM_LEAF_INDEX=${messageLeafIndex?.toString() ?? 'UNKNOWN'}`);

    if (bridgeOnly) {
      console.log('\n--bridge-only: stopping here. Run with --claim-only after 5-10 min.');
      console.log(`CLAIM_SECRET=${claimSecret.toString()} CLAIM_LEAF_INDEX=${messageLeafIndex?.toString()} CLAIM_AMOUNT=${amount.toString()} npx tsx scripts/claim-fpc-fee-juice.ts`);
      return;
    }

    // Wait for L1→L2 propagation
    console.log('\nWaiting 5 minutes for L1→L2 message propagation...');
    await new Promise(r => setTimeout(r, 5 * 60 * 1000));
  } else {
    // Claim-only mode: use env vars
    claimSecret = Fr.fromHexString(process.env.CLAIM_SECRET!);
    messageLeafIndex = BigInt(process.env.CLAIM_LEAF_INDEX!);
    amount = BigInt(process.env.CLAIM_AMOUNT || '1000000000000000000000');
    console.log('Claim-only mode. Using env var claim data.');
  }

  // Connect to L2 and claim
  console.log('\nConnecting to L2...');
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const secretKey = Fr.fromHexString(process.env.KEEPER_SECRET_KEY!);
  const salt = Fr.fromHexString(process.env.KEEPER_SALT!);
  const signingKey = GrumpkinScalar.fromHexString(process.env.KEEPER_SIGNING_KEY!);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const keeperAddress = accountManager.address;
  console.log(`Keeper: ${keeperAddress.toString()}`);

  // Register keeper
  const keeperInstance = await node.getContract(keeperAddress);
  if (keeperInstance) {
    const accountContract = accountManager.getAccountContract();
    const keeperArtifact = await accountContract.getContractArtifact();
    await wallet.registerContract(keeperInstance as any, keeperArtifact as any, secretKey);
  }

  const fpcAddress = AztecAddress.fromString(FPC_ADDRESS);
  const feeJuice = FeeJuiceContract.at(wallet);

  // Retry claim up to 5 times
  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`\nClaim attempt ${attempt}/5...`);
    try {
      const { receipt } = await feeJuice.methods
        .claim(fpcAddress, amount, claimSecret, new Fr(messageLeafIndex!))
        .send({ from: keeperAddress });
      console.log(`\nClaim successful! tx: ${receipt.txHash.toString()}`);
      break;
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('message') && attempt < 5) {
        console.log('Message not yet available, waiting 60s...');
        await new Promise(r => setTimeout(r, 60_000));
      } else {
        console.error('Claim failed:', msg);
        if (attempt === 5) process.exit(1);
      }
    }
  }

  // Verify balance
  try {
    const { result: balance } = await feeJuice.methods
      .balance_of_public(fpcAddress)
      .simulate({ from: keeperAddress });
    console.log(`\nSponsoredFPC fee juice balance: ${balance.toString()} (${Number(balance) / 1e18} FEE)`);
  } catch (err: any) {
    console.warn('Could not read FPC balance:', err?.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err.message || err);
    process.exit(1);
  });
