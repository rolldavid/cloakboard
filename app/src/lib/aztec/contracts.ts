import { AztecClient } from './client';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { publishContractClass } from '@aztec/aztec.js/deployment';
import { loadContractArtifact } from '@aztec/stdlib/abi';

const INTERNAL_PREFIX = '__aztec_nr_internals__';

/** Load and process a nargo-compiled artifact JSON.
 *  We no longer strip the __aztec_nr_internals__ prefix from function names because
 *  the Aztec SDK computes function selectors by hashing the full function signature
 *  string (including the name). Stripping the prefix produces wrong selectors and
 *  causes every on-chain call to silently revert with `app_logic_reverted`.
 *  Instead, callers use wrapContractWithCleanNames() after Contract.at() to get a
 *  clean API while preserving correct selectors. */
function loadNargoArtifact(rawArtifact: any): any {
  rawArtifact.transpiled = true;
  return loadContractArtifact(rawArtifact);
}

/**
 * Wrap a Contract instance with a Proxy that maps clean method names (e.g. `add_membership`)
 * to the original prefixed names (`__aztec_nr_internals__add_membership`) in the artifact.
 * This preserves correct function selector computation while giving callers a clean API.
 */
export function wrapContractWithCleanNames(contract: any): any {
  const originalMethods = contract.methods;

  const methodsProxy = new Proxy(originalMethods, {
    get(target: any, prop: string | symbol) {
      // If the property exists as-is, return it directly
      if (typeof prop === 'string' && typeof target[prop] === 'function') {
        return target[prop].bind(target);
      }
      // Try with the internal prefix
      if (typeof prop === 'string') {
        const prefixedName = INTERNAL_PREFIX + prop;
        if (typeof target[prefixedName] === 'function') {
          return target[prefixedName].bind(target);
        }
      }
      // Fallback to original behavior
      return target[prop];
    },
  });

  // Return a proxy of the contract that intercepts `.methods`
  return new Proxy(contract, {
    get(target: any, prop: string | symbol) {
      if (prop === 'methods') {
        return methodsProxy;
      }
      return target[prop];
    },
  });
}

