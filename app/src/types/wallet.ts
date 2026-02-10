/**
 * Wallet Type Definitions
 * Core types for the Cloak wallet system
 */

// Account types supported by Aztec
export type AccountType = 'schnorr' | 'ecdsasecp256k1' | 'ecdsasecp256r1';

// Authentication methods supported
export type AuthMethod = 'passkey' | 'google' | 'magic-link' | 'ethereum' | 'solana';

// Auth metadata stored with account
export interface AuthMetadata {
  method: AuthMethod;
  createdAt: number;
  credentialId?: string;      // Passkey
  emailDomainHash?: string;   // Google (privacy-preserving)
  emailHash?: string;         // Magic link
}

// Wallet status state machine
export type WalletStatus =
  | 'no_wallet'      // No vault exists
  | 'locked'         // Vault exists but not unlocked
  | 'unlocked'       // Keys in memory, not connected to network
  | 'connected'      // Connected to network, account not deployed
  | 'deployed';      // Account deployed on-chain

// Derived keys from mnemonic
export interface DerivedKeys {
  secretKey: Uint8Array;
  signingKey: Uint8Array;
  salt: Uint8Array;
}

// Full wallet key set including mnemonic
export interface WalletKeySet extends DerivedKeys {
  mnemonic: string;
  accountIndex: number;
  accountType: AccountType;
}

// Account metadata stored in vault
export interface AccountMetadata {
  index: number;
  type: AccountType;
  address: string;
  alias: string;
  isDeployed: boolean;
  deployedAt?: number;
}

// Vault data structure (encrypted in storage)
export interface VaultData {
  mnemonic: string;
  accounts: AccountMetadata[];
  createdAt: number;
  lastAccessed: number;
  // Multi-auth additions
  username?: string;
  usernameChangedAt?: number;
  authMethod?: AuthMethod;
  authMetadata?: AuthMetadata;
  // Linked Ethereum addresses (for ERC20 token gating)
  linkedEthAddresses?: string[];
  // Linked auth methods for account linking / recovery
  linkedAuthMethods?: LinkedAuthMethod[];
  // Multi-auth key-to-address mapping cache (for cross-device recovery)
  linkedKeyMap?: LinkedKeyEntry[];
}

// A linked key entry for multi-auth key-to-address resolution
export interface LinkedKeyEntry {
  keyType: number;          // 0=schnorr, 1=secp256k1, 2=secp256r1
  publicKeyHash: string;    // hex
  label: string;            // e.g. "google", "eth:0xABC..."
  linkedAt: number;
}

// A linked authentication method reference
export interface LinkedAuthMethod {
  method: AuthMethod;
  credentialId?: string;    // passkey
  emailDomainHash?: string; // google
  emailHash?: string;       // magic-link
  ethAddress?: string;      // ethereum
  linkedAt: number;
  linkedVaultKey?: string;  // IndexedDB composite key for the redirect vault
}

// Redirect vault for linked account login resolution
export interface LinkedVaultRedirect {
  type: 'linked';
  primarySecretKey: string;    // hex
  primarySigningKey: string;   // hex
  primarySalt: string;         // hex
  primaryMethod: AuthMethod;
  primaryAccountType: AccountType;
  primaryAddress: string;
  primaryUsername: string;
  linkedAt: number;
}

// Encrypted vault structure (stored in IndexedDB)
export interface EncryptedVault {
  version: number;
  salt: ArrayBuffer;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  networkId: string;
}

// Current wallet state
export interface WalletState {
  status: WalletStatus;
  address: string | null;
  isDeployed: boolean;
  accountIndex: number;
  networkId: string;
}

// Network configuration
export interface NetworkConfig {
  id: string;
  name: string;
  nodeUrl: string;
  chainId: number;
  rollupVersion: number;
  sponsoredFpcAddress?: string;
  cloakRegistryAddress?: string;
  cloakConnectionsAddress?: string;
  cloakMembershipsAddress?: string;  // Public membership registry
  l1RpcUrl?: string;
  l1ChainId?: number;
}

// Session configuration
export interface SessionConfig {
  autoLockTimeout: number;      // ms, default 15 minutes
  lockOnHidden: boolean;        // Lock when tab hidden
  requireReauthFor: string[];   // Operations requiring re-auth
}

// Wallet creation result
export interface WalletCreationResult {
  mnemonic: string;
  address: string;
  username?: string;
  authMethod?: AuthMethod;
}

// Wallet provider interface for abstraction
export interface WalletProvider {
  readonly type: 'embedded' | 'extension' | 'hardware';

  connect(): Promise<string>;
  disconnect(): Promise<void>;
  getAddress(): string | null;
  isConnected(): boolean;

  getAccounts(): Promise<string[]>;
  switchAccount(address: string): Promise<void>;
}

// Wallet context value for React
export interface WalletContextValue {
  state: WalletState;
  isLoading: boolean;
  error: string | null;

  createWallet: (password: string) => Promise<WalletCreationResult>;
  importWallet: (mnemonic: string, password: string) => Promise<string>;
  unlock: (password: string) => Promise<string>;
  lock: () => void;
  deployAccount: () => Promise<string>;

  // Extension detection
  isExtensionAvailable: boolean;
}
