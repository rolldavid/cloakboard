'use client';

/**
 * Wallet Provider Component
 *
 * Re-exports the WalletProvider from the hooks module
 * and provides additional context for backward compatibility.
 * Bridges the wallet management system with the AztecClient for contract interactions.
 */

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import {
  WalletProvider as BaseWalletProvider,
  useWallet,
  useWalletStatus,
} from '@/lib/hooks/useWallet';
import { AuthProvider, useAuth } from '@/lib/hooks/useAuth';
import type { NetworkConfig } from '@/types/wallet';
import { NETWORKS } from '@/lib/config/networks';
import { useAztecStore } from '@/store/aztecStore';

// Dynamic import for AztecClient to avoid SSR issues
let aztecClientModule: typeof import('@/lib/aztec/client') | null = null;

async function getAztecClientModule() {
  if (!aztecClientModule) {
    aztecClientModule = await import('@/lib/aztec/client');
  }
  return aztecClientModule;
}

/**
 * Legacy context interface for backward compatibility
 */
export interface LegacyWalletContextValue {
  // PXE Client for contract interactions
  client: any | null;

  // Status
  isInitialized: boolean;
  isInitializing: boolean;
  isConnected: boolean;
  isLoading: boolean;
  isClientReady: boolean;

  // Account info
  account: {
    address: string;
    isDeployed: boolean;
  } | null;

  // Errors
  error: string | null;

  // Actions (legacy)
  createAccount: () => Promise<void>;
  deployAccount: () => Promise<void>;
  disconnect: () => void;
}

const LegacyWalletContext = createContext<LegacyWalletContextValue | null>(null);

/**
 * Inner provider that bridges new and legacy APIs
 */
