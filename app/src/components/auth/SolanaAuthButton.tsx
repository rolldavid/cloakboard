import { useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { SolanaKeyDerivation } from '@/lib/auth/solana/SolanaKeyDerivation';
import { SolanaAuthService } from '@/lib/auth/solana/SolanaAuthService';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

export function SolanaAuthButton() {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { completeAuth } = useAuthCompletion();
  const processingRef = useRef(false);

  useEffect(() => {
    if (connected && publicKey && !processingRef.current) {
      processingRef.current = true;

      const pubKeyStr = publicKey.toBase58();
      const keys = SolanaKeyDerivation.deriveKeys(pubKeyStr);
      SolanaAuthService.storeSession(pubKeyStr);

      // Disconnect wallet immediately — we only needed the public key
      disconnect();

      completeAuth(keys, 'solana', pubKeyStr);
    }
  }, [connected, publicKey, disconnect, completeAuth]);

  return (
    <button
      onClick={() => setVisible(true)}
      className="block w-full p-4 rounded-lg border border-border hover:border-border-hover hover:bg-card-hover transition-all text-left"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#9945FF]/20 to-[#14F195]/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-[#14F195]" viewBox="0 0 397.7 311.7" fill="currentColor">
            <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
            <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
            <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
          </svg>
        </div>
        <div className="flex-1">
          <span className="font-semibold text-foreground">Solana Wallet</span>
          <p className="text-sm text-foreground-secondary">Phantom or any Solana wallet</p>
        </div>
        <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
