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

/**
 * Perform challenge-response authentication with the server.
 * Returns a JWT token on success.
 */
export async function authenticateWithServer(address: string, name: string): Promise<string | null> {
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

    // 2. Verify the challenge (in transition period, we don't need a signature)
    const verifyRes = await fetch(apiUrl('/api/auth/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, name, nonce }),
    });

    if (!verifyRes.ok) {
      console.warn('[Auth] Verify request failed:', verifyRes.status);
      return null;
    }

    const { token } = await verifyRes.json();
    setAuthToken(token);
    return token;
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
