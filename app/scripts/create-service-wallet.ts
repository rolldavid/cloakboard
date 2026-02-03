/**
 * Create and deploy a Molt service wallet on Aztec devnet.
 *
 * Usage:
 *   AZTEC_RPC_URL=https://devnet-6.aztec-labs.com/ npx tsx scripts/create-service-wallet.ts
 *
 * Outputs the keys to paste into .env.local:
 *   MOLT_SERVICE_SECRET_KEY
 *   MOLT_SERVICE_SALT
 */

import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { randomBytes } from 'crypto';

async function main() {
  const nodeUrl = process.env.AZTEC_RPC_URL || 'http://localhost:8080';
  console.log(`Connecting to Aztec node at ${nodeUrl}...`);

  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node);
  console.log('Connected.\n');

  // Generate random field elements as bigints (mod BN254 scalar field order)
  const fieldOrder = BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');
  const secretKeyBigint = BigInt('0x' + randomBytes(32).toString('hex')) % fieldOrder;
  const saltBigint = BigInt('0x' + randomBytes(32).toString('hex')) % fieldOrder;

  // Server import uses LMDB (Node.js compatible)
  const { TestWallet } = await import('@aztec/test-wallet/server');
  const testWallet = await TestWallet.create(node, { proverEnabled: true });

  console.log('Creating Schnorr account...');
  const accountManager = await testWallet.createAccount({
    secret: secretKeyBigint,
    salt: saltBigint,
  });

  const address = accountManager.address;
  console.log(`Account address: ${address.toString()}\n`);

  // Register SponsoredFPC for fee payment
  const fpcAddress = AztecAddress.fromString(
    process.env.NEXT_PUBLIC_SPONSORED_FPC_ADDRESS || '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e'
  );
  try {
    const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
    const { getContractInstanceFromInstantiationParams } = await import('@aztec/stdlib/contract');
    const { Fr: StdFr } = await import('@aztec/foundation/curves/bn254');
    const fpcInstance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContract.artifact,
      { salt: new StdFr(0) }
    );
    await testWallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
    console.log('SponsoredFPC registered.\n');
  } catch (err) {
    console.warn('Could not register SponsoredFPC:', err);
  }

  console.log('Deploying account on-chain...');
  const deployMethod = await accountManager.getDeployMethod();
  const paymentMethod = new SponsoredFeePaymentMethod(fpcAddress);

  await deployMethod.send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod },
  }).wait({ timeout: 300000 });
  console.log('Account deployed.\n');

  const secretKeyHex = '0x' + secretKeyBigint.toString(16).padStart(64, '0');
  const saltHex = '0x' + saltBigint.toString(16).padStart(64, '0');

  console.log('=== Add these to your .env.local ===\n');
  console.log(`MOLT_SERVICE_SECRET_KEY=${secretKeyHex}`);
  console.log(`MOLT_SERVICE_SALT=${saltHex}`);
  console.log(`\n# Service wallet address: ${address.toString()}`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
