/**
 * SchnorrAccountContractWrapper — Thin wrapper around Aztec's built-in SchnorrAccountContract.
 *
 * All auth methods (Google, Ethereum, Solana, Passkey) now use Schnorr signing.
 * The auth method only determines HOW the seed is generated — on-chain verification
 * is always Schnorr. This works because the Aztec signing key is completely decoupled
 * from the external auth credential.
 *
 * Using SchnorrAccount solves the deployment problem: it stores the signing key as a
 * private note (SinglePrivateImmutable<PublicKeyNote>), so is_valid_impl() works during
 * deployment without needing initialized public storage.
 */

import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';

let _SchnorrAccountContract: any = null;

async function ensureSchnorrImport(): Promise<any> {
  if (_SchnorrAccountContract) return _SchnorrAccountContract;
  const mod = await import('@aztec/accounts/schnorr');
  _SchnorrAccountContract = mod.SchnorrAccountContract;
  return _SchnorrAccountContract;
}

export class SchnorrAccountContractWrapper {
  private signingKey: Uint8Array;
  private inner: any = null;

  constructor(signingKey: Uint8Array) {
    this.signingKey = signingKey;
  }

  private getPrivKey(): GrumpkinScalar {
    return GrumpkinScalar.fromBufferReduce(Buffer.from(this.signingKey));
  }

  private async ensureInner(): Promise<any> {
    if (this.inner) return this.inner;
    const SchnorrContract = await ensureSchnorrImport();
    this.inner = new SchnorrContract(this.getPrivKey());
    return this.inner;
  }

  async getContractArtifact(): Promise<any> {
    const inner = await this.ensureInner();
    return inner.getContractArtifact();
  }

  async getInitializationFunctionAndArgs(): Promise<{
    constructorName: string;
    constructorArgs: any[];
  }> {
    const inner = await this.ensureInner();
    return inner.getInitializationFunctionAndArgs();
  }

  getAccount(address: any): any {
    if (!this.inner) {
      throw new Error('Call getContractArtifact() or getInitializationFunctionAndArgs() first to initialize');
    }
    return this.inner.getAccount(address);
  }

  getAuthWitnessProvider(address: any): any {
    if (!this.inner) {
      throw new Error('Call getContractArtifact() or getInitializationFunctionAndArgs() first to initialize');
    }
    return this.inner.getAuthWitnessProvider(address);
  }
}

/**
 * Compute the Aztec address for a SchnorrAccount given secret key, salt, and signing key.
 */
export async function getSchnorrAccountAddress(
  secretKey: any, salt: any, signingKey: Uint8Array,
): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  const { getSchnorrAccountContractAddress } = await import('@aztec/accounts/schnorr');
  const privKey = GrumpkinScalar.fromBufferReduce(Buffer.from(signingKey));
  return getSchnorrAccountContractAddress(secretKey, salt, privKey);
}
