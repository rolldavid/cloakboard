import type { AuthMethod } from '@/types/wallet';
import type { DerivedKeys } from '@/types/wallet';
import { OAuthKeyDerivation } from '@/lib/auth/google/OAuthKeyDerivation';
import { EthereumKeyDerivation } from '@/lib/auth/ethereum/EthereumKeyDerivation';
import { SolanaKeyDerivation } from '@/lib/auth/solana/SolanaKeyDerivation';
import { PasskeyKeyDerivation } from '@/lib/auth/passkey/PasskeyKeyDerivation';
import { queueWalletCreation } from './backgroundWalletService';
import { decryptAndRetrieve } from './seedVault';

const syncDerivers: Record<Exclude<AuthMethod, 'google'>, (seed: string) => DerivedKeys | null> = {
  ethereum: (s) => EthereumKeyDerivation.deriveKeys(s),
  solana: (s) => SolanaKeyDerivation.deriveKeys(s),
  passkey: (s) => PasskeyKeyDerivation.deriveKeys(s),
};

/**
 * Restore wallet from persisted auth state.
 * Returns true if restoration was queued, false if it failed (e.g. missing salt).
 * On false, caller should reset auth state to force re-login.
 */
export async function restoreWalletSession(authMethod: AuthMethod, seed: string): Promise<boolean> {
  if (authMethod === 'google') {
    const salt = await decryptAndRetrieve('duelcloak-googleSalt');
    if (!salt) return false; // No salt -- force re-login via GoogleCallback
    const keys = OAuthKeyDerivation.deriveKeysWithSalt(seed, salt);
    queueWalletCreation(keys, authMethod);
    return true;
  }

  const deriver = syncDerivers[authMethod];
  if (!deriver) return false;

  const keys = deriver(seed);
  if (!keys) return false;

  queueWalletCreation(keys, authMethod);
  return true;
}
