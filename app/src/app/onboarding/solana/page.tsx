'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';

export default function SolanaOnboardingPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  if (isAuthenticated) {
    router.push('/dashboard');
    return null;
  }

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // Check for Solana wallet provider (Phantom, Solflare, etc.)
      const solana = (window as any).solana || (window as any).phantom?.solana;
      if (!solana) {
        throw new Error('No Solana wallet detected. Please install Phantom or another Solana wallet.');
      }

      // Connect to wallet
      const resp = await solana.connect();
      const publicKey = resp.publicKey.toString();

      // Sign a deterministic message for key derivation
      const message = new TextEncoder().encode('Cloak Aztec Account v1');
      const signatureResponse = await solana.signMessage(message, 'utf8');

      // signMessage returns { signature: Uint8Array } or Uint8Array directly
      const signature: Uint8Array = signatureResponse.signature || signatureResponse;

      // Import SolanaKeyDerivation + AuthManager
      const { SolanaKeyDerivation } = await import('@/lib/auth/solana/SolanaKeyDerivation');
      const { getAuthManager } = await import('@/lib/auth/AuthManager');

      // Get network config from environment
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
      const result = await authManager.authenticateWithSolana(publicKey, signature);

      // Redirect to dashboard or original destination
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/dashboard';
      router.push(redirect);
    } catch (err: any) {
      console.error('[SolanaOnboarding] Error:', err);
      // Handle user rejection
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setError('Connection cancelled.');
      } else {
        setError(err.message || 'Failed to connect Solana wallet');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Connect Solana Wallet</h1>
          <p className="text-foreground-secondary mt-2">
            Sign a message to create your Aztec account from your Solana wallet.
            The same wallet will always produce the same account.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="p-4 bg-background-secondary rounded-md">
            <h3 className="font-medium text-foreground mb-1">How it works</h3>
            <ol className="text-sm text-foreground-secondary space-y-1 list-decimal list-inside">
              <li>Connect your Phantom or other Solana wallet</li>
              <li>Sign a message (no transaction, no fees)</li>
              <li>Your Aztec account is derived from the signature</li>
              <li>Use the same wallet on any device to restore access</li>
            </ol>
          </div>

          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full px-4 py-3 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Connect Solana Wallet'}
          </button>

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
