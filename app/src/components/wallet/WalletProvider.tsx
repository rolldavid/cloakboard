'use client';

/**
 * Wallet Provider Component
 *
 * Re-exports the WalletProvider from the hooks module
 * and provides additional context for backward compatibility.
 * Bridges the wallet management system with the AztecClient for contract interactions.
 */

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
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
 * Process pending registrations and memberships.
 * Called after syncAccountNotes() discovers the signing key note.
 * Only clears items that succeed — failed ones stay in the queue for next session.
 *
 * @param client - AztecClient instance
 * @param notesSynced - true if syncAccountNotes found the signing key note.
 *   When false, only public operations (addMembership) are attempted;
 *   private operations (register) are skipped.
 */
async function processPendingOperations(client: any, notesSynced: boolean = true) {
  const store = useAztecStore.getState();
  const pendingRegs = store.getPendingRegistrations();
  const pendingMems = store.getPendingMemberships();

  if (pendingRegs.length === 0 && pendingMems.length === 0) return;
  if (!client.getWallet) return;

  const wallet = client.getWallet();
  const senderAddr = client.getAddress?.();
  const paymentMethod = client.getPaymentMethod?.();

  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  // Process pending memberships FIRST (public function, no access control).
  // addMembership is #[external("public")]. Requires the user's account to be
  // deployed and signing key note to be synced (simulate/send route through
  // the account entrypoint).
  if (pendingMems.length > 0 && notesSynced) {
    console.log('[processPendingOps] Processing', pendingMems.length, 'pending memberships');
    try {
      const { CloakMembershipsService } = await import('@/lib/templates/CloakMembershipsService');
      const { getCloakMembershipsArtifact } = await import('@/lib/aztec/contracts');
      const membershipsAddr = store.membershipsAddress;
      if (membershipsAddr) {
        const membershipsArtifact = await getCloakMembershipsArtifact();
        // senderAddress needed — simulate/send route through account entrypoint
        const membershipsService = new CloakMembershipsService(wallet, senderAddr, paymentMethod);
        await membershipsService.connect(AztecAddress.fromString(membershipsAddr), membershipsArtifact);

        for (const { userAddress, cloakAddress, role } of pendingMems) {
          try {
            await membershipsService.addMembership(
              AztecAddress.fromString(userAddress),
              AztecAddress.fromString(cloakAddress),
              role,
            );
            console.log('[processPendingOps] Recorded membership:', userAddress, '->', cloakAddress, 'role:', role);
            store.removePendingMembership(cloakAddress);
          } catch (err: any) {
            console.warn('[processPendingOps] Failed to record membership (will retry next session):', cloakAddress, err?.message);
          }
        }
      }
    } catch (err) {
      console.warn('[processPendingOps] Failed to init memberships service:', err);
    }
  } else if (pendingMems.length > 0 && !notesSynced) {
    console.log('[processPendingOps] Skipping', pendingMems.length, 'pending memberships (signing key note not synced)');
  }

  // Process pending registry registrations (PRIVATE function, needs signing key note)
  // CloakRegistry.register() is #[external("private")] — it routes through the
  // account entrypoint which calls signing_key.get_note(). Only attempt if
  // syncAccountNotes confirmed the note is available.
  if (pendingRegs.length > 0 && notesSynced) {
    console.log('[processPendingOps] Processing', pendingRegs.length, 'pending registry registrations');
    const successfulRegs: string[] = [];
    try {
      const { CloakRegistryService } = await import('@/lib/templates/CloakRegistryService');
      const { getCloakRegistryArtifact } = await import('@/lib/aztec/contracts');
      const regAddr = store.registryAddress;
      if (regAddr) {
        const registryArtifact = await getCloakRegistryArtifact();
        const registryService = new CloakRegistryService(wallet, senderAddr, paymentMethod);
        await registryService.connect(AztecAddress.fromString(regAddr), registryArtifact);

        for (const { name, cloakAddress } of pendingRegs) {
          try {
            await registryService.register(name, AztecAddress.fromString(cloakAddress));
            console.log('[processPendingOps] Registered name:', name, '->', cloakAddress);
            successfulRegs.push(cloakAddress);
          } catch (err: any) {
            console.warn('[processPendingOps] Failed to register name (will retry next session):', name, err?.message);
          }
        }
      }
    } catch (err) {
      console.warn('[processPendingOps] Failed to init registry service:', err);
    }
    // Only clear successful registrations
    if (successfulRegs.length === pendingRegs.length) {
      store.clearPendingRegistrations();
    }
  } else if (pendingRegs.length > 0 && !notesSynced) {
    console.log('[processPendingOps] Skipping', pendingRegs.length, 'pending registrations (signing key note not synced)');
  }
}

