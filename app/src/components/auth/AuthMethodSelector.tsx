'use client';

/**
 * Auth Method Selector Component
 *
 * Primary picker for authentication methods.
 * Google OAuth is the default, with passkey as a super secure option.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { PasskeyService } from '@/lib/auth/passkey/PasskeyService';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { EmailService } from '@/lib/auth/email/EmailService';
import { getDefaultNetwork } from '@/lib/config/networks';
interface AuthMethodSelectorProps {
  autoTriggerPasskey?: boolean;
}

export function AuthMethodSelector({ autoTriggerPasskey }: AuthMethodSelectorProps) {
  const router = useRouter();
  const { openConnectModal } = useConnectModal();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [passkeySupported, setPasskeySupported] = useState<boolean | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [ethClicked, setEthClicked] = useState(false);
  const [ethStatus, setEthStatus] = useState<'idle' | 'signing' | 'creating' | 'error'>('idle');
  const [ethError, setEthError] = useState<string | null>(null);
  const hasTriggeredSign = useRef(false);
  const [passkeyStatus, setPasskeyStatus] = useState<'idle' | 'registering' | 'creating' | 'error'>('idle');
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [solanaStatus, setSolanaStatus] = useState<'idle' | 'connecting' | 'signing' | 'creating' | 'error'>('idle');
  const [solanaError, setSolanaError] = useState<string | null>(null);
  const hasTriggeredPasskey = useRef(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'form' | 'sending' | 'sent' | 'error'>('idle');
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  const authenticateWithSignature = useCallback(async (ethAddress: string) => {
    if (hasTriggeredSign.current) return;
    hasTriggeredSign.current = true;
    setEthStatus('signing');
    setEthError(null);

    try {
      const signature = await signMessageAsync({ message: 'Cloak Aztec Account v1' });

      setEthStatus('creating');

      const sigBytes = new Uint8Array(
        signature.slice(2).match(/.{2}/g)!.map((byte: string) => parseInt(byte, 16))
      );

      const { getAuthManager } = await import('@/lib/auth/AuthManager');
      const authManager = getAuthManager(getDefaultNetwork());
      await authManager.initialize();
      await authManager.authenticateWithEthereum(ethAddress, sigBytes);

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[EthAuth] Error:', err);
      hasTriggeredSign.current = false;
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setEthError('Signature cancelled. Please try again.');
      } else {
        setEthError(err.message || 'Failed to authenticate');
      }
      setEthStatus('error');
      disconnect();
    }
  }, [signMessageAsync, router, disconnect]);

  // When wallet connects after clicking Ethereum option, prompt signature
  useEffect(() => {
    if (ethClicked && isConnected && address && !hasTriggeredSign.current) {
      authenticateWithSignature(address);
    }
  }, [ethClicked, isConnected, address, authenticateWithSignature]);

  useEffect(() => {
    const checkSupport = async () => {
      const supported = PasskeyService.isSupported();
      setPasskeySupported(supported);

      if (supported) {
        await PasskeyService.isPlatformAuthenticatorAvailable();
      }

      setGoogleConfigured(GoogleAuthService.isConfigured());
    };

    checkSupport();
  }, []);

  const handlePasskeyAuth = useCallback(async () => {
    if (passkeyStatus === 'registering' || passkeyStatus === 'creating') return;
    setPasskeyStatus('registering');
    setPasskeyError(null);

    try {
      const storedIds = PasskeyService.listStoredCredentialIds();
      let credential;
      if (storedIds.length > 0) {
        credential = await PasskeyService.authenticate();
      } else {
        credential = await PasskeyService.register({ displayName: 'Cloakboard User' });
      }

      PasskeyService.storeCredential(credential);
      setPasskeyStatus('creating');

      const { getAuthManager } = await import('@/lib/auth/AuthManager');
      const authManager = getAuthManager(getDefaultNetwork());
      await authManager.initialize();

      if (storedIds.length > 0) {
        await authManager.unlockWithPasskey(credential);
      } else {
        await authManager.authenticateWithPasskey(credential);
      }

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[PasskeyAuth] Error:', err);
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError' ||
          err?.message?.includes('not allowed') || err?.message?.includes('abort')) {
        setPasskeyStatus('idle');
        setPasskeyError(null);
      } else {
        setPasskeyError(err.message || 'Passkey authentication failed');
        setPasskeyStatus('error');
      }
    }
  }, [passkeyStatus, router]);

  const handleSolanaAuth = useCallback(async () => {
    if (solanaStatus === 'connecting' || solanaStatus === 'signing' || solanaStatus === 'creating') return;
    setSolanaStatus('connecting');
    setSolanaError(null);

    try {
      const solana = (window as any).solana || (window as any).phantom?.solana;
      if (!solana) {
        throw new Error('No Solana wallet detected. Please install Phantom or another Solana wallet.');
      }

      const resp = await solana.connect();
      const publicKey = resp.publicKey.toString();

      setSolanaStatus('signing');
      const message = new TextEncoder().encode('Cloak Aztec Account v1');
      const signatureResponse = await solana.signMessage(message, 'utf8');
      const signature: Uint8Array = signatureResponse.signature || signatureResponse;

      setSolanaStatus('creating');

      const { getAuthManager } = await import('@/lib/auth/AuthManager');
      const authManager = getAuthManager(getDefaultNetwork());
      await authManager.initialize();
      await authManager.authenticateWithSolana(publicKey, signature);

      router.push('/dashboard');
    } catch (err: any) {
      console.error('[SolanaAuth] Error:', err);
      if (err?.code === 4001 || err?.message?.includes('User rejected')) {
        setSolanaStatus('idle');
        setSolanaError(null);
      } else {
        setSolanaError(err.message || 'Failed to connect Solana wallet');
        setSolanaStatus('error');
      }
    }
  }, [solanaStatus, router]);

  const handleEmailSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailStatus === 'sending') return;
    setEmailError(null);

    if (!EmailService.validateEmail(emailInput)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setEmailStatus('sending');
    try {
      await EmailService.sendMagicLink(emailInput);
      EmailService.storeFlowState(emailInput);
      setEmailStatus('sent');
    } catch (err: any) {
      console.error('[EmailAuth] Error:', err);
      setEmailError(err.message || 'Failed to send magic link');
      setEmailStatus('error');
    }
  }, [emailStatus, emailInput]);

  // Auto-trigger passkey for returning users
  useEffect(() => {
    if (autoTriggerPasskey && passkeySupported && !hasTriggeredPasskey.current) {
      hasTriggeredPasskey.current = true;
      handlePasskeyAuth();
    }
  }, [autoTriggerPasskey, passkeySupported, handlePasskeyAuth]);

  return (
    <div className="space-y-4">
      {/* Google OAuth - Primary/Recommended */}
      <button
        onClick={() => GoogleAuthService.initiateOAuthFlow()}
        className="block w-full p-4 rounded-lg border-2 border-accent bg-accent-muted hover:bg-accent-muted transition-all text-left"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-card border border-border flex items-center justify-center">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Sign in with Google</span>
            </div>
            <p className="text-sm text-foreground-secondary">One click, no password needed</p>
          </div>
          <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Email (Magic Link) */}
      {emailStatus === 'idle' || emailStatus === 'error' ? (
        <button
          onClick={() => {
            if (emailStatus === 'error') {
              setEmailError(null);
            }
            setEmailStatus('form');
          }}
          className="block w-full p-4 rounded-lg border border-border hover:border-border-hover hover:bg-card-hover transition-all text-left"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <span className="font-semibold text-foreground">Sign in with Email</span>
              <p className="text-sm text-foreground-secondary">
                {emailError || 'Passwordless — just enter your email'}
              </p>
            </div>
            <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      ) : emailStatus === 'sent' ? (
        <div className="w-full p-4 rounded-lg border border-purple-300 bg-purple-50 dark:bg-purple-900/20 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold text-foreground text-sm">Check your email</span>
          </div>
          <p className="text-sm text-foreground-secondary">
            We sent a magic link to <strong>{emailInput}</strong>. Click the link in the email to sign in.
          </p>
          <button
            type="button"
            onClick={() => {
              setEmailStatus('form');
              setEmailError(null);
            }}
            className="w-full px-3 py-2 border border-border text-foreground-secondary rounded-md text-sm hover:bg-card-hover transition-colors"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleEmailSubmit}
          className="w-full p-4 rounded-lg border border-purple-300 bg-purple-50 dark:bg-purple-900/20 space-y-3"
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold text-foreground text-sm">Sign in with Email</span>
          </div>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
            autoFocus
            disabled={emailStatus === 'sending'}
          />
          {emailError && (
            <p className="text-xs text-status-error">{emailError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEmailStatus('idle');
                setEmailInput('');
                setEmailError(null);
              }}
              className="flex-1 px-3 py-2 border border-border text-foreground-secondary rounded-md text-sm hover:bg-card-hover transition-colors"
              disabled={emailStatus === 'sending'}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={emailStatus === 'sending' || !emailInput}
              className="flex-1 px-3 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {emailStatus === 'sending' ? 'Sending...' : 'Send Magic Link'}
            </button>
          </div>
        </form>
      )}

      {/* Passkey - Super Secure option */}
      <button
        onClick={() => {
          if (passkeyStatus === 'error') {
            setPasskeyError(null);
            setPasskeyStatus('idle');
          }
          if (passkeySupported) handlePasskeyAuth();
        }}
        disabled={!passkeySupported || passkeyStatus === 'registering' || passkeyStatus === 'creating'}
        className={`block w-full p-4 rounded-lg border transition-all text-left ${
          passkeySupported
            ? 'border-border hover:border-border-hover hover:bg-card-hover'
            : 'border-border bg-background-secondary opacity-60 cursor-not-allowed'
        } disabled:opacity-60`}
      >
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
            passkeySupported ? 'bg-status-success/10' : 'bg-background-tertiary'
          }`}>
            {passkeyStatus === 'registering' || passkeyStatus === 'creating' ? (
              <svg className="w-6 h-6 text-status-success animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className={`w-6 h-6 ${passkeySupported ? 'text-status-success' : 'text-foreground-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {passkeyStatus === 'registering' ? 'Verifying identity...' :
                 passkeyStatus === 'creating' ? 'Creating account...' :
                 'Continue with Passkey'}
              </span>
            </div>
            <p className="text-sm text-foreground-secondary">
              {passkeyError || (passkeySupported
                ? 'Face ID, Touch ID, or device biometric'
                : 'Not supported in this browser')}
            </p>
          </div>
          {passkeyStatus === 'idle' && (
            <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </button>

      {/* Ethereum Wallet */}
      <button
        onClick={() => {
          if (ethStatus === 'error') {
            setEthError(null);
            setEthStatus('idle');
            hasTriggeredSign.current = false;
          }
          setEthClicked(true);
          if (isConnected && address) {
            authenticateWithSignature(address);
          } else {
            openConnectModal?.();
          }
        }}
        disabled={ethStatus === 'signing' || ethStatus === 'creating'}
        className="block w-full p-4 rounded-lg border border-border hover:border-border-hover hover:bg-card-hover transition-all text-left disabled:opacity-60"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
            {ethStatus === 'signing' || ethStatus === 'creating' ? (
              <svg className="w-6 h-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <span className="font-semibold text-foreground">
              {ethStatus === 'signing' ? 'Sign the message in your wallet...' :
               ethStatus === 'creating' ? 'Creating account...' :
               'Ethereum Wallet'}
            </span>
            <p className="text-sm text-foreground-secondary">
              {ethError || 'MetaMask, WalletConnect, Coinbase, or any wallet'}
            </p>
          </div>
          {ethStatus === 'idle' && (
            <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </button>

      {/* Solana Wallet */}
      <button
        onClick={() => {
          if (solanaStatus === 'error') {
            setSolanaError(null);
            setSolanaStatus('idle');
          }
          handleSolanaAuth();
        }}
        disabled={solanaStatus === 'connecting' || solanaStatus === 'signing' || solanaStatus === 'creating'}
        className="block w-full p-4 rounded-lg border border-border hover:border-border-hover hover:bg-card-hover transition-all text-left disabled:opacity-60"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
            {solanaStatus === 'connecting' || solanaStatus === 'signing' || solanaStatus === 'creating' ? (
              <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" viewBox="0 0 397.7 311.7" fill="currentColor">
                <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
                <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
                <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <span className="font-semibold text-foreground">
              {solanaStatus === 'connecting' ? 'Connecting wallet...' :
               solanaStatus === 'signing' ? 'Sign the message in your wallet...' :
               solanaStatus === 'creating' ? 'Creating account...' :
               'Solana Wallet'}
            </span>
            <p className="text-sm text-foreground-secondary">
              {solanaError || 'Connect Phantom or any Solana wallet'}
            </p>
          </div>
          {solanaStatus === 'idle' && (
            <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </button>
    </div>
  );
}
