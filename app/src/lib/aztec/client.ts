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
  private accountType: 'schnorr' | 'ecdsasecp256k1' | 'ecdsasecp256r1' = 'schnorr';

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
    const { EmbeddedWallet } = await import('@aztec/wallets/embedded');

    const threads = typeof navigator !== 'undefined'
      ? Math.min(navigator.hardwareConcurrency || 4, 32) : 4;

    console.log(`[AztecClient] Creating EmbeddedWallet (${threads} threads)... [${elapsed()}]`);
    this.testWallet = await EmbeddedWallet.create(this.node as any, {
      ephemeral: true,
      pxeConfig: { proverEnabled: true },
      pxeOptions: { proverOrOptions: { threads } as any },
    });
    console.log(`[AztecClient] EmbeddedWallet ready [${elapsed()}]`);

    // Register SponsoredFPC
    if (this.config.sponsoredFpcAddress) {
      try {
        const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
        const fpcAddress = AztecAddress.fromString(this.config.sponsoredFpcAddress);
        const fpcInstance = await this.node.getContract(fpcAddress);
        if (fpcInstance) {
          await this.testWallet.registerContract(fpcInstance as any, SponsoredFPCContract.artifact as any);
        }
      } catch (err) {
        console.warn('[AztecClient] Failed to register SponsoredFPC:', err);
      }
    }
  }

  getEmbeddedWallet(): WalletLike | null { return this.testWallet; }

  /**
   * Import account from DerivedKeys using MultiAuthAccountContract.
   */
  async importAccountFromDerivedKeys(
    keys: { secretKey: Uint8Array; signingKey: Uint8Array; salt: Uint8Array },
    accountType: 'schnorr' | 'ecdsasecp256k1' | 'ecdsasecp256r1' = 'schnorr',
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
    const { MultiAuthAccountContractClass, ensureAccountImports } = await import('@/lib/auth/MultiAuthAccountContract');
    await ensureAccountImports();

    const labelMap: Record<string, string> = {
      schnorr: 'schnorr',
      ecdsasecp256k1: 'ethereum',
      ecdsasecp256r1: 'passkey',
    };

    const accountContract = new MultiAuthAccountContractClass(
      keys.signingKey, accountType, labelMap[accountType] ?? 'schnorr',
    );

    console.log(`[AztecClient] Creating AccountManager... [${elapsed()}]`);
    const account = await AccountManager.create(this.testWallet, secretKey, accountContract, salt);
    console.log(`[AztecClient] Address: ${account.address.toString().slice(0, 10)}... [${elapsed()}]`);

    // Register contract instance with PXE
    const instance = account.getInstance();
    const artifact = await accountContract.getContractArtifact();
    await this.testWallet.registerContract(instance as any, artifact as any, secretKey);

    // Monkey-patch getAccountFromAddress for MultiAuth
    const multiAuthAccount = await account.getAccount();
    const userAddress = account.address;
    const originalGetAccount = this.testWallet.getAccountFromAddress?.bind(this.testWallet);

    (this.testWallet as any).getAccountFromAddress = async (address: any) => {
      if (address.equals(userAddress)) return multiAuthAccount;
      if (originalGetAccount) return originalGetAccount(address);
      throw new Error(`Account ${address.toString()} not found in wallet`);
    };

    // Store in walletDB for enumeration
    try {
      const walletDB = (this.testWallet as any).walletDB;
      if (walletDB?.storeAccount) {
        await walletDB.storeAccount(account.address, {
          type: accountType, secretKey, salt,
          signingKey: GrumpkinScalar.fromBufferReduce(Buffer.from(keys.signingKey)).toBuffer(),
          alias: 'user',
        });
      }
    } catch { /* non-fatal */ }

    this.wallet = account;
    this.accountType = accountType;

    return { address: account.address, wallet: this.wallet };
  }

  /**
   * Deploy account via server-side proving (public constructor).
   */
  async deployAccount(): Promise<AztecAddress> {
    if (!this.wallet) throw new Error('No account created');
    if (!this.testWallet) throw new Error('EmbeddedWallet not initialized');

    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    // Publish class
    try {
      await fetch(`${apiBase()}/api/publish-account-class`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch { /* non-fatal — deploy-account verifies */ }

    // Check if already deployed
    const accountAddress = AztecAddress.fromString(this.wallet.address.toString());
    if (await this.isMultiAuthConstructorRun(accountAddress)) {
      console.log(`[AztecClient] Already deployed [${elapsed()}]`);
      return this.wallet.address;
    }

    const instance = this.wallet.getInstance();
    const { MultiAuthAccountContractClass } = await import('@/lib/auth/MultiAuthAccountContract');
    const labelMap: Record<string, string> = { schnorr: 'schnorr', ecdsasecp256k1: 'ethereum', ecdsasecp256r1: 'passkey' };
    const tempContract = new MultiAuthAccountContractClass(
      Buffer.from(this.accountKeys!.signingKey.toBuffer()),
      this.accountType,
      labelMap[this.accountType] ?? 'schnorr',
    );
    const { constructorArgs } = await tempContract.getInitializationFunctionAndArgs();

    const resp = await fetch(`${apiBase()}/api/deploy-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salt: instance.salt.toString(),
        publicKeys: instance.publicKeys.toString(),
        deployer: instance.deployer.toString(),
        initializationHash: instance.initializationHash.toString(),
        currentContractClassId: instance.currentContractClassId.toString(),
        originalContractClassId: instance.originalContractClassId.toString(),
        keyType: Number(constructorArgs[0]),
        primaryKeyHash: constructorArgs[1].toString(),
        labelHash: constructorArgs[2].toString(),
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => 'no body');
      if (errBody.includes('alreadyDeployed')) return this.wallet.address;
      if (resp.status === 409 && errBody.includes('stuckInstance')) {
        const err = new Error('Stuck instance — recovering with fresh address');
        (err as any).isStuckInstance = true;
        throw err;
      }
      throw new Error(`Deploy failed (${resp.status}): ${errBody}`);
    }

    return this.wallet.address;
  }

  async isMultiAuthConstructorRun(address: AztecAddress): Promise<boolean> {
    if (!this.node) return false;
    try {
      const keyCount = await this.node.getPublicStorageAt('latest', address, new Fr(5n));
      return keyCount.toBigInt() > 0n;
    } catch { return false; }
  }

  async waitForConstructorConfirmation(address: AztecAddress, maxAttempts = 20, intervalMs = 3000): Promise<boolean> {
    if (!this.node) return false;
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isMultiAuthConstructorRun(address)) return true;
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
