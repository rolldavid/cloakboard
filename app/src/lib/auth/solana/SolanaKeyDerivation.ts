import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

const SOLANA_DOMAIN = 'aztec.network/private-cloak/solana/v2';

/**
 * HIGH-3: Key derivation now uses a SIGNATURE from the SOL wallet as input,
 * not the public key. Only someone who controls the SOL private key
 * can produce the correct signature, preventing impersonation.
 *
 * The `signatureHex` parameter is the result of signing the fixed message
 * "DuelCloak Aztec Key Derivation v1" with the user's Solana wallet.
 */
export class SolanaKeyDerivation {
  /** The fixed message that must be signed by the Solana wallet. */
  static readonly SIGN_MESSAGE = 'DuelCloak Aztec Key Derivation v1';

  /**
   * Derive Aztec keys from a Solana wallet signature.
   * @param signatureHex - The hex-encoded signature of SIGN_MESSAGE
   */
  static deriveKeys(signatureHex: string): DerivedKeys {
    const encoder = new TextEncoder();
    const ikm = encoder.encode(signatureHex);

    const secretKeyBytes = hkdf(sha256, ikm, `${SOLANA_DOMAIN}/secret`, 'aztec-secret-key', 32);
    const signingKeyBytes = hkdf(sha256, ikm, `${SOLANA_DOMAIN}/signing`, 'aztec-signing-key', 32);
    const saltBytes = hkdf(sha256, ikm, `${SOLANA_DOMAIN}/salt/v1`, 'aztec-salt', 32);

    return {
      secretKey: new Uint8Array(secretKeyBytes),
      signingKey: new Uint8Array(signingKeyBytes),
      salt: new Uint8Array(saltBytes),
    };
  }

  static wipeKeys(keys: DerivedKeys): void {
    keys.secretKey.fill(0);
    keys.signingKey.fill(0);
    keys.salt.fill(0);
  }
}
