/**
 * Deploy CloakRegistry Contract
 *
 * The CloakRegistry is a singleton contract that maps cloak names to addresses.
 * This enables slug-based URLs like /cloak/my-dao instead of /cloak/0x...
 *
 * IMPORTANT: Contracts must be compiled with `aztec compile` (NOT `nargo compile`).
 * `aztec compile` transpiles public functions to AVM bytecode and generates VKs.
 * Without transpilation, public function calls revert with `app_logic_reverted`.
 *
 * Pattern:
 * 1. Publish contract class separately (from: ZERO — private-only call)
 * 2. Deploy instance with skipClassPublication: true (from: ZERO — signerless)
 *
 * After deployment, update the app configuration:
 * 1. Set NEXT_PUBLIC_CLOAK_REGISTRY_ADDRESS in .env.local
 *
 * Usage:
 *   npx ts-node scripts/deploy_registry.ts
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Contract } from "@aztec/aztec.js/contracts";
import { loadContractArtifact } from "@aztec/stdlib/abi";
import { getContractInstanceFromInstantiationParams, getContractClassFromArtifact } from "@aztec/stdlib/contract";
import { publishContractClass } from "@aztec/aztec.js/deployment";
import { TestWallet } from "@aztec/test-wallet/server";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import type { Wallet, PXE } from "@aztec/aztec.js";

// Get node URL from env
const NODE_URL = process.env.NEXT_PUBLIC_AZTEC_NODE_URL || "https://devnet-6.aztec-labs.com";

// Sponsored FPC address for devnet
const SPONSORED_FPC_ADDRESS = process.env.NEXT_PUBLIC_SPONSORED_FPC_ADDRESS || "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

// Timeouts (devnet can be slow)
const DEPLOY_TIMEOUT = 1200000; // 20 minutes

/**
 * Patch a TestWallet to add missing PXE methods that DeployMethod expects.
 */
function patchWalletForDeployment(wallet: any): Wallet {
  const pxe = wallet.pxe as PXE;

  if (!wallet.getContractClassMetadata) {
    wallet.getContractClassMetadata = async (id: Fr) => {
      return pxe.getContractClassMetadata(id);
    };
  }

  if (!wallet.getContractMetadata) {
    wallet.getContractMetadata = async (address: AztecAddress) => {
      return pxe.getContractMetadata(address);
    };
  }

  return wallet as Wallet;
}

