/**
 * Email Key Derivation via OPRF
 *
 * Derives Aztec keys from email using OPRF (Oblivious PRF):
 * 1. Client hashes email to a ristretto255 point
 * 2. Client blinds the point with a random scalar
 * 3. Server multiplies by its secret key (never sees email)
 * 4. Client unblinds to get a deterministic PRF output
 * 5. HKDF derives Aztec keys from the PRF output
 *
 * Same email always produces the same keys (deterministic).
 * Server contributes entropy but cannot link email to output.
 */

import { hash_to_ristretto255, RistrettoPoint } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

const EMAIL_OPRF_DOMAIN = 'aztec.network/private-cloak/email-oprf/v1';

/**
 * Generate a random scalar in the ristretto255 group order.
 * The ed25519 curve order is L = 2^252 + 27742317777372353535851937790883648493.
 */
function randomScalar(): bigint {
  const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  let n = BigInt(0);
  for (let i = 0; i < 64; i++) {
    n = (n << BigInt(8)) | BigInt(buf[i]);
  }
  // Reduce mod L, ensuring non-zero
  const result = (n % (L - BigInt(1))) + BigInt(1);
  return result;
}

/**
 * Compute modular inverse of a scalar mod L.
 */
function modInverse(a: bigint): bigint {
  const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
  // Extended Euclidean algorithm
  let [old_r, r] = [a % L, L];
  let [old_s, s] = [BigInt(1), BigInt(0)];

  while (r !== BigInt(0)) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }

  return ((old_s % L) + L) % L;
}

export interface BlindResult {
  blindedPoint: Uint8Array; // ristretto255 encoded point
  blindFactor: bigint;
}

export class EmailKeyDerivation {
  /**
   * Step 1: Blind the email for OPRF.
   * Hash email to a ristretto255 point, then multiply by random scalar.
   */
  static blind(email: string): BlindResult {
    const normalizedEmail = email.toLowerCase().trim();
    const emailBytes = new TextEncoder().encode(`${EMAIL_OPRF_DOMAIN}/input/${normalizedEmail}`);

    // Hash to ristretto255 point
    const point = hash_to_ristretto255(emailBytes, {
      DST: EMAIL_OPRF_DOMAIN,
    });

    // Generate random blinding factor
    const r = randomScalar();

    // Blind: B = r * H(email)
    const blinded = point.multiply(r);

    return {
      blindedPoint: blinded.toRawBytes(),
      blindFactor: r,
    };
  }

  /**
   * Step 2: Finalize the OPRF by unblinding the server's response.
   * Derive Aztec keys from the unblinded PRF output.
   */
  static finalize(evaluatedPointBytes: Uint8Array, blindFactor: bigint): DerivedKeys {
    // Decode server's evaluated point
    const evaluated = RistrettoPoint.fromHex(evaluatedPointBytes);

    // Unblind: U = r^{-1} * Evaluated = r^{-1} * k * r * H(email) = k * H(email)
    const rInv = modInverse(blindFactor);
    const unblinded = evaluated.multiply(rInv);

    // Use the unblinded point as IKM for HKDF
    const ikm = unblinded.toRawBytes();
    const salt = new TextEncoder().encode(`${EMAIL_OPRF_DOMAIN}/hkdf-salt`);

    return {
      secretKey:  new Uint8Array(hkdf(sha256, ikm, salt, 'aztec-secret-key', 32)),
      signingKey: new Uint8Array(hkdf(sha256, ikm, salt, 'aztec-signing-key', 32)),
      salt:       new Uint8Array(hkdf(sha256, ikm, salt, 'aztec-salt', 32)),
    };
  }

  /**
   * Hash email for privacy-preserving storage (same as PasswordKeyDerivation).
   */
  static async hashEmail(email: string): Promise<string> {
    const data = new TextEncoder().encode(email.toLowerCase().trim());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Securely clear derived keys from memory.
   */
  static wipeKeys(keys: DerivedKeys): void {
    keys.secretKey.fill(0);
    keys.signingKey.fill(0);
    keys.salt.fill(0);
  }
}
