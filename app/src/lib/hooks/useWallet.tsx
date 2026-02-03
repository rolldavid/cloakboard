'use client';

/**
 * useWallet Hook and WalletProvider
 *
 * React integration for the wallet system.
 * Provides context, hooks, and state management for wallet operations.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  NetworkConfig,
  WalletState,
  WalletCreationResult,
  AccountMetadata,
} from '@/types/wallet';
import { WalletManager, getWalletManager } from '../wallet/walletManager';
import { EmbeddedWalletProvider } from '../wallet/providers/embedded';
import { ExtensionWalletProvider, isExtensionAvailable } from '../wallet/providers/extension';
import type { WalletProviderInterface, ProviderType } from '../wallet/providers/interface';

/**
 * Wallet context value
 */
interface WalletContextValue {
  // State
  state: WalletState;
  isLoading: boolean;
  error: string | null;

  // Provider info
  providerType: ProviderType | null;
  isExtensionAvailable: boolean;

  // Actions
  createWallet: (password: string) => Promise<WalletCreationResult>;
  importWallet: (mnemonic: string, password: string) => Promise<string>;
  unlock: (password: string) => Promise<string>;
  lock: () => void;
  deployAccount: () => Promise<string>;
  switchProvider: (type: ProviderType) => Promise<void>;

  // Account management
  getAccounts: () => AccountMetadata[];
  addAccount: (alias: string) => Promise<AccountMetadata>;
  switchAccount: (address: string) => Promise<void>;
  switchAccountByIndex: (index: number) => Promise<void>;
  currentAccountIndex: number;

  // Mnemonic export (requires wallet to be unlocked)
  exportMnemonic: () => string | null;

  // Wallet deletion
  deleteWallet: () => Promise<void>;

