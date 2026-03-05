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
 *                      MultiAuthAccountContract → Aztec Account
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

const OAUTH_DOMAIN = 'aztec.network/private-cloak/oauth/v2';
const OAUTH_DOMAIN_V3 = 'aztec.network/private-cloak/oauth/v3';

export class OAuthKeyDerivation {
  static deriveKeys(sub: string): DerivedKeys {
    const encoder = new TextEncoder();
    const ikm = encoder.encode(sub);

    const secretKeyBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN}/secret`, 'aztec-secret-key', 32);
    const signingKeyBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN}/signing`, 'aztec-signing-key', 32);
    const saltBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN}/salt/v2`, 'aztec-salt', 32);

    return {
      secretKey: new Uint8Array(secretKeyBytes),
      signingKey: new Uint8Array(signingKeyBytes),
      salt: new Uint8Array(saltBytes),
    };
  }

  static deriveKeysWithSalt(sub: string, serverSalt: string): DerivedKeys {
    const encoder = new TextEncoder();
    const ikm = encoder.encode(sub + ':' + serverSalt);

    const secretKeyBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN_V3}/secret`, 'aztec-secret-key', 32);
    const signingKeyBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN_V3}/signing`, 'aztec-signing-key', 32);
    const saltBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN_V3}/salt/v1`, 'aztec-salt', 32);

    return {
      secretKey: new Uint8Array(secretKeyBytes),
      signingKey: new Uint8Array(signingKeyBytes),
      salt: new Uint8Array(saltBytes),
    };
  }

  static deriveKeysWithDomain(sub: string, domain: string): DerivedKeys {
    const encoder = new TextEncoder();
    const subBytes = encoder.encode(sub);
    const domainBytes = encoder.encode(domain.toLowerCase());
    const ikm = new Uint8Array(subBytes.length + domainBytes.length);
    ikm.set(subBytes, 0);
    ikm.set(domainBytes, subBytes.length);

    const secretKeyBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN}/domain/secret`, 'aztec-secret-key', 32);
    const signingKeyBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN}/domain/signing`, 'aztec-signing-key', 32);
    const saltBytes = hkdf(sha256, ikm, `${OAUTH_DOMAIN}/domain/salt/v2`, 'aztec-salt', 32);

    return {
      secretKey: new Uint8Array(secretKeyBytes),
      signingKey: new Uint8Array(signingKeyBytes),
      salt: new Uint8Array(saltBytes),
    };
  }

  static wipeKeys(keys: DerivedKeys): void {
    keys.secretKey.fill(0);
    keys.signingKey.fill(0);
    keys.salt.fill(0);
  }
}