async function main() {
  console.log("=".repeat(60));
  console.log("CloakRegistry Deployment");
  console.log("=".repeat(60));
  console.log("");
  console.log(`Node URL: ${NODE_URL}`);

  // Connect to node
  console.log("\nConnecting to Aztec node...");
  const node = createAztecNodeClient(NODE_URL);

  try {
    await waitForNode(node);
    const nodeInfo = await node.getNodeInfo();
    console.log(`Connected! Node version: ${nodeInfo.nodeVersion}`);
  } catch (e) {
    console.error("Failed to connect to Aztec node.");
    throw e;
  }

  // Create TestWallet for account operations (enables prover for devnet)
  console.log("\nCreating TestWallet...");
  const testWallet = await TestWallet.create(node, { proverEnabled: true });
  console.log("TestWallet created!");

  // Setup fee payment
  const fpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  const paymentMethod = new SponsoredFeePaymentMethod(fpcAddress);
  console.log(`Using FPC for fee payment: ${fpcAddress.toString()}`);

  // Register FPC contract with wallet (required for fee payment)
  console.log("Registering FPC contract...");
  const fpcInstance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    { salt: new Fr(0) }
  );
  await testWallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
  console.log("FPC contract registered!");

  // Load and prepare artifact (must be compiled with `aztec compile`, not `nargo compile`)
  console.log("\nLoading CloakRegistry artifact...");
  const artifactModule = await import('../target/cloak_registry-CloakRegistry.json', { with: { type: 'json' } });
  const rawArtifact = artifactModule.default as any;
  rawArtifact.transpiled = true;
  const artifact = loadContractArtifact(rawArtifact);

  // Patch the TestWallet with missing PXE methods needed for deployment
  console.log("Patching wallet for deployment...");
  const deploymentWallet = patchWalletForDeployment(testWallet);

  // Step 1: Publish the contract class SEPARATELY.
  // Class publication is a private-only call, so from: ZERO works.
  console.log("\nStep 1: Publishing contract class...");
  const contractClass = await getContractClassFromArtifact(artifact);
  console.log(`Contract class ID: ${contractClass.id.toString()}`);

  let classPublished = false;
  try {
    const metadata = await deploymentWallet.getContractClassMetadata(contractClass.id);
    classPublished = metadata && metadata.isContractClassPubliclyRegistered;
    if (classPublished) {
      console.log("Contract class already published on-chain, skipping.");
    }
  } catch {
    // Not found locally — need to publish
  }

  if (!classPublished) {
    try {
      const publishTx = await publishContractClass(deploymentWallet, artifact);
      await publishTx.send({
        from: AztecAddress.ZERO,
        fee: { paymentMethod },
      }).wait({ timeout: DEPLOY_TIMEOUT });
      console.log("Contract class published successfully!");
    } catch (publishErr: any) {
      const msg = publishErr?.message ?? '';
      if (msg.includes('Existing nullifier') || msg.includes('already registered') || msg.includes('app_logic_reverted')) {
        console.log("Contract class already published (nullifier exists), continuing...");
      } else {
        console.error("Failed to publish contract class:", msg);
        throw publishErr;
      }
    }
  }

  // Step 2: Deploy contract instance.
  // skipClassPublication: true — class was published in Step 1 (PXE may not have synced).
  // from: ZERO — signerless deploy (works now that bytecode is properly transpiled).
  console.log("\nStep 2: Deploying CloakRegistry instance...");

  const deployTx = Contract.deploy(deploymentWallet, artifact, []);

  const instance = await deployTx.getInstance({
    contractAddressSalt: Fr.random(),
  });
  const expectedAddress = instance.address;
  console.log(`Expected address: ${expectedAddress.toString()}`);

  const sentTx = deployTx.send({
    skipClassPublication: true,
    from: AztecAddress.ZERO,
    fee: { paymentMethod },
  } as any);

  try {
    const deployedContract = await sentTx.deployed({ timeout: DEPLOY_TIMEOUT });
    const contractAddress = deployedContract.address.toString();

    // Verify on-chain
    const onChain = await node.getContract(deployedContract.address);
    if (!onChain) {
      console.warn("WARNING: Contract not found via node.getContract() — may need to wait for sync");
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("Deployment Successful!");
    console.log("=".repeat(60));
    console.log("");
    console.log(`CloakRegistry Address: ${contractAddress}`);
    console.log("");
    console.log("Add to app/.env.local:");
    console.log(`   NEXT_PUBLIC_CLOAK_REGISTRY_ADDRESS=${contractAddress}`);
    console.log("");

    return {
      contractAddress,
    };
  } catch (deployError) {
    console.warn("Deployment wait failed, checking if contract exists on-chain...", deployError);

    try {
      const onChainInstance = await node.getContract(expectedAddress);
      if (!onChainInstance) {
        console.error("Contract NOT found on-chain. Deployment truly failed.");
        throw deployError;
      }

      console.log(`\nCloakRegistry deployed at: ${expectedAddress.toString()}`);
      console.log("DEPLOYMENT SUCCESSFUL (verified on-chain)!");
      console.log(`NEXT_PUBLIC_CLOAK_REGISTRY_ADDRESS=${expectedAddress.toString()}`);

      return {
        contractAddress: expectedAddress.toString(),
      };
    } catch (verifyErr) {
      if (verifyErr === deployError) throw deployError;
      console.error("On-chain verification also failed:", verifyErr);
      throw deployError;
    }
  }
}

main()
  .then((result) => {
    console.log("=".repeat(60));
    console.log("Deployment Result:");
    console.log("=".repeat(60));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });
