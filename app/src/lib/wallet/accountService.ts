/**
 * Account Service - Multi-Auth Compatible
 *
 * Handles node initialization and account management.
 * All auth methods now deploy a single MultiAuthAccount contract.
 *
 * CRITICAL from demo-wallet: Only ONE node instance per session!
 * Multiple instances cause synchronization failures.
 */

import type { NetworkConfig, DerivedKeys, AccountType } from '@/types/wallet';

// Node sessions - singleton per network
// Key format: `${chainId}-${rollupVersion}`
const NODE_SESSIONS: Map<string, any> = new Map();

/**
 * Auth method label used for the initial key at deployment.
 * Maps AccountType to a default label string.
 */
function defaultLabelForAccountType(accountType: AccountType): string {
  switch (accountType) {
    case 'schnorr': return 'schnorr';
    case 'ecdsasecp256k1': return 'ethereum';
    case 'ecdsasecp256r1': return 'passkey';
  }
}

export class AccountService {
  private node: any = null;
  private network: NetworkConfig;
  private initialized: boolean = false;

  constructor(network: NetworkConfig) {
    this.network = network;
  }

  /**
   * Initialize node connection (singleton per network session)
   *
   * This is lazy-loaded to support SSR in Next.js
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const sessionKey = `${this.network.chainId}-${this.network.rollupVersion}`;

    // Reuse existing session if available
    if (NODE_SESSIONS.has(sessionKey)) {
      const session = NODE_SESSIONS.get(sessionKey);
      this.node = session.node;
      this.initialized = true;
      return;
    }

    // Dynamic imports to support SSR
    const { createAztecNodeClient, waitForNode } = await import('@aztec/aztec.js/node');

    // Create Aztec node client
    this.node = createAztecNodeClient(this.network.nodeUrl);

    // Wait for node to be ready with timeout
    try {
      await waitForNode(this.node);
    } catch (error) {
      console.error('[AccountService] Node connection failed:', error);
      NODE_SESSIONS.set(sessionKey, {
        node: this.node,
        connectionError: error instanceof Error ? error.message : 'Connection failed',
      });
      this.initialized = true;
      throw new Error(`Failed to connect to Aztec node at ${this.network.nodeUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Store session
    NODE_SESSIONS.set(sessionKey, {
      node: this.node,
    });

    this.initialized = true;
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get account address from derived keys.
   *
   * Uses MultiAuthAccountContractClass to compute the address deterministically.
   * This is a pure local computation — no network connection needed.
   *
   * The address is derived from the MultiAuthAccount contract artifact +
   * constructor args (key_type, public_key_hash, label_hash) + salt + public keys.
   * This means all auth methods produce a DIFFERENT address than the old
   * per-type contracts (SchnorrAccountContract, etc.).
   *
   * @param label - Optional label for the auth method (e.g. "google", "passkey").
   *               Defaults to the account type name.
   */
  async getAddress(
    keys: DerivedKeys,
    accountType: AccountType = 'schnorr',
    label?: string,
  ): Promise<string> {
    const { Fr } = await import('@aztec/foundation/curves/bn254');

    const secretKey = Fr.fromBuffer(Buffer.from(keys.secretKey));
    const salt = Fr.fromBuffer(Buffer.from(keys.salt));
    const effectiveLabel = label ?? defaultLabelForAccountType(accountType);

    const { getMultiAuthAccountContractAddress } = await import(
      '../auth/MultiAuthAccountContract'
    );

    const address = await getMultiAuthAccountContractAddress(
      secretKey,
      salt,
      keys.signingKey,
      accountType,
      effectiveLabel,
    );
    return address.toString();
  }

  /**
   * Create an AccountManager using MultiAuthAccountContractClass.
   *
   * This replaces the old per-type switch (SchnorrAccountContract,
   * EcdsaKAccountContract, EcdsaRAccountContract) with the unified
   * multi-auth contract.
   */
  async createAccountManager(
    keys: DerivedKeys,
    accountType: AccountType = 'schnorr',
    label?: string,
  ): Promise<any> {
    await this.ensureInitialized();

    if (!this.node) {
      throw new Error('Node not available. Account deployment requires node connection.');
    }

    const { Fr } = await import('@aztec/foundation/curves/bn254');
    const { AccountManager } = await import('@aztec/aztec.js/wallet');

    const secretKey = Fr.fromBuffer(Buffer.from(keys.secretKey));
    const salt = Fr.fromBuffer(Buffer.from(keys.salt));
    const effectiveLabel = label ?? defaultLabelForAccountType(accountType);

    const { MultiAuthAccountContractClass } = await import(
      '../auth/MultiAuthAccountContract'
    );

    const accountContract = new MultiAuthAccountContractClass(
      keys.signingKey,
      accountType,
      effectiveLabel,
    );

    const testWallet = await this.getTestWallet();

    return AccountManager.create(testWallet, secretKey, accountContract, salt);
  }

