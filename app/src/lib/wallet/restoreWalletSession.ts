import type { AuthMethod } from '@/types/wallet';
import { OAuthKeyDerivation } from '@/lib/auth/google/OAuthKeyDerivation';
import { EthereumKeyDerivation } from '@/lib/auth/ethereum/EthereumKeyDerivation';
import { SolanaKeyDerivation } from '@/lib/auth/solana/SolanaKeyDerivation';
import { PasskeyKeyDerivation } from '@/lib/auth/passkey/PasskeyKeyDerivation';
import { queueWalletCreation } from './backgroundWalletService';

const derivers: Record<AuthMethod, (seed: string) => ReturnType<typeof OAuthKeyDerivation.deriveKeys>> = {
  google: (s) => OAuthKeyDerivation.deriveKeys(s),
  ethereum: (s) => EthereumKeyDerivation.deriveKeys(s),
  solana: (s) => SolanaKeyDerivation.deriveKeys(s),
  passkey: (s) => PasskeyKeyDerivation.deriveKeys(s),
};

export function restoreWalletSession(authMethod: AuthMethod, seed: string): void {
  const deriver = derivers[authMethod];
  if (!deriver) return;
  const keys = deriver(seed);
  queueWalletCreation(keys, authMethod);
}
