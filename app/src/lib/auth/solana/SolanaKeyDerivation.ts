import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { DerivedKeys } from '@/types/wallet';

const SOLANA_DOMAIN = 'aztec.network/private-cloak/solana/v1';

export class SolanaKeyDerivation {
  static deriveKeys(publicKey: string): DerivedKeys {
    const encoder = new TextEncoder();
    const ikm = encoder.encode(publicKey);

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
