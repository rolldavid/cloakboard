/**
 * MultiAuthAccountContract — Aztec AccountContract interface for MultiAuthAccount.
 *
 * Single contract for all auth methods (Schnorr, ECDSA-K, ECDSA-R).
 */

import type { AccountType, DerivedKeys } from '@/types/wallet';
import {
  accountTypeToKeyType,
  computePrimaryKeyHash,
  computeLabelHash,
  MultiAuthWitnessProvider,
  type MultiAuthKeyType,
} from './MultiAuthAccountEntrypoint';
import { getMultiAuthAccountArtifact } from '@/lib/aztec/contracts';

async function packBytesToField(bytes: Uint8Array): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return new Fr(value);
}

let _BaseAccount: any = null;
let _DefaultAccountEntrypoint: any = null;

export async function ensureAccountImports(): Promise<void> {
  if (_BaseAccount && _DefaultAccountEntrypoint) return;
  const [accountModule, entrypointsModule] = await Promise.all([
    import('@aztec/aztec.js/account'),
    import('@aztec/entrypoints/account'),
  ]);
  _BaseAccount = accountModule.BaseAccount;
  _DefaultAccountEntrypoint = entrypointsModule.DefaultAccountEntrypoint;
}

export class MultiAuthAccountContractClass {
  private signingKey: Uint8Array;
  private accountType: AccountType;
  private label: string;
  private cachedPkFields: [any, any, any, any] | null = null;

  constructor(signingKey: Uint8Array, accountType: AccountType, label: string) {
    this.signingKey = signingKey;
    this.accountType = accountType;
    this.label = label;
  }

  async getContractArtifact(): Promise<any> {
    return getMultiAuthAccountArtifact();
  }

  async getInitializationFunctionAndArgs(): Promise<{
    constructorName: string;
    constructorArgs: any[];
  }> {
    const keyType = accountTypeToKeyType(this.accountType);
    const { Fr } = await import('@aztec/foundation/curves/bn254');

    let pkField1: any, pkField2: any, pkField3: any, pkField4: any;

    if (this.accountType === 'schnorr') {
      const { GrumpkinScalar } = await import('@aztec/foundation/curves/grumpkin');
      const { Schnorr } = await import('@aztec/foundation/crypto/schnorr');
      const signingPrivateKey = GrumpkinScalar.fromBufferReduce(Buffer.from(this.signingKey));
      const schnorr = new Schnorr();
      const pubKey = await schnorr.computePublicKey(signingPrivateKey);
      pkField1 = pubKey.x;
      pkField2 = pubKey.y;
      pkField3 = Fr.ZERO;
      pkField4 = Fr.ZERO;
    } else {
      const { Ecdsa } = await import('@aztec/foundation/crypto/ecdsa');
      const curve = this.accountType === 'ecdsasecp256r1' ? 'secp256r1' : 'secp256k1';
      const ecdsa = new Ecdsa(curve);
      const pubKeyBuf = await ecdsa.computePublicKey(Buffer.from(this.signingKey));
      const pubX = new Uint8Array(pubKeyBuf.subarray(0, 32));
      const pubY = new Uint8Array(pubKeyBuf.subarray(32, 64));
      pkField1 = await packBytesToField(pubX.subarray(0, 31));
      pkField2 = new Fr(BigInt(pubX[31]));
      pkField3 = await packBytesToField(pubY.subarray(0, 31));
      pkField4 = new Fr(BigInt(pubY[31]));
    }

    this.cachedPkFields = [pkField1, pkField2, pkField3, pkField4];

    const primaryKeyHash = await computePrimaryKeyHash(keyType, pkField1, pkField2, pkField3, pkField4);
    const labelHash = await computeLabelHash(this.label);

    return {
      constructorName: 'constructor',
      constructorArgs: [keyType, primaryKeyHash, labelHash],
    };
  }

  getAccount(address: any): any {
    let BaseAccount = _BaseAccount;
    let DefaultAccountEntrypoint = _DefaultAccountEntrypoint;
    if (!BaseAccount || !DefaultAccountEntrypoint) {
      throw new Error(
        'BaseAccount/DefaultAccountEntrypoint not loaded. Call ensureAccountImports() first.',
      );
    }
    const authWitnessProvider = this.getAuthWitnessProvider(address);
    return new BaseAccount(
      new DefaultAccountEntrypoint(address.address, authWitnessProvider),
      authWitnessProvider,
      address,
    );
  }

  getAuthWitnessProvider(address: any): any {
    const keyType = accountTypeToKeyType(this.accountType);
    const innerProvider = this.createInnerAuthWitnessProvider();
    if (!this.cachedPkFields) {
      throw new Error('pkFields not cached. Call getInitializationFunctionAndArgs() first.');
    }
    return new MultiAuthWitnessProvider(keyType, innerProvider, this.cachedPkFields);
  }

  async ensurePkFieldsCached(): Promise<void> {
    if (this.cachedPkFields) return;
    await this.getInitializationFunctionAndArgs();
  }

  private createInnerAuthWitnessProvider(): any {
    const signingKey = this.signingKey;
    const accountType = this.accountType;

    return {
      async createAuthWit(messageHash: any) {
        switch (accountType) {
          case 'schnorr': {
            const { GrumpkinScalar } = await import('@aztec/foundation/curves/grumpkin');
            const { Schnorr } = await import('@aztec/foundation/crypto/schnorr');
            const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
            const privKey = GrumpkinScalar.fromBufferReduce(Buffer.from(signingKey));
            const schnorr = new Schnorr();
            const signature = await schnorr.constructSignature(messageHash.toBuffer(), privKey);
            return new AuthWitness(messageHash, [...signature.toBuffer()]);
          }
          case 'ecdsasecp256k1': {
            const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
            const { Ecdsa } = await import('@aztec/foundation/crypto/ecdsa');
            const ecdsa = new Ecdsa();
            const signature = await ecdsa.constructSignature(messageHash.toBuffer(), Buffer.from(signingKey));
            return new AuthWitness(messageHash, [...signature.toBuffer()]);
          }
          case 'ecdsasecp256r1': {
            const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
            const { Ecdsa } = await import('@aztec/foundation/crypto/ecdsa');
            const ecdsa = new Ecdsa('secp256r1');
            const signature = await ecdsa.constructSignature(messageHash.toBuffer(), Buffer.from(signingKey));
            return new AuthWitness(messageHash, [...signature.toBuffer()]);
          }
          default:
            throw new Error(`Unsupported account type: ${accountType}`);
        }
      },
    };
  }
}

export async function getMultiAuthAccountContractAddress(
  secretKey: any, salt: any, signingKey: Uint8Array, accountType: AccountType, label: string,
): Promise<any> {
  const { deriveKeys } = await import('@aztec/stdlib/keys');
  const { getContractInstanceFromInstantiationParams } = await import('@aztec/stdlib/contract');

  const accountContract = new MultiAuthAccountContractClass(signingKey, accountType, label);

  const { BarretenbergSync } = await import('@aztec/bb.js');
  await BarretenbergSync.initSingleton();

  const { publicKeys } = await deriveKeys(secretKey);
  const initData = await accountContract.getInitializationFunctionAndArgs();
  const artifact = await accountContract.getContractArtifact();

  const instance = await getContractInstanceFromInstantiationParams(artifact, {
    constructorArtifact: initData.constructorName,
    constructorArgs: initData.constructorArgs,
    salt,
    publicKeys,
  });

  return instance.address;
}