/**
 * Register infrastructure contracts (CloakMemberships, CloakRegistry) with the PXE.
 * Contract.at() only creates a JS-side proxy — it does NOT register the contract instance
 * with the PXE. For private functions (CloakRegistry.register), the PXE needs the contract
 * registered to simulate private calls. Public functions may also benefit for ABI resolution.
 *
 * Uses node.getContract(address) to fetch the on-chain instance, then wallet.registerContract().
 */
async function registerInfrastructureContracts(client: any) {
  const node = client.getNode?.();
  const wallet = client.getWallet?.();
  if (!node || !wallet) return;

  const store = useAztecStore.getState();
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');
  const { getCloakMembershipsArtifact, getCloakRegistryArtifact } = await import('@/lib/aztec/contracts');

  const contracts = [
    { address: store.membershipsAddress, getArtifact: getCloakMembershipsArtifact, label: 'CloakMemberships' },
    { address: store.registryAddress, getArtifact: getCloakRegistryArtifact, label: 'CloakRegistry' },
  ];

  for (const { address, getArtifact, label } of contracts) {
    if (!address) continue;
    try {
      const artifact = await getArtifact();
      const addr = AztecAddress.fromString(address);
      const instance = await node.getContract(addr);
      if (instance) {
        await wallet.registerContract(instance, artifact);
        console.log(`[registerInfra] Registered ${label} at ${address.slice(0, 10)}...`);
      } else {
        console.warn(`[registerInfra] ${label} not found on-chain: ${address.slice(0, 10)}...`);
      }
    } catch (e: any) {
      // May already be registered, or contract doesn't exist on current devnet epoch
      console.warn(`[registerInfra] Failed for ${label} (${address?.slice(0, 10)}):`, e?.message);
    }
  }
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

  // Cloak connection refresh
  refreshCloakConnections: () => Promise<void>;
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

  // Keep a stable ref to auth so the syncWalletToClient effect doesn't re-fire
  // on every render (the auth context object is recreated each render).
  const authRef = useRef(auth);
  useEffect(() => { authRef.current = auth; }, [auth]);

  // Initialize Aztec client and set registry/connections addresses from network config
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

          // Initialize contract addresses from network config
          if (network.cloakRegistryAddress) {
            useAztecStore.getState().setRegistryAddress(network.cloakRegistryAddress);
          }
          if (network.cloakConnectionsAddress) {
            useAztecStore.getState().setConnectionsAddress(network.cloakConnectionsAddress);
          }
          if (network.cloakMembershipsAddress) {
            useAztecStore.getState().setMembershipsAddress(network.cloakMembershipsAddress);
          }
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

  // Sync wallet state with AztecClient when wallet/auth is connected.
  // Dependencies are stable primitives — NOT the `auth` object (recreated each render).
  // Auth values are read via authRef.current inside the async function.
  useEffect(() => {
    if (!client || !effectiveIsConnected || !effectiveAddress) {
      setIsClientReady(false);
      return;
    }

    let mounted = true;

    const syncWalletToClient = async () => {
      try {
        // Ensure infrastructure addresses are set (may have been cleared by clearAll)
        const store = useAztecStore.getState();
        if (!store.registryAddress && network.cloakRegistryAddress) {
          store.setRegistryAddress(network.cloakRegistryAddress);
        }
        if (!store.membershipsAddress && network.cloakMembershipsAddress) {
          store.setMembershipsAddress(network.cloakMembershipsAddress);
        }

        // Check if client already has a wallet loaded with the same address
        if (client.hasWallet && client.hasWallet()) {
          const clientAddress = client.getAddress()?.toString();
          if (clientAddress === effectiveAddress) {
            if (mounted) {
              setIsClientReady(true);

              // Fetch memberships even when skipping wallet sync — cloakList may
              // have been cleared by logout while the client kept its wallet.
              fetchUserMemberships(client, effectiveAddress).catch((err) => {
                console.warn('[LegacyWalletBridge] Failed to fetch memberships (non-fatal):', err);
              });
            }
            return;
          }
        }

        // Read auth state from ref (stable, no effect re-trigger)
        const currentAuth = authRef.current;
        const authKeys = currentAuth.getKeys?.();
        console.log('[syncWalletToClient] effectiveAddress:', effectiveAddress, 'auth.method:', currentAuth.method, 'hasAuthKeys:', !!authKeys);

        if (authKeys) {
          // Map auth method to account type so AztecClient uses the same
          // MultiAuthAccount contract as AuthManager (matching addresses)
          const methodToAccountType: Record<string, 'schnorr' | 'ecdsasecp256k1' | 'ecdsasecp256r1'> = {
            google: 'schnorr',
            email: 'schnorr',
            solana: 'schnorr',
            ethereum: 'ecdsasecp256k1',
            passkey: 'ecdsasecp256r1',
          };
          const accountType = methodToAccountType[currentAuth.method ?? 'google'] ?? 'schnorr';

          // Use auth-derived keys to import the correct account
          const imported = await client.importAccountFromDerivedKeys(authKeys, accountType);
          console.log('[syncWalletToClient] Imported account address:', imported.address.toString(), 'matches effectiveAddress:', imported.address.toString() === effectiveAddress);
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

        // Fetch memberships IMMEDIATELY after import — this only uses public state
        // queries (simulate) so it doesn't need the account to be deployed. This way
        // the user sees their cloaks within seconds, not after the 20-40s deploy wait.
        if (mounted) {
          fetchUserMemberships(client, effectiveAddress).catch((err) => {
            console.warn('[LegacyWalletBridge] Failed to fetch memberships (non-fatal):', err);
          });
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

        // Sync private notes — needed for the signing key note whether
        // freshly deployed or returning user with a fresh PXE.
        // syncAccountNotes returns true if the signing key note was discovered.
        // For freshly deployed accounts, deployAccount() already called sync internally,
        // but we call again to ensure the note is available (may need extra retries).
        let notesSynced = false;
        if (client.syncAccountNotes) {
          notesSynced = await client.syncAccountNotes();
          console.log('[LegacyWalletBridge] syncAccountNotes result: notesSynced =', notesSynced);
        }

        // Register infrastructure contracts with PXE so send()/simulate() work.
        // Contract.at() does NOT register contracts with the PXE — only Contract.deploy() does.
        // Pre-existing infrastructure contracts need explicit wallet.registerContract().
        await registerInfrastructureContracts(client);

        // Process pending operations — pass notesSynced so private operations
        // (register) are only attempted when the signing key note is available.
        // Public operations (addMembership) are always attempted.
        await processPendingOperations(client, notesSynced);

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
  }, [client, effectiveIsConnected, effectiveAddress, network]);

  /**
   * Fetch user's cloak memberships using direct node storage reads.
   * Uses node.getPublicStorageAt() — no wallet, PXE, or account deployment needed.
   * This allows the dashboard to show cloaks immediately on login.
   */
  const fetchUserMemberships = useCallback(async (aztecClient: any, userAddress: string) => {
    try {
      console.log('[fetchUserMemberships] Starting fetch for userAddress:', userAddress);

      const node = aztecClient.getNode?.();
      if (!node) {
        console.warn('[fetchUserMemberships] No node available, aborting');
        return;
      }

      const membershipsAddress = useAztecStore.getState().membershipsAddress;
      const registryAddress = useAztecStore.getState().registryAddress;
      console.log('[fetchUserMemberships] membershipsAddress:', membershipsAddress, 'registryAddress:', registryAddress);
      if (!membershipsAddress) {
        console.warn('[fetchUserMemberships] No membershipsAddress set, aborting');
        return;
      }

      const { AztecAddress } = await import('@aztec/aztec.js/addresses');
      const { getUserCloaksWithRoles, getCloakNameField } = await import('@/lib/aztec/publicStorageReader');
      const { nameToSlug } = await import('@/lib/utils/slug');

      const membershipsAddr = AztecAddress.fromString(membershipsAddress);
      const user = AztecAddress.fromString(userAddress);

      // 1. Get addresses + roles from CloakMemberships via direct node reads
      console.log('[fetchUserMemberships] Querying cloaks for user via direct node reads:', user.toString());
      const cloaksWithRoles = await getUserCloaksWithRoles(node, membershipsAddr, user);
      console.log('[fetchUserMemberships] Found cloaks:', cloaksWithRoles.length, cloaksWithRoles);

      if (cloaksWithRoles.length === 0) return;

      // 2. Resolve names from CloakRegistry via direct node reads
      const addCloak = useAztecStore.getState().addCloak;
      const registryAddr = registryAddress ? AztecAddress.fromString(registryAddress) : null;

      const namePromises = cloaksWithRoles.map(async ({ address, role }) => {
        let name = 'Unknown';
        if (registryAddr) {
          try {
            const resolved = await getCloakNameField(node, registryAddr, AztecAddress.fromString(address));
            if (resolved) name = resolved;
          } catch {
            // Non-fatal — name resolution may fail for unregistered cloaks
          }
        }
        return { address, role, name };
      });

      const enriched = await Promise.all(namePromises);

      // 3. Add fully enriched CloakInfo entries to store
      for (const { address, role, name } of enriched) {
        addCloak({
          address,
          name,
          slug: nameToSlug(name),
          role,
          memberCount: 0,
          proposalCount: 0,
        });
      }
    } catch (err) {
      console.warn('[fetchUserMemberships]', err);
    }
  }, []);

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

      // Clear user-specific session data (cloakList, starredAddresses)
      // This ensures clean state for next login / different user
      useAztecStore.getState().clearUserData();
    },
    refreshCloakConnections: async () => {
      if (client && effectiveAddress) {
        await fetchUserMemberships(client, effectiveAddress);
      }
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
