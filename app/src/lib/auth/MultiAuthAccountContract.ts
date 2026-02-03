/**
 * MultiAuthAccountContract
 *
 * Implements the Aztec AccountContract interface for the MultiAuthAccount
 * Noir contract. This replaces SchnorrAccountContract / EcdsaKAccountContract /
 * EcdsaRAccountContract as the single account contract for all auth methods.
 *
 * How it works:
 * 1. The contract artifact is the compiled MultiAuthAccount.nr
 * 2. Constructor receives [key_type, public_key_hash, label_hash]
 * 3. Auth witnesses prepend key_type before the curve-specific signature
 * 4. Additional keys can be added post-deployment via add_authorized_key()
 *
 * The same contract is deployed regardless of which auth method the user
 * signs up with. The underlying signing key type (Schnorr, ECDSA-K, ECDSA-R)
 * is passed to the contract so it knows how to verify.
 */

import type { AccountType, DerivedKeys } from '@/types/wallet';
import {
  accountTypeToKeyType,
  computePublicKeyHash,
  computeSchnorrPublicKeyHash,
  computeLabelHash,
  MultiAuthWitnessProvider,
  type MultiAuthKeyType,
} from './MultiAuthAccountEntrypoint';

// ============================================================
// Artifact Loading
// ============================================================

let cachedMultiAuthArtifact: any = null;

/**
 * Lazy-load the compiled MultiAuthAccount contract artifact.
 * The artifact must be compiled from contracts/src/account/multi_auth_account.nr
 * and placed at app/src/lib/aztec/artifacts/MultiAuthAccount.json.
 */
