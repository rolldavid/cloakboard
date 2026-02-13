/**
 * Email Service
 *
 * Client-side orchestration for magic link + OPRF email auth:
 * 1. Send magic link email
 * 2. Verify magic link token
 * 3. Perform OPRF key derivation
 * 4. Manage cross-tab flow state via localStorage
 */

import { EmailKeyDerivation } from './EmailKeyDerivation';
import type { DerivedKeys } from '@/types/wallet';

const FLOW_STATE_KEY = 'private-cloak-email-flow';

interface FlowState {
  email: string;
  startedAt: number;
}

export class EmailService {
  /**
   * Validate email format (same regex as old PasswordService).
   */
  static validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  /**
   * Send a magic link email via the server.
   */
  static async sendMagicLink(email: string): Promise<void> {
    const res = await fetch('/api/auth/magic-link/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.toLowerCase().trim() }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send magic link');
    }
  }

  /**
   * Verify a magic link token and get a session token.
   */
  static async verifyToken(token: string): Promise<string> {
    const res = await fetch('/api/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Invalid or expired link');
    }

    return data.sessionToken;
  }

  /**
   * Perform the full OPRF exchange and derive keys.
   *
   * 1. Blind the email
   * 2. Send blinded point to server with session token
   * 3. Receive evaluated point
   * 4. Unblind and derive keys via HKDF
   */
  static async performOPRF(email: string, sessionToken: string): Promise<DerivedKeys> {
    // Step 1: Blind
    const { blindedPoint, blindFactor } = EmailKeyDerivation.blind(email);

    // Step 2: Send to server
    const blindedHex = Array.from(blindedPoint)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const res = await fetch('/api/auth/oprf/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blindedPoint: blindedHex, sessionToken }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'OPRF evaluation failed');
    }

    // Step 3: Decode evaluated point
    const evalHex: string = data.evaluatedPoint;
    const evalBytes = new Uint8Array(evalHex.length / 2);
    for (let i = 0; i < evalHex.length; i += 2) {
      evalBytes[i / 2] = parseInt(evalHex.substring(i, i + 2), 16);
    }

    // Step 4: Unblind and derive keys
    return EmailKeyDerivation.finalize(evalBytes, blindFactor);
  }

  /**
   * Store email in localStorage for cross-tab flow continuity.
   * (User clicks magic link in same browser → verify page reads email from here.)
   */
  static storeFlowState(email: string): void {
    if (typeof window === 'undefined') return;
    const state: FlowState = { email: email.toLowerCase().trim(), startedAt: Date.now() };
    localStorage.setItem(FLOW_STATE_KEY, JSON.stringify(state));
  }

  /**
   * Read flow state from localStorage.
   * Returns null if expired (>15 min) or not found.
   */
  static getFlowState(): FlowState | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(FLOW_STATE_KEY);
      if (!raw) return null;
      const state: FlowState = JSON.parse(raw);
      // Expire after 15 minutes
      if (Date.now() - state.startedAt > 15 * 60 * 1000) {
        localStorage.removeItem(FLOW_STATE_KEY);
        return null;
      }
      return state;
    } catch {
      return null;
    }
  }

  /**
   * Clear flow state after successful auth.
   */
  static clearFlowState(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(FLOW_STATE_KEY);
  }
}