// Lazy load the artifact to avoid bundling the large JSON file
let cachedArtifact: any = null;
async function getPrivateCloakArtifact(): Promise<any> {
  if (!cachedArtifact) {
    const module = await import('./artifacts/PrivateCloak.json');
    cachedArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedArtifact;
}

let cachedRegistryArtifact: any = null;
export async function getCloakRegistryArtifact(): Promise<any> {
  if (!cachedRegistryArtifact) {
    const module = await import('./artifacts/CloakRegistry.json');
    cachedRegistryArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedRegistryArtifact;
}

let cachedBravoArtifact: any = null;
export async function getGovernorBravoCloakArtifact(): Promise<any> {
  if (!cachedBravoArtifact) {
    const module = await import('./artifacts/GovernorBravoCloak.json');
    cachedBravoArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedBravoArtifact;
}

let cachedStarredCloaksArtifact: any = null;
export async function getStarredCloaksArtifact(): Promise<any> {
  if (!cachedStarredCloaksArtifact) {
    const module = await import('./artifacts/StarredCloaks.json');
    cachedStarredCloaksArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedStarredCloaksArtifact;
}

let cachedCloakConnectionsArtifact: any = null;
export async function getCloakConnectionsArtifact(): Promise<any> {
  if (!cachedCloakConnectionsArtifact) {
    const module = await import('./artifacts/CloakConnections.json');
    cachedCloakConnectionsArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedCloakConnectionsArtifact;
}

let cachedCloakMembershipsArtifact: any = null;
export async function getCloakMembershipsArtifact(): Promise<any> {
  if (!cachedCloakMembershipsArtifact) {
    const module = await import('./artifacts/CloakMemberships.json');
    cachedCloakMembershipsArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedCloakMembershipsArtifact;
}

export interface CloakInfo {
  address: string;
  name: string;
  memberCount: number;
  proposalCount: number;
  votingDuration: number;
  quorumThreshold: number;
}

export interface Proposal {
  id: number;
  creator: string;
  title: string;
  description: string;
  proposalType: number;
  targetAddress: string;
  value: bigint;
  startBlock: number;
  endBlock: number;
  executed: boolean;
}

export interface VoteTally {
  yesVotes: bigint;
  noVotes: bigint;
  totalVotes: bigint;
}

export class CloakContractService {
  private client: AztecClient;
  private contract: any | null = null;

  constructor(client: AztecClient) {
    this.client = client;
  }

  /**
   * Get wallet for contract interactions
   */
  private getWallet(): Wallet {
    return this.client.getWallet();
  }

  /** Get the sender address for send/simulate options */
  private getSenderAddress(): any {
    return this.client.getAddress?.() ?? undefined;
  }

  /** Build options for simulate calls. */
  private simOpts(): any {
    const from = this.getSenderAddress();
    return from ? { from } : {};
  }

  /** Build options with `from` and `fee` for send calls */
  private txOpts(): any {
    const from = this.getSenderAddress();
    const paymentMethod = this.client.getPaymentMethod?.();
    return {
      ...(from ? { from } : {}),
      ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    };
  }

  /**
   * Connect to an existing Cloak contract
   */
  async connectToCloak(address: string): Promise<void> {
    // Validate address before attempting to parse
    if (!address || typeof address !== 'string' || !address.startsWith('0x') || address.length < 60) {
      throw new Error(`Invalid cloak address: ${address?.slice?.(0, 20) || 'empty'}`);
    }

    const wallet = this.getWallet();
    const aztecAddress = AztecAddress.fromString(address);
    const artifact = await getPrivateCloakArtifact();

    this.contract = wrapContractWithCleanNames(await Contract.at(aztecAddress, artifact, wallet));
  }

  /**
   * Get a zero AztecAddress (handles SDK version differences)
   */
  private getZeroAddress(): AztecAddress {
    // Try static ZERO property first (SDK 3.x standard)
    if (AztecAddress.ZERO) {
      return AztecAddress.ZERO;
    }
    // Fallback: create from zero string
    return AztecAddress.fromString('0x0000000000000000000000000000000000000000000000000000000000000000');
  }

  /**
   * Deploy a new PrivateCloak contract
   *
   * Constructor parameters from main.nr:
   * - name: str<31> - Cloak name (max 31 chars)
   * - admin: AztecAddress - Admin address
   * - voting_duration: u32 - Blocks voting remains open
   * - quorum_threshold: u64 - Minimum votes required
   * - membership_mode: u8 - 0=aztec-token, 1=erc20-token
   * - token_gate_address: AztecAddress - Token gate contract (zero if none)
   * - token_address: AztecAddress - Aztec token address (zero if none)
   * - erc20_token_address_hash: Field - Hash of ERC20 token address (zero if none)
   * - erc20_min_balance: u128 - Minimum ERC20 balance (0 if none)
   */
  async deployCloak(
    name: string,
    admin: AztecAddress,
    votingDuration: number,
    quorumThreshold: number,
    membershipMode: number = 0,
    tokenGateAddress?: AztecAddress,
    tokenAddress?: AztecAddress,
    erc20TokenAddressHash?: any,
    erc20MinBalance: bigint = 0n,
  ): Promise<string> {
    // Validate required parameters
    if (!admin) {
      throw new Error('Admin address is required');
    }

    const wallet = this.getWallet();
    const paymentMethod = this.client.getPaymentMethod();

    // Ensure name is properly formatted (max 31 chars, padded if necessary)
    const paddedName = name.slice(0, 31).padEnd(31, '\0');

    try {
      // Load artifact dynamically
      const artifact = await getPrivateCloakArtifact();

      // Publish the contract class to the network before deployment
      // This is required in SDK 3.x to make the bytecode available to the prover
      const contractClass = await getContractClassFromArtifact(artifact);

      // Get the sender address from the client's account
      const senderAddress = this.client.getAddress();
      if (!senderAddress) {
        throw new Error('No sender address available. Ensure account is created before deploying.');
      }
      // Publish the contract class if not already registered on the network.
      // If it's already published (by a previous deploy or another user), skip to avoid
      // "Existing nullifier" errors.
      let alreadyPublished = false;
      try {
        const existing = await wallet.getContractClassMetadata(contractClass.id);
        alreadyPublished = existing && existing.isContractClassPubliclyRegistered;
        if (alreadyPublished) {
          // already published, skip
        }
      } catch {
        // Not found — need to publish
      }

      if (!alreadyPublished) {
        try {
          const publishInteraction = await publishContractClass(wallet, artifact);
          // Use AztecAddress.ZERO for signerless entrypoint to avoid note lookup issues
          await publishInteraction.send({
            from: AztecAddress.ZERO,
            fee: paymentMethod ? { paymentMethod } : undefined,
          }).wait({ timeout: 120000 });
        } catch (publishErr: any) {
          const msg = publishErr?.message ?? '';
          if (msg.includes('Existing nullifier') || msg.includes('already registered')) {
          } else {
            throw publishErr;
          }
        }
      }

      const zeroAddr = this.getZeroAddress();

      // Deploy the contract using SDK 3.x pattern
      const deployTx = Contract.deploy(
        wallet,
        artifact,
        [
          paddedName,                           // name: str<31>
          admin,                                // admin: AztecAddress
          votingDuration,                       // voting_duration: u32
          quorumThreshold,                      // quorum_threshold: u64
          membershipMode,                       // membership_mode: u8
          tokenGateAddress ?? zeroAddr,         // token_gate_address: AztecAddress
          tokenAddress ?? zeroAddr,             // token_address: AztecAddress
          erc20TokenAddressHash ?? Fr.ZERO,     // erc20_token_address_hash: Field
          erc20MinBalance,                      // erc20_min_balance: u128
        ]
      );

      // Get the expected contract address before sending
      const instance = await deployTx.getInstance();
      const expectedAddress = instance.address;

      // Use AztecAddress.ZERO as `from` to route through signerless/default entrypoint.
      // This avoids the "Failed to get a note" error when the account's signing key
      // note hasn't been synced. The admin is passed explicitly to the constructor.
      const sentTx = deployTx.send({
        from: AztecAddress.ZERO,
        fee: paymentMethod ? { paymentMethod } : undefined,
      });

      try {
        const deployedContract = await sentTx.deployed({ timeout: 180000 }); // 3 minute timeout
        this.contract = wrapContractWithCleanNames(deployedContract);
        const address = deployedContract.address.toString();
        return address;
      } catch (deployError) {
        // Check if the contract was actually deployed despite the error
        // This can happen when block stream tracking fails but deployment succeeded
        console.warn('[CloakContractService] Deployment wait failed, checking if contract exists...', deployError);

        try {
          // Try to connect to the contract at the expected address
          const maybeContract = wrapContractWithCleanNames(await Contract.at(expectedAddress, artifact, wallet));

          // Try a simple read to verify it's deployed
          await maybeContract.methods.get_proposal_count().simulate({ from: senderAddress });

          this.contract = maybeContract;
          return expectedAddress.toString();
        } catch (verifyError) {
          // Contract really doesn't exist, rethrow original error
          console.error('[CloakContractService] Contract verification failed:', verifyError);
          throw deployError;
        }
      }
    } catch (error) {
      console.error('[CloakContractService] Deployment failed:', error);
      throw error;
    }
  }

  /**
   * Add a member to the Cloak (admin only)
   */
  async addMember(memberAddress: AztecAddress, votingPower: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    await this.contract.methods.add_member(memberAddress, votingPower).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Create a new proposal
   */
  async createProposal(
    title: string,
    description: string,
    proposalType: number,
    targetAddress: AztecAddress,
    value: bigint
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    // Ensure strings are properly formatted (max 31 chars)
    const paddedTitle = title.slice(0, 31).padEnd(31, '\0');
    const paddedDescription = description.slice(0, 31).padEnd(31, '\0');

    await this.contract.methods.create_proposal(
      paddedTitle,
      paddedDescription,
      proposalType,
      targetAddress,
      value
    ).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Cast a vote on a proposal
   */
  async castVote(proposalId: bigint, voteChoice: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    await this.contract.methods.cast_vote(new Fr(proposalId), voteChoice).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Execute a passed proposal
   */
  async executeProposal(proposalId: bigint): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    await this.contract.methods.execute_proposal(new Fr(proposalId)).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Update the sponsored FPC address (admin only)
   */
  async setSponsoredFpc(fpcAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    await this.contract.methods.set_sponsored_fpc(fpcAddress).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Enable or disable sponsored voting (admin only)
   */
  async setSponsoredVotingEnabled(enabled: boolean): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    await this.contract.methods.set_sponsored_voting_enabled(enabled).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Get the sponsored FPC address
   */
  async getSponsoredFpcAddress(): Promise<AztecAddress> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const address = await this.contract.methods.get_sponsored_fpc_address().simulate(this.simOpts());
    return address;
  }

  /**
   * Check if sponsored voting is enabled
   */
  async isSponsoredVotingEnabled(): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const enabled = await this.contract.methods.is_sponsored_voting_enabled().simulate(this.simOpts());
    return enabled;
  }

  /**
   * Get the member count
   */
  async getMemberCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const count = await this.contract.methods.get_member_count().simulate(this.simOpts());
    return Number(count);
  }

  /**
   * Get the proposal count
   */
  async getProposalCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const count = await this.contract.methods.get_proposal_count().simulate(this.simOpts());
    return Number(count);
  }

  /**
   * Get a proposal by ID
   */
  async getProposal(proposalId: bigint): Promise<Proposal> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const proposal = await this.contract.methods.get_proposal(new Fr(proposalId)).simulate(this.simOpts());
    return {
      id: Number(proposal.id),
      creator: proposal.creator.toString(),
      title: proposal.title.toString(),
      description: proposal.description.toString(),
      proposalType: Number(proposal.proposal_type),
      targetAddress: proposal.target_address.toString(),
      value: BigInt(proposal.value),
      startBlock: Number(proposal.start_block),
      endBlock: Number(proposal.end_block),
      executed: proposal.executed,
    };
  }

  /**
   * Get the vote tally for a proposal
   */
  async getVoteTally(proposalId: bigint): Promise<VoteTally> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const tally = await this.contract.methods.get_vote_tally(new Fr(proposalId)).simulate(this.simOpts());
    return {
      yesVotes: BigInt(tally.yes_votes),
      noVotes: BigInt(tally.no_votes),
      totalVotes: BigInt(tally.total_votes),
    };
  }

  /**
   * Get the voting power for an address
   */
  async getVotingPower(memberAddress: AztecAddress): Promise<bigint> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const power = await this.contract.methods.get_voting_power(memberAddress).simulate(this.simOpts());
    return BigInt(power);
  }

  /**
   * Get the Cloak name
   */
  async getName(): Promise<string> {
    if (!this.contract) throw new Error('Not connected to a Cloak');

    const name = await this.contract.methods.get_name().simulate(this.simOpts());
    // Remove null padding
    return name.toString().replace(/\0/g, '').trim();
  }
}

// ===== Multi-Auth Account Contract Service =====

/**
 * Service for interacting with deployed MultiAuthAccount contracts.
 * Used to add/remove authorized keys after the account is deployed.
 */
export class MultiAuthContractService {
  private client: AztecClient;
  private contract: any | null = null;

  constructor(client: AztecClient) {
    this.client = client;
  }

  private getSenderAddress(): any {
    return this.client.getAddress?.() ?? undefined;
  }

  private simOpts(): any {
    const from = this.getSenderAddress();
    return from ? { from } : {};
  }

  private txOpts(): any {
    const from = this.getSenderAddress();
    const paymentMethod = this.client.getPaymentMethod?.();
    return {
      ...(from ? { from } : {}),
      ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    };
  }

  /**
   * Connect to an existing MultiAuthAccount contract
   */
  async connect(address: string): Promise<void> {
    const wallet = this.client.getWallet();
    const aztecAddress = AztecAddress.fromString(address);
    // MultiAuthAccount artifact would be loaded similarly to PrivateCloak
    // For now, this is a placeholder — the artifact needs to be compiled first
    // const artifact = await getMultiAuthAccountArtifact();
    // this.contract = await Contract.at(aztecAddress, artifact, wallet);
  }

  /**
   * Add a new authorized key to the account.
   * Must be called by an already-authorized key (through entrypoint).
   */
  async addAuthorizedKey(
    keyType: number,
    publicKeyHash: bigint,
    labelHash: bigint,
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a MultiAuthAccount');

    await this.contract.methods.add_authorized_key(
      keyType,
      new Fr(publicKeyHash),
      new Fr(labelHash),
    ).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Remove an authorized key from the account.
   * Cannot remove the last key (lockout protection).
   */
  async removeAuthorizedKey(
    keyType: number,
    publicKeyHash: bigint,
  ): Promise<void> {
    if (!this.contract) throw new Error('Not connected to a MultiAuthAccount');

    await this.contract.methods.remove_authorized_key(
      keyType,
      new Fr(publicKeyHash),
    ).send(this.txOpts()).wait({ timeout: 120000 });
  }

  /**
   * Check if a key is authorized on the account.
   */
  async isKeyAuthorized(keyType: number, publicKeyHash: bigint): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to a MultiAuthAccount');

    const result = await this.contract.methods.is_key_authorized(
      keyType,
      new Fr(publicKeyHash),
    ).simulate(this.simOpts());
    return result;
  }

  /**
   * Get the number of authorized keys.
   */
  async getKeyCount(): Promise<number> {
    if (!this.contract) throw new Error('Not connected to a MultiAuthAccount');

    const count = await this.contract.methods.get_key_count().simulate(this.simOpts());
    return Number(count);
  }
}
