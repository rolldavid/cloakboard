'use client';

/**
 * Magic Link Request Page
 *
 * Flow:
 * 1. User enters email
 * 2. Magic link sent
 * 3. Show "check your email" screen
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagicLinkForm } from '@/components/auth/MagicLinkForm';

type Step = 'email' | 'sent';

export default function MagicLinkPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');

  const handleSuccess = (sentEmail: string) => {
    setEmail(sentEmail);
    setStep('sent');
  };

  const handleCancel = () => {
    router.push('/onboarding');
  };

  const handleResend = () => {
    setStep('email');
  };

  // Email sent confirmation
  if (step === 'sent') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card rounded-lg shadow-sm border border-border p-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-status-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Check Your Email</h2>
              <p className="text-foreground-secondary">
                We sent a magic link to<br />
                <span className="font-medium text-foreground">{email}</span>
              </p>
            </div>

            <div className="bg-accent-muted rounded-md p-4 mb-6">
              <h4 className="font-medium text-foreground mb-2">Next steps:</h4>
              <ol className="text-sm text-foreground-secondary space-y-1 list-decimal list-inside">
                <li>Open the email we sent</li>
                <li>Click the magic link</li>
                <li>Set a password for your wallet</li>
              </ol>
            </div>

            <div className="text-center text-sm text-foreground-muted mb-4">
              Didn&apos;t receive the email?
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2 border border-border-hover text-foreground-secondary rounded-md hover:bg-card-hover transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={handleResend}
                className="flex-1 px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
              >
                Resend Email
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Email input
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <MagicLinkForm
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  );
}
