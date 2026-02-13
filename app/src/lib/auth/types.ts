/**
 * Auth Type Definitions
 * Types for the multi-auth system: Passkey, Google OAuth, Magic Link
 */

import type { DerivedKeys, AccountType } from '@/types/wallet';

// Authentication methods supported
export type AuthMethod = 'passkey' | 'google' | 'email' | 'ethereum' | 'solana';

// Passkey credential data
export interface PasskeyCredential {
  credentialId: string;
  publicKey: Uint8Array;
  algorithm: number; // COSE algorithm identifier (-7 for ES256/P-256)
  transports?: AuthenticatorTransport[];
}

// Google OAuth token data
export interface GoogleOAuthData {
  idToken: string;
  sub: string; // Google user ID
  email: string;
  emailVerified: boolean;
  domain: string;
}

// Authentication credentials for different methods
export type AuthCredentials =
  | { method: 'passkey'; credential: PasskeyCredential }
  | { method: 'google'; oauth: GoogleOAuthData; password: string }
  | { method: 'email'; email: string }
;

// Result of authentication
export interface AuthResult {
  method: AuthMethod;
  address: string;
  username: string;
  keys: DerivedKeys;
  accountType: AccountType;
  metadata: AuthMetadata;
}

// Metadata stored with account based on auth method
export interface AuthMetadata {
  method: AuthMethod;
  createdAt: number;
  // Passkey specific
  credentialId?: string;
  // Google specific (privacy-preserving - only domain hash, not email)
  emailDomainHash?: string;
  // Password/email specific (hashed email for recovery)
  emailHash?: string;
}

// Domain proof for gated Cloaks
export interface DomainProof {
  domain: string;
  domainHash: string;
  nullifier: string;
  accountCommitment: string;
  proof: Uint8Array;
  publicInputs: DomainProofPublicInputs;
  generatedAt: number;
  expiresAt: number;
}

export interface DomainProofPublicInputs {
  domainHash: string;
  nullifier: string;
  accountCommitment: string;
  jwtPubkeyModulusLimbs?: string[];
}

// Cached proof in IndexedDB
export interface CachedProof {
  domain: string;
  proof: Uint8Array;
  publicInputs: DomainProofPublicInputs;
  generatedAt: number;
  expiresAt: number;
}

// Proof generation status
export type ProofStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface ProofState {
  status: ProofStatus;
  progress?: number;
  error?: string;
  proof?: DomainProof;
}

// WebAuthn types for passkey
export interface PasskeyRegistrationOptions {
  displayName: string;
  userHandle?: Uint8Array;
}

export interface PasskeyAuthenticationOptions {
  credentialId?: string;
  challenge?: Uint8Array;
}

// Web Worker message types
export interface ProofWorkerRequest {
  type: 'generate-domain-proof';
  idToken: string;
  domain: string;
  accountAddress: string;
}

export interface ProofWorkerResponse {
  type: 'proof-ready' | 'proof-error' | 'proof-progress';
  proof?: DomainProof;
  error?: string;
  progress?: number;
}

// Username types
export interface UsernameData {
  username: string;
  address: string;
  createdAt: number;
  changedAt?: number;
}

export interface UsernameCheckResult {
  available: boolean;
  suggestion?: string;
}
