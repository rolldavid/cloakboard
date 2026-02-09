/**
 * Deploy CloakConnections Contract
 *
 * CloakConnections is a singleton contract that tracks user-cloak relationships
 * as private notes. This enables users to see their cloaks across devices
 * without revealing relationships publicly.
 *
 * After deployment, update the app configuration:
 * 1. Set NEXT_PUBLIC_CLOAK_CONNECTIONS_ADDRESS in .env.local
 *
 * Usage:
 *   yarn ts-node scripts/deploy_connections.ts
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Contract } from "@aztec/aztec.js/contracts";
import { loadContractArtifact } from "@aztec/stdlib/abi";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
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
  console.log("CloakConnections Deployment");
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

  // Create deployer account
  console.log("\nCreating deployer account...");
  const deployerSecretKey = Fr.random();
  const deployerSalt = Fr.random();

  const accountManager = await testWallet.createSchnorrAccount(deployerSecretKey, deployerSalt);
  const deployerAddress = accountManager.address;

  console.log(`Deployer address: ${deployerAddress.toString()}`);

  console.log("Deploying deployer account...");
  const accountDeployMethod = await accountManager.getDeployMethod();
  await accountDeployMethod.send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod },
  }).wait({ timeout: DEPLOY_TIMEOUT });
  console.log("Deployer account deployed!");

  // Get the account wallet for signing transactions
  const accountWallet = await accountManager.getAccount();
  console.log(`Account wallet address: ${accountWallet.getAddress().toString()}`);

  // Load and prepare artifact
  console.log("\nLoading CloakConnections artifact...");
  const artifactModule = await import('../target/cloak_connections-CloakConnections.json', { with: { type: 'json' } });
  const rawArtifact = artifactModule.default as any;
  rawArtifact.transpiled = true;
  const artifact = loadContractArtifact(rawArtifact);

  // Patch the TestWallet with missing PXE methods needed for deployment
  console.log("Patching wallet for deployment...");
  const deploymentWallet = patchWalletForDeployment(testWallet);

  // Deploy contract
  console.log("\nDeploying CloakConnections contract...");

  const deployTx = Contract.deploy(deploymentWallet, artifact, []);

  const instance = await deployTx.getInstance();
  const expectedAddress = instance.address;
  console.log(`Expected address: ${expectedAddress.toString()}`);

  const sentTx = deployTx.send({
    from: deployerAddress,
    fee: { paymentMethod },
  });

  try {
    const deployedContract = await sentTx.deployed({ timeout: DEPLOY_TIMEOUT });
    const contractAddress = deployedContract.address.toString();

    console.log("");
    console.log("=".repeat(60));
    console.log("Deployment Successful!");
    console.log("=".repeat(60));
    console.log("");
    console.log(`CloakConnections Address: ${contractAddress}`);
    console.log("");

    console.log("=".repeat(60));
    console.log("Next Steps");
    console.log("=".repeat(60));
    console.log("");
    console.log("1. Add to app/.env.local:");
    console.log(`   NEXT_PUBLIC_CLOAK_CONNECTIONS_ADDRESS=${contractAddress}`);
    console.log("");
    console.log("2. Restart the app to pick up the new connections address");
    console.log("");

    return {
      contractAddress,
      deployerAddress: deployerAddress.toString(),
    };
  } catch (deployError) {
    console.warn("Deployment wait failed, checking if contract exists...", deployError);

    try {
      const maybeContract = await Contract.at(expectedAddress, artifact, testWallet);
      // Try to call a view function to verify contract exists
      await maybeContract.methods.is_forgotten(deployerAddress, deployerAddress).simulate({ from: deployerAddress });

      console.log(`\nCloakConnections deployed at: ${expectedAddress.toString()}`);
      console.log("\n========================================");
      console.log("DEPLOYMENT SUCCESSFUL!");
      console.log("========================================");
      console.log(`\nAdd this to your app/.env.local:`);
      console.log(`NEXT_PUBLIC_CLOAK_CONNECTIONS_ADDRESS=${expectedAddress.toString()}`);
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
    console.log("=".repeat(60));
    console.log("Deployment Result (save this!):");
    console.log("=".repeat(60));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });
