/**
 * Magic Link Service
 *
 * Handles magic link (passwordless email) authentication.
 *
 * Flow:
 * 1. User enters email
 * 2. Backend generates token, sends email with verify link
 * 3. User clicks link
 * 4. User sets local password
 * 5. Keys derived from email + password
 */

import type { MagicLinkRequest, MagicLinkVerification, MagicLinkData } from '../types';

// Token expiration (15 minutes)
const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

// Storage key for pending magic link
const PENDING_STORAGE_KEY = 'pending_magic_link';

export class MagicLinkService {
  /**
   * Request a magic link to be sent to email
   */
  static async requestMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          redirectUrl: typeof window !== 'undefined'
            ? `${window.location.origin}/onboarding/magic-link/verify`
            : undefined,
        } satisfies MagicLinkRequest),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.message || 'Failed to send magic link' };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Check if a token is valid (without consuming it)
   * Use this on page load to validate before showing password form
   */
  static async checkToken(token: string): Promise<{ email: string } | null> {
    try {
      const response = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return { email: data.email };
    } catch {
      return null;
    }
  }

  /**
   * Consume a magic link token (single use - call after password is set)
   */
  static async consumeToken(token: string): Promise<{ email: string } | null> {
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
        } satisfies Partial<MagicLinkVerification>),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return { email: data.email };
    } catch {
      return null;
    }
  }

  /**
   * @deprecated Use checkToken for validation, consumeToken after password set
   */
  static async verifyToken(token: string): Promise<{ email: string } | null> {
    return this.checkToken(token);
  }

  /**
   * Parse token from URL query parameters
   */
  static parseTokenFromUrl(): string | null {
    if (typeof window === 'undefined') return null;

    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  }

  /**
   * Store pending magic link data in sessionStorage
   */
  static storePendingLink(email: string): void {
    const data: MagicLinkData = {
      email: email.toLowerCase().trim(),
      token: '', // Token will be in email
      expiresAt: Date.now() + TOKEN_EXPIRY_MS,
    };
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Get pending magic link data
   */
  static getPendingLink(): MagicLinkData | null {
    try {
      const stored = sessionStorage.getItem(PENDING_STORAGE_KEY);
      if (!stored) return null;

      const data: MagicLinkData = JSON.parse(stored);

      // Check if expired
      if (data.expiresAt < Date.now()) {
        this.clearPendingLink();
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Clear pending magic link data
   */
  static clearPendingLink(): void {
    sessionStorage.removeItem(PENDING_STORAGE_KEY);
  }

  /**
   * Validate email format
   */
  static validateEmail(email: string): boolean {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Check if email is from a work/organization domain
   * (not a free email provider)
   */
  static isWorkEmail(email: string): boolean {
    const freeProviders = [
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
    ];

    const domain = email.toLowerCase().split('@')[1];
    return !freeProviders.includes(domain);
  }

  /**
   * Generate a secure random token (for server-side use)
   */
  static generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
