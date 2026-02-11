'use client';

/**
 * Onboarding Page
 *
 * Entry point for new users with multi-auth options:
 * - Passkey (recommended)
 * - Google OAuth
 * - Magic Link (email)
 *
 * For returning users, redirects to appropriate re-authentication page
 * based on their previously used auth method.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { AuthMethodSelector } from '@/components/auth/AuthMethodSelector';
import { AuthManager, type StoredAuthMethod } from '@/lib/auth/AuthManager';
import { LoadingOwl } from '@/components/ui/LoadingOwl';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function OnboardingPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [storedAuth, setStoredAuth] = useState<StoredAuthMethod | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [autoTriggerPasskey, setAutoTriggerPasskey] = useState(false);

  const isConnected = isAuthenticated;

  // Check for stored auth method on mount
  useEffect(() => {
    const stored = AuthManager.getStoredAuthMethod();
    setStoredAuth(stored);
    setCheckingAuth(false);

  }, []);

  // Redirect based on auth state
  useEffect(() => {
    if (checkingAuth) return;

    if (isConnected) {
      router.push('/');
    } else if (storedAuth) {
      // Returning user - redirect to appropriate re-auth page
      switch (storedAuth.method) {
        case 'google':
          router.push('/onboarding/google');
          break;
        case 'password':
          router.push('/onboarding/email');
          break;
        case 'passkey':
          // Auto-trigger passkey auth inline instead of redirecting
          setAutoTriggerPasskey(true);
          break;
        case 'solana':
          // Solana requires wallet click, just stay on page
          break;
        default:
          // Unknown method - stay on onboarding to choose
          break;
      }
    }
  }, [checkingAuth, isConnected, storedAuth, router]);

  // Show loading while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingOwl />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <CloakLogo size="lg" />
          </div>
          <p className="text-foreground-secondary">
            Cloakboard accounts are 100% private - nobody other than you sees how you logged in, including the app itself.
          </p>
        </div>

        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <AuthMethodSelector autoTriggerPasskey={autoTriggerPasskey} />
        </div>
      </div>
    </div>
  );
}
