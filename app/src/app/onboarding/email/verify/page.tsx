'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmailService } from '@/lib/auth/email/EmailService';
import { getDefaultNetwork } from '@/lib/config/networks';
import { CloakLogo } from '@/components/ui/CloakLogo';

type VerifyStatus = 'verifying' | 'need_email' | 'authenticating' | 'complete' | 'error';

export default function EmailVerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<VerifyStatus>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Step 1: Verify the magic link token
  useEffect(() => {
    if (!token) {
      setError('No token found in URL');
      setStatus('error');
      return;
    }

    let cancelled = false;

    const verify = async () => {
      try {
        const st = await EmailService.verifyToken(token);
        if (cancelled) return;

        setSessionToken(st);

        // Check if we have the email from localStorage (same browser)
        const flowState = EmailService.getFlowState();
        if (flowState?.email) {
          setEmail(flowState.email);
          // Proceed to OPRF automatically
          await performAuth(flowState.email, st);
        } else {
          // Different browser/device — need email input
          setStatus('need_email');
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || 'Failed to verify link');
        setStatus('error');
      }
    };

    verify();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Step 2: OPRF + authenticate
  const performAuth = useCallback(async (userEmail: string, st: string) => {
    setStatus('authenticating');
    setError(null);

    try {
      // OPRF exchange
      const keys = await EmailService.performOPRF(userEmail, st);

      // Authenticate with AuthManager
      const { getAuthManager } = await import('@/lib/auth/AuthManager');
      const authManager = getAuthManager(getDefaultNetwork());
      await authManager.initialize();
      await authManager.authenticateWithEmail(userEmail, keys);

      // Cleanup
      EmailService.clearFlowState();
      setStatus('complete');
      router.push('/dashboard');
    } catch (err: any) {
      console.error('[EmailVerify] Auth error:', err);
      setError(err.message || 'Authentication failed');
      setStatus('error');
    }
  }, [router]);

  // Handle manual email submission (new device flow)
  const handleEmailSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EmailService.validateEmail(email) || !sessionToken) return;
    await performAuth(email, sessionToken);
  }, [email, sessionToken, performAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <CloakLogo size="lg" />
          </div>
        </div>

        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          {status === 'verifying' && (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-purple-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <p className="text-foreground font-medium">Verifying your link...</p>
            </div>
          )}

          {status === 'need_email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-foreground">Enter your email</h2>
                <p className="text-sm text-foreground-secondary mt-1">
                  Looks like you opened this on a different device. Enter the email you used to sign in.
                </p>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
                autoFocus
              />
              <button
                type="submit"
                disabled={!EmailService.validateEmail(email)}
                className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                Continue
              </button>
            </form>
          )}

          {status === 'authenticating' && (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-purple-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <p className="text-foreground font-medium">Setting up your account...</p>
              <p className="text-sm text-foreground-secondary">Deriving keys securely</p>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-foreground font-medium">Something went wrong</p>
              <p className="text-sm text-status-error">{error}</p>
              <button
                type="button"
                onClick={() => router.push('/onboarding/email')}
                className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'complete' && (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-foreground font-medium">You&apos;re in!</p>
              <p className="text-sm text-foreground-secondary">Redirecting to dashboard...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
