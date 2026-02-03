/**
 * Wallet Module
 *
 * Production-grade wallet system for the Realm platform.
 * Based on analysis of demo-wallet, aztec-packages, and aztec-nr.
 *
 * Key features:
 * - BIP39 mnemonic support (improvement over demo-wallet)
 * - AES-256-GCM encryption with PBKDF2 (600k iterations)
 * - Per-network vault isolation
 * - Auto-lock and session management
 * - Provider abstraction for future extension support
 */

// Core services
export { KeyDerivationService } from './keyDerivation';
export { SecureVault, getVaultInstance } from './secureVault';
export { SessionManager, getSessionManager } from './sessionManager';
export { AccountService, getAccountService, clearPXESessions } from './accountService';
export { WalletManager, getWalletManager, clearWalletManagers } from './walletManager';

// Provider interfaces and implementations
export type {
  WalletProviderInterface,
  WalletProviderEvent,
  WalletProviderEventHandler,
  WalletProviderWithEvents,
  ProviderType,
} from './providers/interface';
export { BaseWalletProvider } from './providers/interface';
export { EmbeddedWalletProvider } from './providers/embedded';
export { ExtensionWalletProvider, isExtensionAvailable } from './providers/extension';

// Re-export types
export type {
  AccountType,
  WalletStatus,
  DerivedKeys,
  WalletKeySet,
  AccountMetadata,
  VaultData,
  EncryptedVault,
  WalletState,
  NetworkConfig,
  SessionConfig,
  WalletCreationResult,
  WalletProvider,
  WalletContextValue,
} from '@/types/wallet';
