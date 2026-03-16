/**
 * Aztec Client — SDK v4 (devnet.2-patch.1)
 *
 * Handles node connection, account management, and wallet operations.
 * Uses EmbeddedWallet with real IVC proofs for browser-side voting.
 */

import { createAztecNodeClient, waitForNode, type AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';
import { SponsoredFeePaymentMethod, type FeePaymentMethod } from '@aztec/aztec.js/fee';

type WalletLike = any;

function apiBase(): string {
  return (import.meta as any).env?.VITE_API_URL || '';
}

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

// Survive HMR
const _g = globalThis as typeof globalThis & { __aztecClient?: AztecClient };

export class AztecClient {
  private node: AztecNode | null = null;
  private config: AztecConfig;
  private initialized = false;
  private wallet: WalletLike | null = null;
  private testWallet: WalletLike | null = null;
  private accountKeys: AccountKeys | null = null;
  private importPromise: Promise<{ address: AztecAddress; wallet: WalletLike }> | null = null;
  private importGeneration = 0; // Incremented on resetAccount() to invalidate stale imports

  private constructor(config: AztecConfig) {
    this.config = config;
  }

  static getInstance(config?: AztecConfig): AztecClient {
    if (!_g.__aztecClient && config) _g.__aztecClient = new AztecClient(config);
    return _g.__aztecClient!;
  }

  static resetInstance(): void { _g.__aztecClient = undefined; }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.node = createAztecNodeClient(this.config.nodeUrl);
    await waitForNode(this.node);
    this.initialized = true;
  }

  getNode(): AztecNode | null { return this.node; }

  getPXE(): any {
    if (!this.testWallet) throw new Error('Wallet not initialized');
    return this.testWallet.pxe ?? this.testWallet;
  }

  getWallet(): WalletLike {
    if (!this.testWallet) throw new Error('Wallet not initialized');
    return this.testWallet;
  }

  getAccount(): WalletLike {
    if (!this.wallet) throw new Error('No account created');
    return this.wallet;
  }

  hasWallet(): boolean { return this.wallet !== null; }

  private async initEmbeddedWallet(): Promise<void> {
    if (!this.node) throw new Error('Node not initialized');
    if (this.testWallet) return;

    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    // Try to reuse pre-warmed PXE from pxeWarmup.ts
    const { getPxeWarmupPromise } = await import('./pxeWarmup');
    const warmupPromise = getPxeWarmupPromise();
    if (warmupPromise) {
      try {
        const { wallet, node } = await warmupPromise;
        this.testWallet = wallet;
        this.node = node;
        console.log(`[AztecClient] Using pre-warmed EmbeddedWallet [${elapsed()}]`);
        return;
      } catch {
        console.warn(`[AztecClient] Warmup failed, falling back to fresh init`);
      }
    }

    console.log(`[AztecClient] Importing EmbeddedWallet... [${elapsed()}]`);

    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    const isAndroid = isMobile && typeof navigator !== 'undefined'
      && /Android/.test(navigator.userAgent);

    if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
      console.warn('[AztecClient] crossOriginIsolated=false — multi-threaded WASM proving will fail');
    }

    // Patch bb.js defaults for mobile — same as pxeWarmup.ts
    if (isMobile) {
      try {
        const bbjs = await import('@aztec/bb.js');
        if (isAndroid && bbjs.Barretenberg?.prototype?.getDefaultSrsSize) {
          bbjs.Barretenberg.prototype.getDefaultSrsSize = () => 2 ** 18;
        }
      } catch { /* non-fatal */ }

      // Cap WebAssembly.Memory maximum for mobile (same as pxeWarmup.ts)
      try {
        const OrigMemory = WebAssembly.Memory;
        const MOBILE_MAX_PAGES = 2 ** 14; // 1GB
        WebAssembly.Memory = function PatchedMemory(
          descriptor: WebAssembly.MemoryDescriptor,
        ) {
          if (descriptor.maximum && descriptor.maximum > MOBILE_MAX_PAGES) {
            descriptor.maximum = MOBILE_MAX_PAGES;
          }
          return new OrigMemory(descriptor);
        } as any;
        (WebAssembly.Memory as any).prototype = OrigMemory.prototype;
      } catch { /* non-fatal */ }
    }

    // Pre-initialize BarretenbergSync (fire-and-forget) — same as pxeWarmup.ts.
    // Overlaps WASM compile with EmbeddedWallet.create() setup.
    (async () => {
      try {
        const { BarretenbergSync } = await import('@aztec/bb.js');
        await BarretenbergSync.initSingleton();
      } catch { /* non-fatal */ }
    })();

    const { EmbeddedWallet } = await import('@aztec/wallets/embedded');
    const hwThreads = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || 4) : 4;
    const crossOriginOk = typeof self !== 'undefined' && self.crossOriginIsolated;
    // Mobile: 2 threads if crossOriginIsolated (SharedArrayBuffer available),
    // else 1 thread. Desktop: use all cores up to 32.
    const threads = isMobile
      ? (crossOriginOk ? Math.min(hwThreads, 2) : 1)
      : Math.min(hwThreads, 32);

    const proverOpts: any = { threads };
    if (isMobile) {
      proverOpts.memory = { maximum: 16384 }; // 1GB for all mobile
    }

    console.log(`[AztecClient] Creating EmbeddedWallet (${threads} threads, mobile=${isMobile})... [${elapsed()}]`);

    // Same timeout as warmup — EmbeddedWallet.create() can hang on mobile Safari
    const EMBEDDED_WALLET_TIMEOUT_MS = isMobile ? 120_000 : 60_000;
    const createResult = await Promise.race([
      EmbeddedWallet.create(this.node as any, {
        ephemeral: false,
        pxeConfig: { proverEnabled: true, l2BlockBatchSize: isMobile ? 50 : 500 },
        pxeOptions: { proverOrOptions: proverOpts },
      }).then((w) => ({ ok: true as const, wallet: w })),
      new Promise<{ ok: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false }), EMBEDDED_WALLET_TIMEOUT_MS),
      ),
    ]);

    if (!createResult.ok) {
      throw new Error(`EmbeddedWallet.create() timed out after ${EMBEDDED_WALLET_TIMEOUT_MS / 1000}s`);
    }
    this.testWallet = createResult.wallet;
    console.log(`[AztecClient] EmbeddedWallet ready [${elapsed()}]`);

    // Pre-initialize Barretenberg singleton (fire-and-forget, same as warmup path)
    (async () => {
      try {
        const { Barretenberg } = await import('@aztec/bb.js');
        await Barretenberg.initSingleton({ threads, memory: proverOpts.memory });
        console.log(`[AztecClient] Barretenberg pre-initialized [${elapsed()}]`);
      } catch (err: any) {
        console.warn('[AztecClient] BB pre-init failed (non-fatal):', err?.message);
      }
    })();

    // Register SponsoredFPC
    if (this.config.sponsoredFpcAddress) {
      try {
        const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
        const fpcAddress = AztecAddress.fromString(this.config.sponsoredFpcAddress);
        const fpcInstance = await this.node!.getContract(fpcAddress);
        if (fpcInstance) {
          await this.testWallet.registerContract(fpcInstance as any, SponsoredFPCContract.artifact as any);
        }
      } catch (err) {
        console.warn('[AztecClient] Failed to register SponsoredFPC:', err);
      }
    }

    // Register UserProfile + VoteHistory (same as warmup path)
    const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
    if (profileAddress) {
      try {
        const { getUserProfileArtifact } = await import('./contracts');
        const profileAddr = AztecAddress.fromString(profileAddress);
        const profileInstance = await this.node!.getContract(profileAddr);
        if (profileInstance) {
          await this.testWallet.registerContract(profileInstance as any, await getUserProfileArtifact() as any);
        }
      } catch { /* non-fatal */ }
    }
    const voteHistoryAddress = (import.meta as any).env?.VITE_VOTE_HISTORY_ADDRESS;
    if (voteHistoryAddress) {
      try {
        const { getVoteHistoryArtifact } = await import('./contracts');
        const vhAddr = AztecAddress.fromString(voteHistoryAddress);
        const vhInstance = await this.node!.getContract(vhAddr);
        if (vhInstance) {
          await this.testWallet.registerContract(vhInstance as any, await getVoteHistoryArtifact() as any);
        }
      } catch { /* non-fatal */ }
    }
  }

  getEmbeddedWallet(): WalletLike | null { return this.testWallet; }

  /**
   * Import account from DerivedKeys using SchnorrAccountContract.
   * All auth methods use Schnorr signing — the auth method only determines
   * how the seed is generated, not the on-chain verification.
   * Uses a promise lock to prevent concurrent calls from racing.
   */
  async importAccountFromDerivedKeys(
    keys: { secretKey: Uint8Array; signingKey: Uint8Array; salt: Uint8Array },
  ): Promise<{ address: AztecAddress; wallet: WalletLike }> {
    if (this.importPromise) return this.importPromise;
    this.importPromise = this._doImportAccount(keys, this.importGeneration);
    return this.importPromise;
  }

  private async _doImportAccount(
    keys: { secretKey: Uint8Array; signingKey: Uint8Array; salt: Uint8Array },
    generation: number,
  ): Promise<{ address: AztecAddress; wallet: WalletLike }> {
    if (!this.node) throw new Error('Node not initialized');

    if (this.wallet && this.accountKeys) {
      return { address: this.wallet.address, wallet: this.wallet };
    }

    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    if (!this.testWallet) await this.initEmbeddedWallet();

    const secretKey = Fr.fromBufferReduce(Buffer.from(keys.secretKey));
    const salt = Fr.fromBufferReduce(Buffer.from(keys.salt));

    this.accountKeys = {
      secretKey,
      signingKey: GrumpkinScalar.fromBufferReduce(Buffer.from(keys.signingKey)),
      salt,
    };

    const { AccountManager } = await import('@aztec/aztec.js/wallet');
    const { SchnorrAccountContractWrapper } = await import('@/lib/auth/SchnorrAccountContract');

    const accountContract = new SchnorrAccountContractWrapper(keys.signingKey);

    console.log(`[AztecClient] Creating AccountManager... [${elapsed()}]`);
    const account = await AccountManager.create(this.testWallet, secretKey, accountContract, salt);
    console.log(`[AztecClient] Address: ${account.address.toString().slice(0, 10)}... [${elapsed()}]`);

    // Register contract instance with PXE
    const instance = account.getInstance();
    const artifact = await accountContract.getContractArtifact();
    await this.testWallet.registerContract(instance as any, artifact as any, secretKey);

    // Patch getAccountFromAddress so PXE can resolve this account
    const schnorrAccount = await account.getAccount();
    const userAddress = account.address;
    const originalGetAccount = this.testWallet.getAccountFromAddress?.bind(this.testWallet);

    (this.testWallet as any).getAccountFromAddress = async (address: any) => {
      if (address.equals(userAddress)) return schnorrAccount;
      if (originalGetAccount) return originalGetAccount(address);
      throw new Error(`Account ${address.toString()} not found in wallet`);
    };

    // Store in walletDB for enumeration
    try {
      const walletDB = (this.testWallet as any).walletDB;
      if (walletDB?.storeAccount) {
        await walletDB.storeAccount(account.address, {
          type: 'schnorr', secretKey, salt,
          signingKey: GrumpkinScalar.fromBufferReduce(Buffer.from(keys.signingKey)).toBuffer(),
          alias: 'user',
        });
      }
    } catch { /* non-fatal */ }

    // Check if this import was superseded by a resetAccount() + new import
    if (generation !== this.importGeneration) {
      console.log('[AztecClient] Import superseded by auth switch, discarding');
      return { address: account.address, wallet: account };
    }

    this.wallet = account;

    return { address: account.address, wallet: this.wallet };
  }

  /**
   * Deploy account from browser using AccountManager.deploy().
   * Uses SponsoredFPC so the user doesn't pay gas.
   * SchnorrAccount class is already published by the keeper deploy script.
   */
  async deployAccount(): Promise<AztecAddress> {
    if (!this.wallet) throw new Error('No account created');
    if (!this.testWallet) throw new Error('EmbeddedWallet not initialized');

    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    // Check if already deployed
    if (await this.isAccountDeployed(this.wallet.address)) {
      console.log(`[AztecClient] Already deployed [${elapsed()}]`);
      return this.wallet.address;
    }

    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    console.log(`[AztecClient] Deploying account from browser (mobile=${isMobile})... [${elapsed()}]`);

    const deployMethod = await this.wallet.getDeployMethod();
    console.log(`[AztecClient] Deploy method obtained [${elapsed()}]`);
    const paymentMethod = this.getPaymentMethod();

    const sendOpts: any = {
      from: AztecAddress.ZERO,
      skipClassPublication: true,
      skipInstancePublication: false,
    };
    if (paymentMethod) sendOpts.fee = { paymentMethod };

    const { NO_WAIT } = await import('@aztec/aztec.js/contracts');
    console.log(`[AztecClient] Starting deploy proof generation... [${elapsed()}]`);
    await deployMethod.send({ ...sendOpts, wait: NO_WAIT });
    console.log(`[AztecClient] Deploy tx sent [${elapsed()}]`);

    return this.wallet.address;
  }

  /**
   * Check if the account contract is deployed on-chain.
   * Uses node.getContract() which works for any contract type.
   */
  async isAccountDeployed(address: AztecAddress): Promise<boolean> {
    if (!this.node) return false;
    try {
      const instance = await this.node.getContract(address);
      return instance !== undefined && instance !== null;
    } catch { return false; }
  }

  async waitForDeployConfirmation(address: AztecAddress, maxAttempts = 20, intervalMs = 3000): Promise<boolean> {
    if (!this.node) return false;
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isAccountDeployed(address)) return true;
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  }

  getAddress(): AztecAddress | null { return this.wallet?.address ?? null; }
  getAccountKeys(): AccountKeys | null { return this.accountKeys; }

  getPaymentMethod(): FeePaymentMethod | undefined {
    const fpcAddr = this.config.sponsoredFpcAddress;
    if (fpcAddr) return new SponsoredFeePaymentMethod(AztecAddress.fromString(fpcAddr));
    return undefined;
  }

  getSponsoredFpcAddress(): AztecAddress | null {
    return this.config.sponsoredFpcAddress ? AztecAddress.fromString(this.config.sponsoredFpcAddress) : null;
  }

  /**
   * Reset account-specific state without destroying the PXE/EmbeddedWallet.
   * Called on auth switch so the warmup PXE is preserved.
   */
  resetAccount(): void {
    this.wallet = null;
    this.accountKeys = null;
    this.importPromise = null;
    this.importGeneration++; // Invalidate any in-flight import from previous auth
  }

  disconnect(): void { this.wallet = null; this.accountKeys = null; }
  isInitialized(): boolean { return this.initialized; }
  getConfig(): AztecConfig { return this.config; }

  async getBlockNumber(): Promise<number> {
    if (!this.node) throw new Error('Node not initialized');
    return Number(await this.node.getBlockNumber());
  }

  async registerKeeperRecipient(completeAddressHex?: string): Promise<void> {
    if (!this.testWallet) return;
    try {
      let hex = completeAddressHex;
      if (!hex) {
        const resp = await fetch(`${apiBase()}/api/keeper/address`);
        if (!resp.ok) return;
        hex = (await resp.json()).completeAddress;
      }
      if (!hex) return;
      const { CompleteAddress } = await import('@aztec/stdlib/contract');
      const keeperAddr = await CompleteAddress.fromString(hex);
      const pxe = (this.testWallet as any).pxe;
      if (pxe?.addressStore?.addCompleteAddress) {
        await pxe.addressStore.addCompleteAddress(keeperAddr);
      }
    } catch { /* non-fatal */ }
  }
}

export async function createAztecClient(config: AztecConfig): Promise<AztecClient> {
  const client = AztecClient.getInstance(config);
  await client.initialize();
  return client;
}

export function getAztecClient(): AztecClient | null {
  try { return AztecClient.getInstance(); } catch { return null; }
}
