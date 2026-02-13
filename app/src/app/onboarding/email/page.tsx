'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { EmailService } from '@/lib/auth/email/EmailService';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function EmailOnboardingPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'waiting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const emailValid = EmailService.validateEmail(email);
  const canSubmit = emailValid && status !== 'sending';

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setStatus('sending');

    try {
      await EmailService.sendMagicLink(email);
      EmailService.storeFlowState(email);
      setStatus('waiting');

      // Start 60-second cooldown for resend
      setCooldown(60);
      const interval = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      console.error('[EmailOnboarding] Error:', err);
      setError(err.message || 'Failed to send magic link');
      setStatus('error');
    }
  }, [canSubmit, email]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || !emailValid) return;
    setError(null);
    setStatus('sending');

    try {
      await EmailService.sendMagicLink(email);
      setStatus('waiting');
      setCooldown(60);
      const interval = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to resend');
      setStatus('error');
    }
  }, [cooldown, emailValid, email]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <CloakLogo size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Sign in with Email</h1>
          <p className="text-foreground-secondary text-sm">
            Passwordless sign in — we&apos;ll send you a magic link.
          </p>
        </div>

        {status === 'waiting' ? (
          <div className="bg-card rounded-lg shadow-sm border border-border p-6 space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Check your email</h2>
              <p className="text-sm text-foreground-secondary">
                We sent a magic link to <strong className="text-foreground">{email}</strong>
              </p>
              <p className="text-sm text-foreground-secondary mt-2">
                Click the link in the email to sign in. The link expires in 10 minutes.
              </p>
            </div>

            {error && (
              <p className="text-sm text-status-error text-center">{error}</p>
            )}

            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              className="w-full px-4 py-2.5 border border-border text-foreground-secondary rounded-md text-sm hover:bg-card-hover transition-colors disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend magic link'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStatus('idle');
                setError(null);
              }}
              className="w-full px-4 py-2 text-foreground-secondary text-sm hover:text-foreground transition-colors"
            >
              Use a different email
            </button>
          </div>
        ) : (
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
                disabled={status === 'sending'}
              />
            </div>

            {error && (
              <p className="text-sm text-status-error">{error}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending...' : 'Send Magic Link'}
            </button>

            <button
              type="button"
              onClick={() => router.push('/onboarding')}
              className="w-full px-4 py-2 text-foreground-secondary text-sm hover:text-foreground transition-colors"
              disabled={status === 'sending'}
            >
              Back to sign in options
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
