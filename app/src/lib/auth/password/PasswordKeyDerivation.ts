/**
 * Password Key Derivation
 *
 * Derives Aztec keys from email + password (fully client-side).
 * Security model: email is identity, password provides entropy.
 * No server involvement, no email sending.
 *
 * Key derivation:
 * password (IKM) + email (salt) -> HKDF -> DerivedKeys
 *                                    |
 *                      SchnorrAccountContract -> Aztec Account
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

const PASSWORD_DOMAIN = 'aztec.network/private-cloak/password/v1';

export class PasswordKeyDerivation {
  /**
   * Derive Aztec keys from email + password
   *
   * @param email - User's email address (identity)
   * @param password - User's password (entropy)
   * @returns DerivedKeys for SchnorrAccountContract
   */
  static deriveKeys(email: string, password: string): DerivedKeys {
    const encoder = new TextEncoder();
    const normalizedEmail = email.toLowerCase().trim();
    const ikm = encoder.encode(password);
    const emailSalt = encoder.encode(`${PASSWORD_DOMAIN}/salt/${normalizedEmail}`);

    return {
      secretKey:  new Uint8Array(hkdf(sha256, ikm, emailSalt, 'aztec-secret-key', 32)),
      signingKey: new Uint8Array(hkdf(sha256, ikm, emailSalt, 'aztec-signing-key', 32)),
      salt:       new Uint8Array(hkdf(sha256, ikm, emailSalt, 'aztec-salt', 32)),
    };
  }

  /**
   * Hash email for privacy-preserving storage
   */
  static async hashEmail(email: string): Promise<string> {
    const data = new TextEncoder().encode(email.toLowerCase().trim());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
