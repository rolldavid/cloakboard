'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backdropVariants, modalContentVariants } from '@/lib/motion';
import type { AuthMethod, LinkedAuthMethod } from '@/types/wallet';
import type { PasskeyCredential, GoogleOAuthData } from '@/lib/auth/types';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { PasskeyService } from '@/lib/auth/passkey/PasskeyService';
import { PasswordService } from '@/lib/auth/password/PasswordService';

interface LinkedAccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
  primaryMethod: AuthMethod | null;
  linkedAccounts: LinkedAuthMethod[];
  onLinkGoogle: (oauth: GoogleOAuthData) => Promise<void>;
  onLinkPasskey: (credential: PasskeyCredential) => Promise<void>;
  onLinkPassword: (email: string, password: string) => Promise<void>;
  onLinkEthereum: (ethAddress: string, signature: Uint8Array) => Promise<void>;
  onLinkSolana: (solAddress: string, signature: Uint8Array) => Promise<void>;
  onUnlink: (method: AuthMethod) => Promise<void>;
  onPrepareGoogleLink?: () => Promise<void>;
}

const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
  google: 'Google',
  passkey: 'Passkey',
  password: 'Email + Password',
  ethereum: 'ETH Wallet',
  solana: 'Solana Wallet',
};

const ALL_METHODS: AuthMethod[] = ['google', 'passkey', 'password', 'ethereum', 'solana'];

type LinkingState = 'idle' | 'linking' | 'password-form' | 'success' | 'error';