  // Manager access (for advanced use)
  manager: WalletManager | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * WalletProvider Props
 */
interface WalletProviderProps {
  children: ReactNode;
  network: NetworkConfig;
  autoInitialize?: boolean;
}

/**
 * WalletProvider Component
 *
 * Wraps the application and provides wallet context.
 */
export function WalletProvider({
  children,
  network,
  autoInitialize = true,
}: WalletProviderProps) {
  const [state, setState] = useState<WalletState>({
    status: 'no_wallet',
    address: null,
    isDeployed: false,
    accountIndex: 0,
    networkId: network.id,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerType, setProviderType] = useState<ProviderType | null>(null);
  const [extensionAvailable, setExtensionAvailable] = useState(false);

  // Get or create wallet manager for this network
  const manager = useMemo(() => getWalletManager(network), [network]);

  // Current provider instance
  const [provider, setProvider] = useState<WalletProviderInterface | null>(null);

  // Initialize wallet manager and check state
  useEffect(() => {
    if (!autoInitialize) return;

    let mounted = true;

    const init = async () => {
      try {
        setIsLoading(true);
        await manager.initialize();

        // Check extension availability
        const hasExtension = isExtensionAvailable();
        if (mounted) {
          setExtensionAvailable(hasExtension);
        }

        // Get current state
        const currentState = await manager.getState();
        if (mounted) {
          setState(currentState);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize wallet');
          setIsLoading(false);
        }
      }
    };

    init();

    // Subscribe to state changes
    const unsubscribe = manager.subscribe((newState) => {
      if (mounted) {
        setState(newState);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [manager, autoInitialize]);

  /**
   * Create a new wallet
   */
  const createWallet = useCallback(
    async (password: string): Promise<WalletCreationResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await manager.createWallet(password);

        // Set up embedded provider
        const embeddedProvider = new EmbeddedWalletProvider(network);
        await embeddedProvider.connect();
        setProvider(embeddedProvider);
        setProviderType('embedded');

        setIsLoading(false);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create wallet';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [manager, network]
  );

  /**
   * Import wallet from mnemonic
   */
  const importWallet = useCallback(
    async (mnemonic: string, password: string): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const address = await manager.importWallet(mnemonic, password);

        // Set up embedded provider
        const embeddedProvider = new EmbeddedWalletProvider(network);
        await embeddedProvider.connect();
        setProvider(embeddedProvider);
        setProviderType('embedded');

        setIsLoading(false);
        return address;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to import wallet';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [manager, network]
  );

  /**
   * Unlock existing wallet
   */
  const unlock = useCallback(
    async (password: string): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const address = await manager.unlock(password);

        // Set up embedded provider
        const embeddedProvider = new EmbeddedWalletProvider(network);
        await embeddedProvider.connect();
        setProvider(embeddedProvider);
        setProviderType('embedded');

        setIsLoading(false);
        return address;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to unlock wallet';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [manager, network]
  );

  /**
   * Lock wallet
   */
  const lock = useCallback(() => {
    manager.lock();
    provider?.disconnect();
    setProvider(null);
    setProviderType(null);
  }, [manager, provider]);

  /**
   * Deploy account on-chain
   */
  const deployAccount = useCallback(async (): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      const address = await manager.deployAccount();
      setIsLoading(false);
      return address;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to deploy account';
      setError(errorMessage);
      setIsLoading(false);
      throw err;
    }
  }, [manager]);

  /**
   * Switch to a different provider type
   */
  const switchProvider = useCallback(
    async (type: ProviderType): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        // Disconnect current provider
        if (provider) {
          await provider.disconnect();
        }

        let newProvider: WalletProviderInterface;

        switch (type) {
          case 'embedded':
            newProvider = new EmbeddedWalletProvider(network);
            break;

          case 'extension':
            if (!isExtensionAvailable()) {
              throw new Error('Aztec browser extension not available');
            }
            newProvider = new ExtensionWalletProvider();
            break;

          case 'hardware':
            throw new Error('Hardware wallet not yet supported');

          default:
            throw new Error(`Unknown provider type: ${type}`);
        }

        await newProvider.connect();
        setProvider(newProvider);
        setProviderType(type);
        setIsLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch provider';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [provider, network]
  );

  /**
   * Get all accounts
   */
  const getAccounts = useCallback((): AccountMetadata[] => {
    return manager.getAccounts();
  }, [manager]);

  /**
   * Add a new account
   */
  const addAccount = useCallback(
    async (alias: string): Promise<AccountMetadata> => {
      setIsLoading(true);
      setError(null);

      try {
        const account = await manager.addAccount(alias);
        setIsLoading(false);
        return account;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to add account';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [manager]
  );

  /**
   * Switch to a different account by address
   */
  const switchAccount = useCallback(
    async (address: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await manager.switchAccountByAddress(address);
        if (provider) {
          await provider.switchAccount(address);
        }
        setIsLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch account';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [manager, provider]
  );

  /**
   * Switch to a different account by index
   */
  const switchAccountByIndex = useCallback(
    async (index: number): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const address = await manager.switchAccount(index);
        if (provider) {
          await provider.switchAccount(address);
        }
        setIsLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to switch account';
        setError(errorMessage);
        setIsLoading(false);
        throw err;
      }
    },
    [manager, provider]
  );

  /**
   * Export mnemonic (requires unlock)
   */
  const exportMnemonic = useCallback((): string | null => {
    return manager.getMnemonic();
  }, [manager]);

  /**
   * Delete wallet
   */
  const deleteWallet = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // Disconnect provider first
      if (provider) {
        await provider.disconnect();
        setProvider(null);
        setProviderType(null);
      }

      await manager.deleteWallet();
      setIsLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete wallet';
      setError(errorMessage);
      setIsLoading(false);
      throw err;
    }
  }, [manager, provider]);

  const contextValue: WalletContextValue = {
    state,
    isLoading,
    error,
    providerType,
    isExtensionAvailable: extensionAvailable,
    createWallet,
    importWallet,
    unlock,
    lock,
    deployAccount,
    switchProvider,
    getAccounts,
    addAccount,
    switchAccount,
    switchAccountByIndex,
    currentAccountIndex: state.accountIndex,
    exportMnemonic,
    deleteWallet,
    manager,
  };

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
}

/**
 * useWallet Hook
 *
 * Primary hook for accessing wallet functionality.
 * Must be used within a WalletProvider.
 */
export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }

  return context;
}

/**
 * useWalletState Hook
 *
 * Access only the wallet state (read-only).
 * Useful for components that only need to display state.
 */
export function useWalletState(): WalletState {
  const { state } = useWallet();
  return state;
}

/**
 * useWalletStatus Hook
 *
 * Access only the wallet status.
 */
export function useWalletStatus() {
  const { state, isLoading, error } = useWallet();

  return {
    status: state.status,
    isConnected: state.status === 'connected' || state.status === 'deployed',
    isDeployed: state.isDeployed,
    isLocked: state.status === 'locked',
    hasWallet: state.status !== 'no_wallet',
    isLoading,
    error,
  };
}

/**
 * useWalletActions Hook
 *
 * Access only wallet actions (write operations).
 */
export function useWalletActions() {
  const {
    createWallet,
    importWallet,
    unlock,
    lock,
    deployAccount,
    switchProvider,
    addAccount,
    switchAccount,
    switchAccountByIndex,
    exportMnemonic,
    deleteWallet,
  } = useWallet();

  return {
    createWallet,
    importWallet,
    unlock,
    lock,
    deployAccount,
    switchProvider,
    addAccount,
    switchAccount,
    switchAccountByIndex,
    exportMnemonic,
    deleteWallet,
  };
}

/**
 * useWalletAddress Hook
 *
 * Get the current wallet address.
 */
export function useWalletAddress(): string | null {
  const { state } = useWallet();
  return state.address;
}

/**
 * useAccounts Hook
 *
 * Get all accounts in the wallet.
 */
export function useAccounts(): AccountMetadata[] {
  const { getAccounts } = useWallet();
  return getAccounts();
}
