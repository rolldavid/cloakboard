'use client';

/**
 * useAuth Hook
 *
 * React integration for the multi-auth system.
 * Provides auth state that works with passkey, Google OAuth, and magic link.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { NetworkConfig, DerivedKeys, LinkedAuthMethod } from '@/types/wallet';
import type { AuthMethod, AuthResult, PasskeyCredential, GoogleOAuthData } from '@/lib/auth/types';
import { AuthManager, getAuthManager, type AuthState, type DeploymentStatus } from '@/lib/auth/AuthManager';
import { useAztecStore } from '@/store/aztecStore';

interface AuthContextValue {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  username: string | null;
  address: string | null;
  method: AuthMethod | null;
  isDeployed: boolean;
  deploymentStatus: DeploymentStatus;
  deploymentError: string | null;

  // Actions
  logout: () => void;
  refreshState: () => Promise<void>;
  retryDeployment: () => Promise<void>;
  loginWithEthereum: (ethAddress: string, signature: Uint8Array) => Promise<void>;
  loginWithSolana: (solAddress: string, signature: Uint8Array) => Promise<void>;
  linkWallet: (ethAddress: string, signature: Uint8Array) => Promise<void>;

  // Linked accounts
  linkedAccounts: LinkedAuthMethod[];
  linkGoogle: (oauth: GoogleOAuthData) => Promise<void>;
  linkPasskey: (credential: PasskeyCredential) => Promise<void>;
  linkMagicLink: (email: string) => Promise<void>;
  linkEthereum: (ethAddress: string, signature: Uint8Array) => Promise<void>;
  linkSolana: (solAddress: string, signature: Uint8Array) => Promise<void>;
  unlinkAccount: (method: AuthMethod) => Promise<void>;

  // Keys access (for syncing with AztecClient)
  getKeys: () => DerivedKeys | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  network: NetworkConfig;
}

/**
 * AuthProvider Component
 *
 * Wraps the application and provides auth context for multi-auth system.
 */
export function AuthProvider({ children, network }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [method, setMethod] = useState<AuthMethod | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>('idle');
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAuthMethod[]>([]);

  const authManager = getAuthManager(network);

  // Update state from auth manager
  const updateFromState = useCallback((state: AuthState) => {
    setIsAuthenticated(state.isAuthenticated);
    setUsername(state.username);
    setAddress(state.address);
    setMethod(state.method);
    setIsDeployed(state.isDeployed);
    setDeploymentStatus(state.deploymentStatus);
    setDeploymentError(state.deploymentError);
  }, []);

  // Initialize and subscribe to auth state
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        await authManager.initialize();

        if (mounted) {
          const state = authManager.getState();
          updateFromState(state);
          // Load linked accounts if authenticated
          if (state.isAuthenticated) {
            authManager.getLinkedAccounts().then(accounts => {
              if (mounted) setLinkedAccounts(accounts);
            }).catch(() => {});
          }
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[AuthProvider] Init error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize auth');
          setIsLoading(false);
        }
      }
    };

    init();

    // Subscribe to state changes
    const unsubscribe = authManager.subscribe((state) => {
      if (mounted) {
        updateFromState(state);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [authManager, updateFromState]);

  const logout = useCallback(() => {
    authManager.lock();
    AuthManager.clearStoredAuthMethod();
    useAztecStore.getState().clearAll();
    setIsAuthenticated(false);
    setUsername(null);
    setAddress(null);
    setMethod(null);
    setIsDeployed(false);
    setDeploymentStatus('idle');
    setDeploymentError(null);
  }, [authManager]);

  const refreshState = useCallback(async () => {
    const state = authManager.getState();
    updateFromState(state);
  }, [authManager, updateFromState]);

  const retryDeployment = useCallback(async () => {
    try {
      await authManager.retryDeployment();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry deployment');
    }
  }, [authManager]);

  const loginWithEthereum = useCallback(async (ethAddress: string, signature: Uint8Array) => {
    try {
      await authManager.authenticateWithEthereum(ethAddress, signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ethereum login failed');
    }
  }, [authManager]);

  const loginWithSolana = useCallback(async (solAddress: string, signature: Uint8Array) => {
    try {
      await authManager.authenticateWithSolana(solAddress, signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Solana login failed');
    }
  }, [authManager]);

  const linkWallet = useCallback(async (ethAddress: string, signature: Uint8Array) => {
    try {
      await authManager.linkEthereumWallet(ethAddress, signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link wallet');
    }
  }, [authManager]);

  const refreshLinkedAccounts = useCallback(async () => {
    try {
      const accounts = await authManager.getLinkedAccounts();
      setLinkedAccounts(accounts);
    } catch {}
  }, [authManager]);

  const linkGoogle = useCallback(async (oauth: GoogleOAuthData) => {
    try {
      await authManager.linkGoogle(oauth);
      await refreshLinkedAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link Google');
    }
  }, [authManager, refreshLinkedAccounts]);

  const linkPasskey = useCallback(async (credential: PasskeyCredential) => {
    try {
      await authManager.linkPasskey(credential);
      await refreshLinkedAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link passkey');
    }
  }, [authManager, refreshLinkedAccounts]);

  const linkMagicLink = useCallback(async (email: string) => {
    try {
      await authManager.linkMagicLink(email);
      await refreshLinkedAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link email');
    }
  }, [authManager, refreshLinkedAccounts]);

  const linkEthereum = useCallback(async (ethAddress: string, signature: Uint8Array) => {
    try {
      await authManager.linkEthereumWallet(ethAddress, signature);
      await refreshLinkedAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link ETH wallet');
    }
  }, [authManager, refreshLinkedAccounts]);

  const linkSolana = useCallback(async (solAddress: string, signature: Uint8Array) => {
    try {
      await authManager.linkSolana(solAddress, signature);
      await refreshLinkedAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link Solana wallet');
    }
  }, [authManager, refreshLinkedAccounts]);

  const unlinkAccount = useCallback(async (method: AuthMethod) => {
    try {
      await authManager.unlinkAccount(method);
      await refreshLinkedAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink account');
    }
  }, [authManager, refreshLinkedAccounts]);

  // Get derived keys (for syncing with AztecClient)
  const getKeys = useCallback((): DerivedKeys | null => {
    return authManager.getKeys();
  }, [authManager]);

  const contextValue: AuthContextValue = {
    isAuthenticated,
    isLoading,
    error,
    username,
    address,
    method,
    isDeployed,
    deploymentStatus,
    deploymentError,
    logout,
    refreshState,
    retryDeployment,
    loginWithEthereum,
    loginWithSolana,
    linkWallet,
    linkedAccounts,
    linkGoogle,
    linkPasskey,
    linkMagicLink,
    linkEthereum,
    linkSolana,
    unlinkAccount,
    getKeys,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth Hook
 *
 * Primary hook for accessing auth state.
 * Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/**
 * useIsAuthenticated Hook
 *
 * Simple hook to check if user is authenticated.
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useAuth();
  return isAuthenticated;
}
