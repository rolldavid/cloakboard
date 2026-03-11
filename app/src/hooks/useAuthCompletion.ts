import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/index';
import type { DerivedKeys, AuthMethod } from '@/types/wallet';
import { queueWalletCreation, resetWalletCreation } from '@/lib/wallet/backgroundWalletService';
import { generateUsername } from '@/lib/username/generator';
import { authenticateWithServer, clearAuthToken } from '@/lib/api/authToken';
import { getAztecClient } from '@/lib/aztec/client';
import { resetDuelServiceCache } from '@/hooks/useDuelService';
import { resetPointsTracker } from '@/lib/pointsTracker';
import { setVoteTrackerUser } from '@/lib/voteTracker';
import { createSessionKey, encryptAndStore } from '@/lib/wallet/seedVault';

/**
 * Shared auth completion hook.
 * Takes DerivedKeys + auth method -> computes address hash, updates store,
 * queues background wallet creation, authenticates with server, navigates home.
 */
export function useAuthCompletion() {
  const navigate = useNavigate();

  const completeAuth = useCallback(async (keys: DerivedKeys, method: AuthMethod, seed: string, salt?: string) => {
    // Log previous state for debugging auth-switch issues
    const prevState = useAppStore.getState();
    console.log('[AuthCompletion] Starting:', {
      method,
      seed: seed.slice(0, 12) + '...',
      prevUserName: prevState.userName,
      prevMethod: prevState.authMethod,
      prevAuthenticated: prevState.isAuthenticated,
    });

    // 0. Full reset of previous auth session state.
    //    Clear auth token, vote tracker, points, wallet creation, and duel service cache.
    //    Preserve the warmup PXE — it's stateless and safe to reuse across auth switches.
    clearAuthToken();
    setVoteTrackerUser(null);
    const existingClient = getAztecClient();
    if (existingClient) existingClient.resetAccount();
    resetWalletCreation();
    resetDuelServiceCache();
    resetPointsTracker();

    // 1. Compute a display address from signing key (instant)
    const hashBuf = await crypto.subtle.digest('SHA-256', keys.signingKey as BufferSource);
    const hashArr = new Uint8Array(hashBuf);
    const shortAddr = `0x${Array.from(hashArr.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    // 2. Generate deterministic username from salted seed (instant)
    // For Google auth, salt prevents deriving username from sub alone.
    // For other auth methods, seed itself is already a signature/credential (not guessable).
    const usernameSeed = salt ? seed + ':' + salt : seed;
    const username = generateUsername(usernameSeed);
    console.log('[AuthCompletion] Generated:', { method, username, shortAddr: shortAddr.slice(0, 12) });

    // 3. Create session key for seed encryption (must happen before encryptAndStore)
    createSessionKey();

    // 4. Update store atomically — single setState call to prevent intermediate persist writes
    useAppStore.setState({
      userAddress: shortAddr,
      userName: username,
      isAuthenticated: true,
      authMethod: method,
      authSeed: seed,
    });
    // Side effects that individual setters would trigger:
    setVoteTrackerUser(shortAddr);
    encryptAndStore('duelcloak-authSeed', seed).catch(() => {});

    // 5. Authenticate with server (get JWT token, non-blocking)
    authenticateWithServer(shortAddr, username).catch(() => {
      // Non-fatal: server auth failure doesn't block the UX
      console.warn('[AuthCompletion] Server authentication failed (non-fatal)');
    });

    // 6. Queue background wallet creation (Aztec client init + account import + deploy)
    queueWalletCreation(keys, method, username);

    // 7. Navigate to intended destination (or home)
    const returnTo = sessionStorage.getItem('returnTo');
    sessionStorage.removeItem('returnTo');
    navigate(returnTo || '/', { replace: true });
  }, [navigate]);

  return { completeAuth };
}
