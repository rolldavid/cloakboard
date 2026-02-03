'use client';

/**
 * Magic Link Form Component
 *
 * Email input form for requesting magic links.
 */

import React, { useState } from 'react';
import { MagicLinkService } from '@/lib/auth/magic-link/MagicLinkService';


interface MagicLinkFormProps {
  onSuccess?: (email: string) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

export function MagicLinkForm({ onSuccess, onError, onCancel }: MagicLinkFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate email
    if (!MagicLinkService.validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const result = await MagicLinkService.requestMagicLink(email);

      if (result.success) {
        MagicLinkService.storePendingLink(email);
        onSuccess?.(email);
      } else {
        setError(result.error || 'Failed to send magic link');
        onError?.(result.error || 'Failed to send magic link');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send magic link';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Sign in with Email</h2>
        <p className="text-foreground-secondary">
          We&apos;ll send you a magic link to sign in instantly.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-status-error/10 border border-status-error/20 text-status-error rounded-md text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground-secondary mb-1">
          Email Address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          disabled={isLoading}
          required
        />
      </div>

      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-border text-foreground-secondary rounded-md hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading || !email}
          className="flex-1 px-4 py-3 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Sending...</span>
            </>
          ) : (
            <span>Send Magic Link</span>
          )}
        </button>
      </div>
    </form>
  );
}
