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

const GLOBAL_DUELCLOAK_ADDRESS = (import.meta as any).env?.VITE_DUELCLOAK_ADDRESS as string | undefined;

export function useDuelService(cloakAddress?: string) {
  const [service, setService] = useState<DuelCloakService | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountDeploying, setAccountDeploying] = useState(false);
  const connectingRef = useRef(false);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  useEffect(() => {
    const resolvedAddress = cloakAddress || GLOBAL_DUELCLOAK_ADDRESS;
    if (!resolvedAddress || !isAuthenticated) return;

    // Return cached service
    const cached = serviceCache.get(resolvedAddress);
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
        const contractAddr = AztecAddress.fromString(resolvedAddress);

        // Start artifact load in parallel with wallet wait
        const artifactP = getDuelCloakArtifact();
        const walletP = waitForWalletCreation();

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

        const artifact = await artifactP;

        // Register DuelCloak contract with ephemeral PXE
        if (node) {
          let registered = false;
          for (let attempt = 0; attempt < 3 && !registered; attempt++) {
            try {
              const instance = await node.getContract(contractAddr);
              if (instance) {
                if (attempt > 0) {
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
        await svc.connect(contractAddr, artifact);

        if (cancelled) return;

        serviceCache.set(resolvedAddress, svc);
        setService(svc);

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
