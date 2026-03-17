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
import { setNotificationUser } from '@/lib/notifications/localNotifications';
import { createSessionKey, encryptAndStore } from '@/lib/wallet/seedVault';
import { hasSeenWelcome } from '@/components/WelcomeModal';

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

    // 5. Authenticate with server — returns isReturning (has prior comments/duels).
    //    No privacy leak: server already knows the address, this only checks public
    //    activity (comments, duel creation), NOT point balances or vote directions.
    const authResult = await authenticateWithServer(shortAddr, username, keys.signingKey).catch(() => null);
    const isReturning = authResult?.isReturning ?? false;

    // 6. Determine display state:
    //    - Has localStorage cache (grantAlreadySent) → show cached points instantly
    //    - Server says returning but no cache (fresh browser) → show skeleton, wait for on-chain
    //    - Genuinely new user → show 500 immediately
    let displayPoints: number;
    let loading: boolean;
    const isNewUser = !grantAlreadySent && !isReturning;

    if (grantAlreadySent) {
      // Same browser, has cache — show cached value (possibly 0 → skeleton)
      displayPoints = cachedPoints;
      loading = cachedPoints === 0;
    } else if (isReturning) {
      // Returning user on fresh browser — skeleton until on-chain sync
      displayPoints = cachedPoints;
      loading = true;
    } else {
      // New user — show 500 immediately
      displayPoints = 500;
      loading = false;
    }

    // Show welcome modal on first login or if never dismissed
    const showWelcome = !hasSeenWelcome();

    useAppStore.setState({
      userAddress: shortAddr,
      userName: username,
      isAuthenticated: true,
      authMethod: method,
      authSeed: seed,
      whisperPoints: displayPoints,
      pointsGranted: true,
      pointsLoading: loading,
      showWelcomeModal: showWelcome,
    });
    setVoteTrackerUser(shortAddr);
    setNotificationUser(shortAddr);
    encryptAndStore('duelcloak-authSeed', seed).catch(() => {});

    // 7. Queue background wallet creation
    queueWalletCreation(keys, method, username);

    // 8. For new users, persist 500 to localStorage (quietly, no store listener)
    if (isNewUser) {
      const { setOptimisticPointsQuiet } = await import('@/lib/pointsTracker');
      setOptimisticPointsQuiet(500);
    }

    // 9. Store login timestamp for post-login cooldowns (duel creation, etc.)
    sessionStorage.setItem('dc_login_at', String(Date.now()));

    // 10. Navigate to intended destination
    const returnTo = sessionStorage.getItem('returnTo');
    sessionStorage.removeItem('returnTo');
    navigate(returnTo || '/', { replace: true });
  }, [navigate]);

  return { completeAuth };
}
