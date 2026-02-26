import { useEffect, useRef } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { EthereumKeyDerivation } from '@/lib/auth/ethereum/EthereumKeyDerivation';
import { EthereumAuthService } from '@/lib/auth/ethereum/EthereumAuthService';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

export function EthereumAuthButton() {
  const { openConnectModal } = useConnectModal();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { completeAuth } = useAuthCompletion();
  const processingRef = useRef(false);

  useEffect(() => {
    if (isConnected && address && !processingRef.current) {
      processingRef.current = true;

      const keys = EthereumKeyDerivation.deriveKeys(address);
      EthereumAuthService.storeSession(address);

      // Disconnect wallet immediately — we only needed the address
      disconnect();

      completeAuth(keys, 'ethereum', address);
    }
  }, [isConnected, address, disconnect, completeAuth]);

  return (
    <button
      onClick={() => openConnectModal?.()}
      className="block w-full p-4 rounded-lg border border-border hover:border-border-hover hover:bg-card-hover transition-all text-left"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <span className="font-semibold text-foreground">Ethereum Wallet</span>
          <p className="text-sm text-foreground-secondary">MetaMask, WalletConnect, or any wallet</p>
        </div>
        <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
