/**
 * Google OAuth Callback Page
 *
 * Handles the redirect from Google OAuth, derives keys in browser,
 * and triggers background wallet creation.
 *
 * Privacy: OAuth token + key derivation happen entirely in browser.
 * Server NEVER sees the identity token.
 */

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { OAuthKeyDerivation } from '@/lib/auth/google/OAuthKeyDerivation';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';
import { fetchGoogleSalt } from '@/lib/api/duelClient';

// Capture hash fragment IMMEDIATELY at module load, before React 18
// StrictMode double-mount can clear it via replaceState.
GoogleAuthService.captureHash();

// Start PXE warmup immediately on callback page load.
// Google OAuth uses a full page redirect — warmup from main.tsx is lost.
// This runs in parallel with token parsing + key derivation below.
import { startPxeWarmup } from '@/lib/aztec/pxeWarmup';
startPxeWarmup();

type CallbackState =
  | { status: 'processing' }
  | { status: 'deriving' }
  | { status: 'success' }
  | { status: 'error'; message: string };

export function GoogleCallback() {
  const navigate = useNavigate();
  const { completeAuth } = useAuthCompletion();
  const [state, setState] = useState<CallbackState>({ status: 'processing' });
  const processedRef = useRef(false);

  useEffect(() => {
    // Guard against React 18 StrictMode double-mount.
    if (processedRef.current) return;
    processedRef.current = true;

    async function handleCallback() {
      try {
        // 1. Parse the OAuth callback
        console.log('[GoogleCallback] Parsing OAuth callback...');
        const result = GoogleAuthService.parseOAuthCallback();
        if (!result) {
          setState({ status: 'error', message: 'No OAuth response found. Please try signing in again.' });
          return;
        }
        console.log('[GoogleCallback] Token received, validating...');

        // 2. Validate the token
        const valid = await GoogleAuthService.validateIdToken(result.idToken);
        if (!valid) {
          setState({ status: 'error', message: 'Invalid or expired token. Please try again.' });
          return;
        }

        // 3. Decode token + store minimal session data
        const oauthData = GoogleAuthService.decodeIdToken(result.idToken);
        GoogleAuthService.storeOAuthData(oauthData);
        console.log('[GoogleCallback] Token valid, sub:', oauthData.sub.slice(0, 6) + '...');

        setState({ status: 'deriving' });

        // 3.5 Fetch server-side salt (cross-app protection)
        const salt = await fetchGoogleSalt(result.idToken);
        // Persist salt durably — sessionStorage is lost on tab close,
        // localStorage survives so session restore can use salted derivation.
        try { localStorage.setItem('duelcloak-googleSalt', salt); } catch { /* quota */ }

        // 4. Derive Aztec keys in browser with server salt
        const keys = OAuthKeyDerivation.deriveKeysWithSalt(oauthData.sub, salt);
        console.log('[GoogleCallback] Keys derived, completing auth...');

        // 5. Complete auth — sets store, queues background wallet creation, navigates home
        // Pass salt so username is derived from salted seed (sub alone can't reveal identity)
        await completeAuth(keys, 'google', oauthData.sub, salt);
        console.log('[GoogleCallback] Auth complete, navigated home');
        setState({ status: 'success' });
      } catch (err: any) {
        console.error('[GoogleCallback] Error:', err);
        setState({ status: 'error', message: err?.message || 'Authentication failed' });
      }
    }

    handleCallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <AnimatePresence mode="wait">
        {(state.status === 'processing' || state.status === 'deriving') && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="text-center space-y-3"
          >
            <Spinner />
            <p className="text-foreground-secondary">Signing in...</p>
          </motion.div>
        )}

        {state.status === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="text-center space-y-3"
          >
            <div className="w-12 h-12 mx-auto rounded-full bg-status-success/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-foreground font-medium">Authenticated</p>
            <p className="text-xs text-foreground-muted">Redirecting...</p>
          </motion.div>
        )}

        {state.status === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="text-center space-y-4"
          >
            <div className="w-12 h-12 mx-auto rounded-full bg-status-error/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-status-error font-medium">Authentication Failed</p>
            <p className="text-sm text-foreground-muted">{state.message}</p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-sm transition-colors"
            >
              Try Again
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-8 h-8 animate-spin text-accent mx-auto" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
