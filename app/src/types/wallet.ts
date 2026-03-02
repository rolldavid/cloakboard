/**
 * Wallet & Auth Types
 */

export type AccountType = 'schnorr';

export type AuthMethod = 'google' | 'ethereum' | 'solana' | 'passkey';

export interface DerivedKeys {
  secretKey: Uint8Array;
  signingKey: Uint8Array;
  salt: Uint8Array;
}

export interface NetworkConfig {
  id: string;
  name: string;
  nodeUrl: string;
  chainId: number;
  rollupVersion: number;
  sponsoredFpcAddress?: string;
  cloakRegistryAddress?: string;
  cloakMembershipsAddress?: string;
  keeperAddress?: string;
}

export interface GoogleOAuthData {
  idToken: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  domain: string;
}

export interface VaultData {
  method: string;
  username: string;
  address: string;
  secretKeyHex: string;
  signingKeyHex: string;
  saltHex: string;
  accountType: AccountType;
}

export interface EncryptedVault {
  version: number;
  salt: ArrayBuffer;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  networkId: string;
}
