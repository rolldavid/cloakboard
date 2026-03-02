import { useState, useEffect, useRef } from 'react';
import { getAztecClient } from '@/lib/aztec/client';
import { waitForWalletCreation, isAccountDeployed, waitForAccountDeploy } from '@/lib/wallet/backgroundWalletService';
import { DuelCloakService } from '@/lib/templates/DuelCloakService';
import { getDuelCloakArtifact } from '@/lib/aztec/contracts';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { useAppStore } from '@/store/index';

const serviceCache = new Map<string, DuelCloakService>();

/**
 * Clear cached DuelCloakService instances. Must be called on logout
 * so the next login doesn't reuse a service bound to the old wallet.
 */
export function resetDuelServiceCache(): void {
  serviceCache.clear();
}

export function useDuelService(cloakAddress: string | undefined) {
  const [service, setService] = useState<DuelCloakService | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountDeploying, setAccountDeploying] = useState(false);
  const connectingRef = useRef(false);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!cloakAddress || !isAuthenticated) return;

    // Return cached service
    const cached = serviceCache.get(cloakAddress);
    if (cached) {
      setService(cached);
      return;
    }

    if (connectingRef.current) return;
    connectingRef.current = true;
    setLoading(true);
    setError(null);

    let cancelled = false;

    (async () => {
      try {
        const addr = AztecAddress.fromString(cloakAddress);

        // Start artifact load + contract instance fetch in parallel with wallet wait.
        // Neither requires a wallet — only the node (which warmup already connected).
        const artifactP = getDuelCloakArtifact();
        const walletP = waitForWalletCreation();

        // Wait for wallet
        await walletP;
        const client = getAztecClient();

        if (!client || !client.hasWallet()) {
          setError('Aztec wallet not ready — please try logging in again');
          return;
        }

        if (cancelled) return;

        const wallet = client.getWallet();
        const node = client.getNode();
        const senderAddress = client.getAddress() ?? undefined;
        const paymentMethod = client.getPaymentMethod();

        // Await artifact (likely already resolved from preloadArtifacts)
        const artifact = await artifactP;

        // Register DuelCloak contract with ephemeral PXE (required for
        // private tx simulation/proving — PXE needs the artifact + instance).
        // Retry on IDB transaction errors — IndexedDB auto-commits when the
        // event loop goes idle between async calls, so a retry with a fresh
        // microtask creates a new transaction.
        if (node) {
          let registered = false;
          for (let attempt = 0; attempt < 3 && !registered; attempt++) {
            try {
              const instance = await node.getContract(addr);
              if (instance) {
                if (attempt > 0) {
                  // Small delay before retry to let IDB settle
                  await new Promise(r => setTimeout(r, 500));
                }
                await wallet.registerContract(instance, artifact);
                registered = true;
                console.log('[useDuelService] Contract registered with PXE');
              } else {
                console.warn('[useDuelService] Contract not found on node — may not be deployed yet');
                break;
              }
            } catch (e: any) {
              const msg = e?.message ?? '';
              if (msg.includes('already') || msg.includes('TransactionInactive')) {
                // Already registered or stale IDB tx — treat as success
                registered = true;
              } else if (attempt < 2) {
                console.warn(`[useDuelService] Registration attempt ${attempt + 1} failed: ${msg}, retrying...`);
              } else {
                console.error(`[useDuelService] Registration failed after ${attempt + 1} attempts: ${msg}`);
              }
            }
          }
        }

        const svc = new DuelCloakService(wallet, senderAddress, paymentMethod);
        await svc.connect(addr, artifact);

        if (cancelled) return;

        serviceCache.set(cloakAddress, svc);
        setService(svc);

        // If account hasn't deployed yet, track it so the UI can show a message
        if (!isAccountDeployed()) {
          setAccountDeploying(true);
          waitForAccountDeploy().then(() => {
            if (!cancelled) setAccountDeploying(false);
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('[useDuelService] Failed:', err?.message);
        setError(err?.message || 'Failed to connect to voting service');
      } finally {
        if (!cancelled) {
          setLoading(false);
          connectingRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
      connectingRef.current = false;
    };
  }, [cloakAddress, isAuthenticated]);

  return { service, loading, error, accountDeploying };
}
