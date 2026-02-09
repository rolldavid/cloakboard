'use client';

/**
 * Google OAuth Onboarding Page (Passwordless)
 *
 * Flow:
 * 1. Show "Sign in with Google" button
 * 2. Parse OAuth callback (id_token in URL hash)
 * 3. Create wallet automatically (no password needed)
 * 4. Show welcome screen
 * 5. Redirect to dashboard
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';
import { getAuthManager } from '@/lib/auth/AuthManager';
import { getDefaultNetwork } from '@/lib/config/networks';
import { LoadingOwl } from '@/components/ui/LoadingOwl';
import type { GoogleOAuthData } from '@/lib/auth/types';

type Step = 'loading' | 'init' | 'creating' | 'welcome' | 'link-success' | 'error';

export default function GoogleOnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use ref to prevent double-processing in React Strict Mode
  const processingRef = useRef(false);

  // Parse OAuth callback and create wallet on mount
  useEffect(() => {
    let mounted = true;

    const processOAuth = async () => {
      // Prevent double-processing (React Strict Mode runs effects twice)
      if (processingRef.current) {
        return;
      }

      // Check URL hash BEFORE marking as processing
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const hasToken = hash.includes('id_token=');

      if (!hasToken) {
        // No callback, show init screen to start OAuth
        if (mounted) setStep('init');
        return;
      }

      // Mark as processing before parsing (which clears the hash)
      processingRef.current = true;

      const callback = GoogleAuthService.parseOAuthCallback();

      if (!callback?.idToken) {
        // Token parsing failed
        processingRef.current = false;
        if (mounted) setStep('init');
        return;
      }

      try {
        const oauthData = GoogleAuthService.decodeIdToken(callback.idToken);

        if (mounted) setStep('creating');

        const network = getDefaultNetwork();
        const authManager = getAuthManager(network);
        await authManager.initialize();

        // Check if this is a link-account flow
        const flowType = sessionStorage.getItem('oauth_flow_type');
        sessionStorage.removeItem('oauth_flow_type');

        if (flowType === 'link-account') {
          // Complete Google account linking
          await authManager.completeGoogleLink(oauthData);

          if (mounted) {
            setStep('link-success');
          }

          await new Promise(resolve => setTimeout(resolve, 1500));
          router.push('/');
        } else {
          // Normal signup/login flow
          const result = await authManager.authenticateWithGoogle(oauthData);

          sessionStorage.setItem('auth_username', result.username);

          if (mounted) {
            setUsername(result.username);
            setStep('welcome');
          }

          await new Promise(resolve => setTimeout(resolve, 1500));
          router.push('/');
        }
      } catch (err) {
        console.error('[Google Auth] Error:', err);
        processingRef.current = false;
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to process Google sign-in');
          setStep('error');
        }
      }
    };

    processOAuth();

    return () => {
      mounted = false;
    };
  }, [router]);

  const handleCancel = () => {
    router.push('/onboarding');
  };

  const handleRetry = () => {
    setError(null);
    setStep('init');
  };

  // Loading
  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <LoadingOwl text="Processing" />
      </div>
    );
  }

  // Init - Start OAuth
  if (step === 'init') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card rounded-lg shadow-sm border border-border p-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-accent" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Sign in with Google</h2>
              <p className="text-foreground-secondary">
                One click to create your Cloakboard account.
              </p>
            </div>

            <GoogleAuthButton variant="primary" size="large" className="w-full mb-4" />

            <button
              onClick={handleCancel}
              className="w-full px-4 py-2 text-foreground-secondary hover:text-foreground transition-colors"
            >
              Go Back
            </button>

            <div className="mt-6 p-4 bg-status-success/10 rounded-md">
              <h4 className="font-medium text-foreground mb-2">Privacy Protected</h4>
              <ul className="text-sm text-foreground-secondary space-y-1">
                <li>Your email is never stored on-chain</li>
                <li>Only domain verified via ZK proof</li>
                <li>No password needed</li>
              </ul>
            </div>
          </div>
        </div>
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
  if (step === 'welcome' && username) {
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
              Welcome, {username}!
            </h1>
            <p className="text-foreground-secondary">
              Your account has been created successfully.
            </p>
          </div>

          <div className="bg-card rounded-lg shadow-sm border border-border p-6">
            <div className="flex items-center justify-center gap-2 text-foreground-secondary">
              <LoadingOwl />
              <span>Redirecting to dashboard...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Link success
  if (step === 'link-success') {
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
              Google account linked!
            </h1>
            <p className="text-foreground-secondary">
              You can now sign in with Google.
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
              onClick={handleCancel}
              className="flex-1 px-4 py-2 border border-border-hover text-foreground-secondary rounded-md hover:bg-card-hover transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={handleRetry}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
