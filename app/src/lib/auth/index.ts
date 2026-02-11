/**
 * Auth Module Exports
 *
 * Multi-auth system for Cloak:
 * - Passkey (WebAuthn with secp256r1)
 * - Google OAuth (with ZK domain proofs)
 * - Email + Password (client-side key derivation)
 */

// Types
export * from './types';

// Auth Manager
export { AuthManager, getAuthManager, clearAuthManagers } from './AuthManager';

// Passkey
export { PasskeyService } from './passkey/PasskeyService';
export { PasskeyKeyDerivation } from './passkey/PasskeyKeyDerivation';

// Google OAuth
export { GoogleAuthService } from './google/GoogleAuthService';
export { OAuthKeyDerivation } from './google/OAuthKeyDerivation';
export { DomainProofService, getDomainProofService } from './google/DomainProofService';

// Password (Email + Password)
export { PasswordService } from './password/PasswordService';
export { PasswordKeyDerivation } from './password/PasswordKeyDerivation';

// Multi-Auth Account
export {
  MultiAuthAccountContractClass,
  getMultiAuthAccountContractAddress,
  storeKeyAddressMapping,
  lookupAddressByKeyHash,
  getKeysForAddress,
  clearKeyAddressMap,
} from './MultiAuthAccountContract';
export {
  KEY_TYPE_SCHNORR,
  KEY_TYPE_ECDSA_K256,
  KEY_TYPE_ECDSA_R1,
  accountTypeToKeyType,
  computePublicKeyHash,
  computeSchnorrPublicKeyHash,
  computeLabelHash,
  MultiAuthWitnessProvider,
} from './MultiAuthAccountEntrypoint';
