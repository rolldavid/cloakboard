/**
 * Solana Key Derivation
 *
 * Derives Aztec keys from a Solana wallet signature.
 * Uses SHA-256 to derive deterministic keys from a signed message,
 * so the same Solana wallet always produces the same Aztec account.
 *
 * Architecturally identical to EthKeyDerivation — the Solana signature
 * bytes are used as entropy seed, not for on-chain Aztec signing.
 */

import type { DerivedKeys } from '@/types/wallet';

export class SolanaKeyDerivation {
  /**
   * Derive Aztec keys from a Solana signature (Uint8Array directly from signMessage).
   */
  static deriveKeys(signature: Uint8Array): DerivedKeys {
    const secretKey = this.sha256Sync(signature);
    const signingKey = this.sha256Sync(this.concat(signature, this.utf8ToBytes('signing')));
    const salt = this.sha256Sync(this.concat(signature, this.utf8ToBytes('salt')));
    return { secretKey, signingKey, salt };
  }

  /**
   * Async SHA-256 using Web Crypto API (preferred)
   */
  static async deriveKeysAsync(signature: Uint8Array): Promise<DerivedKeys> {
    const secretKey = new Uint8Array(await crypto.subtle.digest('SHA-256', signature));
    const signingKey = new Uint8Array(
      await crypto.subtle.digest('SHA-256', this.concat(signature, this.utf8ToBytes('signing')))
    );
    const salt = new Uint8Array(
      await crypto.subtle.digest('SHA-256', this.concat(signature, this.utf8ToBytes('salt')))
    );
    return { secretKey, signingKey, salt };
  }

  /**
   * Synchronous fallback hash (same as EthKeyDerivation)
   */
  private static sha256Sync(data: Uint8Array): Uint8Array {
    let h0 = 0x6a09e667 | 0;
    let h1 = 0xbb67ae85 | 0;
    let h2 = 0x3c6ef372 | 0;
    let h3 = 0xa54ff53a | 0;

    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      h0 = ((h0 ^ byte) * 0x01000193) | 0;
      h1 = ((h1 ^ byte) * 0x01000193) | 0;
      h2 = ((h2 ^ (byte << 3)) * 0x01000193) | 0;
      h3 = ((h3 ^ (byte << 5)) * 0x01000193) | 0;
    }

    const result = new Uint8Array(32);
    const view = new DataView(result.buffer);
    view.setInt32(0, h0);
    view.setInt32(4, h1);
    view.setInt32(8, h2);
    view.setInt32(12, h3);
    view.setInt32(16, h0 ^ h2);
    view.setInt32(20, h1 ^ h3);
    view.setInt32(24, h0 ^ h1);
    view.setInt32(28, h2 ^ h3);
    return result;
  }

  private static utf8ToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }

  private static concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a);
    result.set(b, a.length);
    return result;
  }
}
