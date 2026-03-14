#!/usr/bin/env node
/**
 * Claim bridged fee juice for the SponsoredFPC on L2.
 *
 * The faucet (or bridge-fee-juice.ts) bridges fee juice from L1 to L2,
 * creating an L1→L2 message. This script consumes that message on L2
 * via FeeJuice.claim(), crediting the FPC's public balance.
 *
 * Usage:
 *   CLAIM_SECRET=0x... CLAIM_LEAF_INDEX=... CLAIM_AMOUNT=... npx tsx scripts/claim-fpc-fee-juice.ts
 */

import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { FeeJuiceContract } from '@aztec/aztec.js/protocol';

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../server/.env.local') });

const NODE_URL = process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
const FPC_ADDRESS = process.env.VITE_SPONSORED_FPC_ADDRESS!;

const CLAIM_SECRET = process.env.CLAIM_SECRET!;
const CLAIM_LEAF_INDEX = process.env.CLAIM_LEAF_INDEX!;
const CLAIM_AMOUNT = process.env.CLAIM_AMOUNT || '1000000000000000000000';

async function main() {
  if (!FPC_ADDRESS) {
    console.error('VITE_SPONSORED_FPC_ADDRESS not set in server/.env.local');
    process.exit(1);
  }
  if (!CLAIM_SECRET || !CLAIM_LEAF_INDEX) {
    console.error('Missing CLAIM_SECRET or CLAIM_LEAF_INDEX env vars.');
    console.error('Get these from the faucet response or bridge-fee-juice.ts output.');
    process.exit(1);
  }

  console.log('Claiming fee juice for SponsoredFPC on L2...\n');
  console.log(`  FPC: ${FPC_ADDRESS}`);
  console.log(`  Amount: ${CLAIM_AMOUNT}`);
  console.log(`  Leaf index: ${CLAIM_LEAF_INDEX}`);

  // Connect to L2
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  console.log('\nNode connected.');

  // Create keeper wallet
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const secretKey = Fr.fromHexString(process.env.KEEPER_SECRET_KEY!);
  const salt = Fr.fromHexString(process.env.KEEPER_SALT!);
  const signingKey = GrumpkinScalar.fromHexString(process.env.KEEPER_SIGNING_KEY!);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey, 'keeper');
  const keeperAddress = accountManager.address;
  console.log(`Keeper: ${keeperAddress.toString()}`);

  // Register keeper on-chain instance
  const keeperInstance = await node.getContract(keeperAddress);
  if (keeperInstance) {
    const accountContract = accountManager.getAccountContract();
    const keeperArtifact = await accountContract.getContractArtifact();
    await wallet.registerContract(keeperInstance as any, keeperArtifact as any, secretKey);
    console.log('Keeper registered with PXE.');
  }

  // Use FeeJuiceContract from protocol (follows faucet SDK snippet)
  const feeJuice = FeeJuiceContract.at(wallet);
  const fpcAddress = AztecAddress.fromString(FPC_ADDRESS);

  console.log(`\nClaiming ${CLAIM_AMOUNT} fee juice for FPC...`);
  console.log('(Keeper sends claim tx — pays gas from its own fee juice balance)');

  try {
    const { receipt } = await feeJuice.methods
      .claim(
        fpcAddress,
        BigInt(CLAIM_AMOUNT),
        Fr.fromHexString(CLAIM_SECRET),
        new Fr(BigInt(CLAIM_LEAF_INDEX)),
      )
      .send({ from: keeperAddress });

    console.log(`\nClaim successful! tx: ${receipt.txHash.toString()}`);
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg.includes('No non-nullified L1 to L2 message') || msg.includes('message not found')) {
      console.error('\nL1→L2 message not yet available on L2.');
      console.error('Wait 5-10 minutes for the L2 sequencer to process L1 blocks, then retry.');
    } else {
      console.error('\nClaim failed:', msg);
      if (err.stack) console.error(err.stack);
    }
    process.exit(1);
  }

  // Verify FPC balance
  try {
    const { result: balance } = await feeJuice.methods
      .balance_of_public(fpcAddress)
      .simulate({ from: keeperAddress });
    console.log(`SponsoredFPC fee juice balance: ${balance.toString()} (${Number(balance) / 1e18} FEE)`);
  } catch (err: any) {
    console.warn('Could not read FPC balance (non-fatal):', err?.message);
  }

  // Also check keeper balance
  try {
    const { result: keeperBal } = await feeJuice.methods
      .balance_of_public(keeperAddress)
      .simulate({ from: keeperAddress });
    console.log(`Keeper fee juice balance: ${keeperBal.toString()} (${Number(keeperBal) / 1e18} FEE)`);
  } catch (err: any) {
    console.warn('Could not read keeper balance (non-fatal):', err?.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