  /**
   * Deploy account with fee payment.
   *
   * Deploys a MultiAuthAccount contract with the initial key.
   * All auth methods go through this same path — the only difference
   * is the key_type and signing key bytes passed to the constructor.
   *
   * IMPORTANT: This checks if already deployed to prevent "Existing nullifier"
   * errors on re-authentication.
   */
  async deployAccount(
    keys: DerivedKeys,
    accountType: AccountType = 'schnorr',
    label?: string,
  ): Promise<string> {
    await this.ensureInitialized();

    if (!this.node) {
      throw new Error('Node not available. Account deployment requires node connection.');
    }

    const { Fr } = await import('@aztec/foundation/curves/bn254');
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');

    const effectiveLabel = label ?? defaultLabelForAccountType(accountType);

    // First, compute the address to check if already deployed
    const address = await this.getAddress(keys, accountType, effectiveLabel);
    // Check if already deployed on-chain BEFORE attempting deployment
    const alreadyDeployed = await this.isAccountDeployed(address);
    if (alreadyDeployed) {
      return address;
    }

    // Create AccountManager using MultiAuthAccountContractClass
    const accountManager = await this.createAccountManager(keys, accountType, effectiveLabel);
    // Get deploy method
    const deployMethod = await accountManager.getDeployMethod();

    // Get TestWallet for FPC registration
    const wallet = await this.getTestWallet();

    // Setup fee payment
    if (this.network.sponsoredFpcAddress) {
      const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
      const { SponsoredFeePaymentMethod } = await import('@aztec/aztec.js/fee/testing');
      const { getContractInstanceFromInstantiationParams } = await import('@aztec/stdlib/contract');

      const fpcAddress = AztecAddress.fromString(this.network.sponsoredFpcAddress);

      // Get FPC contract instance (with salt=0 as per convention)
      const fpcInstance = await getContractInstanceFromInstantiationParams(
        SponsoredFPCContract.artifact,
        { salt: new Fr(0) }
      );

      // Register FPC contract with wallet
      await wallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);

      const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(fpcAddress);

      // Deploy with sponsored fees
      try {
        const tx = await deployMethod.send({
          from: AztecAddress.ZERO,
          fee: { paymentMethod: sponsoredPaymentMethod },
        }).wait({ timeout: 120000 });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Existing nullifier') || errorMessage.includes('already deployed')) {
          return address;
        }
        console.error('[AccountService] Deployment failed:', error);
        throw error;
      }
    } else {
      // Sandbox mode: deploy without fee payment
      try {
        await deployMethod.send().wait();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Existing nullifier') || errorMessage.includes('already deployed')) {
          return address;
        }
        console.error('[AccountService] Deployment failed:', error);
        throw error;
      }
    }

    return address;
  }

  /**
   * Check if account is deployed on-chain
   */
  async isAccountDeployed(address: string): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.node) {
      return false;
    }

    try {
      const { AztecAddress } = await import('@aztec/aztec.js/addresses');
      const aztecAddress = AztecAddress.fromString(address);
      const contract = await this.node.getContract(aztecAddress);
      return contract !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Get node client
   */
  getNode(): any {
    if (!this.node) {
      throw new Error('Node not initialized');
    }
    return this.node;
  }

  /**
   * Get network configuration
   */
  getNetwork(): NetworkConfig {
    return this.network;
  }

  /**
   * Create a TestWallet for account operations
   * Uses lazy loading for browser compatibility
   *
   * TestWallet is used for all environments:
   * - sandbox: proverEnabled=false (fast local testing)
   * - devnet/testnet/mainnet: proverEnabled=true (generates valid ZK proofs)
   */
  private async createTestWallet(): Promise<any> {
    if (!this.node) {
      throw new Error('Node not initialized');
    }

    // Use lazy client import for browser
    const { TestWallet } = await import('@aztec/test-wallet/client/lazy');

    // Enable prover for non-sandbox environments (devnet, testnet, mainnet)
    const proverEnabled = this.network.id !== 'sandbox';
    const wallet = await TestWallet.create(this.node, { proverEnabled });

    return wallet;
  }

  // Cache for TestWallet instance
  private testWallet: any = null;

  private async getTestWallet(): Promise<any> {
    if (!this.testWallet) {
      this.testWallet = await this.createTestWallet();
    }
    return this.testWallet;
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

/**
 * Clear all node sessions
 * Use this when switching networks or on logout
 */
export function clearNodeSessions(): void {
  NODE_SESSIONS.clear();
}

/**
 * Get or create AccountService for a network
 */
const accountServices: Map<string, AccountService> = new Map();

export function getAccountService(network: NetworkConfig): AccountService {
  const key = network.id;

  if (!accountServices.has(key)) {
    accountServices.set(key, new AccountService(network));
  }

  return accountServices.get(key)!;
}

// Legacy export for backward compatibility
export function clearPXESessions(): void {
  clearNodeSessions();
}
