/**
 * Ethereum Auth Service
 *
 * Thin session storage wrapper for Ethereum wallet auth.
 * Privacy: Only the address is stored in session. No private keys.
 */

export class EthereumAuthService {
  static storeSession(address: string): void {
    sessionStorage.setItem('eth_auth', JSON.stringify({ address: address.toLowerCase() }));
  }

  static getStoredSession(): { address: string } | null {
    try {
      const stored = sessionStorage.getItem('eth_auth');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static clearSession(): void {
    sessionStorage.removeItem('eth_auth');
  }
}
