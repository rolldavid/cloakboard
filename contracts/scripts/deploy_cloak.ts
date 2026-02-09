// import { PrivateCloakContract } from "../src/artifacts/PrivateCloak.js";
import { createPXEClient } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { getSponsoredFPCAddress, hasFPCConfigured } from "../src/utils/sponsored_fpc.js";
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee/testing';
import { Fr, GrumpkinScalar } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { getTimeouts, getConfig } from "../src/config/config.js";

async function main() {
    console.log("Starting Private Cloak deployment...");

    const config = getConfig();
    console.log(`Network: ${config.name}`);

    // Connect to PXE
    console.log("Connecting to PXE...");
    const pxe = createPXEClient(config.network.nodeUrl);

    try {
        const nodeInfo = await pxe.getNodeInfo();
        console.log(`Connected! Node version: ${nodeInfo.nodeVersion}`);
    } catch (e) {
        console.error("Failed to connect to PXE. Is the sandbox running?");
        throw e;
    }

    // Setup fee payment method if FPC is configured
    let feeOptions: any = {};
    if (hasFPCConfigured()) {
        const fpcAddress = getSponsoredFPCAddress();
        if (fpcAddress) {
            feeOptions = {
                fee: { paymentMethod: new SponsoredFeePaymentMethod(fpcAddress) }
            };
            console.log(`Using FPC for fee payment: ${fpcAddress.toString()}`);
        }
    } else {
        console.log("No FPC configured, attempting deployment without fee payment (sandbox mode)");
    }

    // Create admin account
    const adminSecretKey = Fr.random();
    const adminSigningKey = GrumpkinScalar.random();
    const adminSalt = Fr.random();

    const accountManager = getSchnorrAccount(pxe, adminSecretKey, adminSigningKey, adminSalt);
    const wallet = await accountManager.register();
    const adminAddress = wallet.getAddress();

    console.log(`Admin address: ${adminAddress.toString()}`);

    console.log("Deploying admin account...");
    await accountManager.deploy().send(feeOptions).wait({ timeout: getTimeouts().deployTimeout });

    console.log(`Admin account deployed: ${adminAddress.toString()}`);

    // Note: Contract deployment requires compiled artifacts
    // Run `aztec compile` and `aztec codegen` first
    console.log("");
    console.log("To deploy the Cloak contract:");
    console.log("1. Compile: ~/.aztec/bin/aztec compile");
    console.log("2. Generate artifacts: aztec codegen target -o src/artifacts");
    console.log("3. Uncomment PrivateCloakContract import and deploy code");
    console.log("");

    /*
    // Deploy Cloak contract (uncomment after codegen)
    console.log("Deploying PrivateCloak contract...");
    const cloak = await PrivateCloakContract.deploy(
        wallet,
        "My Private Cloak",           // name
        adminAddress,               // admin
        100,                         // voting_duration (blocks)
        2,                           // quorum_threshold
        AztecAddress.ZERO,           // upgrade_authority (no upgrades)
    ).send(feeOptions).deployed({ timeout: getTimeouts().deployTimeout });

    console.log(`PrivateCloak deployed at: ${cloak.address.toString()}`);

    // Verify deployment
    const memberCount = await cloak.methods.get_member_count().simulate();
    const proposalCount = await cloak.methods.get_proposal_count().simulate();

    console.log("");
    console.log("Deployment Summary:");
    console.log(`   Cloak Address: ${cloak.address.toString()}`);
    console.log(`   Admin Address: ${adminAddress.toString()}`);
    console.log(`   Member Count: ${memberCount}`);
    console.log(`   Proposal Count: ${proposalCount}`);
    console.log("");
    console.log("Deployment complete!");

    return {
        cloakAddress: cloak.address.toString(),
        adminAddress: adminAddress.toString(),
        adminSecretKey: adminSecretKey.toString(),
    };
    */

    return {
        adminAddress: adminAddress.toString(),
        adminSecretKey: adminSecretKey.toString(),
    };
}

main()
    .then((result) => {
        console.log("");
        console.log("Save these values:");
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    })
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
