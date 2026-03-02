import { useEffect, useRef } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { EthereumKeyDerivation } from '@/lib/auth/ethereum/EthereumKeyDerivation';
import { EthereumAuthService } from '@/lib/auth/ethereum/EthereumAuthService';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

/**
 * Ethereum auth button — lazy-mounted by AuthMethodSelector.
 * Connects directly to MetaMask on mount, then signs a message for key derivation.
 */
export function EthereumAuthButton() {
  const { connect, connectors } = useConnect();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { completeAuth } = useAuthCompletion();
  const processingRef = useRef(false);
  const autoConnectedRef = useRef(false);

  // Auto-connect to MetaMask on mount (user already clicked "Ethereum Wallet")
  useEffect(() => {
    if (!autoConnectedRef.current && !isConnected && connectors.length > 0) {
      autoConnectedRef.current = true;
      connect({ connector: connectors[0] });
    }
  }, [connect, connectors, isConnected]);

  useEffect(() => {
    if (isConnected && address && !processingRef.current) {
      processingRef.current = true;

      // HIGH-3: Request a signature to prove wallet ownership
      // The signature (not the public address) is used as HKDF input
      signMessageAsync({ message: EthereumKeyDerivation.SIGN_MESSAGE })
        .then((signature) => {
          const keys = EthereumKeyDerivation.deriveKeys(signature);
          EthereumAuthService.storeSession(address);

          // Disconnect wallet immediately -- we only needed the signature
          disconnect();

          // Use the signature as the seed (not the address)
          completeAuth(keys, 'ethereum', signature);
        })
        .catch((err) => {
          console.error('[EthereumAuth] Signature rejected:', err?.message);
          processingRef.current = false;
          disconnect();
        });
    }
  }, [isConnected, address, disconnect, signMessageAsync, completeAuth]);

  // Render a loading state while MetaMask is connecting
  return (
    <div className="block w-full p-4 rounded-lg border border-accent bg-accent-muted/30 text-left">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <span className="font-semibold text-foreground">Ethereum Wallet</span>
          <p className="text-sm text-foreground-secondary">Connecting to MetaMask...</p>
        </div>
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