export function LinkedAccountsModal({
  isOpen,
  onClose,
  primaryMethod,
  linkedAccounts,
  onLinkGoogle,
  onLinkPasskey,
  onLinkPassword,
  onLinkEthereum,
  onLinkSolana,
  onUnlink,
  onPrepareGoogleLink,
}: LinkedAccountsModalProps) {
  const [linkingMethod, setLinkingMethod] = useState<AuthMethod | null>(null);
  const [linkingState, setLinkingState] = useState<LinkingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');

  const linkedSet = new Set(linkedAccounts.map(a => a.method));

  const resetState = () => {
    setLinkingMethod(null);
    setLinkingState('idle');
    setError(null);
    setLinkEmail('');
    setLinkPassword('');
  };

  const handleLink = async (method: AuthMethod) => {
    setLinkingMethod(method);
    setLinkingState('linking');
    setError(null);

    try {
      switch (method) {
        case 'google': {
          // Google uses a redirect flow — we store the intent and redirect
          // On return, the onboarding/google callback page will handle linking
          if (!GoogleAuthService.isConfigured()) {
            throw new Error('Google OAuth is not configured');
          }
          // Store primary key material before redirect
          if (onPrepareGoogleLink) {
            await onPrepareGoogleLink();
          }
          // Store intent in sessionStorage so the callback knows it's a link operation
          sessionStorage.setItem('oauth_flow_type', 'link-account');
          GoogleAuthService.initiateOAuthFlow();
          // Page will redirect — modal won't be visible anymore
          return;
        }

        case 'passkey': {
          const credential = await PasskeyService.register({
            displayName: 'Cloak Linked Passkey',
          });
          PasskeyService.storeCredential(credential);
          await onLinkPasskey(credential);
          setLinkingState('success');
          break;
        }

        case 'password': {
          // Show email + password form
          setLinkingState('password-form');
          return;
        }

        case 'ethereum': {
          // Find the right Ethereum provider — Phantom hijacks window.ethereum
          let ethereum = (window as any).ethereum;
          if (ethereum?.providers?.length) {
            // Multiple wallets installed: prefer MetaMask (not Phantom's ETH bridge)
            ethereum = ethereum.providers.find((p: any) => p.isMetaMask && !p.isPhantom)
              || ethereum.providers.find((p: any) => !p.isPhantom)
              || ethereum.providers[0];
          } else if (ethereum?.isPhantom) {
            // Only Phantom installed, no real ETH wallet
            throw new Error('Phantom\'s Ethereum bridge was detected. Please install MetaMask or another Ethereum wallet for linking.');
          }
          if (!ethereum) {
            throw new Error('No Ethereum wallet detected. Please install MetaMask, Coinbase Wallet, or another Ethereum wallet.');
          }
          const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
          const ethAddress = accounts[0] as string;
          const message = 'Cloak Aztec Account v1';
          const signature = await ethereum.request({
            method: 'personal_sign',
            params: [message, ethAddress],
          });
          const sigBytes = new Uint8Array(
            (signature as string)
              .slice(2)
              .match(/.{2}/g)!
              .map((byte: string) => parseInt(byte, 16))
          );
          await onLinkEthereum(ethAddress, sigBytes);
          setLinkingState('success');
          break;
        }

        case 'solana': {
          const solana = (window as any).solana || (window as any).phantom?.solana;
          if (!solana) {
            throw new Error('No Solana wallet detected. Please install Phantom or another Solana wallet.');
          }
          const resp = await solana.connect();
          const solPublicKey = resp.publicKey.toString();
          const solMessage = new TextEncoder().encode('Cloak Aztec Account v1');
          const solSigResponse = await solana.signMessage(solMessage, 'utf8');
          const solSignature: Uint8Array = solSigResponse.signature || solSigResponse;
          await onLinkSolana(solPublicKey, solSignature);
          setLinkingState('success');
          break;
        }
      }
    } catch (err) {
      // User cancelled WebAuthn / MetaMask
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        resetState();
        return;
      }
      setError(err instanceof Error ? err.message : 'Linking failed');
      setLinkingState('error');
    }
  };

  const handlePasswordLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PasswordService.validateEmail(linkEmail)) {
      setError('Please enter a valid email address');
      return;
    }
    if (!PasswordService.isStrongEnough(linkPassword)) {
      setError(PasswordService.checkStrength(linkPassword).feedback || 'Password is too weak');
      return;
    }
    setLinkingState('linking');
    setError(null);

    try {
      await onLinkPassword(linkEmail, linkPassword);
      setLinkingState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link email');
      setLinkingState('error');
    }
  };

  const handleUnlink = async (method: AuthMethod) => {
    try {
      await onUnlink(method);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/50"
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={() => { resetState(); onClose(); }}
      />

      {/* Modal */}
      <motion.div
        className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6"
        variants={modalContentVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Linked Accounts</h2>
          <button
            onClick={() => { resetState(); onClose(); }}
            className="text-foreground-muted hover:text-foreground transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-status-error/10 border border-status-error/20 text-status-error rounded-md text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-xs">Dismiss</button>
          </div>
        )}

        {/* Success banner */}
        {linkingState === 'success' && (
          <div className="mb-4 p-3 bg-status-success/10 border border-status-success/20 text-status-success rounded-md text-sm">
            {linkingMethod && AUTH_METHOD_LABELS[linkingMethod]} linked successfully.
            <button onClick={resetState} className="ml-2 underline text-xs">Done</button>
          </div>
        )}

        {/* Password link form */}
        {linkingState === 'password-form' && (
          <form onSubmit={handlePasswordLinkSubmit} className="mb-4 p-4 bg-background-secondary rounded-md space-y-3">
            <p className="text-sm font-medium text-foreground">Link Email + Password</p>
            <input
              type="email"
              value={linkEmail}
              onChange={(e) => setLinkEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
              autoFocus
            />
            <div>
              <input
                type="password"
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
                placeholder="Password (10+ characters)"
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
              />
              {linkPassword.length > 0 && (
                <div className="mt-1.5">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          PasswordService.checkStrength(linkPassword).score >= level
                            ? level <= 1 ? 'bg-red-400' : level <= 2 ? 'bg-yellow-400' : 'bg-green-400'
                            : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                      />
                    ))}
                  </div>
                  {PasswordService.checkStrength(linkPassword).feedback && (
                    <p className="text-xs text-foreground-muted mt-0.5">
                      {PasswordService.checkStrength(linkPassword).feedback}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetState}
                className="flex-1 px-3 py-2 border border-border text-foreground-secondary rounded-md text-sm hover:bg-card-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!linkEmail || !linkPassword}
                className="flex-1 px-3 py-2 bg-accent text-white rounded-md text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                Link Email
              </button>
            </div>
          </form>
        )}

        {/* Auth methods list */}
        <div className="space-y-2">
          {ALL_METHODS.map((method) => {
            const isPrimary = method === primaryMethod;
            const isLinked = isPrimary || linkedSet.has(method);
            const isCurrentlyLinking = linkingMethod === method && linkingState === 'linking';

            return (
              <div
                key={method}
                className="flex items-center justify-between p-3 bg-background-secondary rounded-md"
              >
                <div className="flex items-center gap-3">
                  <MethodIcon method={method} />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {AUTH_METHOD_LABELS[method]}
                    </p>
                    {isPrimary && (
                      <p className="text-xs text-foreground-muted">Primary</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isLinked ? (
                    <>
                      <span className="flex items-center gap-1 text-xs text-status-success">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Connected
                      </span>
                      {!isPrimary && (
                        <button
                          onClick={() => handleUnlink(method)}
                          className="text-xs text-foreground-muted hover:text-status-error transition-colors px-2 py-1 rounded"
                        >
                          Unlink
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => handleLink(method)}
                      disabled={isCurrentlyLinking}
                      className="text-xs font-medium text-accent hover:text-accent-hover transition-colors px-3 py-1.5 border border-accent/30 rounded-md hover:bg-accent/5 disabled:opacity-50"
                    >
                      {isCurrentlyLinking ? (
                        <span className="flex items-center gap-1">
                          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                          Linking...
                        </span>
                      ) : (
                        '+ Link'
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-foreground-muted">
          Linked accounts let you sign in with multiple methods. Your primary method cannot be unlinked.
        </p>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}

function MethodIcon({ method }: { method: AuthMethod }) {
  const className = "w-8 h-8 rounded-full flex items-center justify-center";

  switch (method) {
    case 'google':
      return (
        <div className={`${className} bg-white border border-border`}>
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
        </div>
      );
    case 'passkey':
      return (
        <div className={`${className} bg-accent/10`}>
          <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
          </svg>
        </div>
      );
    case 'password':
      return (
        <div className={`${className} bg-purple-100 dark:bg-purple-900/30`}>
          <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      );
    case 'ethereum':
      return (
        <div className={`${className} bg-blue-100 dark:bg-blue-900/30`}>
          <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" viewBox="0 0 256 417" preserveAspectRatio="xMidYMid">
            <path fill="currentColor" d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" opacity="0.6" />
            <path fill="currentColor" d="M127.962 0L0 212.32l127.962 75.639V154.158z" />
            <path fill="currentColor" d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z" opacity="0.6" />
            <path fill="currentColor" d="M127.962 416.905v-104.72L0 236.585z" />
          </svg>
        </div>
      );
    case 'solana':
      return (
        <div className={`${className} bg-gradient-to-br from-[#9945FF]/20 to-[#14F195]/20`}>
          <svg className="w-4 h-4" viewBox="0 0 397.7 311.7" fill="url(#solGrad)">
            <defs>
              <linearGradient id="solGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#9945FF" />
                <stop offset="100%" stopColor="#14F195" />
              </linearGradient>
            </defs>
            <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
            <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
            <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
          </svg>
        </div>
      );
  }
}