export async function getMultiAuthAccountArtifact(): Promise<any> {
  if (!cachedMultiAuthArtifact) {
    const { loadContractArtifact } = await import('@aztec/stdlib/abi');
    let module: any;
    try {
      module = await import('../aztec/artifacts/MultiAuthAccount.json');
    } catch {
      throw new Error(
        'MultiAuthAccount artifact not found. ' +
        'Compile the contract with `nargo compile` in contracts/ and copy ' +
        'the output JSON to app/src/lib/aztec/artifacts/MultiAuthAccount.json',
      );
    }
    const rawArtifact = module.default as any;
    rawArtifact.transpiled = true;
    cachedMultiAuthArtifact = loadContractArtifact(rawArtifact);
  }
  return cachedMultiAuthArtifact;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Pack up to 31 bytes (big-endian) into a single BN254 Field element.
 */
async function packBytesToField(bytes: Uint8Array): Promise<any> {
  const { Fr } = await import('@aztec/foundation/curves/bn254');
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return new Fr(value);
}

// ============================================================
// AccountContract Implementation
// ============================================================

/**
 * Multi-auth account contract for the Aztec SDK.
 *
 * Implements the AccountContract interface so it can be used with
 * AccountManager.create() for deployment and address computation.
 *
 * Usage:
 *   const contract = new MultiAuthAccountContractClass(signingKey, 'schnorr', 'google');
 *   const manager = await AccountManager.create(wallet, secretKey, contract, salt);
 *   const address = manager.getAddress();
 *   await manager.deploy().send().wait();
 */
export class MultiAuthAccountContractClass {
  private signingKey: Uint8Array;
  private accountType: AccountType;
  private label: string;

  constructor(signingKey: Uint8Array, accountType: AccountType, label: string) {
    this.signingKey = signingKey;
    this.accountType = accountType;
    this.label = label;
  }

  /**
   * Returns the compiled MultiAuthAccount contract artifact.
   */
  async getContractArtifact(): Promise<any> {
    return getMultiAuthAccountArtifact();
  }

  /**
   * Returns the constructor name and arguments.
   *
   * The MultiAuthAccount constructor takes:
   *   (key_type: u8, public_key_hash: Field, label_hash: Field,
   *    pk_field_1: Field, pk_field_2: Field, pk_field_3: Field, pk_field_4: Field)
   *
   * The pk_field args store the actual public key for private signature verification.
   */
  async getInitializationFunctionAndArgs(): Promise<{
    constructorName: string;
    constructorArgs: any[];
  }> {
    const keyType = accountTypeToKeyType(this.accountType);
    const { Fr } = await import('@aztec/foundation/curves/bn254');

    let publicKeyHash: any;
    let pkField1: any, pkField2: any, pkField3: any, pkField4: any;

    if (this.accountType === 'schnorr') {
      const { GrumpkinScalar } = await import('@aztec/foundation/curves/grumpkin');
      const { Schnorr } = await import('@aztec/foundation/crypto/schnorr');
      const signingPrivateKey = GrumpkinScalar.fromBuffer(Buffer.from(this.signingKey));
      publicKeyHash = await computeSchnorrPublicKeyHash(signingPrivateKey);
      const schnorr = new Schnorr();
      const pubKey = await schnorr.computePublicKey(signingPrivateKey);
      pkField1 = pubKey.x;
      pkField2 = pubKey.y;
      pkField3 = Fr.ZERO;
      pkField4 = Fr.ZERO;
    } else {
      publicKeyHash = await computePublicKeyHash(this.signingKey);
      // Derive ECDSA public key from private key
      const { Ecdsa } = await import('@aztec/foundation/crypto/ecdsa');
      const ecdsa = new Ecdsa();
      const pubKeyBuf = await ecdsa.computePublicKey(Buffer.from(this.signingKey));
      const pubX = new Uint8Array(pubKeyBuf.subarray(0, 32));
      const pubY = new Uint8Array(pubKeyBuf.subarray(32, 64));
      // Pack into Fields matching EcdsaPublicKeyNote scheme:
      // field_1 = x[0..31] big-endian, field_2 = x[31], field_3 = y[0..31], field_4 = y[31]
      pkField1 = await packBytesToField(pubX.subarray(0, 31));
      pkField2 = new Fr(BigInt(pubX[31]));
      pkField3 = await packBytesToField(pubY.subarray(0, 31));
      pkField4 = new Fr(BigInt(pubY[31]));
    }

    const labelHash = await computeLabelHash(this.label);

    return {
      constructorName: 'constructor',
      constructorArgs: [keyType, publicKeyHash, labelHash, pkField1, pkField2, pkField3, pkField4],
    };
  }

  /**
   * Returns the AccountInterface for this contract at the given address.
   * Uses DefaultAccountInterface which routes through the account's private entrypoint.
   */
  getInterface(address: any, chainInfo: any): any {
    const { DefaultAccountInterface } = require('@aztec/accounts/defaults');
    return new DefaultAccountInterface(
      this.getAuthWitnessProvider(address),
      address,
      chainInfo,
    );
  }

  /**
   * Returns the auth witness provider that wraps the underlying curve signer.
   *
   * The MultiAuthWitnessProvider prepends the key_type to every auth witness
   * so the on-chain contract can dispatch to the right verification path.
   */
  getAuthWitnessProvider(address: any): any {
    const keyType = accountTypeToKeyType(this.accountType);
    const innerProvider = this.createInnerAuthWitnessProvider();
    return new MultiAuthWitnessProvider(keyType, innerProvider);
  }

  /**
   * Creates the curve-specific auth witness provider.
   * This is the same signer that SchnorrAccountContract / EcdsaKAccountContract
   * would use, just wrapped by MultiAuthWitnessProvider.
   */
  private createInnerAuthWitnessProvider(): any {
    // We return a lazy provider that imports the right signer dynamically
    const signingKey = this.signingKey;
    const accountType = this.accountType;

    return {
      async createAuthWit(messageHash: any) {
        switch (accountType) {
          case 'schnorr': {
            const { GrumpkinScalar } = await import('@aztec/foundation/curves/grumpkin');
            const { Schnorr } = await import('@aztec/foundation/crypto/schnorr');
            const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
            const privKey = GrumpkinScalar.fromBuffer(Buffer.from(signingKey));
            const schnorr = new Schnorr();
            const signature = await schnorr.constructSignature(messageHash.toBuffer(), privKey);
            return new AuthWitness(messageHash, [...signature.toBuffer()]);
          }
          case 'ecdsasecp256k1': {
            // ECDSA secp256k1 signing
            const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
            const { Ecdsa } = await import('@aztec/foundation/crypto/ecdsa');
            const ecdsa = new Ecdsa();
            const signature = await ecdsa.constructSignature(messageHash.toBuffer(), Buffer.from(signingKey));
            return new AuthWitness(messageHash, [...signature.toBuffer()]);
          }
          case 'ecdsasecp256r1': {
            // ECDSA secp256r1 signing
            const { AuthWitness } = await import('@aztec/stdlib/auth-witness');
            const { Ecdsa } = await import('@aztec/foundation/crypto/ecdsa');
            const ecdsa = new Ecdsa();
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

// ============================================================
// Display Name Functions
// ============================================================

/**
 * Set the display name hash on a deployed MultiAuthAccount contract.
 * Must be called by the account itself (only_self).
 */
export async function setDisplayName(
  wallet: any,
  accountAddress: any,
  nameHash: any,
): Promise<void> {
  const { Contract } = await import('@aztec/aztec.js/contracts');
  const artifact = await getMultiAuthAccountArtifact();
  const contract = await Contract.at(accountAddress, artifact, wallet);
  await contract.methods.set_display_name(nameHash).send({} as any).wait({ timeout: 120000 });
}

/**
 * Read the display name hash from a MultiAuthAccount contract.
 * This is a view function — no transaction needed.
 */
export async function getDisplayNameHash(
  wallet: any,
  accountAddress: any,
): Promise<any> {
  const { Contract } = await import('@aztec/aztec.js/contracts');
  const artifact = await getMultiAuthAccountArtifact();
  const contract = await Contract.at(accountAddress, artifact, wallet);
  return contract.methods.get_display_name_hash().simulate({} as any);
}

// ============================================================
// Address Computation
// ============================================================

/**
 * Compute the address of a MultiAuthAccount contract.
 *
 * This is the equivalent of getSchnorrAccountContractAddress() but for the
 * multi-auth contract. It is a pure local computation — no network needed.
 *
 * @param secretKey - The account secret key (Fr)
 * @param salt - The contract address salt (Fr)
 * @param signingKey - The raw signing key bytes
 * @param accountType - The curve type for this key
 * @param label - The label for this key (e.g. "google", "passkey")
 * @returns The deterministic Aztec address
 */
export async function getMultiAuthAccountContractAddress(
  secretKey: any,  // Fr
  salt: any,       // Fr
  signingKey: Uint8Array,
  accountType: AccountType,
  label: string,
): Promise<any> {
  const { deriveKeys } = await import('@aztec/stdlib/keys');
  const { getContractInstanceFromInstantiationParams } = await import('@aztec/stdlib/contract');

  const accountContract = new MultiAuthAccountContractClass(signingKey, accountType, label);

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

// ============================================================
// Key-to-Address Cache (localStorage)
// ============================================================

const KEY_ADDRESS_MAP_KEY = 'cloak-key-address-map';

export interface KeyAddressEntry {
  keyType: MultiAuthKeyType;
  publicKeyHash: string;  // hex
  accountAddress: string;
  label: string;
  linkedAt: number;
}

/**
 * Store a key-to-address mapping in localStorage.
 */
export function storeKeyAddressMapping(entry: KeyAddressEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadKeyAddressMap();
    const idx = existing.findIndex(e => e.publicKeyHash === entry.publicKeyHash);
    if (idx >= 0) {
      existing[idx] = entry;
    } else {
      existing.push(entry);
    }
    localStorage.setItem(KEY_ADDRESS_MAP_KEY, JSON.stringify(existing));
  } catch {
    // Best-effort cache
  }
}

/**
 * Look up an account address by public key hash.
 */
export function lookupAddressByKeyHash(publicKeyHash: string): string | null {
  const entries = loadKeyAddressMap();
  const entry = entries.find(e => e.publicKeyHash === publicKeyHash);
  return entry?.accountAddress ?? null;
}

/**
 * Get all key-address mappings for a given account address.
 */
export function getKeysForAddress(accountAddress: string): KeyAddressEntry[] {
  const entries = loadKeyAddressMap();
  return entries.filter(e => e.accountAddress === accountAddress);
}

/**
 * Remove a specific key-address mapping by public key hash.
 */
export function removeKeyAddressMapping(publicKeyHash: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadKeyAddressMap();
    const filtered = existing.filter(e => e.publicKeyHash !== publicKeyHash);
    localStorage.setItem(KEY_ADDRESS_MAP_KEY, JSON.stringify(filtered));
  } catch {
    // Best-effort cache
  }
}

/**
 * Remove all key-address mappings (e.g., on logout/account deletion).
 */
export function clearKeyAddressMap(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY_ADDRESS_MAP_KEY);
}

function loadKeyAddressMap(): KeyAddressEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(KEY_ADDRESS_MAP_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as KeyAddressEntry[];
  } catch {
    return [];
  }
}
