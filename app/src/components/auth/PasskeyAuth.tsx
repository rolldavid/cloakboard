'use client';

/**
 * Passkey Authentication Component
 *
 * Handles passkey registration and authentication with Face ID/Touch ID.
 */

import React, { useState, useEffect } from 'react';
import { PasskeyService } from '@/lib/auth/passkey/PasskeyService';
import type { PasskeyCredential } from '@/lib/auth/types';


interface PasskeyAuthProps {
  mode: 'register' | 'authenticate';
  displayName?: string;
  onSuccess: (credential: PasskeyCredential) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

export function PasskeyAuth({
  mode,
  displayName = 'Realm User',
  onSuccess,
  onError,
  onCancel,
}: PasskeyAuthProps) {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isPlatformAvailable, setIsPlatformAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(displayName);

  useEffect(() => {
    const checkSupport = async () => {
      const supported = PasskeyService.isSupported();
      setIsSupported(supported);

      if (supported) {
        const platformAvailable = await PasskeyService.isPlatformAuthenticatorAvailable();
        setIsPlatformAvailable(platformAvailable);
      }
    };

    checkSupport();
  }, []);

  const handleRegister = async () => {
    if (!name.trim()) {
      setError('Please enter a display name');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const credential = await PasskeyService.register({
        displayName: name.trim(),
      });

      // Store credential for later authentication
      PasskeyService.storeCredential(credential);

      onSuccess(credential);
    } catch (err) {
      // Check if user cancelled the WebAuthn dialog
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        setIsLoading(false);
        // Call onCancel if available, otherwise just reset state
        if (onCancel) {
          onCancel();
        }
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Failed to register passkey';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get stored credential IDs
      const storedIds = PasskeyService.listStoredCredentialIds();

      if (storedIds.length === 0) {
        throw new Error('No passkey found. Please register first.');
      }

      // Try to authenticate with the first stored credential
      const credential = await PasskeyService.authenticate({
        credentialId: storedIds[0],
      });

      // Get the full stored credential with public key
      const storedCredential = PasskeyService.getStoredCredential(credential.credentialId);
      if (storedCredential) {
        onSuccess(storedCredential);
      } else {
        onSuccess(credential);
      }
    } catch (err) {
      // Check if user cancelled the WebAuthn dialog
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        setIsLoading(false);
        // Call onCancel if available, otherwise just reset state
        if (onCancel) {
          onCancel();
        }
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Failed to authenticate';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsLoading(false);
    }
  };

  // Not supported
  if (isSupported === false) {
    return (
      <div className="text-center p-6">
        <div className="w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">Passkey Not Supported</h3>
        <p className="text-foreground-secondary mb-4">
          Your browser doesn&apos;t support passkeys. Please try a different browser or authentication method.
        </p>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-accent hover:text-accent"
          >
            Go Back
          </button>
        )}
      </div>
    );
  }

  // Still checking support
  if (isSupported === null || isPlatformAvailable === null) {
    return (
      <div className="text-center p-6">
        <div className="w-16 h-16 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4 animate-shimmer">
          <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-foreground-secondary">Checking passkey support...</p>
      </div>
    );
  }

  // Registration mode
  if (mode === 'register') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-20 h-20 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Set Up Passkey</h2>
          <p className="text-foreground-secondary">
            {isPlatformAvailable
              ? 'Use Face ID, Touch ID, or your device\'s biometric authentication.'
              : 'Use a security key or your device\'s authentication.'}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-status-error/10 border border-status-error/20 text-status-error rounded-md text-sm">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-foreground-secondary mb-1">
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
            disabled={isLoading}
          />
          <p className="mt-1 text-xs text-foreground-muted">
            This name is stored on your device only.
          </p>
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
            type="button"
            onClick={handleRegister}
            disabled={isLoading || !name.trim()}
            className="flex-1 px-4 py-3 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                <span>Registering...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                <span>Register Passkey</span>
              </>
            )}
          </button>
        </div>

        <div className="bg-accent-muted rounded-md p-4">
          <h4 className="font-medium text-accent mb-2">Why passkeys?</h4>
          <ul className="text-sm text-accent space-y-1">
            <li>• No password to remember</li>
            <li>• Phishing resistant</li>
            <li>• Biometric security</li>
            <li>• Works across devices</li>
          </ul>
        </div>
      </div>
    );
  }

  // Authentication mode
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Unlock with Passkey</h2>
        <p className="text-foreground-secondary">
          {isPlatformAvailable
            ? 'Use Face ID, Touch ID, or your device\'s biometric to unlock.'
            : 'Use your security key to unlock.'}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-status-error/10 border border-status-error/20 text-status-error rounded-md text-sm">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleAuthenticate}
        disabled={isLoading}
        className="w-full px-4 py-3 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <span>Authenticating...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Unlock</span>
          </>
        )}
      </button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="w-full px-4 py-2 text-foreground-secondary hover:text-foreground transition-colors disabled:opacity-50"
        >
          Try another method
        </button>
      )}
    </div>
  );
}
