/**
 * Solana Auth Service
 *
 * Thin session storage wrapper for Solana wallet auth.
 * Privacy: Only the public key is stored in session.
 */

export class SolanaAuthService {
  static storeSession(publicKey: string): void {
    sessionStorage.setItem('sol_auth', JSON.stringify({ publicKey }));
  }

  static getStoredSession(): { publicKey: string } | null {
    try {
      const stored = sessionStorage.getItem('sol_auth');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static clearSession(): void {
    sessionStorage.removeItem('sol_auth');
  }
}
