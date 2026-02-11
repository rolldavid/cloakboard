/**
 * Auth Manager
 *
 * Unified orchestrator for all authentication methods:
 * - Passkey (WebAuthn with secp256r1)
 * - Google OAuth (with ZK domain proofs)
 * - Email + Password (client-side key derivation)
 * - Mnemonic (legacy)
 *
 * Coordinates between auth services, key derivation, username system, and vault.
 */

import type { NetworkConfig, DerivedKeys, AccountType, VaultData, AccountMetadata, LinkedAuthMethod, LinkedKeyEntry, LinkedVaultRedirect } from '@/types/wallet';
import type {
  AuthMethod,
  AuthResult,
  AuthCredentials,
  AuthMetadata,
  PasskeyCredential,
  GoogleOAuthData,
  DomainProof,
  ProofState,
} from './types';
import { generateUsername } from '../username/generator';
import { hashDisplayName, getDisplayNameService } from '../username/DisplayNameService';
import { getVaultInstance, SecureVault } from '../wallet/secureVault';
import { getAccountService, AccountService } from '../wallet/accountService';
import { getDeploymentService, DeploymentService } from '../wallet/deploymentService';
import { KeyDerivationService } from '../wallet/keyDerivation';
import {
  storeKeyAddressMapping,
  lookupAddressByKeyHash,
  removeKeyAddressMapping,
  clearKeyAddressMap,
  getKeysForAddress,
  type KeyAddressEntry,
} from './MultiAuthAccountContract';
import { computePublicKeyHash, computeLabelHash, accountTypeToKeyType } from './MultiAuthAccountEntrypoint';

type AuthStateListener = (state: AuthState) => void;

export type DeploymentStatus = 'idle' | 'deploying' | 'deployed' | 'failed';

export interface AuthState {
  isAuthenticated: boolean;
  method: AuthMethod | null;
  username: string | null;
  address: string | null;
  isDeployed: boolean;
  deploymentStatus: DeploymentStatus;
  deploymentError: string | null;
  proofState: ProofState;
}

// Session storage key for persisting auth state during session
const AUTH_SESSION_KEY = 'private-cloak-auth-session';

// LocalStorage key for persisting auth method across sessions (for returning users)
const AUTH_METHOD_KEY = 'private-cloak-auth-method';

// LocalStorage key for caching linked account methods (readable without vault keys)
const LINKED_ACCOUNTS_KEY = 'private-cloak-linked-accounts';

interface PersistedAuthState {
  method: AuthMethod;
  username: string;
  address: string;
}

// Minimal info stored in localStorage (unencrypted) to know which auth method to prompt
export interface StoredAuthMethod {
  method: AuthMethod;
  username: string;
  // For passkeys, we may need credential ID hints
  credentialId?: string;
  // For email-based methods, we can store a hint (not the full email for privacy)
  emailHint?: string;
}

export class AuthManager {
  private vault: SecureVault;
  private accountService: AccountService;
  private deploymentService: DeploymentService;
  private network: NetworkConfig;
  private initialized: boolean = false;

  private currentKeys: DerivedKeys | null = null;
  private currentPassword: string | null = null;
  private currentMethod: AuthMethod | null = null;
  private currentUsername: string | null = null;
  private currentAddress: string | null = null;
  private isDeployed: boolean = false;
  private deploymentStatus: DeploymentStatus = 'idle';
  private deploymentError: string | null = null;

  private listeners: Set<AuthStateListener> = new Set();
  private proofState: ProofState = { status: 'idle' };

  constructor(network: NetworkConfig) {
    this.vault = getVaultInstance();
    this.accountService = getAccountService(network);
    this.deploymentService = getDeploymentService(network);
    this.network = network;


  }

