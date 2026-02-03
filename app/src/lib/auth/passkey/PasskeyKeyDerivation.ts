/**
 * Passkey Key Derivation
 *
 * Derives Aztec keys from WebAuthn P-256 public key and credential ID.
 *
 * Key derivation:
 * WebAuthn credential → { publicKey (P-256), credentialId }
 *                              ↓
 * HKDF(publicKey || credentialId, "aztec/passkey/...") → DerivedKeys
 *                              ↓
 * EcdsaRAccountContract(signingKey) → Aztec Account
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

// Domain separation for passkey key derivation
const PASSKEY_DOMAIN = 'aztec.network/private-cloak/passkey/v1';

export class PasskeyKeyDerivation {
  /**
   * Derive Aztec keys from passkey credential
   *
   * @param publicKey - P-256 public key from WebAuthn credential
   * @param credentialId - Credential ID from WebAuthn
   * @returns DerivedKeys for EcdsaRAccountContract
   */
  static deriveKeys(publicKey: Uint8Array, credentialId: string): DerivedKeys {
    // Combine public key and credential ID as input keying material
    const credentialIdBytes = new TextEncoder().encode(credentialId);
    const ikm = new Uint8Array(publicKey.length + credentialIdBytes.length);
    ikm.set(publicKey, 0);
    ikm.set(credentialIdBytes, publicKey.length);

    // Derive secret key
    const secretKeyBytes = hkdf(
      sha256,
      ikm,
      `${PASSKEY_DOMAIN}/secret`,
      'aztec-secret-key',
      32
    );

    // Derive signing key (for P-256/secp256r1)
    const signingKeyBytes = hkdf(
      sha256,
      ikm,
      `${PASSKEY_DOMAIN}/signing`,
      'aztec-signing-key',
      32
    );

    // Derive salt
    const saltBytes = hkdf(
      sha256,
      ikm,
      `${PASSKEY_DOMAIN}/salt`,
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
