import { PrivateCloakContract } from "../src/artifacts/PrivateCloak.js";
import { setupWallet } from "../src/utils/setup_wallet.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee/testing';
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { Fr, GrumpkinScalar } from "@aztec/aztec.js/fields";
import { getTimeouts } from "../config/config.js";

describe("Private Cloak E2E Tests", () => {
    let wallet: any;
    let sponsoredPaymentMethod: SponsoredFeePaymentMethod;
    let admin: any;
    let member1: any;
    let cloak: PrivateCloakContract;

    beforeAll(async () => {
        wallet = await setupWallet();

        const sponsoredFPC = await getSponsoredFPCInstance();
        await wallet.registerContract(sponsoredFPC, SponsoredFPCContract.artifact);
        sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

        // Create accounts
        admin = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), GrumpkinScalar.random());
        await (await admin.getDeployMethod()).send({
            from: admin.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().deployTimeout });

        member1 = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), GrumpkinScalar.random());
        await (await member1.getDeployMethod()).send({
            from: member1.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().deployTimeout });

        // Register senders
        await wallet.registerSender(admin.address);
        await wallet.registerSender(member1.address);

        // Deploy Cloak
        cloak = await PrivateCloakContract.deploy(
            wallet,
            "Test Cloak",
            admin.address,
            100,  // voting_duration
            2,    // quorum
            admin.address,  // upgrade_authority (or AztecAddress.ZERO)
        ).send({
            from: admin.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).deployed({ timeout: getTimeouts().deployTimeout });
    }, 600000);

    it("deploys successfully", () => {
        expect(cloak.address).toBeDefined();
    });

    it("adds members privately", async () => {
        await cloak.methods.add_member(member1.address, 100n).send({
            from: admin.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().txTimeout });

        const count = await cloak.methods.get_member_count().simulate();
        expect(Number(count)).toBe(1);
    }, 300000);

    it("returns private voting power", async () => {
        const votingPower = await cloak.methods.balance_of_private(member1.address).simulate();
        expect(Number(votingPower)).toBe(100);
    });

    it("creates proposals", async () => {
        // First add admin as member
        await cloak.methods.add_member(admin.address, 100n).send({
            from: admin.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().txTimeout });

        // Create proposal
        await cloak.methods.create_proposal(
            "Test Proposal",
            "Description here",
            0,  // proposal_type: treasury
            admin.address,
            1000n,  // value
        ).send({
            from: admin.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().txTimeout });

        const proposalCount = await cloak.methods.get_proposal_count().simulate();
        expect(Number(proposalCount)).toBe(1);
    }, 300000);

    it("casts votes", async () => {
        // Cast vote from admin
        await cloak.methods.cast_vote(0n, true).send({
            from: admin.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().txTimeout });

        // Cast vote from member1
        await cloak.methods.cast_vote(0n, false).send({
            from: member1.address,
            fee: { paymentMethod: sponsoredPaymentMethod }
        }).wait({ timeout: getTimeouts().txTimeout });

        const tally = await cloak.methods.get_vote_tally(0n).simulate();
        expect(Number(tally.yes_votes)).toBe(100);
        expect(Number(tally.no_votes)).toBe(100);
        expect(Number(tally.total_votes)).toBe(200);
    }, 300000);

    it("prevents double voting", async () => {
        await expect(
            cloak.methods.cast_vote(0n, true).send({
                from: admin.address,
                fee: { paymentMethod: sponsoredPaymentMethod }
            }).wait({ timeout: getTimeouts().txTimeout })
        ).rejects.toThrow("already voted");
    }, 300000);
});
