/**
 * Google Auth Service
 *
 * Handles Google OAuth flow for authentication.
 * Extracts email domain for ZK domain proofs without revealing full email.
 *
 * Privacy guarantees:
 * - Email is NEVER stored or sent on-chain
 * - Only domain hash is stored (for gated Cloak verification)
 * - ZK proofs prove domain membership without revealing email
 */

import type { GoogleOAuthData } from '../types';

// Google OAuth configuration
// These should be environment variables in production
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_REDIRECT_URI = typeof window !== 'undefined'
  ? `${window.location.origin}/onboarding/google`
  : '';

export class GoogleAuthService {
  /**
   * Check if Google OAuth is configured
   */
  static isConfigured(): boolean {
    return !!GOOGLE_CLIENT_ID;
  }

  /**
   * Initiate Google OAuth flow
   * Redirects to Google's consent screen
   */
  static initiateOAuthFlow(): void {
    // Generate CSRF state token and store for validation on callback
    const state = this.generateNonce();
    sessionStorage.setItem('oauth_csrf_state', state);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'id_token',
      scope: 'openid email profile',
      nonce: this.generateNonce(),
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    window.location.href = authUrl;
  }

  /**
   * Parse OAuth callback from URL hash
   * Google returns tokens in the URL hash fragment
   */
  static parseOAuthCallback(): { idToken: string } | null {
    if (typeof window === 'undefined') return null;

    const hash = window.location.hash.substring(1);
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');
    const state = params.get('state');

    if (!idToken) return null;

    // Validate CSRF state
    const expectedState = sessionStorage.getItem('oauth_csrf_state');
    sessionStorage.removeItem('oauth_csrf_state');
    if (!state || state !== expectedState) {
      console.error('[GoogleAuth] Invalid OAuth state — possible CSRF');
      return null;
    }

    // Clear the hash from URL for security
    window.history.replaceState(null, '', window.location.pathname);

    return { idToken };
  }

  /**
   * Decode and validate JWT id_token
   * Returns user info including email and domain
   */
  static decodeIdToken(idToken: string): GoogleOAuthData {
    // JWT has three parts: header.payload.signature
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid ID token format');
    }

    try {
      // Decode payload (base64url)
      const payload = JSON.parse(this.base64UrlDecode(parts[1]));

      // Validate required claims
      if (!payload.sub) {
        throw new Error('Missing sub claim');
      }
      if (!payload.email) {
        throw new Error('Missing email claim');
      }

      // Extract domain from email
      const domain = this.extractDomain(payload.email);

      return {
        idToken,
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        domain,
      };
    } catch (error) {
      throw new Error('Failed to decode ID token');
    }
  }

  /**
   * Extract domain from email address
   */
  static extractDomain(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) {
      throw new Error('Invalid email format');
    }
    return parts[1].toLowerCase();
  }

  /**
   * Check if domain is a corporate/organization domain
   * (not a free email provider)
   */
  static isOrganizationDomain(domain: string): boolean {
    const freeEmailProviders = [
      'gmail.com',
      'googlemail.com',
      'yahoo.com',
      'yahoo.co.uk',
      'hotmail.com',
      'outlook.com',
      'live.com',
      'msn.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'protonmail.com',
      'proton.me',
      'zoho.com',
      'yandex.com',
      'mail.com',
      'gmx.com',
      'gmx.de',
      'tutanota.com',
    ];

    return !freeEmailProviders.includes(domain.toLowerCase());
  }

  /**
   * Generate a cryptographic nonce for OAuth
   */
  private static generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Decode base64url string
   */
  private static base64UrlDecode(str: string): string {
    // Add padding if needed
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }
    return atob(base64);
  }

  /**
   * Validate ID token signature (simplified)
   * In production, this should verify against Google's public keys
   */
  static async validateIdToken(idToken: string): Promise<boolean> {
    try {
      const payload = this.decodeIdToken(idToken);

      // Check expiration
      const parts = idToken.split('.');
      const decoded = JSON.parse(this.base64UrlDecode(parts[1]));

      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        return false;
      }

      // Check issuer
      if (decoded.iss !== 'https://accounts.google.com' && decoded.iss !== 'accounts.google.com') {
        return false;
      }

      // Check audience (client ID)
      if (GOOGLE_CLIENT_ID && decoded.aud !== GOOGLE_CLIENT_ID) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store OAuth data temporarily in sessionStorage
   * (cleared when setting password)
   */
  static storeOAuthData(data: GoogleOAuthData): void {
    sessionStorage.setItem('oauth_data', JSON.stringify({
      sub: data.sub,
      domain: data.domain,
      emailVerified: data.emailVerified,
      // Never store the full email or token
    }));
  }

  /**
   * Get stored OAuth data
   */
  static getStoredOAuthData(): Partial<GoogleOAuthData> | null {
    try {
      const stored = sessionStorage.getItem('oauth_data');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  /**
   * Clear stored OAuth data
   */
  static clearStoredOAuthData(): void {
    sessionStorage.removeItem('oauth_data');
  }
}
