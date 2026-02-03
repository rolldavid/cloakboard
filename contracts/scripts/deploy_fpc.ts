/**
 * Deploy Sponsored FPC (Fee Paying Contract)
 *
 * NOTE: For sandbox development, account deployment works without an FPC.
 * The app automatically falls back to sandbox mode when no FPC is configured.
 *
 * For production (testnet/mainnet), you'll need to deploy an FPC.
 *
 * ## Using Aztec CLI (Recommended)
 *
 * The easiest way to deploy an FPC is using the Aztec CLI:
 *
 * ```bash
 * # Start the sandbox (if not already running)
 * aztec start --sandbox
 *
 * # Deploy SponsoredFPC
 * aztec deploy SponsoredFPC --from 0x... --fee-payment-method none
 * ```
 *
 * ## After Deployment
 *
 * Add the FPC address to your configuration:
 *
 * 1. config/local-network.json:
 *    "sponsoredFpcAddress": "0x..."
 *
 * 2. app/.env.local:
 *    NEXT_PUBLIC_SPONSORED_FPC_ADDRESS=0x...
 */

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";

const NODE_URL = process.env.PXE_URL || "http://localhost:8080";

async function main() {
  console.log("=".repeat(60));
  console.log("FPC Deployment Guide");
  console.log("=".repeat(60));
  console.log("");

  // Check if sandbox is running
  console.log("Checking sandbox connection...");
  const node = createAztecNodeClient(NODE_URL);

  try {
    await waitForNode(node);
    const nodeInfo = await node.getNodeInfo();
    console.log(`Connected to Aztec node: ${nodeInfo.nodeVersion}`);
    console.log(`Node URL: ${NODE_URL}`);
  } catch (e) {
    console.error("Failed to connect to Aztec node.");
    console.error("Start the sandbox with: aztec start --sandbox");
    process.exit(1);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Deployment Instructions");
  console.log("=".repeat(60));
  console.log("");
  console.log("For SANDBOX development:");
  console.log("  - No FPC is required!");
  console.log("  - Account deployment works without fee payment");
  console.log("  - The app automatically uses sandbox mode");
  console.log("");
  console.log("For PRODUCTION (testnet/mainnet):");
  console.log("  1. Deploy the SponsoredFPC contract");
  console.log("  2. Fund it with Fee Juice tokens");
  console.log("  3. Configure the FPC address in your app");
  console.log("");
  console.log("Using Aztec CLI to deploy:");
  console.log("  aztec deploy SponsoredFPC");
  console.log("");
  console.log("After deployment, configure:");
  console.log("  - config/local-network.json:");
  console.log('    "sponsoredFpcAddress": "<FPC_ADDRESS>"');
  console.log("");
  console.log("  - app/.env.local:");
  console.log("    NEXT_PUBLIC_SPONSORED_FPC_ADDRESS=<FPC_ADDRESS>");
  console.log("");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
