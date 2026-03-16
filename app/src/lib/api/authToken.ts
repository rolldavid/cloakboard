/**
 * Client-side JWT token management for server authentication.
 *
 * CRITICAL-1: Challenge-response auth. On login, the client requests a challenge
 * nonce from the server, then verifies it to receive a JWT token. The token is
 * included in all subsequent API requests via the Authorization header.
 *
 * During the transition period, x-user-address and x-user-name headers are
 * still sent as fallback.
 */

import { apiUrl } from '@/lib/api';

let _authToken: string | null = null;

/** Get the current auth token (from memory, localStorage, or sessionStorage fallback). */
export function getAuthToken(): string | null {
  if (_authToken) return _authToken;
  try {
    _authToken = localStorage.getItem('duelcloak-auth-token');
  } catch { /* ignore */ }
  if (!_authToken) {
    try {
      _authToken = sessionStorage.getItem('duelcloak-auth-token');
    } catch { /* ignore */ }
  }
  return _authToken;
}

/** Store the auth token in memory, localStorage, and sessionStorage (fallback for Safari private browsing). */
export function setAuthToken(token: string | null): void {
  _authToken = token;
  try {
    if (token) localStorage.setItem('duelcloak-auth-token', token);
    else localStorage.removeItem('duelcloak-auth-token');
  } catch { /* ignore */ }
  try {
    if (token) sessionStorage.setItem('duelcloak-auth-token', token);
    else sessionStorage.removeItem('duelcloak-auth-token');
  } catch { /* ignore */ }
}

/** Clear the auth token. */
export function clearAuthToken(): void {
  setAuthToken(null);
}

export interface AuthResult {
  token: string;
  isReturning: boolean;
}

/**
 * Perform challenge-response authentication with the server.
 * Returns token + isReturning flag (whether the address has prior activity).
 */
export async function authenticateWithServer(address: string, name: string, signingKey?: BufferSource): Promise<AuthResult | null> {
  try {
    // 1. Request challenge nonce
    const challengeRes = await fetch(apiUrl('/api/auth/challenge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });

    if (!challengeRes.ok) {
      console.warn('[Auth] Challenge request failed:', challengeRes.status);
      return null;
    }

    const { nonce } = await challengeRes.json();

    // 2. Sign the nonce with HMAC-SHA256 using the signing key (proves key ownership)
    let signature: string | undefined;
    if (signingKey) {
      try {
        const key = await crypto.subtle.importKey(
          'raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
        );
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nonce));
        signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch {
        // Fall back to unsigned (session restore without signing key)
      }
    }

    // 3. Verify the challenge
    const verifyRes = await fetch(apiUrl('/api/auth/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, name, nonce, signature }),
    });

    if (!verifyRes.ok) {
      console.warn('[Auth] Verify request failed:', verifyRes.status);
      return null;
    }

    const { token, isReturning } = await verifyRes.json();
    setAuthToken(token);
    return { token, isReturning: isReturning ?? false };
  } catch (err) {
    console.warn('[Auth] Authentication failed:', err);
    return null;
  }
}

/**
 * Build auth headers for API requests.
 * Uses JWT Bearer token from challenge-response auth.
 */
export function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}
