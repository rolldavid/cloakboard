'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function EthereumOnboardingPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const hasTriggeredSign = useRef(false);

  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  // Redirect if already authenticated with Cloak
  if (isAuthenticated) {
    router.push('/dashboard');
    return null;
  }

  const authenticateWithSignature = useCallback(async (ethAddress: string) => {
    if (isAuthenticating || hasTriggeredSign.current) return;
    hasTriggeredSign.current = true;
    setIsAuthenticating(true);
    setError(null);

    try {
      const message = 'Cloak Aztec Account v1';
      const signature = await signMessageAsync({ message });

      const sigBytes = new Uint8Array(
        signature
          .slice(2)
          .match(/.{2}/g)!
          .map((byte: string) => parseInt(byte, 16))
      );

      const { getAuthManager } = await import('@/lib/auth/AuthManager');

      const network = {
        id: 'aztec-local',
        name: 'Aztec Local',
        nodeUrl: process.env.NEXT_PUBLIC_AZTEC_NODE_URL || 'http://localhost:8080',
        chainId: 31337,
        rollupVersion: 1,
        sponsoredFpcAddress: process.env.NEXT_PUBLIC_SPONSORED_FPC_ADDRESS,
      };

      const authManager = getAuthManager(network);
      await authManager.initialize();
      const result = await authManager.authenticateWithEthereum(ethAddress, sigBytes);

      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/dashboard';
      router.push(redirect);
    } catch (err: any) {
      console.error('[EthereumOnboarding] Error:', err);
      hasTriggeredSign.current = false;
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setError('Signature cancelled. Please sign the message to continue.');
      } else {
        setError(err.message || 'Failed to authenticate');
      }
      disconnect();
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, signMessageAsync, router, disconnect]);

  // When wallet connects via RainbowKit, proceed to sign
  useEffect(() => {
    if (isConnected && address && !isAuthenticating && !isAuthenticated && !hasTriggeredSign.current) {
      authenticateWithSignature(address);
    }
  }, [isConnected, address, isAuthenticating, isAuthenticated, authenticateWithSignature]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Connect Ethereum Wallet</h1>
          <p className="text-foreground-secondary mt-2">
            Connect any Ethereum wallet and sign a message to create your Aztec account.
            The same wallet will always produce the same account.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="p-4 bg-background-secondary rounded-md">
            <h3 className="font-medium text-foreground mb-1">How it works</h3>
            <ol className="text-sm text-foreground-secondary space-y-1 list-decimal list-inside">
              <li>Choose your wallet (MetaMask, WalletConnect, Coinbase, etc.)</li>
              <li>Sign a message (no transaction, no gas)</li>
              <li>Your Aztec account is derived from the signature</li>
              <li>Use the same wallet on any device to restore access</li>
            </ol>
          </div>

          {isAuthenticating ? (
            <div className="w-full px-4 py-3 bg-accent/80 text-white rounded-md font-medium text-center">
              Signing...
            </div>
          ) : (
            <div className="flex justify-center [&>div]:w-full [&_button]:w-full [&_button]:justify-center [&_button]:px-4 [&_button]:py-3 [&_button]:rounded-md [&_button]:font-medium">
              <ConnectButton.Custom>
                {({ account, chain, openConnectModal, mounted }) => {
                  const connected = mounted && account && chain;
                  return (
                    <button
                      onClick={() => {
                        if (connected) {
                          // Already connected — re-trigger sign
                          if (address) authenticateWithSignature(address);
                        } else {
                          openConnectModal();
                        }
                      }}
                      className="w-full px-4 py-3 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
                    >
                      {connected ? `Sign with ${account.displayName}` : 'Connect Wallet'}
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          )}

          {error && (
            <div className="p-3 bg-status-error/10 border border-status-error/20 rounded-md">
              <p className="text-sm text-status-error">{error}</p>
            </div>
          )}
        </div>

        <div className="text-center">
          <a href="/onboarding" className="text-sm text-accent hover:text-accent-hover">
            Back to sign-in options
          </a>
        </div>
      </div>
    </div>
  );
}