  /**
   * Persist auth state to localStorage so it survives page refreshes
   * and dev server restarts.
   */
  private persistAuthState(): void {
    if (typeof window === 'undefined') return;

    if (this.currentMethod && this.currentUsername && this.currentAddress) {
      // Full session state in localStorage (persists across restarts)
      const state: PersistedAuthState = {
        method: this.currentMethod,
        username: this.currentUsername,
        address: this.currentAddress,
      };
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(state));

      // Auth method hint for returning users
      const storedMethod: StoredAuthMethod = {
        method: this.currentMethod,
        username: this.currentUsername,
      };
      localStorage.setItem(AUTH_METHOD_KEY, JSON.stringify(storedMethod));
    }
  }

  /**
   * Get stored auth method for returning users (static, no initialization needed)
   */
  static getStoredAuthMethod(): StoredAuthMethod | null {
    if (typeof window === 'undefined') return null;

    try {
      const stored = localStorage.getItem(AUTH_METHOD_KEY);
      if (!stored) return null;
      return JSON.parse(stored) as StoredAuthMethod;
    } catch {
      return null;
    }
  }

  /**
   * Clear stored auth method (on logout or account deletion)
   */
  static clearStoredAuthMethod(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(AUTH_METHOD_KEY);
  }

  /**
   * Restore auth state from localStorage
   */
  private restoreAuthState(): boolean {
    if (typeof window === 'undefined') return false;

    try {
      const stored = localStorage.getItem(AUTH_SESSION_KEY);
      if (!stored) return false;

      const state: PersistedAuthState = JSON.parse(stored);
      this.currentMethod = state.method;
      this.currentUsername = state.username;
      this.currentAddress = state.address;
      // Note: keys are NOT restored - they exist only in memory during the session
      // For re-authentication, user would need to sign in again

      // Check deployment status on-chain in background
      if (state.address) {
        this.checkDeploymentStatusAsync(state.address);
      }

      return true;
    } catch (e) {
      console.error('[AuthManager] Failed to restore auth state:', e);
      return false;
    }
  }

  /**
   * Check deployment status on-chain (called after session restore)
   */
  private async checkDeploymentStatusAsync(address: string): Promise<void> {
    try {
      const deployed = await this.deploymentService.isDeployed(address);

      if (deployed) {
        this.isDeployed = true;
        this.deploymentStatus = 'deployed';
      } else {
        // Account not deployed - user needs to re-authenticate to deploy
        this.deploymentStatus = 'idle';
      }
      this.notifyListeners();
    } catch (error) {
      console.error('[AuthManager] Failed to check deployment status:', error);
    }
  }

  /**
   * Clear persisted auth state
   */
  private clearPersistedAuthState(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_METHOD_KEY);
    localStorage.removeItem(LINKED_ACCOUNTS_KEY);
    clearKeyAddressMap();
  }

  /**
   * Persist linked accounts to localStorage cache (readable without vault keys)
   */
  private persistLinkedAccounts(accounts: LinkedAuthMethod[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(LINKED_ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch {}
  }

  /**
   * Load cached linked accounts from localStorage
   */
  static getCachedLinkedAccounts(): LinkedAuthMethod[] {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(LINKED_ACCOUNTS_KEY);
      if (!stored) return [];
      return JSON.parse(stored) as LinkedAuthMethod[];
    } catch {
      return [];
    }
  }

  /**
   * Initialize the auth manager
   *
   * NOTE: We only initialize the vault here, not the accountService.
   * The accountService connects to the Aztec node which may not be available.
   * Address computation is purely local and doesn't need node connection.
   * Node connection is only needed for deploying accounts (done later).
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      // Even if already initialized, check if we need to restore state
      // This handles the case where auth happened in a different component
      if (!this.currentMethod && !this.currentUsername) {
        this.restoreAuthState();
      }
      return;
    }

    await this.vault.initialize();
    // Don't initialize accountService here - it tries to connect to Aztec node
    // which may hang if no node is running. Address computation is local.

    // Restore auth state from sessionStorage if available
    this.restoreAuthState();

    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get current auth state
   */
  getState(): AuthState {
    // User is authenticated if we have keys in memory OR restored session
    const isAuthenticated = this.currentKeys !== null ||
      (this.currentMethod !== null && this.currentUsername !== null);

    return {
      isAuthenticated,
      method: this.currentMethod,
      username: this.currentUsername,
      address: this.currentAddress,
      isDeployed: this.isDeployed,
      deploymentStatus: this.deploymentStatus,
      deploymentError: this.deploymentError,
      proofState: this.proofState,
    };
  }

  /**
   * Authenticate with passkey
   */
  async authenticateWithPasskey(credential: PasskeyCredential): Promise<AuthResult> {
    await this.ensureInitialized();

    // Import passkey key derivation dynamically to avoid circular deps
    const { PasskeyKeyDerivation } = await import('./passkey/PasskeyKeyDerivation');

    // Derive keys from passkey credential
    const keys = PasskeyKeyDerivation.deriveKeys(credential.publicKey, credential.credentialId);

    // Check for linked vault redirect — if found, use primary account keys
    const linkedResolution = await this.resolveLinkedVault(keys);
    if (linkedResolution) {
      this.currentKeys = linkedResolution.keys;
      this.currentMethod = linkedResolution.method;
      this.currentAddress = linkedResolution.address;
      this.currentUsername = linkedResolution.username;
      this.persistAuthState();
      await this.notifyListeners();
      return {
        method: linkedResolution.method,
        address: linkedResolution.address,
        username: linkedResolution.username,
        keys: linkedResolution.keys,
        accountType: linkedResolution.accountType,
        metadata: { method: linkedResolution.method, createdAt: Date.now() },
      };
    }

    // Get address using ecdsasecp256r1 account type
    const address = await this.accountService.getAddress(keys, 'ecdsasecp256r1');

    // Check if returning user
    const displayName = await this.getExistingUsername(keys, 'ecdsasecp256r1') ?? generateUsername();

    // Create auth metadata
    const metadata: AuthMetadata = {
      method: 'passkey',
      createdAt: Date.now(),
      credentialId: credential.credentialId,
    };

    // Store in vault
    await this.storeInVault(keys, 'passkey', metadata, displayName);

    this.currentKeys = keys;
    this.currentMethod = 'passkey';
    this.currentUsername = displayName;
    this.currentAddress = address;

    // Store key-to-address mapping for multi-auth login
    await this.storeKeyAddressEntry(keys.signingKey, 'ecdsasecp256r1', 'passkey', address);

    // Optimistic cache — available immediately on next login
    const service = getDisplayNameService();
    service.cacheDisplayName(address, displayName).catch(() => {});

    // Persist to sessionStorage for page navigation
    this.persistAuthState();

    await this.notifyListeners();

    return {
      method: 'passkey',
      address,
      username: displayName,
      keys,
      accountType: 'ecdsasecp256r1',
      metadata,
    };
  }

  /**
   * Authenticate with Google OAuth (passwordless)
   */
  async authenticateWithGoogle(oauth: GoogleOAuthData): Promise<AuthResult> {
    await this.ensureInitialized();

    // Import OAuth key derivation dynamically
    const { OAuthKeyDerivation } = await import('./google/OAuthKeyDerivation');

    // Derive keys from Google sub (passwordless)
    const keys = OAuthKeyDerivation.deriveKeys(oauth.sub);

    // Check for linked vault redirect — if found, use primary account keys
    const linkedResolution = await this.resolveLinkedVault(keys);
    if (linkedResolution) {
      this.currentKeys = linkedResolution.keys;
      this.currentMethod = linkedResolution.method;
      this.currentAddress = linkedResolution.address;
      this.currentUsername = linkedResolution.username;
      this.persistAuthState();
      await this.notifyListeners();
      return {
        method: linkedResolution.method,
        address: linkedResolution.address,
        username: linkedResolution.username,
        keys: linkedResolution.keys,
        accountType: linkedResolution.accountType,
        metadata: { method: linkedResolution.method, createdAt: Date.now() },
      };
    }

    // Get address using schnorr account type
    const address = await this.accountService.getAddress(keys, 'schnorr');

    // Check if returning user
    const displayName = await this.getExistingUsername(keys) ?? generateUsername();

    // Create auth metadata (privacy-preserving - only domain hash, not email)
    const domainHash = await this.hashDomain(oauth.domain);
    const metadata: AuthMetadata = {
      method: 'google',
      createdAt: Date.now(),
      emailDomainHash: domainHash,
    };

    // Store in vault (passwordless - use derived vault password)
    await this.storeInVault(keys, 'google', metadata, displayName);

    this.currentKeys = keys;
    this.currentMethod = 'google';
    this.currentUsername = displayName;
    this.currentAddress = address;

    // Store key-to-address mapping for multi-auth login
    await this.storeKeyAddressEntry(keys.signingKey, 'schnorr', 'google', address);

    // Optimistic cache — available immediately on next login
    const service = getDisplayNameService();
    service.cacheDisplayName(address, displayName).catch(() => {});

    // Persist to sessionStorage for page navigation
    this.persistAuthState();

    // Trigger background proof generation
    this.generateDomainProofInBackground(oauth);

    await this.notifyListeners();

    return {
      method: 'google',
      address,
      username: displayName,
      keys,
      accountType: 'schnorr',
      metadata,
    };
  }

  /**
   * Authenticate with Ethereum wallet.
   * Derives Aztec keys from an ETH signature for a deterministic account.
   */
  async authenticateWithEthereum(ethAddress: string, signature: Uint8Array): Promise<AuthResult> {
    await this.ensureInitialized();

    const { EthKeyDerivation } = await import('./ethereum/EthKeyDerivation');

    // Derive keys from signature (async for proper SHA-256)
    const keys = await EthKeyDerivation.deriveKeysAsync(signature);

    // Check for linked vault redirect — if found, use primary account keys
    const linkedResolution = await this.resolveLinkedVault(keys);
    if (linkedResolution) {
      this.currentKeys = linkedResolution.keys;
      this.currentMethod = linkedResolution.method;
      this.currentAddress = linkedResolution.address;
      this.currentUsername = linkedResolution.username;
      this.persistAuthState();
      await this.notifyListeners();
      return {
        method: linkedResolution.method,
        address: linkedResolution.address,
        username: linkedResolution.username,
        keys: linkedResolution.keys,
        accountType: linkedResolution.accountType,
        metadata: { method: linkedResolution.method, createdAt: Date.now() },
      };
    }

    // Get address using ecdsasecp256k1 account type
    const address = await this.accountService.getAddress(keys, 'ecdsasecp256k1');

    // Check if returning user
    const username = await this.getExistingUsername(keys, 'ecdsasecp256k1') ?? generateUsername();

    // Create auth metadata
    const metadata: AuthMetadata = {
      method: 'ethereum',
      createdAt: Date.now(),
    };

    // Store in vault
    await this.storeInVault(keys, 'ethereum', metadata, username);

    this.currentKeys = keys;
    this.currentMethod = 'ethereum';
    this.currentUsername = username;
    this.currentAddress = address;

    // Store key-to-address mapping for multi-auth login
    await this.storeKeyAddressEntry(keys.signingKey, 'ecdsasecp256k1', `eth:${ethAddress}`, address);

    // Optimistic cache — available immediately on next login
    const ethService = getDisplayNameService();
    ethService.cacheDisplayName(address, username).catch(() => {});

    // Persist to sessionStorage
    this.persistAuthState();

    await this.notifyListeners();

    return {
      method: 'ethereum',
      address,
      username,
      keys,
      accountType: 'ecdsasecp256k1',
      metadata,
    };
  }

  /**
   * Link an Ethereum wallet to the current Aztec account.
   * Used for ERC20 token gating when the user signed up via a non-ETH method.
   *
   * This stores the link in the vault AND registers a key-to-address mapping
   * so the user can log in with the linked ETH wallet on any device.
   */
  async linkEthereumWallet(ethAddress: string, signature: Uint8Array): Promise<void> {
    if (!this.currentAddress) {
      throw new Error('No authenticated account to link to');
    }

    const vaultPassword = this.requireVaultPassword();

    // Derive the ETH key and check if it's already linked to a different account
    const { EthKeyDerivation } = await import('./ethereum/EthKeyDerivation');
    const linkedKeys = await EthKeyDerivation.deriveKeysAsync(signature);
    const pubKeyHash = await computePublicKeyHash(linkedKeys.signingKey);
    const existingAddress = lookupAddressByKeyHash(pubKeyHash.toString());
    if (existingAddress && existingAddress !== this.currentAddress) {
      throw new Error(
        'This Ethereum wallet is already linked to a different account. Unlink it from the other account first.'
      );
    }

    // On-chain check: reject if this wallet already has a deployed account
    const linkedAddress = await this.accountService.getAddress(linkedKeys, 'ecdsasecp256k1');
    if (linkedAddress !== this.currentAddress) {
      const deployed = await this.accountService.isAccountDeployed(linkedAddress);
      if (deployed) {
        throw new Error(
          'This wallet already has its own Cloakboard account and cannot be linked. Sign in directly with this wallet instead.'
        );
      }
    }

    await this.storeKeyAddressEntry(
      linkedKeys.signingKey,
      'ecdsasecp256k1',
      `eth:${ethAddress.toLowerCase()}`,
      this.currentAddress,
    );

    const linkedVaultKey = await this.createRedirectVault(linkedKeys, 'ethereum');

    await this.vault.updateVault(this.network.id, vaultPassword, (data) => {
      const linked = data.linkedEthAddresses ?? [];
      if (!linked.includes(ethAddress.toLowerCase())) {
        linked.push(ethAddress.toLowerCase());
      }
      const linkedMethods = data.linkedAuthMethods ?? [];
      if (!linkedMethods.some(l => l.method === 'ethereum' && l.ethAddress === ethAddress.toLowerCase())) {
        linkedMethods.push({
          method: 'ethereum',
          ethAddress: ethAddress.toLowerCase(),
          linkedAt: Date.now(),
          linkedVaultKey,
        });
      }
      return { ...data, linkedEthAddresses: linked, linkedAuthMethods: linkedMethods };
    });
    await this.refreshLinkedAccountsCache();
    this.notifyListeners();
  }

  /**
   * Authenticate with a Solana wallet signature.
   * Derives Aztec keys from the Ed25519 signature bytes.
   */
  async authenticateWithSolana(solAddress: string, signature: Uint8Array): Promise<AuthResult> {
    await this.ensureInitialized();

    const { SolanaKeyDerivation } = await import('./solana/SolanaKeyDerivation');

    // Derive keys from signature (async for proper SHA-256)
    const keys = await SolanaKeyDerivation.deriveKeysAsync(signature);

    // Check for linked vault redirect — if found, use primary account keys
    const linkedResolution = await this.resolveLinkedVault(keys);
    if (linkedResolution) {
      this.currentKeys = linkedResolution.keys;
      this.currentMethod = linkedResolution.method;
      this.currentAddress = linkedResolution.address;
      this.currentUsername = linkedResolution.username;
      this.persistAuthState();
      await this.notifyListeners();
      return {
        method: linkedResolution.method,
        address: linkedResolution.address,
        username: linkedResolution.username,
        keys: linkedResolution.keys,
        accountType: linkedResolution.accountType,
        metadata: { method: linkedResolution.method, createdAt: Date.now() },
      };
    }

    // Use schnorr account type (signature is just entropy, not used for Aztec signing)
    const address = await this.accountService.getAddress(keys, 'schnorr');

    // Check if returning user
    const username = await this.getExistingUsername(keys) ?? generateUsername();

    // Create auth metadata
    const metadata: AuthMetadata = {
      method: 'solana',
      createdAt: Date.now(),
    };

    // Store in vault
    await this.storeInVault(keys, 'solana', metadata, username);

    this.currentKeys = keys;
    this.currentMethod = 'solana';
    this.currentUsername = username;
    this.currentAddress = address;

    // Store key-to-address mapping for multi-auth login
    await this.storeKeyAddressEntry(keys.signingKey, 'schnorr', `sol:${solAddress}`, address);

    // Optimistic cache — available immediately on next login
    const solService = getDisplayNameService();
    solService.cacheDisplayName(address, username).catch(() => {});

    // Persist to sessionStorage
    this.persistAuthState();

    await this.notifyListeners();

    return {
      method: 'solana',
      address,
      username,
      keys,
      accountType: 'schnorr',
      metadata,
    };
  }

  /**
   * Link a Solana wallet to the current Aztec account.
   */
  async linkSolana(solAddress: string, signature: Uint8Array): Promise<void> {
    if (!this.currentAddress) {
      throw new Error('No authenticated account to link to');
    }
    const vaultPassword = this.requireVaultPassword();

    // Derive the Solana key and check if it's already linked to a different account
    const { SolanaKeyDerivation } = await import('./solana/SolanaKeyDerivation');
    const linkedKeys = await SolanaKeyDerivation.deriveKeysAsync(signature);
    const pubKeyHash = await computePublicKeyHash(linkedKeys.signingKey);
    const existingAddress = lookupAddressByKeyHash(pubKeyHash.toString());
    if (existingAddress && existingAddress !== this.currentAddress) {
      throw new Error(
        'This Solana wallet is already linked to a different account. Unlink it from the other account first.'
      );
    }

    // On-chain check: reject if this wallet already has a deployed account
    const linkedAddress = await this.accountService.getAddress(linkedKeys, 'schnorr');
    if (linkedAddress !== this.currentAddress) {
      const deployed = await this.accountService.isAccountDeployed(linkedAddress);
      if (deployed) {
        throw new Error(
          'This wallet already has its own Cloakboard account and cannot be linked. Sign in directly with this wallet instead.'
        );
      }
    }

    await this.storeKeyAddressEntry(
      linkedKeys.signingKey,
      'schnorr',
      `sol:${solAddress}`,
      this.currentAddress,
    );

    const linkedVaultKey = await this.createRedirectVault(linkedKeys, 'solana');

    await this.vault.updateVault(this.network.id, vaultPassword, (data) => {
      const linked = data.linkedAuthMethods ?? [];
      if (linked.some(l => l.method === 'solana' && l.ethAddress === solAddress)) return data;
      linked.push({
        method: 'solana',
        ethAddress: solAddress, // reuse ethAddress field for wallet address
        linkedAt: Date.now(),
        linkedVaultKey,
      });
      return { ...data, linkedAuthMethods: linked };
    });
    await this.refreshLinkedAccountsCache();
    this.notifyListeners();
  }

  /**
   * Link a Google account to the current Aztec account.
   */
  async linkGoogle(oauth: GoogleOAuthData): Promise<void> {
    if (!this.currentAddress) {
      throw new Error('No authenticated account to link to');
    }
    const vaultPassword = this.requireVaultPassword();

    // Derive the Google key and check if it's already linked to a different account
    const { OAuthKeyDerivation } = await import('./google/OAuthKeyDerivation');
    const linkedKeys = OAuthKeyDerivation.deriveKeys(oauth.sub);
    const pubKeyHash = await computePublicKeyHash(linkedKeys.signingKey);
    const existingAddress = lookupAddressByKeyHash(pubKeyHash.toString());
    if (existingAddress && existingAddress !== this.currentAddress) {
      throw new Error(
        'This Google account is already linked to a different account. Unlink it from the other account first.'
      );
    }

    // On-chain check: reject if this Google account already has a deployed account
    const linkedAddress = await this.accountService.getAddress(linkedKeys, 'schnorr');
    if (linkedAddress !== this.currentAddress) {
      const deployed = await this.accountService.isAccountDeployed(linkedAddress);
      if (deployed) {
        throw new Error(
          'This account already has its own Cloakboard account and cannot be linked. Sign in directly with this account instead.'
        );
      }
    }

    await this.storeKeyAddressEntry(
      linkedKeys.signingKey,
      'schnorr',
      'google',
      this.currentAddress,
    );

    const domainHash = await this.hashDomain(oauth.domain);

    const linkedVaultKey = await this.createRedirectVault(linkedKeys, 'google');

    await this.vault.updateVault(this.network.id, vaultPassword, (data) => {
      const linked = data.linkedAuthMethods ?? [];
      if (linked.some(l => l.method === 'google')) return data;
      linked.push({
        method: 'google',
        emailDomainHash: domainHash,
        linkedAt: Date.now(),
        linkedVaultKey,
      });
      return { ...data, linkedAuthMethods: linked };
    });
    await this.refreshLinkedAccountsCache();
    this.notifyListeners();
  }

  /**
   * Link a passkey to the current Aztec account.
   */
  async linkPasskey(credential: PasskeyCredential): Promise<void> {
    if (!this.currentAddress) {
      throw new Error('No authenticated account to link to');
    }
    const vaultPassword = this.requireVaultPassword();

    // Derive the passkey key and check if it's already linked to a different account
    const { PasskeyKeyDerivation } = await import('./passkey/PasskeyKeyDerivation');
    const linkedKeys = PasskeyKeyDerivation.deriveKeys(credential.publicKey, credential.credentialId);
    const pubKeyHash = await computePublicKeyHash(linkedKeys.signingKey);
    const existingAddress = lookupAddressByKeyHash(pubKeyHash.toString());
    if (existingAddress && existingAddress !== this.currentAddress) {
      throw new Error(
        'This passkey is already linked to a different account. Unlink it from the other account first.'
      );
    }

    // On-chain check: reject if this passkey already has a deployed account
    const linkedAddress = await this.accountService.getAddress(linkedKeys, 'ecdsasecp256r1');
    if (linkedAddress !== this.currentAddress) {
      const deployed = await this.accountService.isAccountDeployed(linkedAddress);
      if (deployed) {
        throw new Error(
          'This passkey already has its own Cloakboard account and cannot be linked. Sign in directly with this passkey instead.'
        );
      }
    }

    await this.storeKeyAddressEntry(
      linkedKeys.signingKey,
      'ecdsasecp256r1',
      'passkey',
      this.currentAddress,
    );

    const linkedVaultKey = await this.createRedirectVault(linkedKeys, 'passkey');

    await this.vault.updateVault(this.network.id, vaultPassword, (data) => {
      const linked = data.linkedAuthMethods ?? [];
      if (linked.some(l => l.method === 'passkey')) return data;
      linked.push({
        method: 'passkey',
        credentialId: credential.credentialId,
        linkedAt: Date.now(),
        linkedVaultKey,
      });
      return { ...data, linkedAuthMethods: linked };
    });
    await this.refreshLinkedAccountsCache();
    this.notifyListeners();
  }

  /**
   * Link an email+password to the current Aztec account.
   */
  async linkPassword(email: string, password: string): Promise<void> {
    if (!this.currentAddress) {
      throw new Error('No authenticated account to link to');
    }
    const vaultPassword = this.requireVaultPassword();

    // Derive the password key and check if it's already linked to a different account
    const { PasswordKeyDerivation } = await import('./password/PasswordKeyDerivation');
    const linkedKeys = PasswordKeyDerivation.deriveKeys(email, password);
    const pubKeyHash = await computePublicKeyHash(linkedKeys.signingKey);
    const existingAddress = lookupAddressByKeyHash(pubKeyHash.toString());
    if (existingAddress && existingAddress !== this.currentAddress) {
      throw new Error(
        'This email is already linked to a different account. Unlink it from the other account first.'
      );
    }

    // On-chain check: reject if this email+password already has a deployed account
    const linkedAddress = await this.accountService.getAddress(linkedKeys, 'schnorr');
    if (linkedAddress !== this.currentAddress) {
      const deployed = await this.accountService.isAccountDeployed(linkedAddress);
      if (deployed) {
        throw new Error(
          'This email already has its own Cloakboard account and cannot be linked. Sign in directly with this email instead.'
        );
      }
    }

    const emailHash = await this.hashEmail(email);

    await this.storeKeyAddressEntry(
      linkedKeys.signingKey,
      'schnorr',
      `password:${emailHash.slice(0, 8)}`,
      this.currentAddress,
    );

    const linkedVaultKey = await this.createRedirectVault(linkedKeys, 'password');

    await this.vault.updateVault(this.network.id, vaultPassword, (data) => {
      const linked = data.linkedAuthMethods ?? [];
      if (linked.some(l => l.method === 'password')) return data;
      linked.push({
        method: 'password',
        emailHash,
        linkedAt: Date.now(),
        linkedVaultKey,
      });
      return { ...data, linkedAuthMethods: linked };
    });
    await this.refreshLinkedAccountsCache();
    this.notifyListeners();
  }

  /**
   * Get all linked auth methods from the vault.
   */
  async getLinkedAccounts(): Promise<LinkedAuthMethod[]> {
    // If we have keys, read from vault and update cache
    if (this.currentKeys) {
      try {
        const vaultPassword = this.deriveVaultPassword(this.currentKeys);
        const data = await this.vault.loadVault(this.network.id, vaultPassword);
        const accounts = data?.linkedAuthMethods ?? [];
        this.persistLinkedAccounts(accounts);
        return accounts;
      } catch {
        // Fall through to cache
      }
    }
    // No keys (e.g. after page refresh) — use localStorage cache
    return AuthManager.getCachedLinkedAccounts();
  }

  /**
   * Read linked accounts from vault and update localStorage cache.
   */
  private async refreshLinkedAccountsCache(): Promise<void> {
    if (!this.currentKeys) return;
    try {
      const vaultPassword = this.deriveVaultPassword(this.currentKeys);
      const data = await this.vault.loadVault(this.network.id, vaultPassword);
      this.persistLinkedAccounts(data?.linkedAuthMethods ?? []);
    } catch {}
  }

  /**
   * Remove a linked auth method. Cannot unlink the primary method.
   */
  async unlinkAccount(method: AuthMethod): Promise<void> {
    if (method === this.currentMethod) {
      throw new Error('Cannot unlink the primary authentication method');
    }
    const vaultPassword = this.requireVaultPassword();

    // Clean up key-address cache for the unlinked method
    if (this.currentAddress) {
      const labelPrefixes: Record<string, string> = {
        ethereum: 'eth:',
        solana: 'sol:',
        google: 'google',
        passkey: 'passkey',
        password: 'password:',
      };
      const prefix = labelPrefixes[method];
      if (prefix) {
        const keys = getKeysForAddress(this.currentAddress);
        for (const key of keys) {
          if (key.label.startsWith(prefix)) {
            removeKeyAddressMapping(key.publicKeyHash);
          }
        }
      }
    }

    // Read the linkedVaultKey before removing the entry
    const vaultData = await this.vault.loadVault(this.network.id, vaultPassword);
    const linkedEntry = vaultData?.linkedAuthMethods?.find(l => l.method === method);

    await this.vault.updateVault(this.network.id, vaultPassword, (data) => {
      const linked = data.linkedAuthMethods ?? [];
      return {
        ...data,
        linkedAuthMethods: linked.filter(l => l.method !== method),
        ...(method === 'ethereum' ? { linkedEthAddresses: [] } : {}),
      };
    });

    // Delete the redirect vault so the unlinked method can no longer redirect to this account
    if (linkedEntry?.linkedVaultKey) {
      await this.vault.deleteByKey(linkedEntry.linkedVaultKey).catch(() => {});
    }

    await this.refreshLinkedAccountsCache();
    this.notifyListeners();
  }

  /**
   * Require an active vault password or throw.
   */
  private requireVaultPassword(): string {
    if (!this.currentKeys) {
      throw new Error('Your session has expired. Please sign in again to manage linked accounts.');
    }
    return this.deriveVaultPassword(this.currentKeys);
  }

  /**
   * Authenticate with email + password (fully client-side)
   */
  async authenticateWithPassword(email: string, password: string): Promise<AuthResult> {
    await this.ensureInitialized();

    // Import password key derivation dynamically
    const { PasswordKeyDerivation } = await import('./password/PasswordKeyDerivation');

    // Derive keys from email + password
    const keys = PasswordKeyDerivation.deriveKeys(email, password);

    // Check for linked vault redirect — if found, use primary account keys
    const linkedResolution = await this.resolveLinkedVault(keys);
    if (linkedResolution) {
      this.currentKeys = linkedResolution.keys;
      this.currentMethod = linkedResolution.method;
      this.currentAddress = linkedResolution.address;
      this.currentUsername = linkedResolution.username;
      this.persistAuthState();
      await this.notifyListeners();
      return {
        method: linkedResolution.method,
        address: linkedResolution.address,
        username: linkedResolution.username,
        keys: linkedResolution.keys,
        accountType: linkedResolution.accountType,
        metadata: { method: linkedResolution.method, createdAt: Date.now() },
      };
    }

    // Get address using schnorr account type
    const address = await this.accountService.getAddress(keys, 'schnorr');

    // Check if returning user
    const displayName = await this.getExistingUsername(keys) ?? generateUsername();

    // Create auth metadata (hashed email for recovery)
    const emailHash = await this.hashEmail(email);
    const metadata: AuthMetadata = {
      method: 'password',
      createdAt: Date.now(),
      emailHash,
    };

    // Store in vault
    await this.storeInVault(keys, 'password', metadata, displayName);

    this.currentKeys = keys;
    this.currentMethod = 'password';
    this.currentUsername = displayName;
    this.currentAddress = address;

    // Store key-to-address mapping for multi-auth login
    await this.storeKeyAddressEntry(keys.signingKey, 'schnorr', `password:${emailHash.slice(0, 8)}`, address);

    // Optimistic cache — available immediately on next login
    const pwService = getDisplayNameService();
    pwService.cacheDisplayName(address, displayName).catch(() => {});

    // Persist to sessionStorage for page navigation
    this.persistAuthState();

    await this.notifyListeners();

    return {
      method: 'password',
      address,
      username: displayName,
      keys,
      accountType: 'schnorr',
      metadata,
    };
  }

  /**
   * Unlock with password (for non-passkey methods)
   */
  async unlock(password: string): Promise<AuthResult> {
    await this.ensureInitialized();

    const vaultData = await this.vault.loadVault(this.network.id, password);
    if (!vaultData) {
      throw new Error('No wallet found');
    }

    // Derive keys based on auth method
    let keys: DerivedKeys;

    keys = KeyDerivationService.deriveKeys(vaultData.mnemonic);

    const account = vaultData.accounts[0];
    if (!account) {
      throw new Error('No account found in vault');
    }

    this.currentKeys = keys;
    this.currentPassword = password;
    this.currentMethod = vaultData.authMethod || 'google';
    this.currentUsername = vaultData.username || account.alias;

    await this.notifyListeners();

    return {
      method: this.currentMethod,
      address: account.address,
      username: this.currentUsername,
      keys,
      accountType: account.type,
      metadata: vaultData.authMetadata || { method: this.currentMethod, createdAt: vaultData.createdAt },
    };
  }

  /**
   * Unlock with passkey
   */
  async unlockWithPasskey(credential: PasskeyCredential): Promise<AuthResult> {
    await this.ensureInitialized();

    const { PasskeyKeyDerivation } = await import('./passkey/PasskeyKeyDerivation');

    // Derive keys from passkey
    const keys = PasskeyKeyDerivation.deriveKeys(credential.publicKey, credential.credentialId);

    // Check for linked vault redirect — if found, use primary account keys
    const linkedResolution = await this.resolveLinkedVault(keys);
    if (linkedResolution) {
      this.currentKeys = linkedResolution.keys;
      this.currentMethod = linkedResolution.method;
      this.currentAddress = linkedResolution.address;
      this.currentUsername = linkedResolution.username;
      this.persistAuthState();
      await this.notifyListeners();
      return {
        method: linkedResolution.method,
        address: linkedResolution.address,
        username: linkedResolution.username,
        keys: linkedResolution.keys,
        accountType: linkedResolution.accountType,
        metadata: { method: linkedResolution.method, createdAt: Date.now() },
      };
    }

    // Normal (primary) passkey flow
    const address = await this.accountService.getAddress(keys, 'ecdsasecp256r1');

    // Get display name from IndexedDB cache, vault, or generate a new one
    const username = await this.getExistingUsername(keys, 'ecdsasecp256r1') ?? generateUsername();

    this.currentKeys = keys;
    this.currentMethod = 'passkey';
    this.currentUsername = username;
    this.currentAddress = address;

    // Cache display name so subsequent logins find it immediately
    const displayNameService = getDisplayNameService();
    displayNameService.cacheDisplayName(address, username).catch(() => {});

    this.persistAuthState();

    await this.notifyListeners();

    return {
      method: 'passkey',
      address,
      username,
      keys,
      accountType: 'ecdsasecp256r1',
      metadata: {
        method: 'passkey',
        createdAt: Date.now(),
        credentialId: credential.credentialId,
      },
    };
  }

  /**
   * Resolve an account address from a signing key using the key-address cache.
   * Used when logging in with a linked auth method to find the primary account.
   */
  static async resolveAddressByKey(
    signingKey: Uint8Array,
    accountType: AccountType,
  ): Promise<string | null> {
    const pubKeyHash = await computePublicKeyHash(signingKey);
    return lookupAddressByKeyHash(pubKeyHash.toString());
  }

  /**
   * Store a key-to-address mapping entry in the local cache.
   */
  private async storeKeyAddressEntry(
    signingKey: Uint8Array,
    accountType: string,
    label: string,
    address: string,
  ): Promise<void> {
    try {
      const keyType = accountTypeToKeyType(accountType);
      const pubKeyHash = await computePublicKeyHash(signingKey);
      storeKeyAddressMapping({
        keyType: keyType as any,
        publicKeyHash: pubKeyHash.toString(),
        accountAddress: address,
        label,
        linkedAt: Date.now(),
      });
    } catch (error) {
      console.error('[AuthManager] Failed to store key-address mapping:', error);
    }
  }

  // ─── Linked vault helpers ───────────────────────────────────────────

  /**
   * Map an AuthMethod to its Aztec AccountType.
   */
  private getAccountTypeForMethod(method: AuthMethod): AccountType {
    switch (method) {
      case 'passkey': return 'ecdsasecp256r1';
      case 'ethereum': return 'ecdsasecp256k1';
      default: return 'schnorr'; // google, password, solana
    }
  }

  private hexEncode(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private hexDecode(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  /**
   * Create a redirect vault encrypted with the linked method's derived keys.
   * When the user later logs in with the linked method, we can find
   * this vault and extract the primary account's keys.
   */
  private async createRedirectVault(
    linkedKeys: DerivedKeys,
    linkedMethod: AuthMethod
  ): Promise<string> {
    if (!this.currentKeys || !this.currentMethod || !this.currentAddress || !this.currentUsername) {
      throw new Error('No primary session to create redirect vault from');
    }

    const linkedVaultPassword = this.deriveVaultPassword(linkedKeys);

    const redirectData: LinkedVaultRedirect = {
      type: 'linked',
      primarySecretKey: this.hexEncode(this.currentKeys.secretKey),
      primarySigningKey: this.hexEncode(this.currentKeys.signingKey),
      primarySalt: this.hexEncode(this.currentKeys.salt),
      primaryMethod: this.currentMethod,
      primaryAccountType: this.getAccountTypeForMethod(this.currentMethod),
      primaryAddress: this.currentAddress,
      primaryUsername: this.currentUsername,
      linkedAt: Date.now(),
    };

    await this.vault.saveLinkedVault(this.network.id, linkedVaultPassword, redirectData);

    return this.vault.getLinkedVaultKey(this.network.id, linkedVaultPassword);
  }

  /**
   * Try to resolve a linked vault redirect from the given derived keys.
   * If found, returns the primary account's keys and metadata.
   */
  private async resolveLinkedVault(keys: DerivedKeys): Promise<{
    keys: DerivedKeys;
    method: AuthMethod;
    address: string;
    username: string;
    accountType: AccountType;
  } | null> {
    try {
      const vaultPassword = this.deriveVaultPassword(keys);
      const redirect = await this.vault.loadLinkedVault(this.network.id, vaultPassword);
      if (!redirect) return null;

      const primaryKeys: DerivedKeys = {
        secretKey: this.hexDecode(redirect.primarySecretKey),
        signingKey: this.hexDecode(redirect.primarySigningKey),
        salt: this.hexDecode(redirect.primarySalt),
      };

      return {
        keys: primaryKeys,
        method: redirect.primaryMethod,
        address: redirect.primaryAddress,
        username: redirect.primaryUsername,
        accountType: redirect.primaryAccountType,
      };
    } catch {
      return null;
    }
  }

  // ─── Prepare/Complete methods for redirect-based flows ────────────

  /**
   * Prepare for Google account linking. Stores primary key material
   * in sessionStorage before the OAuth redirect.
   */
  async prepareGoogleLink(): Promise<void> {
    if (!this.currentKeys || !this.currentMethod || !this.currentAddress || !this.currentUsername) {
      throw new Error('No authenticated account to link');
    }
    const data = {
      secretKey: this.hexEncode(this.currentKeys.secretKey),
      signingKey: this.hexEncode(this.currentKeys.signingKey),
      salt: this.hexEncode(this.currentKeys.salt),
      method: this.currentMethod,
      accountType: this.getAccountTypeForMethod(this.currentMethod),
      address: this.currentAddress,
      username: this.currentUsername,
    };
    sessionStorage.setItem('pending_google_link', JSON.stringify(data));
  }

  /**
   * Complete Google account linking after OAuth redirect.
   * Reads primary key material from sessionStorage and creates redirect vault.
   */
  async completeGoogleLink(oauthData: GoogleOAuthData): Promise<void> {
    const stored = sessionStorage.getItem('pending_google_link');
    if (!stored) {
      throw new Error('No pending Google link data found. Please try linking again.');
    }
    sessionStorage.removeItem('pending_google_link');

    const primary = JSON.parse(stored);

    // Restore primary state
    this.currentKeys = {
      secretKey: this.hexDecode(primary.secretKey),
      signingKey: this.hexDecode(primary.signingKey),
      salt: this.hexDecode(primary.salt),
    };
    this.currentMethod = primary.method;
    this.currentAddress = primary.address;
    this.currentUsername = primary.username;

    // Now call linkGoogle which checks uniqueness, stores key-address mapping,
    // updates vault, and creates the redirect vault
    await this.linkGoogle(oauthData);

    this.persistAuthState();
    await this.notifyListeners();
  }

  /**
   * Lock (clear keys from memory and session)
   */
  lock(): void {
    if (this.currentKeys) {
      KeyDerivationService.wipeKeys(this.currentKeys);
    }
    this.currentKeys = null;
    this.currentPassword = null;
    this.currentMethod = null;
    this.currentUsername = null;
    this.currentAddress = null;

    // Clear persisted session
    this.clearPersistedAuthState();

    this.notifyListeners();
  }

  /**
   * Get current derived keys
   */
  getKeys(): DerivedKeys | null {
    return this.currentKeys;
  }

  /**
   * Get current username
   */
  getUsername(): string | null {
    return this.currentUsername;
  }

  /**
   * Get current auth method
   */
  getMethod(): AuthMethod | null {
    return this.currentMethod;
  }

  /**
   * Subscribe to auth state changes
   */
  subscribe(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Store authentication in vault
   */
  private async storeInVault(
    keys: DerivedKeys,
    method: AuthMethod,
    metadata: AuthMetadata,
    username: string,
    password?: string
  ): Promise<void> {
    const accountType = method === 'passkey' ? 'ecdsasecp256r1'
      : method === 'ethereum' ? 'ecdsasecp256k1'
      : 'schnorr';
    const address = await this.accountService.getAddress(keys, accountType);

    // For non-mnemonic methods, we generate a random mnemonic as a recovery key
    // This is stored encrypted and can be exported by the user
    const recoveryMnemonic = KeyDerivationService.generateMnemonic();

    const vaultData: VaultData = {
      mnemonic: recoveryMnemonic,
      accounts: [{
        index: 0,
        type: accountType,
        address,
        alias: username,
        isDeployed: false,
      }],
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      username,
      authMethod: method,
      authMetadata: metadata,
    };

    // For passkey, we use a derived password from the credential
    // For other methods, we use the user's password
    const vaultPassword = password || this.deriveVaultPassword(keys);

    // Preserve linked accounts from existing vault (re-login must not destroy them)
    try {
      const existing = await this.vault.loadVault(this.network.id, vaultPassword);
      if (existing) {
        if (existing.linkedAuthMethods) vaultData.linkedAuthMethods = existing.linkedAuthMethods;
        if (existing.linkedEthAddresses) vaultData.linkedEthAddresses = existing.linkedEthAddresses;
        // Preserve original mnemonic and createdAt
        vaultData.mnemonic = existing.mnemonic;
        vaultData.createdAt = existing.createdAt;
        // Preserve deployment status
        if (existing.accounts?.[0]?.isDeployed) {
          vaultData.accounts[0].isDeployed = true;
        }
      }
    } catch {
      // No existing vault — first time, nothing to preserve
    }

    await this.vault.saveVault(this.network.id, vaultPassword, vaultData);
  }

  /**
   * Try to load an existing username for a returning user.
   * Checks: 1) IndexedDB display name cache, 2) encrypted vault.
   */
  private async getExistingUsername(keys: DerivedKeys, accountType: AccountType = 'schnorr'): Promise<string | null> {
    // First check IndexedDB display name (set via settings page / on-chain)
    try {
      const address = await this.accountService.getAddress(keys, accountType);
      const displayNameService = getDisplayNameService();
      const cachedName = await displayNameService.getOwnDisplayName(address);
      if (cachedName) {
        return cachedName;
      }
    } catch {
      // IndexedDB not available or address computation failed
    }

    // Fall back to vault
    try {
      const vaultPassword = this.deriveVaultPassword(keys);
      const existingVault = await this.vault.loadVault(this.network.id, vaultPassword);
      if (existingVault?.username) {
        return existingVault.username;
      }
    } catch {
      // No existing vault — new user
    }
    return null;
  }

  /**
   * Derive a vault password from keys (for passkey method)
   */
  private deriveVaultPassword(keys: DerivedKeys): string {
    // Use first 16 bytes of signing key as hex string for vault password
    const bytes = keys.signingKey.slice(0, 16);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Hash domain for privacy-preserving storage
   */
  private async hashDomain(domain: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(domain.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Hash email for privacy-preserving storage
   */
  private async hashEmail(email: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generate domain proof in background using Web Worker
   */
  private generateDomainProofInBackground(oauth: GoogleOAuthData): void {
    this.proofState = { status: 'generating', progress: 0 };
    this.notifyListeners();

    // Web Worker proof generation will be implemented in DomainProofService
    // For now, mark as ready after a delay (placeholder)
    setTimeout(() => {
      this.proofState = { status: 'ready' };
      this.notifyListeners();
    }, 100);
  }

  /**
   * Retry account deployment (delegates to WalletProvider's deployment path)
   */
  async retryDeployment(): Promise<void> {
    if (!this.currentKeys || !this.currentAddress || !this.currentMethod) {
      throw new Error('No authenticated account to deploy');
    }
    // Deployment is handled by WalletProvider — this is a no-op placeholder.
    // The WalletProvider will re-attempt deployment on next sync cycle.
  }

  /**
   * Notify all listeners of state change
   */
  private async notifyListeners(): Promise<void> {
    const state = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('Error in auth state listener:', error);
      }
    });
  }
}

// Factory for creating auth managers per network
const authManagers: Map<string, AuthManager> = new Map();

export function getAuthManager(network: NetworkConfig): AuthManager {
  const key = network.id;

  if (!authManagers.has(key)) {
    authManagers.set(key, new AuthManager(network));
  }

  return authManagers.get(key)!;
}

export function clearAuthManagers(): void {
  authManagers.forEach(manager => manager.lock());
  authManagers.clear();
}
