import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/index';
import type { DerivedKeys, AuthMethod } from '@/types/wallet';
import { queueWalletCreation } from '@/lib/wallet/backgroundWalletService';
import { generateUsername } from '@/lib/username/generator';

/**
 * Shared auth completion hook.
 * Takes DerivedKeys + auth method → computes address hash, updates store,
 * queues background wallet creation, navigates home.
 */
export function useAuthCompletion() {
  const navigate = useNavigate();
  const { setUserAddress, setUserName, setAuthenticated, setAuthMethod, setAuthSeed, setDeployed } = useAppStore();

  const completeAuth = useCallback(async (keys: DerivedKeys, method: AuthMethod, seed: string) => {
    // 1. Compute a display address from signing key (instant)
    const hashBuf = await crypto.subtle.digest('SHA-256', keys.signingKey as BufferSource);
    const hashArr = new Uint8Array(hashBuf);
    const shortAddr = `0x${Array.from(hashArr.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    // 2. Generate deterministic username from seed (instant)
    const username = generateUsername(seed);

    // 3. Update store immediately (instant login UX)
    setUserAddress(shortAddr);
    setUserName(username);
    setAuthenticated(true);
    setAuthMethod(method);
    setAuthSeed(seed);

    // 4. Queue background wallet creation (Aztec client init + account import + deploy)
    queueWalletCreation(keys, method, username);

    // 5. Navigate to intended destination (or home)
    const returnTo = sessionStorage.getItem('returnTo');
    sessionStorage.removeItem('returnTo');
    navigate(returnTo || '/', { replace: true });
  }, [navigate, setUserAddress, setUserName, setAuthenticated, setAuthMethod, setAuthSeed, setDeployed]);

  return { completeAuth };
}
