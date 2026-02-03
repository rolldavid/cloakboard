'use client';

/**
 * Passkey Onboarding Page
 *
 * Flow:
 * 1. Register passkey with Face ID/Touch ID
 * 2. Auto-assign username
 * 3. Show welcome screen
 * 4. Redirect to dashboard
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PasskeyAuth } from '@/components/auth/PasskeyAuth';
import { getAuthManager } from '@/lib/auth/AuthManager';
import { getDefaultNetwork } from '@/lib/config/networks';
import { LoadingOwl } from '@/components/ui/LoadingOwl';
import type { PasskeyCredential } from '@/lib/auth/types';

type Step = 'register' | 'welcome' | 'error';

export default function PasskeyOnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('register');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePasskeySuccess = async (credential: PasskeyCredential) => {
    setIsProcessing(true);

    try {
      const network = getDefaultNetwork();
      const authManager = getAuthManager(network);
      await authManager.initialize();

      const result = await authManager.authenticateWithPasskey(credential);

      setUsername(result.username);
      setStep('welcome');

      // Auto-redirect after showing welcome
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (err) {
      console.error('Passkey auth error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setStep('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    router.push('/onboarding');
  };

  const handleRetry = () => {
    setError(null);
    setStep('register');
  };

  // Welcome screen
  if (step === 'welcome' && username) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-8">
            <div className="w-24 h-24 bg-status-success/10 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
              <svg className="w-12 h-12 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Welcome, {username}!
            </h1>
            <p className="text-foreground-secondary">
              Your passkey has been set up successfully.
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

  // Error screen
  if (step === 'error') {
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
              <p className="text-foreground-secondary">{error}</p>
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

  // Registration screen
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          {isProcessing ? (
            <div className="text-center py-8">
              <LoadingOwl text="Setting up your account" />
            </div>
          ) : (
            <PasskeyAuth
              mode="register"
              onSuccess={handlePasskeySuccess}
              onCancel={handleCancel}
              onError={(err) => {
                setError(err.message);
                setStep('error');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
