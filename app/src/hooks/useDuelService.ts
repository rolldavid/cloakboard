import { useState, useEffect, useRef } from 'react';
import { getAztecClient } from '@/lib/aztec/client';
import { waitForWalletCreation } from '@/lib/wallet/backgroundWalletService';
import { DuelCloakService } from '@/lib/templates/DuelCloakService';
import { getDuelCloakArtifact } from '@/lib/aztec/contracts';
import { AztecAddress } from '@aztec/aztec.js/addresses';

const serviceCache = new Map<string, DuelCloakService>();

export function useDuelService(cloakAddress: string | undefined) {
  const [service, setService] = useState<DuelCloakService | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectingRef = useRef(false);

  useEffect(() => {
    if (!cloakAddress) return;

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
        // private tx simulation/proving — PXE needs the artifact + instance)
        if (node) {
          try {
            const instance = await node.getContract(addr);
            if (instance) {
              await wallet.registerContract(instance, artifact);
            }
          } catch (e: any) {
            console.warn('[useDuelService] Contract registration warning:', e?.message);
          }
        }

        const svc = new DuelCloakService(wallet, senderAddress, paymentMethod);
        await svc.connect(addr, artifact);

        if (cancelled) return;

        serviceCache.set(cloakAddress, svc);
        setService(svc);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[useDuelService] Failed:', err?.message);
        setError(err?.message || 'Failed to connect to DuelCloak contract');
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
  }, [cloakAddress]);

  return { service, loading, error };
}
