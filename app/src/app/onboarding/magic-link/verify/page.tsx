'use client';

/**
 * Magic Link Verify Page (Passwordless)
 *
 * Flow:
 * 1. Parse token from URL
 * 2. Verify token with API
 * 3. Create wallet automatically (no password needed)
 * 4. Show welcome screen
 * 5. Redirect to dashboard
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MagicLinkService } from '@/lib/auth/magic-link/MagicLinkService';
import { getAuthManager } from '@/lib/auth/AuthManager';
import { getDefaultNetwork } from '@/lib/config/networks';
import { LoadingOwl } from '@/components/ui/LoadingOwl';

type Step = 'verifying' | 'creating' | 'welcome' | 'error';

export default function MagicLinkVerifyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('verifying');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prevent double-processing in React Strict Mode
  const processingRef = useRef(false);

  // Verify token and create wallet on mount
  useEffect(() => {
    let mounted = true;

    const verifyAndCreateWallet = async () => {
      if (processingRef.current) return;

      const urlToken = MagicLinkService.parseTokenFromUrl();

      if (!urlToken) {
        if (mounted) {
          setError('No token found in URL');
          setStep('error');
        }
        return;
      }

      // Check if this is a link flow (email linking, not signup)
      const params = new URLSearchParams(window.location.search);
      const flow = params.get('flow');

      // Mark as processing before consuming token (single-use)
      processingRef.current = true;

      try {
        // Consume token (single use)
        const result = await MagicLinkService.consumeToken(urlToken);

        if (!result || !result.email) {
          if (mounted) {
            setError('Invalid or expired magic link');
            setStep('error');
          }
          return;
        }

        if (mounted) setStep('creating');

        const network = getDefaultNetwork();
        const authManager = getAuthManager(network);
        await authManager.initialize();

        if (flow === 'link') {
          // Complete the account linking flow
          await authManager.completeMagicLinkLink(result.email);

          MagicLinkService.clearPendingLink();

          if (mounted) {
            setUsername('');
            setStep('welcome');
          }

          await new Promise(resolve => setTimeout(resolve, 1500));
          router.push('/');
        } else {
          // Normal signup/login flow
          const authResult = await authManager.authenticateWithMagicLink(result.email);

          MagicLinkService.clearPendingLink();
          sessionStorage.setItem('auth_username', authResult.username);

          if (mounted) {
            setUsername(authResult.username);
            setStep('welcome');
          }

          await new Promise(resolve => setTimeout(resolve, 1500));
          router.push('/');
        }
      } catch (err) {
        console.error('[Magic Link] Error:', err);
        processingRef.current = false;
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Authentication failed');
          setStep('error');
        }
      }
    };

    verifyAndCreateWallet();

    return () => {
      mounted = false;
    };
  }, [router]);

  const handleRetry = () => {
    router.push('/onboarding/magic-link');
  };

  const handleGoBack = () => {
    router.push('/onboarding');
  };

  // Verifying token
  if (step === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <LoadingOwl text="Verifying magic link" />
      </div>
    );
  }

  // Creating wallet
  if (step === 'creating') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <LoadingOwl text="Signing you in" />
      </div>
    );
  }

  // Welcome
  if (step === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-8">
            <div className="w-24 h-24 bg-status-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {username ? `Welcome, ${username}!` : 'Email linked!'}
            </h1>
            <p className="text-foreground-secondary">
              {username ? 'Your account has been created successfully.' : 'Your email has been linked to your account.'}
            </p>
          </div>

          <p className="text-sm text-foreground-muted">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  // Error
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Something went wrong</h2>
            <p className="text-foreground-secondary">{error || 'An unexpected error occurred'}</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleGoBack}
              className="flex-1 px-4 py-2 border border-border-hover text-foreground-secondary rounded-md hover:bg-card-hover transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={handleRetry}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
            >
              Request New Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
