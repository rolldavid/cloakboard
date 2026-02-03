/**
 * MultiAuthAccountEntrypoint
 *
 * Auth witness provider for the MultiAuthAccount contract.
 * Wraps the underlying curve-specific signer (Schnorr, ECDSA-K, ECDSA-R)
 * and prepends the key type byte so the on-chain contract knows which
 * verification path to take.
 *
 * Also provides utilities for computing public key hashes and label hashes
 * that match the Noir-side pedersen_hash / poseidon computations.
 */

/** Key type constants matching the Noir contract */
export const KEY_TYPE_SCHNORR = 0;
export const KEY_TYPE_ECDSA_K256 = 1;  // secp256k1 (ETH)
export const KEY_TYPE_ECDSA_R1 = 2;    // secp256r1 (Passkey)

export type MultiAuthKeyType = typeof KEY_TYPE_SCHNORR | typeof KEY_TYPE_ECDSA_K256 | typeof KEY_TYPE_ECDSA_R1;

/**
 * Maps AccountType strings to key type numbers.
 */
export function accountTypeToKeyType(accountType: string): MultiAuthKeyType {
  switch (accountType) {
    case 'schnorr':
      return KEY_TYPE_SCHNORR;
    case 'ecdsasecp256k1':
      return KEY_TYPE_ECDSA_K256;
    case 'ecdsasecp256r1':
      return KEY_TYPE_ECDSA_R1;
    default:
      throw new Error(`Unknown account type: ${accountType}`);
  }
}

/**
 * MultiAuthWitnessProvider
 *
 * Implements the Aztec AuthWitnessProvider interface for the MultiAuthAccount contract.
 * Delegates actual signing to the underlying curve-specific signer, then prepends
 * the key_type field to the witness so the contract can route verification.
 */
export class MultiAuthWitnessProvider {
  private keyType: MultiAuthKeyType;
  private innerProvider: any; // AuthWitnessProvider from the underlying account contract

  constructor(keyType: MultiAuthKeyType, innerProvider: any) {
    this.keyType = keyType;
    this.innerProvider = innerProvider;
  }

  /**
   * Create an auth witness with key_type prepended.
   *
   * Layout:
   *   witness[0] = key_type (0=schnorr, 1=ecdsa_k256, 2=ecdsa_r1)
   *   witness[1..] = inner signature (curve-specific)
   */
  async createAuthWit(messageHash: any): Promise<any> {
    // Get the inner auth witness from the curve-specific provider
    const innerWit = await this.innerProvider.createAuthWit(messageHash);

    // Dynamic import to avoid SSR issues
    const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
    const { Fr } = await import('@aztec/foundation/curves/bn254');

    // Prepend key type to the witness values
    const innerValues = innerWit.witness;
    const multiAuthValues = [new Fr(BigInt(this.keyType)).toBuffer()[31], ...innerValues];

    return new AuthWitness(innerWit.requestHash, multiAuthValues);
  }
}

/**
 * Compute the public key hash used by the MultiAuthAccount contract.
 *
 * For Schnorr keys: hash the Grumpkin public key (x, y) coordinates.
 * For ECDSA keys: hash the raw public key bytes.
 *
 * Uses SHA-256 truncated to fit in a Field (first byte zeroed).
 * This MUST match the Noir-side computation.
 */
export async function computePublicKeyHash(publicKeyBytes: Uint8Array): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');

  // Hash the raw public key bytes with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyBytes);
  const hashBytes = new Uint8Array(hashBuffer);
  // Zero the first byte to ensure it fits in a BN254 Field (~254 bits)
  hashBytes[0] = 0;
  return Fr.fromBuffer(Buffer.from(hashBytes));
}

/**
 * Compute the public key hash from a Schnorr signing private key.
 * Derives the public key first, then hashes it.
 */
export async function computeSchnorrPublicKeyHash(signingPrivateKey: any): Promise<any> {
  const { Schnorr } = await import('@aztec/foundation/crypto/schnorr');
  const schnorr = new Schnorr();
  const publicKey = await schnorr.computePublicKey(signingPrivateKey);
  // Serialize public key as x || y (both are 32-byte Fields)
  const pubKeyBytes = new Uint8Array(64);
  pubKeyBytes.set(publicKey.x.toBuffer(), 0);
  pubKeyBytes.set(publicKey.y.toBuffer(), 32);
  return computePublicKeyHash(pubKeyBytes);
}

/**
 * Compute the label hash for a given label string.
 * Uses SHA-256 truncated to fit in a Field.
 */
export async function computeLabelHash(label: string): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const encoder = new TextEncoder();
  const data = encoder.encode(label.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashBytes = new Uint8Array(hashBuffer);
  // Zero the first byte to ensure it fits in a Field
  hashBytes[0] = 0;
  return Fr.fromBuffer(Buffer.from(hashBytes));
}
