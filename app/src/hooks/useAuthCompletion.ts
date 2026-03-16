import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/index';
import type { DerivedKeys, AuthMethod } from '@/types/wallet';
import { queueWalletCreation, resetWalletCreation } from '@/lib/wallet/backgroundWalletService';
import { generateUsername } from '@/lib/username/generator';
import { authenticateWithServer, clearAuthToken } from '@/lib/api/authToken';
import { getAztecClient } from '@/lib/aztec/client';
import { resetDuelServiceCache } from '@/hooks/useDuelService';
import { setActiveAccount, isInitialGrantSent, getOptimisticPoints } from '@/lib/pointsTracker';
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

    // 0. Reset previous session state (auth token, wallet, duel service)
    //    Do NOT reset pointsTracker — it's per-account, just switch account below.
    clearAuthToken();
    setVoteTrackerUser(null);
    const existingClient = getAztecClient();
    if (existingClient) existingClient.resetAccount();
    resetWalletCreation();
    resetDuelServiceCache();

    // 1. Compute a display address from signing key (instant, deterministic)
    const hashBuf = await crypto.subtle.digest('SHA-256', keys.signingKey as BufferSource);
    const hashArr = new Uint8Array(hashBuf);
    const shortAddr = `0x${Array.from(hashArr.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    // 2. Switch points tracker to this account (loads cached balance from localStorage)
    setActiveAccount(shortAddr);
    const cachedPoints = getOptimisticPoints();
    const grantAlreadySent = isInitialGrantSent();

    // 3. Generate deterministic username from salted seed (instant)
    const usernameSeed = salt ? seed + ':' + salt : seed;
    const username = generateUsername(usernameSeed);
    console.log('[AuthCompletion] Generated:', { method, username, shortAddr: shortAddr.slice(0, 12), cachedPoints, grantAlreadySent });

    // 4. Create session key for seed encryption
    createSessionKey();

    // 5. Update store atomically
    // For accounts where grant hasn't been sent yet, show 500 as a display hint.
    // This doesn't write to localStorage or set a grace period — the on-chain sync
    // will freely correct it. Prevents showing 0 for 15-60s while grant proof generates.
    const displayPoints = grantAlreadySent ? cachedPoints : Math.max(cachedPoints, 500);
    useAppStore.setState({
      userAddress: shortAddr,
      userName: username,
      isAuthenticated: true,
      authMethod: method,
      authSeed: seed,
      whisperPoints: displayPoints,
      pointsGranted: true,
      pointsLoading: grantAlreadySent && cachedPoints === 0, // Skeleton for returning users with cleared cache only
    });
    setVoteTrackerUser(shortAddr);
    encryptAndStore('duelcloak-authSeed', seed).catch(() => {});

    // 6. Authenticate with server (non-blocking)
    authenticateWithServer(shortAddr, username).catch(() => {
      console.warn('[AuthCompletion] Server authentication failed (non-fatal)');
    });

    // 7. Queue background wallet creation
    queueWalletCreation(keys, method, username);

    // 8. Show welcome modal for new users only
    if (!grantAlreadySent) {
      useAppStore.setState({ showWelcomeModal: true });
      // Persist 500 to localStorage (quietly, no store listener) so it survives reloads.
      // The on-chain sync will correct it for returning users with different real balances.
      const { setOptimisticPointsQuiet } = await import('@/lib/pointsTracker');
      setOptimisticPointsQuiet(500);
    }

    // 9. Navigate to intended destination
    const returnTo = sessionStorage.getItem('returnTo');
    sessionStorage.removeItem('returnTo');
    navigate(returnTo || '/', { replace: true });
  }, [navigate]);

  return { completeAuth };
}
