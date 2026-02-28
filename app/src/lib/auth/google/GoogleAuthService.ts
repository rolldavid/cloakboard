/**
 * Google Auth Service
 *
 * Handles Google OAuth flow for authentication.
 * Privacy: Email is NEVER stored or sent on-chain.
 *
 * HIGH-4: JWT signature is now cryptographically verified using Google's JWKS.
 */

import type { GoogleOAuthData } from '@/types/wallet';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_REDIRECT_URI = typeof window !== 'undefined'
  ? `${window.location.origin}/onboarding/google`
  : '';

// Cache the JWKS keyset (jose handles key rotation internally)
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getGoogleJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  }
  return _jwks;
}

export class GoogleAuthService {
  static isConfigured(): boolean {
    return !!GOOGLE_CLIENT_ID;
  }

  static initiateOAuthFlow(): void {
    const state = this.generateNonce();
    sessionStorage.setItem('oauth_csrf_state', state);

    const nonce = this.generateNonce();
    sessionStorage.setItem('oauth_nonce', nonce);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'id_token',
      scope: 'openid email profile',
      prompt: 'select_account',
      nonce,
      state,
    });

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  // Cache the hash fragment eagerly so React 18 StrictMode double-mount
  // doesn't lose it (the first run clears the URL hash via replaceState).
  private static _cachedHash: string | null = null;

  static captureHash(): void {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.substring(1);
    if (hash) {
      this._cachedHash = hash;
    }
  }

  static parseOAuthCallback(): { idToken: string } | null {
    if (typeof window === 'undefined') return null;

    const hash = this._cachedHash || window.location.hash.substring(1);
    if (!hash) {
      console.warn('[GoogleAuth] No hash fragment in callback URL');
      return null;
    }

    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      console.error('[GoogleAuth] OAuth error:', error, params.get('error_description'));
      return null;
    }

    if (!idToken) {
      console.warn('[GoogleAuth] No id_token in hash. Hash params:', Array.from(params.keys()));
      return null;
    }

    // LOW-1: Enforce strict state validation -- reject if expected state is missing
    const expectedState = sessionStorage.getItem('oauth_csrf_state');
    sessionStorage.removeItem('oauth_csrf_state');
    if (!expectedState || !state || state !== expectedState) {
      console.error('[GoogleAuth] State mismatch -- possible CSRF');
      return null;
    }

    // Clean up: clear URL hash and cached value
    this._cachedHash = null;
    window.history.replaceState(null, '', window.location.pathname);
    return { idToken };
  }

  static decodeIdToken(idToken: string): GoogleOAuthData {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid ID token format');

    const payload = JSON.parse(this.base64UrlDecode(parts[1]));
    if (!payload.sub) throw new Error('Missing sub claim');
    if (!payload.email) throw new Error('Missing email claim');

    return {
      idToken,
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      domain: this.extractDomain(payload.email),
    };
  }

  static extractDomain(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');
    return parts[1].toLowerCase();
  }

  static isOrganizationDomain(domain: string): boolean {
    const freeProviders = [
      'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
      'outlook.com', 'live.com', 'icloud.com', 'protonmail.com',
      'proton.me', 'aol.com', 'zoho.com',
    ];
    return !freeProviders.includes(domain.toLowerCase());
  }

  private static generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private static base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) base64 += '='.repeat(4 - padding);
    return atob(base64);
  }

  /**
   * HIGH-4: Validate the ID token signature using Google's JWKS endpoint.
   * This cryptographically verifies the token was issued by Google.
   */
  static async validateIdToken(idToken: string): Promise<boolean> {
    try {
      const jwks = getGoogleJWKS();

      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: GOOGLE_CLIENT_ID || undefined,
      });

      // Check expiry (jose already checks this, but be explicit)
      if (payload.exp && payload.exp * 1000 < Date.now()) return false;

      // Verify sub claim exists
      if (!payload.sub) return false;

      return true;
    } catch (err) {
      console.error('[GoogleAuth] JWT verification failed:', err);
      return false;
    }
  }

  static storeOAuthData(data: GoogleOAuthData): void {
    sessionStorage.setItem('oauth_data', JSON.stringify({
      sub: data.sub,
      domain: data.domain,
      emailVerified: data.emailVerified,
    }));
  }

  static getStoredOAuthData(): Partial<GoogleOAuthData> | null {
    try {
      const stored = sessionStorage.getItem('oauth_data');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  }

  static clearStoredOAuthData(): void {
    sessionStorage.removeItem('oauth_data');
  }
}
