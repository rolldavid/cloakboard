import type { AuthMethod } from '@/types/wallet';
import type { DerivedKeys } from '@/types/wallet';
import { OAuthKeyDerivation } from '@/lib/auth/google/OAuthKeyDerivation';
import { EthereumKeyDerivation } from '@/lib/auth/ethereum/EthereumKeyDerivation';
import { SolanaKeyDerivation } from '@/lib/auth/solana/SolanaKeyDerivation';
import { PasskeyKeyDerivation } from '@/lib/auth/passkey/PasskeyKeyDerivation';
import { queueWalletCreation } from './backgroundWalletService';

const derivers: Record<AuthMethod, (seed: string) => DerivedKeys | null> = {
  google: (s) => {
    // Salt is required — prevents deriving keys from Google sub alone.
    // Stored in localStorage (survives tab close). Set during GoogleCallback.
    const salt = localStorage.getItem('duelcloak-googleSalt');
    if (!salt) return null; // No salt → force re-login via GoogleCallback
    return OAuthKeyDerivation.deriveKeysWithSalt(s, salt);
  },
  ethereum: (s) => EthereumKeyDerivation.deriveKeys(s),
  solana: (s) => SolanaKeyDerivation.deriveKeys(s),
  passkey: (s) => PasskeyKeyDerivation.deriveKeys(s),
};

/**
 * Restore wallet from persisted auth state.
 * Returns true if restoration was queued, false if it failed (e.g. missing salt).
 * On false, caller should reset auth state to force re-login.
 */
export function restoreWalletSession(authMethod: AuthMethod, seed: string): boolean {
  const deriver = derivers[authMethod];
  if (!deriver) return false;

  const keys = deriver(seed);
  if (!keys) return false; // Deriver signaled failure (e.g. Google without salt)

  queueWalletCreation(keys, authMethod);
  return true;
}
