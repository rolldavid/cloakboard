/**
 * MultiAuthAccountEntrypoint — Auth witness provider for the MultiAuthAccount contract.
 *
 * Wraps curve-specific signers, prepends key type, appends pk_field_1-4.
 */

export const KEY_TYPE_SCHNORR = 0;
export const KEY_TYPE_ECDSA_K256 = 1;
export const KEY_TYPE_ECDSA_R1 = 2;

export type MultiAuthKeyType = typeof KEY_TYPE_SCHNORR | typeof KEY_TYPE_ECDSA_K256 | typeof KEY_TYPE_ECDSA_R1;

export function accountTypeToKeyType(accountType: string): MultiAuthKeyType {
  switch (accountType) {
    case 'schnorr': return KEY_TYPE_SCHNORR;
    case 'ecdsasecp256k1': return KEY_TYPE_ECDSA_K256;
    case 'ecdsasecp256r1': return KEY_TYPE_ECDSA_R1;
    default: throw new Error(`Unknown account type: ${accountType}`);
  }
}

/**
 * Auth witness layout (69 fields):
 *   [0]     = key_type
 *   [1..65] = 64-byte signature
 *   [65-68] = pk_field_1-4
 */
export class MultiAuthWitnessProvider {
  private keyType: MultiAuthKeyType;
  private innerProvider: any;
  private pkFields: [any, any, any, any];

  constructor(keyType: MultiAuthKeyType, innerProvider: any, pkFields: [any, any, any, any]) {
    this.keyType = keyType;
    this.innerProvider = innerProvider;
    this.pkFields = pkFields;
  }

  async createAuthWit(messageHash: any): Promise<any> {
    const innerWit = await this.innerProvider.createAuthWit(messageHash);
    const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
    const { Fr } = await import('@aztec/foundation/curves/bn254');

    const multiAuthValues = [
      new Fr(BigInt(this.keyType)).toBuffer()[31],
      ...innerWit.witness,
      ...this.pkFields,
    ];

    return new AuthWitness(innerWit.requestHash, multiAuthValues);
  }
}

export async function computePublicKeyHash(publicKeyBytes: Uint8Array): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyBytes as unknown as BufferSource);
  const hashBytes = new Uint8Array(hashBuffer);
  hashBytes[0] = 0;
  return Fr.fromBuffer(Buffer.from(hashBytes));
}

export async function computePrimaryKeyHash(
  keyType: number, pkField1: any, pkField2: any, pkField3: any, pkField4: any,
): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const { pedersenHash } = await import('@aztec/foundation/crypto/pedersen');
  return pedersenHash([new Fr(BigInt(keyType)), pkField1, pkField2, pkField3, pkField4]);
}

export async function computeLabelHash(label: string): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const data = new TextEncoder().encode(label.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
  const hashBytes = new Uint8Array(hashBuffer);
  hashBytes[0] = 0;
  return Fr.fromBuffer(Buffer.from(hashBytes));
}