function LegacyWalletBridge({ children, network }: { children: ReactNode; network: NetworkConfig }) {
  const wallet = useWallet();
  const { isConnected, isDeployed, hasWallet, isLocked, isLoading, error } = useWalletStatus();
  const auth = useAuth();
  const [client, setClient] = useState<any | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isClientReady, setIsClientReady] = useState(false);

  // Use auth address if available, otherwise fall back to legacy wallet address
  const effectiveAddress = auth.address || wallet.state.address;
  const effectiveIsConnected = auth.isAuthenticated || isConnected;
  const effectiveIsDeployed = auth.isDeployed || isDeployed;

  // Initialize Aztec client
  useEffect(() => {
    let mounted = true;

    const initClient = async () => {
      try {
        const { createAztecClient } = await getAztecClientModule();
        const aztecClient = await createAztecClient({
          nodeUrl: network.nodeUrl,
          environment: network.id as 'sandbox' | 'devnet' | 'testnet' | 'mainnet',
          sponsoredFpcAddress: network.sponsoredFpcAddress,
        });
        if (mounted) {
          setClient(aztecClient);
        }
      } catch (err) {
        console.error('Failed to initialize Aztec client:', err);
        if (mounted) {
          setClientError(err instanceof Error ? err.message : 'Failed to connect to Aztec network');
        }
      }
    };

    initClient();

    return () => {
      mounted = false;
    };
  }, [network]);

  // Sync wallet state with AztecClient when wallet/auth is connected
  useEffect(() => {
    if (!client || !effectiveIsConnected || !effectiveAddress) {
      setIsClientReady(false);
      return;
    }

    let mounted = true;

    const syncWalletToClient = async () => {
      try {
        // Check if client already has a wallet loaded with the same address
        if (client.hasWallet && client.hasWallet()) {
          const clientAddress = client.getAddress()?.toString();
          if (clientAddress === effectiveAddress) {
            if (mounted) setIsClientReady(true);
            return;
          }
        }

        // Try to get keys from AuthManager if authenticated with OAuth/passkey/magic-link
        const authKeys = auth.getKeys?.();

        if (authKeys) {
          // Map auth method to account type so AztecClient uses the same
          // MultiAuthAccount contract as AuthManager (matching addresses)
          const methodToAccountType: Record<string, 'schnorr' | 'ecdsasecp256k1' | 'ecdsasecp256r1'> = {
            google: 'schnorr',
            'magic-link': 'schnorr',
            solana: 'schnorr',
            ethereum: 'ecdsasecp256k1',
            passkey: 'ecdsasecp256r1',
          };
          const accountType = methodToAccountType[auth.method ?? 'google'] ?? 'schnorr';

          // Use auth-derived keys to import the correct account
          await client.importAccountFromDerivedKeys(authKeys, accountType);
        } else {
          // No auth keys — check if we have persisted keys from a previous session
          const storedKeys = useAztecStore.getState().getAccountKeys();
          if (storedKeys) {
            await client.importAccountFromHex(storedKeys.secretKey, storedKeys.signingKey, storedKeys.salt);
          } else {
            // First time: create a new random account and persist the keys
            await client.createAccount();
            const newKeys = client.exportAccountKeysHex();
            if (newKeys) {
              useAztecStore.getState().setAccountKeys(newKeys);
            }
          }
        }

        // Deploy the account on-chain so it can send transactions (publish classes, deploy contracts).
        // The Aztec node requires the sender account to be deployed to validate auth witnesses.
        // Skip if already deployed to avoid wasting time generating a proof for nothing.
        let freshlyDeployed = false;
        const { AztecAddress } = await import('@aztec/aztec.js/addresses');
        const accountAddress = AztecAddress.fromString(effectiveAddress);
        const alreadyDeployed = client.isAccountDeployed
          ? await client.isAccountDeployed(accountAddress)
          : false;

        if (!alreadyDeployed) {
          try {
            await client.deployAccount();
            freshlyDeployed = true;
          } catch (deployErr: any) {
            const msg = deployErr?.message ?? '';
            if (msg.includes('already deployed') || msg.includes('already registered') || msg.includes('Existing nullifier')) {
            } else {
              console.warn('[LegacyWalletBridge] Account deployment failed (non-fatal):', msg);
            }
          }
        }

        // Always sync private notes — needed for the signing key note whether
        // freshly deployed or returning user with a fresh PXE
        if (client.syncAccountNotes) {
          await client.syncAccountNotes();
        }

        // After first deployment, set display name on-chain if we have one cached
        if (freshlyDeployed && effectiveAddress && client.getWallet) {
          try {
            const { getDisplayNameService, hashDisplayName } = await import('@/lib/username/DisplayNameService');
            const displayNameService = getDisplayNameService();
            const cachedName = await displayNameService.getOwnDisplayName(effectiveAddress);
            if (cachedName) {
              const { setDisplayName } = await import('@/lib/auth/MultiAuthAccountContract');
              const { Fr } = await import('@aztec/foundation/curves/bn254');
              const { AztecAddress } = await import('@aztec/aztec.js/addresses');
              const wallet = client.getWallet();
              const nameHash = hashDisplayName(cachedName);
              await setDisplayName(wallet, AztecAddress.fromString(effectiveAddress), new Fr(nameHash));
            }
          } catch (nameErr) {
            console.warn('[LegacyWalletBridge] Failed to set display name on-chain (non-fatal):', nameErr);
          }
        }

        if (mounted) {
          setIsClientReady(true);
        }
      } catch (err) {
        console.error('[LegacyWalletBridge] Failed to sync wallet with client:', err);
        if (mounted) {
          setClientError(err instanceof Error ? err.message : 'Failed to sync wallet');
        }
      }
    };

    syncWalletToClient();

    return () => {
      mounted = false;
    };
  }, [client, effectiveIsConnected, effectiveAddress, auth]);

  // Determine initialization state
  const isInitialized = hasWallet || wallet.state.status !== 'no_wallet' || auth.isAuthenticated;
  const isInitializing = (isLoading || auth.isLoading) && !hasWallet && !auth.isAuthenticated;

  // Build legacy account object using effective values (auth takes precedence)
  const account = effectiveAddress
    ? {
        address: effectiveAddress,
        isDeployed: effectiveIsDeployed,
      }
    : null;

  const value: LegacyWalletContextValue = {
    client: isClientReady ? client : null,
    isInitialized,
    isInitializing,
    isConnected: effectiveIsConnected,
    isLoading: isLoading || auth.isLoading,
    isClientReady,
    account,
    error: error || clientError || auth.error,
    createAccount: async () => {
      // Legacy create account - prompts for password in modal
      throw new Error('Use the new wallet onboarding flow instead');
    },
    deployAccount: async () => {
      await wallet.deployAccount();
    },
    disconnect: () => {
      // Disconnect client wallet too
      if (client && client.disconnect) {
        client.disconnect();
      }
      setIsClientReady(false);
      wallet.lock();
    },
  };

  return (
    <LegacyWalletContext.Provider value={value}>
      {children}
    </LegacyWalletContext.Provider>
  );
}

/**
 * Props for WalletProviderWrapper
 */
interface WalletProviderWrapperProps {
  children: ReactNode;
  network?: NetworkConfig;
}

/**
 * WalletProvider Wrapper
 *
 * Wraps the new WalletProvider and provides legacy context.
 * Use the default sandbox network if none specified.
 */
export function WalletProvider({
  children,
  network = NETWORKS.sandbox,
}: WalletProviderWrapperProps) {
  return (
    <AuthProvider network={network}>
      <BaseWalletProvider network={network}>
        <LegacyWalletBridge network={network}>{children}</LegacyWalletBridge>
      </BaseWalletProvider>
    </AuthProvider>
  );
}

/**
 * Legacy hook for backward compatibility
 * @deprecated Use useWallet from @/lib/hooks/useWallet instead
 */
export function useWalletContext() {
  const context = useContext(LegacyWalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within a WalletProvider');
  }
  return context;
}

// Re-export new hooks for convenience
export {
  useWallet,
  useWalletStatus,
  useWalletState,
  useWalletActions,
  useWalletAddress,
  useAccounts,
} from '@/lib/hooks/useWallet';

// Export auth hooks
export { useAuth, useIsAuthenticated } from '@/lib/hooks/useAuth';
