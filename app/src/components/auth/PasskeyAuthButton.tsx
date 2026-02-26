import { useState } from 'react';
import { PasskeyAuthService } from '@/lib/auth/passkey/PasskeyAuthService';
import { PasskeyKeyDerivation } from '@/lib/auth/passkey/PasskeyKeyDerivation';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

export function PasskeyAuthButton() {
  const { completeAuth } = useAuthCompletion();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasCredentials = PasskeyAuthService.hasStoredCredentials();
  const supported = PasskeyAuthService.isSupported();

  async function handleClick() {
    if (!supported) return;
    setError(null);
    setLoading(true);

    try {
      let credentialId: string;
      if (hasCredentials) {
        credentialId = await PasskeyAuthService.authenticate();
      } else {
        credentialId = await PasskeyAuthService.register();
      }

      PasskeyAuthService.storeSession(credentialId);
      const keys = PasskeyKeyDerivation.deriveKeys(credentialId);
      await completeAuth(keys, 'passkey', credentialId);
    } catch (err: any) {
      setError(err?.message || 'Passkey authentication failed');
      setLoading(false);
    }
  }

  if (!supported) return null;

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="block w-full p-4 rounded-lg border border-border hover:border-border-hover hover:bg-card-hover transition-all text-left disabled:opacity-50"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="font-semibold text-foreground">
              {loading ? 'Waiting for device...' : hasCredentials ? 'Sign in with Passkey' : 'Set up Passkey'}
            </span>
            <p className="text-sm text-foreground-secondary">
              {hasCredentials ? 'Touch ID, Face ID, or Windows Hello' : 'Use biometrics to create an account'}
            </p>
          </div>
          <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
      {error && (
        <p className="mt-2 text-sm text-status-error px-4">{error}</p>
      )}
    </div>
  );
}
