/**
 * Magic Link Key Derivation
 *
 * Derives Aztec keys from email alone (passwordless).
 * Security model: email access = wallet access (suitable for Cloak voting)
 *
 * Key derivation:
 * email → HKDF → DerivedKeys
 *           ↓
 * SchnorrAccountContract → Aztec Account
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

// Domain separation for magic link key derivation
// Using v2 to ensure different keys from password-based v1
const MAGIC_LINK_DOMAIN = 'aztec.network/private-cloak/magic-link/v2';

export class MagicLinkKeyDerivation {
  /**
   * Derive Aztec keys from email (passwordless)
   *
   * @param email - User's email address
   * @returns DerivedKeys for SchnorrAccountContract
   */
  static deriveKeys(email: string): DerivedKeys {
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Use email as input keying material (passwordless)
    const encoder = new TextEncoder();
    const ikm = encoder.encode(normalizedEmail);

    // Derive secret key
    const secretKeyBytes = hkdf(
      sha256,
      ikm,
      `${MAGIC_LINK_DOMAIN}/secret`,
      'aztec-secret-key',
      32
    );

    // Derive signing key (for Schnorr)
    const signingKeyBytes = hkdf(
      sha256,
      ikm,
      `${MAGIC_LINK_DOMAIN}/signing`,
      'aztec-signing-key',
      32
    );

    // Derive salt
    const saltBytes = hkdf(
      sha256,
      ikm,
      `${MAGIC_LINK_DOMAIN}/salt`,
      'aztec-salt',
      32
    );

    return {
      secretKey: new Uint8Array(secretKeyBytes),
      signingKey: new Uint8Array(signingKeyBytes),
      salt: new Uint8Array(saltBytes),
    };
  }

  /**
   * Hash email for storage (privacy-preserving)
   */
  static async hashEmail(email: string): Promise<string> {
    const normalizedEmail = email.toLowerCase().trim();
    const encoder = new TextEncoder();
    const data = encoder.encode(normalizedEmail);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Extract domain from email
   */
  static extractDomain(email: string): string {
    const parts = email.toLowerCase().trim().split('@');
    if (parts.length !== 2) {
      throw new Error('Invalid email format');
    }
    return parts[1];
  }

  /**
   * Securely clear derived keys from memory
   */
  static wipeKeys(keys: DerivedKeys): void {
    keys.secretKey.fill(0);
    keys.signingKey.fill(0);
    keys.salt.fill(0);
  }
}
