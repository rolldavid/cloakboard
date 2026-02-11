'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PasswordService } from '@/lib/auth/password/PasswordService';
import { getDefaultNetwork } from '@/lib/config/networks';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function EmailOnboardingPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'creating' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const emailValid = PasswordService.validateEmail(email);
  const strength = PasswordService.checkStrength(password);
  const strongEnough = PasswordService.isStrongEnough(password);
  const passwordsMatch = password === confirmPassword;
  const canSubmit = emailValid && strongEnough && passwordsMatch && confirmPassword.length > 0;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || status === 'creating') return;
    setError(null);
    setStatus('creating');

    try {
      const { getAuthManager } = await import('@/lib/auth/AuthManager');
      const authManager = getAuthManager(getDefaultNetwork());
      await authManager.initialize();
      await authManager.authenticateWithPassword(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      console.error('[EmailOnboarding] Error:', err);
      setError(err.message || 'Failed to create account');
      setStatus('error');
    }
  }, [canSubmit, status, email, password, router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <CloakLogo size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Sign in with Email</h1>
          <p className="text-foreground-secondary text-sm">
            Your email and password never leave your browser. Keys are derived locally.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-lg shadow-sm border border-border p-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
              autoFocus
              disabled={status === 'creating'}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="10+ characters"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
              disabled={status === 'creating'}
            />
            {password.length > 0 && (
              <div className="mt-1.5">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        strength.score >= level
                          ? level <= 1 ? 'bg-red-400' : level <= 2 ? 'bg-yellow-400' : 'bg-green-400'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    />
                  ))}
                </div>
                {strength.feedback && (
                  <p className="text-xs text-foreground-muted mt-0.5">{strength.feedback}</p>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground mb-1">
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-ring"
              disabled={status === 'creating'}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-status-error mt-0.5">Passwords do not match</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-status-error">{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit || status === 'creating'}
            className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {status === 'creating' ? 'Creating account...' : 'Continue'}
          </button>

          <button
            type="button"
            onClick={() => router.push('/onboarding')}
            className="w-full px-4 py-2 text-foreground-secondary text-sm hover:text-foreground transition-colors"
            disabled={status === 'creating'}
          >
            Back to sign in options
          </button>
        </form>
      </div>
    </div>
  );
}
