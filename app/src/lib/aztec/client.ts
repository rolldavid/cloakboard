/**
 * Aztec Client - Full Implementation for SDK 3.x
 *
 * Provides a complete client for interacting with the Aztec network.
 * Handles node connection, account management, and wallet operations.
 *
 * SDK 3.x Architecture:
 * - Uses AztecNode instead of PXE for network interactions
 * - TestWallet for full wallet functionality (contract deployment, etc.)
 * - Fields (Fr, GrumpkinScalar) come from @aztec/foundation
 */

import { createAztecNodeClient, waitForNode, type AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';
import { SponsoredFeePaymentMethod, type FeePaymentMethod } from '@aztec/aztec.js/fee';

// Type alias for wallet - SDK 3.x uses AccountWithSecretKey which has different methods
// We use 'any' here for flexibility with evolving SDK types
type WalletLike = any;

export interface AztecConfig {
  nodeUrl: string;
  environment: 'sandbox' | 'devnet' | 'testnet' | 'mainnet';
  sponsoredFpcAddress?: string;
}

export interface AccountKeys {
  secretKey: Fr;
  signingKey: GrumpkinScalar;
  salt: Fr;
}

export class AztecClient {
  private static instance: AztecClient;
  private node: AztecNode | null = null;
  private config: AztecConfig;
  private initialized: boolean = false;
  private wallet: WalletLike | null = null;
  private testWallet: WalletLike | null = null;
  private accountKeys: AccountKeys | null = null;

  private constructor(config: AztecConfig) {
    this.config = config;
  }

  static getInstance(config?: AztecConfig): AztecClient {
    if (!AztecClient.instance && config) {
      AztecClient.instance = new AztecClient(config);
    }
    return AztecClient.instance;
  }

  /**
   * Reset the singleton instance (useful for network switching)
   */
  static resetInstance(): void {
    AztecClient.instance = null as any;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create Aztec node client connection
    this.node = createAztecNodeClient(this.config.nodeUrl);

    // Wait for node to be ready
    try {
      await waitForNode(this.node);
      this.initialized = true;
    } catch (error) {
      console.error('Failed to connect to Aztec node:', error);
      throw new Error(`Failed to connect to Aztec network at ${this.config.nodeUrl}`);
    }
  }

  /**
   * Get the Aztec node client instance
   */
  getNode(): AztecNode | null {
    return this.node;
  }

  /**
   * Get the PXE instance from TestWallet for note queries
   * In SDK 3.x, the PXE is part of TestWallet, not a separate service
   */
  getPXE(): any {
    if (!this.testWallet) {
      throw new Error('Wallet not initialized. Call createAccount() first.');
    }
    // TestWallet exposes the PXE as a .pxe property
    return this.testWallet.pxe ?? this.testWallet;
  }

  /**
   * Get the current wallet for contract operations
   * Returns TestWallet which has all required methods including getContractClassMetadata
   */
  getWallet(): WalletLike {
    // Use TestWallet for contract operations as it has all required methods
    // (getContractClassMetadata, registerContract, etc.) that individual accounts don't have
    if (!this.testWallet) {
      throw new Error('Wallet not initialized. Call createAccount() first to initialize TestWallet.');
    }
    return this.testWallet;
  }

  /**
   * Get the current account (for account-specific operations)
   */
  getAccount(): WalletLike {
    if (!this.wallet) {
      throw new Error('No account created. Call createAccount() or importAccount() first.');
    }
    return this.wallet;
  }

  /**
   * Check if a wallet is connected
   */
  hasWallet(): boolean {
    return this.wallet !== null;
  }

  /**
   * Create a new Schnorr account using TestWallet
   * This provides full wallet functionality needed for contract deployment
   */
  async createAccount(): Promise<{ address: AztecAddress; wallet: WalletLike }> {
    if (!this.node) throw new Error('Node not initialized');

    // Get or create TestWallet
    if (!this.testWallet) {
      await this.initTestWallet();
    }

    // Generate random keys
    const secretKey = Fr.random();
    const signingKey = GrumpkinScalar.random();
    const salt = Fr.random();

    this.accountKeys = { secretKey, signingKey, salt };

    // Create account using TestWallet's method (provides full wallet functionality)
    const account = await this.testWallet.createSchnorrAccount(secretKey, salt, signingKey);

    // The account from TestWallet has all required methods for contract deployment
    this.wallet = account;

    return { address: account.address, wallet: this.wallet };
  }

  /**
   * Initialize TestWallet for full wallet operations
   *
   * TestWallet is used for all environments:
   * - sandbox: proverEnabled=false (fast local testing)
   * - devnet/testnet/mainnet: proverEnabled=true (generates valid ZK proofs)
   */
  private async initTestWallet(): Promise<void> {
    if (!this.node) throw new Error('Node not initialized');

    // Use lazy client import for browser compatibility
    const { TestWallet } = await import('@aztec/test-wallet/client/lazy');

    // Enable prover for non-sandbox environments (required for devnet/testnet/mainnet)
    const proverEnabled = this.config.environment !== 'sandbox';

    this.testWallet = await TestWallet.create(this.node, { proverEnabled });

    // Register SponsoredFPC contract if configured (needed for sponsored transactions)
    if (this.config.sponsoredFpcAddress) {
      try {
        const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
        const { getContractInstanceFromInstantiationParams } = await import('@aztec/stdlib/contract');

        const fpcAddress = AztecAddress.fromString(this.config.sponsoredFpcAddress);

        // Get FPC contract instance (with salt=0 as per convention)
        const fpcInstance = await getContractInstanceFromInstantiationParams(
          SponsoredFPCContract.artifact,
          { salt: new Fr(0) }
        );

        // Register FPC contract with wallet
        await this.testWallet.registerContract(fpcInstance, SponsoredFPCContract.artifact);
      } catch (error) {
        console.warn('[AztecClient] Failed to register SponsoredFPC:', error);
        // Continue anyway - FPC registration may not be required for all operations
      }
    }
  }

  /**
   * Get the TestWallet instance
   */
  getTestWallet(): WalletLike | null {
    return this.testWallet;
  }

  /**
   * Import an existing account from keys (Fr/GrumpkinScalar types)
   */
  async importAccount(
    secretKey: Fr,
    signingKey: GrumpkinScalar,
    salt: Fr
  ): Promise<{ address: AztecAddress; wallet: WalletLike }> {
    if (!this.node) throw new Error('Node not initialized');

    // Get or create TestWallet
    if (!this.testWallet) {
      await this.initTestWallet();
    }

    this.accountKeys = { secretKey, signingKey, salt };

    // Create account using TestWallet
    const account = await this.testWallet.createSchnorrAccount(secretKey, salt, signingKey);

    this.wallet = account;

    return { address: account.address, wallet: this.wallet };
  }

  /**
   * Import an existing account from DerivedKeys (Uint8Array types)
   * This is used when importing keys from the auth system.
   *
   * Uses MultiAuthAccountContract so the address matches AuthManager.
   *
   * @param accountType - The account/signing type (maps from auth method).
   *   'schnorr' for google/solana/magic-link, 'ecdsasecp256k1' for ethereum, 'ecdsasecp256r1' for passkey.
   */
  async importAccountFromDerivedKeys(
    keys: { secretKey: Uint8Array; signingKey: Uint8Array; salt: Uint8Array },
    accountType: 'schnorr' | 'ecdsasecp256k1' | 'ecdsasecp256r1' = 'schnorr',
  ): Promise<{ address: AztecAddress; wallet: WalletLike }> {
    if (!this.node) throw new Error('Node not initialized');

    // Get or create TestWallet
    if (!this.testWallet) {
      await this.initTestWallet();
    }

    // Convert Uint8Array to Fr
    const secretKey = Fr.fromBuffer(Buffer.from(keys.secretKey));
    const salt = Fr.fromBuffer(Buffer.from(keys.salt));

    this.accountKeys = {
      secretKey,
      signingKey: GrumpkinScalar.fromBuffer(Buffer.from(keys.signingKey)),
      salt,
    };

    // Use MultiAuthAccountContract to match the address AuthManager computes
    const { AccountManager } = await import('@aztec/aztec.js/wallet');
    const { MultiAuthAccountContractClass } = await import('@/lib/auth/MultiAuthAccountContract');

    // Default label matches what AccountService uses
    const labelMap: Record<string, string> = {
      schnorr: 'schnorr',
      ecdsasecp256k1: 'ethereum',
      ecdsasecp256r1: 'passkey',
    };

    const accountContract = new MultiAuthAccountContractClass(
      keys.signingKey,
      accountType,
      labelMap[accountType] ?? 'schnorr',
    );

    const account = await AccountManager.create(this.testWallet, secretKey, accountContract, salt);

    // Register the account with the TestWallet so it can be found by sendTx/getAccountFromAddress.
    // This mirrors what TestWallet.createAccount() does internally.
    const instance = account.getInstance();
    const artifact = await accountContract.getContractArtifact();
    await this.testWallet.registerContract(instance, artifact, secretKey);
    this.testWallet.accounts?.set(account.address.toString(), await account.getAccount());

    this.wallet = account;

    return { address: account.address, wallet: this.wallet };
  }

  /**
   * Import account from hex strings (for loading from storage)
   */
  async importAccountFromHex(
    secretKeyHex: string,
    signingKeyHex: string,
    saltHex: string
  ): Promise<{ address: AztecAddress; wallet: WalletLike }> {
    const secretKey = Fr.fromString(secretKeyHex);
    const signingKey = GrumpkinScalar.fromString(signingKeyHex);
    const salt = Fr.fromString(saltHex);

    return this.importAccount(secretKey, signingKey, salt);
  }

  /**
   * Deploy the current account on-chain.
   *
   * The MultiAuthAccount contract class is NOT canonical (unlike Schnorr/ECDSA),
   * so we must publish it to the network before deployment.
   *
   * IMPORTANT: We must NOT use DeployAccountMethod.send({ from: AztecAddress.ZERO })
   * because that triggers the "self-deployment" branch in DeployAccountMethod.request().
   * Self-deployment wraps fee payment through AccountEntrypointMetaPaymentMethod which
   * calls the account's private entrypoint → signing_key.get_note() → fails because
   * the note doesn't exist yet during simulation (PXE pending state from the constructor
   * isn't visible to subsequent private function calls within the same tx simulation).
   *
   * Instead, we manually call request() WITHOUT deployer (external fee branch where
   * SponsoredFeePaymentMethod pays directly), then sendTx() with from: AztecAddress.ZERO
   * (SignerlessAccount wraps everything without routing through the account's entrypoint).
   */
  async deployAccount(): Promise<AztecAddress> {
    if (!this.wallet) throw new Error('No account created. Call createAccount() first.');
    if (!this.testWallet) throw new Error('TestWallet not initialized.');

    const paymentMethod = this.getPaymentMethod();

    const deployMethod = await this.wallet.getDeployMethod();

    try {
      // Build execution payload using the "external deployment" fee branch.
      // By NOT passing deployer (or passing undefined), DeployAccountMethod.request()
      // uses the else branch where fee payment goes directly via SponsoredFeePaymentMethod
      // — no routing through the account's entrypoint, no signing_key.get_note() call.
      //
      // skipClassPublication: false — custom account class must be published (not canonical)
      // skipInstancePublication: false — instance must be registered
      // skipInitialization: false — constructor must run to create signing key note
      console.log('[AztecClient] Building account deployment payload (external fee branch)...');
      const executionPayload = await deployMethod.request({
        skipClassPublication: false,
        skipInstancePublication: false,
        skipInitialization: false,
        fee: paymentMethod ? { paymentMethod } : undefined,
        // NO deployer field → external branch → fee goes directly
      });

      // Send via TestWallet with SignerlessAccount (from: ZERO).
      // This wraps everything through DefaultMultiCallEntrypoint which doesn't
      // call the account's private entrypoint, avoiding the signing key note issue.
      console.log('[AztecClient] Sending account deployment tx...');
      const { SentTx } = await import('@aztec/aztec.js/contracts');
      const sentTx = new SentTx(this.testWallet, async () => {
        return this.testWallet.sendTx(executionPayload, {
          from: AztecAddress.ZERO,
          fee: paymentMethod ? { gasSettings: paymentMethod.getGasSettings?.() } : undefined,
        });
      });
      await sentTx.wait({ timeout: 120 });
      console.log('[AztecClient] Account deployed successfully');
    } catch (deployErr: any) {
      const msg = deployErr?.message ?? '';
      if (msg.includes('already deployed') || msg.includes('Existing nullifier')) {
        console.log('[AztecClient] Account already deployed (nullifier exists)');
      } else {
        console.error('[AztecClient] Deploy failed:', msg);
        throw deployErr;
      }
    }

    // Sync private notes so the signing key note created by the constructor
    // is discoverable by the PXE before the next transaction.
    await this.syncAccountNotes();

    return this.wallet.address;
  }

  /**
   * Sync private notes for the current account.
   * Discovers the signing key note created by the MultiAuthAccount constructor.
   * Must be called after deployment and on returning-user import.
   *
   * IMPORTANT: We use getNotes() instead of sync_private_state().simulate()
   * because simulate({ from: addr }) routes through the account's private
   * entrypoint which calls signing_key.get_note() — the very note we're trying
   * to discover. This circular dependency causes "Failed to get a note".
   * getNotes() internally calls sync_private_state via simulateUtility() which
   * does NOT route through the entrypoint, avoiding the circular dependency.
   *
   * @returns true if the signing key note was discovered, false otherwise
   */
  async syncAccountNotes(): Promise<boolean> {
    if (!this.wallet || !this.testWallet) {
      console.warn('[AztecClient] syncAccountNotes: no wallet or testWallet');
      return false;
    }

    const addr = this.wallet.address;

    // Step 1: Register the account as a sender so the PXE discovers notes
    // tagged with set_sender_for_tags(self.address) from the constructor.
    try {
      await this.testWallet.registerSender(addr);
    } catch (err: any) {
      console.error('[AztecClient] registerSender failed:', err?.message);
    }

    // Step 2: Wait for the PXE to discover the signing key note.
    // The PXE's block synchronizer processes historical blocks in the background.
    // For returning users, the signing key note was created in a past block during
    // account deployment. The PXE needs time to scan and discover it.
    //
    // getNotes() internally calls sync_private_state via simulateUtility()
    // (NOT through the account entrypoint), so no circular dependency.
    const maxRetries = 20;
    const retryDelay = 2000; // 2 seconds between retries
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const notes = await this.testWallet.getNotes({ contractAddress: addr });
        if (notes && notes.length > 0) {
          console.log('[AztecClient] syncAccountNotes: Found', notes.length, 'notes after', attempt + 1, 'attempts');
          return true;
        }
      } catch (err: any) {
        // getNotes may fail if PXE hasn't synced the relevant block yet
        if (attempt === 0 || attempt === maxRetries - 1) {
          console.warn('[AztecClient] getNotes attempt', attempt + 1, ':', err?.message);
        }
      }

      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }

    console.warn('[AztecClient] syncAccountNotes: Signing key note NOT found after', maxRetries, 'attempts (' + (maxRetries * retryDelay / 1000) + 's)');
    return false;
  }

  /**
   * Check if an account is deployed on-chain
   */
  async isAccountDeployed(address: AztecAddress): Promise<boolean> {
    if (!this.node) throw new Error('Node not initialized');

    try {
      const contract = await this.node.getContract(address);
      return contract !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Get current wallet address
   */
  getAddress(): AztecAddress | null {
    return this.wallet?.address ?? null;
  }

  /**
   * Get the account keys (for backup/export)
   */
  getAccountKeys(): AccountKeys | null {
    return this.accountKeys;
  }

  /**
   * Export account keys as hex strings
   */
  exportAccountKeysHex(): { secretKey: string; signingKey: string; salt: string } | null {
    if (!this.accountKeys) return null;

    return {
      secretKey: this.accountKeys.secretKey.toString(),
      signingKey: this.accountKeys.signingKey.toString(),
      salt: this.accountKeys.salt.toString(),
    };
  }

  /**
   * Get a fee payment method
   * Uses SponsoredFeePaymentMethod if FPC is configured, otherwise returns undefined
   */
  getPaymentMethod(): FeePaymentMethod | undefined {
    const fpcAddress = this.getSponsoredFpcAddress();
    if (fpcAddress) {
      return new SponsoredFeePaymentMethod(fpcAddress);
    }
    // In sandbox mode without FPC, fees may not be required
    return undefined;
  }

  /**
   * Get the sponsored FPC address if configured
   */
  getSponsoredFpcAddress(): AztecAddress | null {
    if (this.config.sponsoredFpcAddress) {
      return AztecAddress.fromString(this.config.sponsoredFpcAddress);
    }
    return null;
  }

  /**
   * Disconnect wallet and clear account
   */
  disconnect(): void {
    this.wallet = null;
    this.accountKeys = null;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConfig(): AztecConfig {
    return this.config;
  }

  /**
   * Get node info (useful for checking connection)
   */
  async getNodeInfo(): Promise<any> {
    if (!this.node) throw new Error('Node not initialized');
    return this.node.getNodeInfo();
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    if (!this.node) throw new Error('Node not initialized');
    const blockNumber = await this.node.getBlockNumber();
    return Number(blockNumber);
  }

}

/**
 * Create and initialize an AztecClient
 */
export async function createAztecClient(config: AztecConfig): Promise<AztecClient> {
  const client = AztecClient.getInstance(config);
  await client.initialize();
  return client;
}

/**
 * Get existing AztecClient instance (must be created first)
 */
export function getAztecClient(): AztecClient | null {
  try {
    return AztecClient.getInstance();
  } catch {
    return null;
  }
}
