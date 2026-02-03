/**
 * OAuth Key Derivation
 *
 * Derives Aztec keys from Google OAuth sub (user ID) alone (passwordless).
 * Security model: Google access = wallet access (suitable for Cloak voting)
 *
 * Key derivation:
 * Google OAuth → id_token (JWT) → sub
 *                                   ↓
 *                      HKDF(sub, "aztec/oauth/...") → DerivedKeys
 *                                   ↓
 *                      SchnorrAccountContract → Aztec Account
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

// Domain separation for OAuth key derivation
// Using v2 to ensure different keys from password-based v1
const OAUTH_DOMAIN = 'aztec.network/private-cloak/oauth/v2';

export class OAuthKeyDerivation {
  /**
   * Derive Aztec keys from Google sub (passwordless)
   *
   * @param sub - Google user ID (sub claim from JWT)
   * @returns DerivedKeys for SchnorrAccountContract
   */
  static deriveKeys(sub: string): DerivedKeys {
    // Use sub as input keying material (passwordless)
    const encoder = new TextEncoder();
    const ikm = encoder.encode(sub);

    // Derive secret key
    const secretKeyBytes = hkdf(
      sha256,
      ikm,
      `${OAUTH_DOMAIN}/secret`,
      'aztec-secret-key',
      32
    );

    // Derive signing key (for Schnorr)
    const signingKeyBytes = hkdf(
      sha256,
      ikm,
      `${OAUTH_DOMAIN}/signing`,
      'aztec-signing-key',
      32
    );

    // Derive salt
    const saltBytes = hkdf(
      sha256,
      ikm,
      `${OAUTH_DOMAIN}/salt`,
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
   * Derive keys with additional domain info for domain-gated Cloaks
   */
  static deriveKeysWithDomain(sub: string, domain: string): DerivedKeys {
    const encoder = new TextEncoder();
    const subBytes = encoder.encode(sub);
    const domainBytes = encoder.encode(domain.toLowerCase());

    const ikm = new Uint8Array(subBytes.length + domainBytes.length);
    ikm.set(subBytes, 0);
    ikm.set(domainBytes, subBytes.length);

    const secretKeyBytes = hkdf(
      sha256,
      ikm,
      `${OAUTH_DOMAIN}/domain/secret`,
      'aztec-secret-key',
      32
    );

    const signingKeyBytes = hkdf(
      sha256,
      ikm,
      `${OAUTH_DOMAIN}/domain/signing`,
      'aztec-signing-key',
      32
    );

    const saltBytes = hkdf(
      sha256,
      ikm,
      `${OAUTH_DOMAIN}/domain/salt`,
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
   * Securely clear derived keys from memory
   */
  static wipeKeys(keys: DerivedKeys): void {
    keys.secretKey.fill(0);
    keys.signingKey.fill(0);
    keys.salt.fill(0);
  }
}
