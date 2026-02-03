/**
 * Wallet Components Index
 *
 * Re-exports all wallet-related components for convenient importing.
 */

// Provider and context
export { WalletProvider, useWalletContext } from './WalletProvider';

// Connection components
export { ConnectButton } from './ConnectButton';
export { AccountInfo } from './AccountInfo';
export { AccountSwitcher } from './AccountSwitcher';

// Gate component
export { WalletGate, withWalletGate } from './WalletGate';

// Re-export hooks from the hooks module
export {
  useWallet,
  useWalletState,
  useWalletStatus,
  useWalletActions,
  useWalletAddress,
  useAccounts,
} from '@/lib/hooks/useWallet';
