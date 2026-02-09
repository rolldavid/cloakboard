/**
 * Deploy StarredCloaks contract to Aztec devnet
 *
 * This script deploys the StarredCloaks contract and uses a Sponsored FPC
 * for fee payment so no tokens are needed.
 *
 * Usage:
 *   yarn ts-node scripts/deploy_starred_cloaks.ts
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Contract, DeployMethod } from "@aztec/aztec.js/contracts";
import { loadContractArtifact } from "@aztec/stdlib/abi";
import { getContractInstanceFromInstantiationParams, getContractClassFromArtifact } from "@aztec/stdlib/contract";
import { TestWallet } from "@aztec/test-wallet/server";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import type { Wallet, PXE } from "@aztec/aztec.js";

// Get node URL from env
const NODE_URL = process.env.NEXT_PUBLIC_AZTEC_NODE_URL || "https://devnet-6.aztec-labs.com";

// Sponsored FPC address for devnet
const SPONSORED_FPC_ADDRESS = "0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e";

// Timeouts (devnet can be slow)
const DEPLOY_TIMEOUT = 1200000; // 20 minutes

/**
 * Patch a TestWallet to add missing PXE methods that DeployMethod expects.
 * TestWallet has this.pxe but doesn't expose certain methods directly.
 */
function patchWalletForDeployment(wallet: any): Wallet {
  const pxe = wallet.pxe as PXE;

  // Add getContractClassMetadata if missing - needed by DeployMethod.getPublicationExecutionPayload
  if (!wallet.getContractClassMetadata) {
    wallet.getContractClassMetadata = async (id: Fr) => {
      return pxe.getContractClassMetadata(id);
    };
  }

  // Add getContractMetadata if missing - needed by protocol_contracts.js
  if (!wallet.getContractMetadata) {
    wallet.getContractMetadata = async (address: AztecAddress) => {
      return pxe.getContractMetadata(address);
    };
  }

  return wallet as Wallet;
}

async function main() {
  console.log("Starting StarredCloaks deployment...");
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

  // Create deployer account using TestWallet's helper method
  console.log("\nCreating deployer account...");
  const deployerSecretKey = Fr.random();
  const deployerSalt = Fr.random();

  // Use TestWallet's built-in method which properly registers the account
  const accountManager = await testWallet.createSchnorrAccount(deployerSecretKey, deployerSalt);
  const deployerAddress = accountManager.address;

  console.log(`Deployer address: ${deployerAddress.toString()}`);

  console.log("Deploying deployer account...");
  const accountDeployMethod = await accountManager.getDeployMethod();
  // Use AztecAddress.ZERO as from since the account doesn't exist yet
  await accountDeployMethod.send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod },
  }).wait({ timeout: DEPLOY_TIMEOUT });
  console.log("Deployer account deployed!");

  // Get the account wallet for signing transactions
  const accountWallet = await accountManager.getAccount();
  console.log(`Account wallet address: ${accountWallet.getAddress().toString()}`);

  // Load and prepare artifact
  console.log("\nLoading StarredCloaks artifact...");
  const artifactModule = await import('../target/starred_cloaks-StarredCloaks.json', { with: { type: 'json' } });
  const rawArtifact = artifactModule.default as any;
  rawArtifact.transpiled = true;
  const artifact = loadContractArtifact(rawArtifact);

  // Patch the TestWallet with missing PXE methods needed for deployment
  // AccountWallet has sender address but misses some PXE methods
  // TestWallet has PXE but deployment code expects methods directly on wallet
  console.log("Patching wallet for deployment...");
  const deploymentWallet = patchWalletForDeployment(testWallet);

  // Deploy contract using patched wallet
  console.log("\nDeploying StarredCloaks contract...");

  const deployTx = Contract.deploy(deploymentWallet, artifact, []);

  const instance = await deployTx.getInstance();
  const expectedAddress = instance.address;
  console.log(`Expected address: ${expectedAddress.toString()}`);

  // Send with from address set to deployer to avoid undefined.equals() error
  // The fee is paid by the FPC, not by the sender
  const sentTx = deployTx.send({
    from: deployerAddress,
    fee: { paymentMethod },
  });

  try {
    const deployedContract = await sentTx.deployed({ timeout: DEPLOY_TIMEOUT });
    console.log(`\nStarredCloaks deployed at: ${deployedContract.address.toString()}`);

    // Verify deployment
    console.log("\nVerifying deployment...");
    const starCount = await deployedContract.methods.get_star_count(deployerAddress).simulate({ from: deployerAddress });
    console.log(`Star count for deployer: ${starCount}`);

    console.log("\n========================================");
    console.log("DEPLOYMENT SUCCESSFUL!");
    console.log("========================================");
    console.log(`\nAdd this to your app/.env.local:`);
    console.log(`NEXT_PUBLIC_STARRED_CLOAKS_ADDRESS=${deployedContract.address.toString()}`);
    console.log("\n========================================");

    return {
      contractAddress: deployedContract.address.toString(),
      deployerAddress: deployerAddress.toString(),
    };
  } catch (deployError) {
    console.warn("Deployment wait failed, checking if contract exists...", deployError);

    try {
      const maybeContract = await Contract.at(expectedAddress, artifact, testWallet);
      await maybeContract.methods.get_star_count(deployerAddress).simulate({ from: deployerAddress });

      console.log(`\nStarredCloaks deployed at: ${expectedAddress.toString()}`);
      console.log("\n========================================");
      console.log("DEPLOYMENT SUCCESSFUL!");
      console.log("========================================");
      console.log(`\nAdd this to your app/.env.local:`);
      console.log(`NEXT_PUBLIC_STARRED_CLOAKS_ADDRESS=${expectedAddress.toString()}`);
      console.log("\n========================================");

      return {
        contractAddress: expectedAddress.toString(),
        deployerAddress: deployerAddress.toString(),
      };
    } catch {
      throw deployError;
    }
  }
}

main()
  .then((result) => {
    console.log("\nDeployment result:");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });
