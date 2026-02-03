/**
 * Wallet Manager
 *
 * Unified state machine for wallet lifecycle management.
 * Coordinates between vault, session, and account services.
 *
 * State machine:
 * no_wallet → (create/import) → locked
 * locked → (unlock) → unlocked/connected
 * connected → (deploy) → deployed
 * any → (lock) → locked
 */

import type {
  NetworkConfig,
  WalletState,
  WalletCreationResult,
  VaultData,
  AccountMetadata,
  DerivedKeys,
} from '@/types/wallet';

import { KeyDerivationService } from './keyDerivation';
import { SecureVault, getVaultInstance } from './secureVault';
import { SessionManager, getSessionManager } from './sessionManager';
import { AccountService, getAccountService } from './accountService';

type StateListener = (state: WalletState) => void;

export class WalletManager {
  private vault: SecureVault;
  private session: SessionManager;
  private accountService: AccountService;
  private networkId: string;

  private vaultData: VaultData | null = null;
  private currentKeys: DerivedKeys | null = null;
  private currentPassword: string | null = null; // Kept in memory for vault updates
  private currentAccountIndex: number = 0; // Track selected account

  private listeners: Set<StateListener> = new Set();
  private initialized: boolean = false;

  constructor(network: NetworkConfig) {
    this.vault = getVaultInstance();
    this.session = getSessionManager();
    this.accountService = getAccountService(network);
    this.networkId = network.id;

    // Auto-lock callback
    this.session.onLock(() => {
      this.handleLock();
    });
  }

  /**
   * Initialize the wallet manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vault.initialize();
    await this.accountService.initialize();

    this.initialized = true;
  }

  /**
   * Ensure manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get current wallet state
   */
  async getState(): Promise<WalletState> {
    await this.ensureInitialized();

    const hasVault = await this.vault.hasVault(this.networkId);

    if (!hasVault) {
      return {
        status: 'no_wallet',
        address: null,
        isDeployed: false,
        accountIndex: 0,
        networkId: this.networkId,
      };
    }

    if (!this.currentKeys || this.session.isSessionLocked()) {
      return {
        status: 'locked',
        address: null,
        isDeployed: false,
        accountIndex: this.currentAccountIndex,
        networkId: this.networkId,
      };
    }

    const account = this.vaultData?.accounts[this.currentAccountIndex];
    return {
      status: account?.isDeployed ? 'deployed' : 'connected',
      address: account?.address || null,
      isDeployed: account?.isDeployed || false,
      accountIndex: this.currentAccountIndex,
      networkId: this.networkId,
    };
  }

  /**
   * Create a new wallet with fresh mnemonic
   */
  async createWallet(password: string): Promise<WalletCreationResult> {
    await this.ensureInitialized();

    // Check if wallet already exists
    const hasVault = await this.vault.hasVault(this.networkId);
    if (hasVault) {
      throw new Error('Wallet already exists for this network. Use importWallet or deleteWallet first.');
    }

    // Generate mnemonic and derive keys
    const mnemonic = KeyDerivationService.generateMnemonic();
    this.currentKeys = KeyDerivationService.deriveKeys(mnemonic);

    // Get address from keys
    const address = await this.accountService.getAddress(this.currentKeys);

    // Create vault data
    this.vaultData = {
      mnemonic,
      accounts: [{
        index: 0,
        type: 'schnorr',
        address,
        alias: 'Account 1',
        isDeployed: false,
      }],
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };

    // Save encrypted vault
    await this.vault.saveVault(this.networkId, password, this.vaultData);

    // Store in session
    this.session.setKeys(this.networkId, this.currentKeys);
    this.currentPassword = password;

    // Notify listeners
    await this.notifyListeners();

    return { mnemonic, address };
  }

  /**
   * Import wallet from mnemonic
   */
  async importWallet(mnemonic: string, password: string): Promise<string> {
    await this.ensureInitialized();

    // Validate mnemonic
    if (!KeyDerivationService.validateMnemonic(mnemonic)) {
      const invalidWords = KeyDerivationService.getInvalidWords(mnemonic);
      if (invalidWords.length > 0) {
        throw new Error(`Invalid words in mnemonic: ${invalidWords.join(', ')}`);
      }
      throw new Error('Invalid mnemonic phrase');
    }

    // Normalize and derive keys
    const normalizedMnemonic = KeyDerivationService.normalizeMnemonic(mnemonic);
    this.currentKeys = KeyDerivationService.deriveKeys(normalizedMnemonic);

    // Get address and check deployment status
    const address = await this.accountService.getAddress(this.currentKeys);
    const isDeployed = await this.accountService.isAccountDeployed(address);

    // Create vault data
    this.vaultData = {
      mnemonic: normalizedMnemonic,
      accounts: [{
        index: 0,
        type: 'schnorr',
        address,
        alias: 'Account 1',
        isDeployed,
      }],
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };

    // Save encrypted vault
    await this.vault.saveVault(this.networkId, password, this.vaultData);

    // Store in session
    this.session.setKeys(this.networkId, this.currentKeys);
    this.currentPassword = password;

    // Notify listeners
    await this.notifyListeners();

    return address;
  }

  /**
   * Unlock existing wallet with password
   */
  async unlock(password: string): Promise<string> {
    await this.ensureInitialized();

    // Load vault
    this.vaultData = await this.vault.loadVault(this.networkId, password);
    if (!this.vaultData) {
      throw new Error('No wallet found for this network');
    }

    // Derive keys from stored mnemonic
    this.currentKeys = KeyDerivationService.deriveKeys(this.vaultData.mnemonic);

    // Store in session
    this.session.setKeys(this.networkId, this.currentKeys);
    this.currentPassword = password;

    // Update last accessed
    this.vaultData.lastAccessed = Date.now();
    await this.vault.saveVault(this.networkId, password, this.vaultData);

    // Notify listeners
    await this.notifyListeners();

    return this.vaultData.accounts[0]?.address || '';
  }

  /**
   * Lock wallet (clear keys from memory)
   */
  lock(): void {
    this.session.lock();
    // handleLock will be called by session callback
  }

  /**
   * Handle lock event from session manager
   */
  private handleLock(): void {
    // Clear sensitive data
    if (this.currentKeys) {
      KeyDerivationService.wipeKeys(this.currentKeys);
    }
    this.currentKeys = null;
    this.vaultData = null;
    this.currentPassword = null;

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Deploy current account on-chain
   */
  async deployAccount(): Promise<string> {
    await this.ensureInitialized();

    if (!this.currentKeys) {
      throw new Error('Wallet not unlocked');
    }

    if (!this.vaultData) {
      throw new Error('Vault data not loaded');
    }

    const currentAccount = this.vaultData.accounts[this.currentAccountIndex];
    if (!currentAccount) {
      throw new Error('Current account not found');
    }

    if (currentAccount.isDeployed) {
      throw new Error('Account is already deployed');
    }

    // Deploy account
    const address = await this.accountService.deployAccount(this.currentKeys);

    // Update vault data for current account
    currentAccount.isDeployed = true;
    currentAccount.deployedAt = Date.now();
    currentAccount.address = address;

    // Save updated vault
    if (this.currentPassword) {
      await this.vault.saveVault(this.networkId, this.currentPassword, this.vaultData);
    }

    // Notify listeners
    await this.notifyListeners();

    return address;
  }

  /**
   * Add a new account (derived from same mnemonic)
   */
  async addAccount(alias: string): Promise<AccountMetadata> {
    await this.ensureInitialized();

    if (!this.vaultData || !this.currentPassword) {
      throw new Error('Wallet not unlocked');
    }

    const newIndex = this.vaultData.accounts.length;
    const keys = KeyDerivationService.deriveKeys(this.vaultData.mnemonic, newIndex);
    const address = await this.accountService.getAddress(keys);

    const newAccount: AccountMetadata = {
      index: newIndex,
      type: 'schnorr',
      address,
      alias: alias || `Account ${newIndex + 1}`,
      isDeployed: false,
    };

    this.vaultData.accounts.push(newAccount);
    await this.vault.saveVault(this.networkId, this.currentPassword, this.vaultData);

    // Wipe the derived keys
    KeyDerivationService.wipeKeys(keys);

    await this.notifyListeners();

    return newAccount;
  }

  /**
   * Get all accounts
   */
  getAccounts(): AccountMetadata[] {
    return this.vaultData?.accounts || [];
  }

  /**
   * Get current account
   */
  getCurrentAccount(): AccountMetadata | null {
    return this.vaultData?.accounts[this.currentAccountIndex] || null;
  }

  /**
   * Get current account index
   */
  getCurrentAccountIndex(): number {
    return this.currentAccountIndex;
  }

  /**
   * Switch to a different account by index
   */
  async switchAccount(index: number): Promise<string> {
    await this.ensureInitialized();

    if (!this.vaultData) {
      throw new Error('Wallet not unlocked');
    }

    if (index < 0 || index >= this.vaultData.accounts.length) {
      throw new Error(`Invalid account index: ${index}`);
    }

    // Update current account index
    this.currentAccountIndex = index;

    // Derive keys for the new account
    if (this.currentKeys) {
      KeyDerivationService.wipeKeys(this.currentKeys);
    }
    this.currentKeys = KeyDerivationService.deriveKeys(this.vaultData.mnemonic, index);

    // Update session
    this.session.setKeys(this.networkId, this.currentKeys);

    // Notify listeners
    await this.notifyListeners();

    return this.vaultData.accounts[index].address;
  }

  /**
   * Switch to account by address
   */
  async switchAccountByAddress(address: string): Promise<string> {
    const accounts = this.getAccounts();
    const index = accounts.findIndex(a => a.address === address);

    if (index === -1) {
      throw new Error(`Account not found: ${address}`);
    }

    return this.switchAccount(index);
  }

  /**
   * Export mnemonic (requires re-auth in production)
   */
  getMnemonic(): string | null {
    if (this.session.requiresReauth('exportMnemonic')) {
      // In production, this should require password re-entry
      // For now, return null if session is locked
      if (this.session.isSessionLocked()) {
        return null;
      }
    }
    return this.vaultData?.mnemonic || null;
  }

  /**
   * Delete wallet for current network
   */
  async deleteWallet(): Promise<void> {
    await this.ensureInitialized();

    // Lock first
    this.lock();

    // Delete vault
    await this.vault.deleteVault(this.networkId);

    // Notify listeners
    await this.notifyListeners();
  }

  /**
   * Check if browser extension is available
   */
  isExtensionAvailable(): boolean {
    return typeof window !== 'undefined' && 'aztec' in window;
  }

  /**
   * Subscribe to wallet state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of state change
   */
  private async notifyListeners(): Promise<void> {
    const state = await this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('Error in wallet state listener:', error);
      }
    });
  }

  /**
   * Get account service for contract interactions
   */
  getAccountService(): AccountService {
    return this.accountService;
  }

  /**
   * Get session manager
   */
  getSessionManager(): SessionManager {
    return this.session;
  }

  /**
   * Get network ID
   */
  getNetworkId(): string {
    return this.networkId;
  }
}

// Factory for creating wallet managers per network
const walletManagers: Map<string, WalletManager> = new Map();

export function getWalletManager(network: NetworkConfig): WalletManager {
  const key = network.id;

  if (!walletManagers.has(key)) {
    walletManagers.set(key, new WalletManager(network));
  }

  return walletManagers.get(key)!;
}

export function clearWalletManagers(): void {
  walletManagers.forEach(manager => manager.lock());
  walletManagers.clear();
}
