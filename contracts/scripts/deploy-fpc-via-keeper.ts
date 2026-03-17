#!/usr/bin/env node
/**
 * Deploy SponsoredFPC via keeper using FeeJuicePaymentMethodWithClaim.
 *
 * 1. Bridge 100 FEE to keeper address (for deploy gas)
 * 2. Wait for L1->L2 propagation
 * 3. Publish SponsoredFPC class + deploy instance using keeper + claim payment
 * 4. Bridge 100,000 FEE to the new SponsoredFPC address
 * 5. Wait + claim
 * 6. Update env files
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

const NODE_URL = process.env.VITE_AZTEC_NODE_URL!;
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY!;
const KEEPER_SECRET_KEY = process.env.KEEPER_SECRET_KEY!;
const KEEPER_SIGNING_KEY = process.env.KEEPER_SIGNING_KEY!;
const KEEPER_SALT = process.env.KEEPER_SALT!;
const KEEPER_ADDRESS = process.env.KEEPER_ADDRESS!;
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

const FEE_JUICE_TOKEN = '0x762c132040fda6183066fa3b14d985ee55aa3c18' as Hex;
const FEE_JUICE_PORTAL = '0xd3361019e40026ce8a9745c19e67fd3acc10d596' as Hex;
const INBOX = '0xf1bb424ac888aa239f1e658b5bddabc65a1c94e6' as Hex;

const OUR_SALT = new Fr(42n);

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

async function bridgeToL2(targetAddress: string, amount: bigint, l1Wallet: any, l1Public: any): Promise<{ claimSecret: any; messageLeafIndex: bigint; amount: bigint }> {
  const [claimSecret, claimSecretHash] = await generateClaimSecret();

  const allowance = await l1Public.readContract({
    address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'allowance',
    args: [l1Wallet.account.address, FEE_JUICE_PORTAL],
  });
  if (allowance < amount) {
    console.log('  Approving...');
    const tx = await l1Wallet.writeContract({
      address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'approve',
      args: [FEE_JUICE_PORTAL, amount],
    });
    await l1Public.waitForTransactionReceipt({ hash: tx });
  }

  console.log(`  Depositing ${Number(amount) / 1e18} FEE to ${targetAddress.slice(0, 14)}...`);
  const depositTx = await l1Wallet.writeContract({
    address: FEE_JUICE_PORTAL, abi: PORTAL_ABI, functionName: 'depositToAztecPublic',
    args: [targetAddress as Hex, amount, claimSecretHash.toString() as Hex],
  });
  const receipt = await l1Public.waitForTransactionReceipt({ hash: depositTx });
  console.log(`  Deposit confirmed: block ${receipt.blockNumber}`);

  let messageLeafIndex = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === INBOX.toLowerCase() && log.data.length >= 66) {
      messageLeafIndex = BigInt('0x' + log.data.slice(2, 66));
      break;
    }
  }
  console.log(`  Leaf index: ${messageLeafIndex}`);

  return { claimSecret, messageLeafIndex, amount };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Deploy Own SponsoredFPC via Keeper Claim');
  console.log('='.repeat(60));

  const l1Account = privateKeyToAccount(`0x${SEPOLIA_PRIVATE_KEY}`);
  const l1Wallet = createWalletClient({ account: l1Account, chain: sepolia, transport: http(SEPOLIA_RPC) });
  const l1Public = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

  const balance = await l1Public.readContract({
    address: FEE_JUICE_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [l1Account.address],
  });
  console.log(`L1 FEE balance: ${Number(balance) / 1e18} FEE`);

  // Compute FPC address
  const fpcInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: OUR_SALT },
  );
  const fpcAddress = fpcInstance.address.toString();
  console.log(`FPC address (salt=42): ${fpcAddress}`);

  // Step 1: Bridge 100 FEE to keeper for deploy gas
  console.log('\n[1/6] Bridging 100 FEE to keeper for deploy gas...');
  const deployGas = 100n * 10n ** 18n;
  const keeperClaim = await bridgeToL2(KEEPER_ADDRESS, deployGas, l1Wallet, l1Public);

  // Step 2: Wait for propagation
  console.log('\n[2/6] Waiting 5 minutes for L1->L2 propagation...');
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));

  // Step 3: Connect and deploy
  console.log('\n[3/6] Connecting to L2 and deploying...');
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  console.log(`  Block: ${await node.getBlockNumber()}`);

  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const patchedWallet = wallet as any;
  if (!patchedWallet.getContractClassMetadata) {
    patchedWallet.getContractClassMetadata = async (id: any) => (wallet as any).pxe.getContractClassMetadata(id);
  }
  if (!patchedWallet.getContractMetadata) {
    patchedWallet.getContractMetadata = async (addr: any) => (wallet as any).pxe.getContractMetadata(addr);
  }

  const secretKey = Fr.fromHexString(KEEPER_SECRET_KEY);
  const keeperSaltFr = Fr.fromHexString(KEEPER_SALT);
  const signingKey = GrumpkinScalar.fromHexString(KEEPER_SIGNING_KEY);
  const acct = await wallet.createSchnorrAccount(secretKey, keeperSaltFr, signingKey, 'keeper');
  await wallet.registerContract(acct.getInstance(), await acct.getAccountContract().getContractArtifact(), secretKey);
  const keeperAddr = acct.address;
  console.log(`  Keeper: ${keeperAddr.toString()}`);

  // Payment method: keeper claims FEE and pays gas
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(keeperAddr, {
    claimAmount: keeperClaim.amount,
    claimSecret: keeperClaim.claimSecret,
    messageLeafIndex: keeperClaim.messageLeafIndex,
  });

  // Publish class
  console.log('  Publishing SponsoredFPC class...');
  const contractClass = await getContractClassFromArtifact(SponsoredFPCContract.artifact);
  let classPublished = false;
  try {
    const meta = await patchedWallet.getContractClassMetadata(contractClass.id);
    classPublished = meta && meta.isContractClassPubliclyRegistered;
  } catch {}

  if (!classPublished) {
    try {
      const classTx = await publishContractClass(patchedWallet, SponsoredFPCContract.artifact);
      await classTx.send({ from: keeperAddr, fee: { paymentMethod } });
      console.log('  Class published!');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Existing nullifier') || msg.includes('already')) {
        console.log('  Class already published');
      } else {
        console.error('  Class publish failed:', msg.slice(0, 200));
        throw err;
      }
    }
  } else {
    console.log('  Class already published');
  }

  // Need fresh claim for deploy tx (previous claim was consumed by class publish)
  // Bridge another small amount for deploy
  console.log('\n[4/6] Bridging 100 FEE to keeper for instance deploy...');
  const deployClaim = await bridgeToL2(KEEPER_ADDRESS, deployGas, l1Wallet, l1Public);
  console.log('  Waiting 5 minutes...');
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));

  const paymentMethod2 = new FeeJuicePaymentMethodWithClaim(keeperAddr, {
    claimAmount: deployClaim.amount,
    claimSecret: deployClaim.claimSecret,
    messageLeafIndex: deployClaim.messageLeafIndex,
  });

  // Deploy instance
  console.log('  Deploying SponsoredFPC instance (salt=42)...');
  // Register with PXE
  await wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);

  try {
    const deploy = Contract.deploy(patchedWallet, SponsoredFPCContract.artifact, []);
    const { contract: deployed } = await deploy.send({
      contractAddressSalt: OUR_SALT,
      skipClassPublication: true,
      from: keeperAddr,
      fee: { paymentMethod: paymentMethod2 },
    });
    console.log(`  Deployed at: ${deployed.address.toString()}`);
  } catch (err: any) {
    const onChain = await node.getContract(fpcInstance.address);
    if (onChain) {
      console.log(`  Deployed at: ${fpcAddress} (verified on-chain)`);
    } else {
      throw err;
    }
  }

  // Step 5: Bridge 100,000 FEE to the FPC
  console.log('\n[5/6] Bridging 100,000 FEE to SponsoredFPC...');
  const fpcFunding = 100_000n * 10n ** 18n;
  const fpcClaim = await bridgeToL2(fpcAddress, fpcFunding, l1Wallet, l1Public);
  console.log('  Waiting 5 minutes...');
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));

  // Claim for FPC — use SponsoredFPC itself to pay (it's now deployed)
  // Actually, use keeper claim again since FPC has no balance yet
  // The FeeJuice.claim is a public function anyone can call
  const feeJuice = FeeJuiceContract.at(wallet);

  // Register SponsoredFPC for gas payment
  const fpcOnChain = await node.getContract(fpcInstance.address);
  if (fpcOnChain) {
    await wallet.registerContract(fpcOnChain as any, SponsoredFPCContract.artifact as any);
  }

  // Claim FPC's fee juice using a third keeper bridge for gas
  console.log('  Bridging 50 FEE to keeper for claim gas...');
  const claimGas = 50n * 10n ** 18n;
  const claimGasClaim = await bridgeToL2(KEEPER_ADDRESS, claimGas, l1Wallet, l1Public);
  console.log('  Waiting 5 minutes...');
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));

  const paymentMethod3 = new FeeJuicePaymentMethodWithClaim(keeperAddr, {
    claimAmount: claimGasClaim.amount,
    claimSecret: claimGasClaim.claimSecret,
    messageLeafIndex: claimGasClaim.messageLeafIndex,
  });

  console.log('  Claiming 100,000 FEE for SponsoredFPC...');
  await feeJuice.methods
    .claim(fpcInstance.address, fpcFunding, fpcClaim.claimSecret, new Fr(fpcClaim.messageLeafIndex))
    .send({ from: keeperAddr, fee: { paymentMethod: paymentMethod3 } });

  console.log('  Claimed!');

  // Step 6: Update env files
  console.log('\n[6/6] Updating env files...');
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

  // Verify
  try {
    const { result: bal } = await feeJuice.methods
      .balance_of_public(fpcInstance.address)
      .simulate({ from: keeperAddr });
    console.log(`\nFPC balance: ${Number(bal) / 1e18} FEE`);
  } catch { console.log('\nCould not verify balance'); }

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
  console.log(`  VITE_SPONSORED_FPC_ADDRESS=${fpcAddress}`);
  console.log('='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  });
