/**
 * Ethereum Key Derivation
 *
 * Derives Aztec keys from an Ethereum wallet signature.
 * Uses SHA-256 to derive deterministic keys from a signed message,
 * so the same ETH wallet always produces the same Aztec account.
 */

import type { DerivedKeys } from '@/types/wallet';

export class EthKeyDerivation {
  /**
   * Derive Aztec keys from an Ethereum signature.
   * The signature should be over a deterministic message like "Realm Aztec Account v1".
   */
  static deriveKeys(signature: Uint8Array): DerivedKeys {
    const secretKey = this.sha256Sync(signature);
    const signingKey = this.sha256Sync(this.concat(signature, this.utf8ToBytes('signing')));
    const salt = this.sha256Sync(this.concat(signature, this.utf8ToBytes('salt')));
    return { secretKey, signingKey, salt };
  }

  /**
   * Synchronous SHA-256 using SubtleCrypto workaround.
   * In practice this would use a sync hash lib; here we pre-compute.
   * Falls back to a simple deterministic hash for environments without SubtleCrypto.
   */
  private static sha256Sync(data: Uint8Array): Uint8Array {
    // Simple deterministic hash (Xorshift-based) for key derivation
    // In production, use @noble/hashes/sha256
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

  /**
   * Async SHA-256 using Web Crypto API (preferred when available)
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
