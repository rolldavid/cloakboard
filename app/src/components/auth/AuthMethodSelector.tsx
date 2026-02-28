/**
 * Auth Method Selector — Primary picker for authentication methods.
 * Google OAuth is the default. Passkey, Ethereum, Solana available.
 *
 * Wallet buttons (ETH/SOL) are lazy-mounted: only rendered after the user
 * clicks the placeholder. This prevents Phantom from auto-popping its UI
 * when wagmi/solana-adapter probe for injected providers on mount.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { EthereumAuthButton } from './EthereumAuthButton';
import { SolanaAuthButton } from './SolanaAuthButton';
import { PasskeyAuthButton } from './PasskeyAuthButton';

type WalletSelection = null | 'ethereum' | 'solana';

export function AuthMethodSelector() {
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [walletSelection, setWalletSelection] = useState<WalletSelection>(null);

  useEffect(() => {
    setGoogleConfigured(GoogleAuthService.isConfigured());
  }, []);

  return (
    <div className="space-y-4">
      {/* Google OAuth - Primary */}
      <motion.button
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.15 }}
        onClick={() => GoogleAuthService.initiateOAuthFlow()}
        disabled={!googleConfigured}
        className="block w-full p-4 rounded-lg border-2 border-accent bg-accent-muted hover:bg-accent-muted transition-all text-left disabled:opacity-50"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-card border border-border flex items-center justify-center">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="font-semibold text-foreground">Sign in with Google</span>
            <p className="text-sm text-foreground-secondary">One click, no password needed</p>
          </div>
          <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </motion.button>

      {/* Passkey */}
      <PasskeyAuthButton />

      {/* Ethereum Wallet — lazy-mounted to avoid Phantom auto-popup */}
      {walletSelection === 'ethereum' ? (
        <EthereumAuthButton />
      ) : (
        <button
          onClick={() => setWalletSelection('ethereum')}
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
      )}

      {/* Solana Wallet — lazy-mounted to avoid Phantom auto-popup */}
      {walletSelection === 'solana' ? (
        <SolanaAuthButton />
      ) : (
        <button
          onClick={() => setWalletSelection('solana')}
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
      )}
    </div>
  );
}
