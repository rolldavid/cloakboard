import { useEffect, useRef } from 'react';
import { EthereumKeyDerivation } from '@/lib/auth/ethereum/EthereumKeyDerivation';
import { EthereumAuthService } from '@/lib/auth/ethereum/EthereumAuthService';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

function findMetaMaskProvider(): any | undefined {
  if (typeof window === 'undefined' || !window.ethereum) return undefined;
  const eth = window.ethereum as any;
  // Multiple wallets: providers array (EIP-5749)
  if (Array.isArray(eth.providers)) {
    const mm = eth.providers.find((p: any) => p.isMetaMask && !p.isPhantom);
    if (mm) return mm;
  }
  // Single provider fallback
  if (eth.isMetaMask && !eth.isPhantom) return eth;
  return undefined;
}

/**
 * Ethereum auth button — lazy-mounted by AuthMethodSelector.
 * Uses MetaMask's raw provider API directly (no wagmi) to avoid
 * Phantom intercepting wagmi's injected() connector discovery.
 */
export function EthereumAuthButton() {
  const { completeAuth } = useAuthCompletion();
  const processingRef = useRef(false);

  useEffect(() => {
    if (processingRef.current) return;
    processingRef.current = true;

    const provider = findMetaMaskProvider();
    if (!provider) {
      console.error('[EthereumAuth] MetaMask not found');
      processingRef.current = false;
      return;
    }

    (async () => {
      try {
        // Connect directly through MetaMask's provider — Phantom can't intercept
        const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];

        // Sign message directly through MetaMask provider for key derivation
        const signature: string = await provider.request({
          method: 'personal_sign',
          params: [
            // personal_sign expects hex-encoded message
            '0x' + Array.from(new TextEncoder().encode(EthereumKeyDerivation.SIGN_MESSAGE))
              .map((b) => b.toString(16).padStart(2, '0')).join(''),
            address,
          ],
        });

        const keys = EthereumKeyDerivation.deriveKeys(signature);
        EthereumAuthService.storeSession(address);
        completeAuth(keys, 'ethereum', signature);
      } catch (err: any) {
        console.error('[EthereumAuth] Failed:', err?.message);
        processingRef.current = false;
      }
    })();
  }, [completeAuth]);

  return (
    <div className="block w-full p-4 rounded-lg border border-accent bg-accent-muted/30 text-left">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <span className="font-semibold text-foreground">MetaMask</span>
          <p className="text-sm text-foreground-secondary">Connecting to MetaMask...</p>
        </div>
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
