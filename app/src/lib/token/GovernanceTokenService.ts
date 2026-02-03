/**
 * Governance Token Service
 *
 * Deploys and manages Aztec governance tokens with Aragon-style initial distribution.
 * Optionally deploys a multisig-controlled treasury.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { AztecTokenConfig } from '@/types/tokenGate';

/** Result of deploying a governance token */
export interface TokenDeployResult {
  tokenAddress: string;
  totalSupply: string;
  multisigAddress?: string;
}

/**
 * Service for deploying and interacting with governance tokens
 */
export class GovernanceTokenService {
  private wallet: Wallet;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Deploy a new governance token with initial distribution.
   * If multisig treasury is enabled, also deploys a TokenMultisig contract.
   */
  async deploy(
    config: AztecTokenConfig,
    admin: AztecAddress,
    tokenArtifact: any,
    multisigArtifact?: any
  ): Promise<TokenDeployResult> {
    // Prepare receivers and amounts (max 10)
    const receivers: AztecAddress[] = [];
    const amounts: bigint[] = [];
    let receiverCount = 0;

    if (config.initialDistribution) {
      for (const entry of config.initialDistribution.slice(0, 10)) {
        if (entry.address && entry.amount) {
          receivers.push(this.parseAddress(entry.address));
          amounts.push(BigInt(entry.amount));
          receiverCount++;
        }
      }
    }

    // Pad to 10 entries
    while (receivers.length < 10) {
      receivers.push(this.parseAddress('0x' + '0'.repeat(64)));
      amounts.push(0n);
    }

    // Deploy the governance token
    const deployTx = await Contract.deploy(this.wallet, tokenArtifact, [
      config.newTokenName ?? 'Governance Token',
      config.newTokenSymbol ?? 'GOV',
      admin,
      receivers,
      amounts,
      receiverCount,
    ]).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    const tokenAddress = deployed.address.toString();

    let totalSupply = amounts.slice(0, receiverCount).reduce((a, b) => a + b, 0n);
    let multisigAddress: string | undefined;

    // Deploy multisig treasury if enabled
    if (config.multisigTreasury?.enabled && multisigArtifact) {
      multisigAddress = await this.deployMultisig(
        config,
        deployed.address,
        multisigArtifact
      );

      // Mint treasury allocation to multisig
      if (config.multisigTreasury.amount && multisigAddress) {
        const treasuryAmount = BigInt(config.multisigTreasury.amount);
        await deployed.methods
          .mint(this.parseAddress(multisigAddress), treasuryAmount)
          .send({} as any)
          .wait({ timeout: 120000 });
        totalSupply += treasuryAmount;
      }
    }

    return {
      tokenAddress,
      totalSupply: totalSupply.toString(),
      multisigAddress,
    };
  }

  /**
   * Deploy a TokenMultisig contract for treasury management.
   */
  private async deployMultisig(
    config: AztecTokenConfig,
    tokenAddress: AztecAddress,
    multisigArtifact: any
  ): Promise<string> {
    const treasury = config.multisigTreasury!;
    const signers: AztecAddress[] = [];
    let signerCount = 0;

    for (const addr of treasury.signers.slice(0, 5)) {
      if (addr) {
        signers.push(this.parseAddress(addr));
        signerCount++;
      }
    }

    // Pad to 5 entries
    while (signers.length < 5) {
      signers.push(this.parseAddress('0x' + '0'.repeat(64)));
    }

    const deployTx = await Contract.deploy(this.wallet, multisigArtifact, [
      tokenAddress,
      signers,
      signerCount,
      treasury.threshold,
    ]).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    return deployed.address.toString();
  }

  private parseAddress(addr: string): AztecAddress {
    // Simple address parsing - in production would use AztecAddress.fromString
    return { toString: () => addr } as any as AztecAddress;
  }
}
