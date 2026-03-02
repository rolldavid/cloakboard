import { useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { SolanaKeyDerivation } from '@/lib/auth/solana/SolanaKeyDerivation';
import { SolanaAuthService } from '@/lib/auth/solana/SolanaAuthService';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

/**
 * Solana auth button — lazy-mounted by AuthMethodSelector.
 * Connects directly to Phantom on mount, then signs a message for key derivation.
 */
export function SolanaAuthButton() {
  const { publicKey, connected, disconnect, signMessage, select, wallet } = useWallet();
  const { completeAuth } = useAuthCompletion();
  const processingRef = useRef(false);
  const selectAttemptedRef = useRef(false);

  // Select Phantom directly on mount (no modal)
  useEffect(() => {
    if (!selectAttemptedRef.current && !connected) {
      selectAttemptedRef.current = true;
      select('Phantom' as any);
    }
  }, [select, connected]);

  // Connect once Phantom is selected
  useEffect(() => {
    if (wallet && !connected && selectAttemptedRef.current) {
      wallet.adapter.connect().catch((err) => {
        console.error('[SolanaAuth] Phantom connect failed:', err?.message);
      });
    }
  }, [wallet, connected]);

  // Sign message once connected
  useEffect(() => {
    if (connected && publicKey && signMessage && !processingRef.current) {
      processingRef.current = true;

      // HIGH-3: Request a signature to prove wallet ownership
      // The signature (not the public key) is used as HKDF input
      const message = new TextEncoder().encode(SolanaKeyDerivation.SIGN_MESSAGE);
      signMessage(message)
        .then((signatureBytes) => {
          // Convert signature bytes to hex string (avoids bs58 import)
          const signatureHex = Array.from(signatureBytes).map(b => b.toString(16).padStart(2, '0')).join('');
          const keys = SolanaKeyDerivation.deriveKeys(signatureHex);
          const pubKeyStr = publicKey.toBase58();
          SolanaAuthService.storeSession(pubKeyStr);

          // Disconnect wallet immediately -- we only needed the signature
          disconnect();

          // Use the signature as the seed (not the public key)
          completeAuth(keys, 'solana', signatureHex);
        })
        .catch((err) => {
          console.error('[SolanaAuth] Signature rejected:', err?.message);
          processingRef.current = false;
          disconnect();
        });
    }
  }, [connected, publicKey, disconnect, signMessage, completeAuth]);

  // Render a loading state while connecting to Phantom
  return (
    <div className="block w-full p-4 rounded-lg border border-accent bg-accent-muted/30 text-left">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#9945FF]/20 to-[#14F195]/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-[#14F195]" viewBox="0 0 397.7 311.7" fill="currentColor">
            <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
            <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
            <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
          </svg>
        </div>
        <div className="flex-1">
          <span className="font-semibold text-foreground">Phantom Wallet</span>
          <p className="text-sm text-foreground-secondary">Connecting...</p>
        </div>
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}
