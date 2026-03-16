/**
 * Background Wallet Service
 *
 * After a user authenticates, this service creates their Aztec wallet
 * in the background. The user sees the app immediately while wallet
 * creation happens silently.
 *
 * Flow: authenticate → store keys → initialize Aztec client → import account → deploy
 *       → store username on UserProfile (background tx)
 */

import type { DerivedKeys, AuthMethod } from '@/types/wallet';
import { createAztecClient, type AztecConfig } from '@/lib/aztec/client';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { useAppStore } from '@/store';

interface PendingWallet {
  keys: DerivedKeys;
  method: AuthMethod;
  username?: string;
}

// Module-level state for pending wallet creation
let _pending: PendingWallet | null = null;
let _creationPromise: Promise<string | null> | null = null;
let _deployPromise: Promise<void> | null = null;
let _deployResolved = false;

/**
 * Queue wallet creation for background processing.
 * Call this immediately after authentication.
 * If creation is already in progress, returns the existing promise.
 */
export function queueWalletCreation(keys: DerivedKeys, method: AuthMethod, username?: string): void {
  if (_creationPromise) return; // Already in progress or done

  _pending = {
    keys,
    method,
    username,
  };
  // Start creation immediately (fire-and-forget)
  _creationPromise = createWalletInBackground().catch((err) => {
    console.error('[BackgroundWallet] Creation failed:', err?.message);
    return null;
  });
}

/**
 * Wait for the background wallet creation to complete.
 * Returns the Aztec address string or null if failed.
 */
export async function waitForWalletCreation(): Promise<string | null> {
  if (_creationPromise) return _creationPromise;
  return null;
}

/**
 * Check if wallet creation is pending or in progress.
 */
export function isWalletCreationPending(): boolean {
  return _pending !== null;
}

/**
 * Wait for account deployment to complete.
 * Returns immediately if already deployed or no deploy in progress.
 */
export async function waitForAccountDeploy(): Promise<void> {
  if (_deployResolved) return;
  if (_deployPromise) return _deployPromise;
}

/**
 * Check if account deployment has completed.
 * If deploy confirmation timed out earlier, re-checks on-chain.
 */
export function isAccountDeployed(): boolean {
  return _deployResolved;
}

/**
 * Re-check on-chain whether the account is deployed.
 * Useful when the initial confirmation timed out but the deploy may have since mined.
 */
export async function recheckAccountDeployed(): Promise<boolean> {
  if (_deployResolved) return true;

  try {
    const { getAztecClient } = await import('@/lib/aztec/client');
    const client = getAztecClient();
    if (!client) return false;
    const address = client.getAddress();
    if (!address) return false;
    const confirmed = await client.isAccountDeployed(address);
    if (confirmed) {
      _deployResolved = true;
      useAppStore.getState().setDeployed(true);
    }
    return confirmed;
  } catch {
    return false;
  }
}

/**
 * Reset wallet creation state. Call on logout to ensure
 * a fresh start when logging in with a different account.
 */
export function resetWalletCreation(): void {
  _pending = null;
  _creationPromise = null;
  _deployPromise = null;
  _deployResolved = false;
  stopAutoClaimTimer();
}

async function createWalletInBackground(): Promise<string | null> {
  if (!_pending) return null;
  const { keys, username } = _pending;

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    const setStatus = (s: string) => useAppStore.getState().setWalletStatus(s);
    console.log(`[BackgroundWallet] Starting wallet creation... [${elapsed()}]`);
    setStatus('Connecting...');

    // 1. Initialize Aztec client
    const nodeUrl = (import.meta as any).env?.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
    const sponsoredFpcAddress = (import.meta as any).env?.VITE_SPONSORED_FPC_ADDRESS;
    const environment = ((import.meta as any).env?.VITE_DEFAULT_NETWORK || 'testnet') as AztecConfig['environment'];

    const config: AztecConfig = { nodeUrl, environment, sponsoredFpcAddress };
    const client = await createAztecClient(config);
    console.log(`[BackgroundWallet] Aztec client initialized [${elapsed()}]`);

    // 2. Import account from derived keys
    //    This awaits pxeWarmup → EmbeddedWallet.create() which can take 30-60s on mobile.
    //    Tick the status so the user knows it's alive.
    setStatus('Getting your account ready...');
    const importTick = setInterval(() => {
      setStatus(`Getting your account ready... ${Math.floor((Date.now() - t0) / 1000)}s`);
    }, 3000);
    let address: any;
    try {
      ({ address } = await client.importAccountFromDerivedKeys(keys));
    } finally {
      clearInterval(importTick);
    }
    const addressStr = address.toString();
    console.log(`[BackgroundWallet] Account imported: ${addressStr.slice(0, 14)}... [${elapsed()}]`);
    setStatus('Getting your account ready...');

    // 3. Early check: if account is already deployed (e.g. deployed on another device),
    //    set isDeployed immediately so vote buttons enable without waiting for deploy flow.
    try {
      const alreadyDeployed = await client.isAccountDeployed(address);
      if (alreadyDeployed) {
        _deployResolved = true;
        useAppStore.getState().setDeployed(true);
        console.log(`[BackgroundWallet] Account already deployed on-chain [${elapsed()}]`);
      }
    } catch { /* non-fatal — deploy flow will handle it */ }

    // 4. Deploy account (SponsoredFPC pays gas) — fire-and-forget, but track completion.
    //    Browser WASM proof generation can hang on mobile, so we race with a timeout
    //    and fall back to periodic on-chain rechecks.
    //    Mobile single-threaded WASM: deploy proof can take 2-4 minutes (3 IVC circuits).
    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    const DEPLOY_SEND_TIMEOUT_MS = isMobile ? 300_000 : 90_000; // 5min mobile, 90s desktop
    // Tick elapsed time into status while deploy is running
    const statusInterval = setInterval(() => {
      if (!_deployResolved) setStatus(`Getting your account ready... ${Math.floor((Date.now() - t0) / 1000)}s`);
    }, 3000);

    _deployPromise = (async () => {
      try {
        // Race: browser deploy vs timeout
        const deployResult = await Promise.race([
          client.deployAccount().then((addr) => ({ ok: true as const, addr })),
          new Promise<{ ok: false }>((resolve) =>
            setTimeout(() => resolve({ ok: false }), DEPLOY_SEND_TIMEOUT_MS),
          ),
        ]);

        if (deployResult.ok) {
          setStatus('Almost ready...');
          console.log(`[BackgroundWallet] Deploy tx sent: ${deployResult.addr.toString().slice(0, 14)}... [${elapsed()}]`);
          const confirmed = await client.waitForDeployConfirmation(
            AztecAddress.fromString(deployResult.addr.toString()),
            60, // 60 attempts × 3s = 180s
          );
          if (confirmed) {
            _deployResolved = true;
            useAppStore.getState().setDeployed(true);
            console.log(`[BackgroundWallet] Constructor confirmed on-chain [${elapsed()}]`);
            return;
          }
          console.warn(`[BackgroundWallet] Constructor confirmation timed out [${elapsed()}]`);
        } else {
          setStatus(`Taking longer than expected... ${elapsed()}`);
          console.warn(`[BackgroundWallet] Deploy proof timed out after ${DEPLOY_SEND_TIMEOUT_MS / 1000}s [${elapsed()}] — proof may still be running, starting recheck fallback`);
        }

        // Fallback: periodic on-chain recheck (deploy may still complete in background,
        // or may have been done in a previous session)
        setStatus('Finishing setup...');
        console.log(`[BackgroundWallet] Starting periodic deploy recheck... [${elapsed()}]`);
        for (let i = 0; i < 60; i++) { // 60 × 10s = 10 min
          await new Promise((r) => setTimeout(r, 10_000));
          if (_deployResolved) return;
          try {
            const found = await client.isAccountDeployed(address);
            if (found) {
              _deployResolved = true;
              useAppStore.getState().setDeployed(true);
              console.log(`[BackgroundWallet] Deploy detected via recheck [${elapsed()}]`);
              return;
            }
          } catch { /* node call failed, keep trying */ }
        }
        setStatus('Setup timed out — try refreshing');
        console.warn(`[BackgroundWallet] Deploy never confirmed [${elapsed()}]`);
      } catch (deployErr: any) {
        // "Already deployed" counts as success
        if (deployErr?.message?.includes('alreadyDeployed') || deployErr?.message?.includes('Already deployed')) {
          _deployResolved = true;
          useAppStore.getState().setDeployed(true);
          return;
        }
        setStatus(`Setup error: ${deployErr?.message?.slice(0, 60) ?? 'unknown'}`);
        console.warn(`[BackgroundWallet] Deploy failed (non-fatal): ${deployErr?.message}`);
      } finally {
        clearInterval(statusInterval);
      }
    })();

    // 4. Sync vote directions from cached vote stakes (from localStorage)
    await syncVoteDirectionsFromCache();

    // 5. Points are auto-granted inside the first vote tx (consume_points auto-grants if sum==0).
    //    No separate grant tx — it conflicts with voting (nullifier collision when both are pending).
    //    The optimistic 500 display hint from useAuthCompletion covers the UI.
    useAppStore.getState().setPointsGranted(true);
    const { isInitialGrantSent, markInitialGrantSent } = await import('@/lib/pointsTracker');
    if (!isInitialGrantSent()) markInitialGrantSent();

    // 6. Refresh whisper points from on-chain FIRST (unconstrained read, no proof needed).
    //    Must run before username store or auto-claim, which generate proofs and
    //    monopolize the single-threaded PXE job queue for 10-15s each.
    await refreshPointsFromChain(client).catch((err: any) =>
      console.warn(`[BackgroundWallet] Points refresh failed (non-fatal): ${err?.message}`),
    );

    // 7. Store username on UserProfile contract (background tx, fire-and-forget)
    //    This generates a proof (~12s) — runs AFTER points read so it doesn't block display.
    if (username) {
      storeUsernameOnChain(client, username).catch((err: any) =>
        console.warn(`[BackgroundWallet] Username store failed (non-fatal): ${err?.message}`),
      );
    }

    // 8. Sync vote directions from PXE (on-chain source of truth, background)
    syncVoteDirectionsFromPXE().catch((err: any) =>
      console.warn(`[BackgroundWallet] Vote direction PXE sync failed (non-fatal): ${err?.message}`),
    );

    // 9. Start auto-claim timer for market voting rewards
    startAutoClaimTimer();

    _pending = null;
    return addressStr;
  } catch (err: any) {
    console.error(`[BackgroundWallet] Error [${elapsed()}]:`, err?.message);
    _pending = null;
    return null;
  }
}

/**
 * Refresh whisper points from on-chain private notes.
 * Calls getMyPoints() via PXE (local, no proof, fast) and syncs to store.
 * Waits for deploy so PXE has time to sync encrypted notes.
 */
async function refreshPointsFromChain(client: any): Promise<void> {
  const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
  if (!profileAddress) return;

  // Don't wait for deploy — unconstrained reads don't need a deployed account.
  // Just give PXE a moment to sync recent blocks after account import.
  await new Promise((r) => setTimeout(r, 3_000));

  const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
  const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');
  const { syncOptimisticPoints } = await import('@/lib/pointsTracker');

  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getUserProfileArtifact();
  const addr = AztecAddress.fromString(profileAddress);

  // Register contract with PXE (may already be registered by storeUsernameOnChain)
  const node = client.getNode();
  if (node) {
    try {
      const instance = await node.getContract(addr);
      if (instance) await wallet.registerContract(instance, artifact);
    } catch { /* may already be registered */ }
  }

  const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
  await svc.connect(addr, artifact);

  // With persistent PXE, notes from previous sessions are already available.
  // One retry after 5s handles PXE sync lag for fresh browsers.
  // Don't over-retry — accounts with genuinely 0 points shouldn't wait 30s+.
  let onChainPoints = await svc.getMyPoints();
  if (onChainPoints === 0) {
    await new Promise((r) => setTimeout(r, 5_000));
    onChainPoints = await svc.getMyPoints();
  }
  console.log(`[BackgroundWallet] On-chain points: ${onChainPoints}`);

  if (onChainPoints > 0) {
    // On-chain has points — sync using the standard grace-aware logic.
    // If user just voted (grace active), the optimistic deduction is preserved.
    // If no grace, on-chain value replaces optimistic.
    syncOptimisticPoints(onChainPoints);

    if (!useAppStore.getState().pointsGranted) {
      const { markInitialGrantSent } = await import('@/lib/pointsTracker');
      markInitialGrantSent();
      useAppStore.getState().setPointsGranted(true);
      console.log('[BackgroundWallet] Auto-enabled voting from on-chain points');
    }
  } else {
    syncOptimisticPoints(onChainPoints);
  }

  useAppStore.getState().setPointsLoading(false);

  // Certification deferred to on-demand (duel creation via usePointsGate)
  // to avoid nullifier conflicts with concurrent voting txs.
}

/**
 * Public: refresh points from chain using the current wallet.
 * Called after voting to sync the updated on-chain balance.
 */
export async function refreshPointsOnChain(): Promise<void> {
  try {
    const { getAztecClient } = await import('@/lib/aztec/client');
    const client = getAztecClient();
    if (!client || !client.hasWallet()) return;
    await refreshPointsFromChain(client);
  } catch (err: any) {
    console.warn('[BackgroundWallet] Public points refresh failed:', err?.message);
  }
}

const CERTIFICATION_THRESHOLD = 10;
let _certificationPromise: Promise<void> | null = null;

/**
 * Check if the user is already certified (per-account localStorage flag).
 */
export function isCertified(): boolean {
  try {
    // Check per-account certified flag (matches pointsTracker's key format)
    const addr = useAppStore.getState().userAddress;
    if (!addr) return false;
    return localStorage.getItem(`dc_pts_${addr}_certified`) === '1';
  } catch {
    return false;
  }
}

/**
 * Wait for an in-progress certification, if any.
 * Returns the promise if certification is running, null otherwise.
 */
export function waitForCertification(): Promise<void> | null {
  return _certificationPromise;
}

/**
 * Public: ensure the user is certified for duel creation.
 * Call from anywhere — deduplicates automatically.
 * Creates its own UserProfileService if needed.
 * No-ops instantly if already certified.
 */
export async function ensureCertification(): Promise<void> {
  if (isCertified()) return;
  if (_certificationPromise) return _certificationPromise;

  try {
    const { getAztecClient } = await import('@/lib/aztec/client');
    const client = getAztecClient();
    if (!client || !client.hasWallet()) return;

    const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
    if (!profileAddress) return;

    // Wait for deploy — certification tx requires the account entrypoint on-chain
    if (_deployPromise) await _deployPromise.catch(() => {});

    const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
    const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');

    const wallet = client.getWallet();
    const senderAddress = client.getAddress() ?? undefined;
    const paymentMethod = client.getPaymentMethod();
    const artifact = await getUserProfileArtifact();
    const addr = AztecAddress.fromString(profileAddress);

    const node = client.getNode();
    if (node) {
      try {
        const instance = await node.getContract(addr);
        if (instance) await wallet.registerContract(instance, artifact);
      } catch { /* already registered */ }
    }

    const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
    await svc.connect(addr, artifact);
    await triggerCertification(svc, CERTIFICATION_THRESHOLD);
  } catch (err: any) {
    console.warn('[BackgroundWallet] ensureCertification failed:', err?.message);
  }
}

/**
 * Internal: trigger on-chain eligibility certification if not already done.
 * Deduplicates concurrent calls via a shared module-level promise.
 */
async function triggerCertification(svc: any, threshold: number): Promise<void> {
  if (isCertified()) return;

  // If already in progress, wait for the existing tx instead of sending a duplicate
  if (_certificationPromise) return _certificationPromise;

  _certificationPromise = (async () => {
    try {
      await svc.certifyEligible(threshold);
      try {
        const addr = useAppStore.getState().userAddress;
        if (addr) localStorage.setItem(`dc_pts_${addr}_certified`, '1');
      } catch { /* ignore */ }
      console.log('[BackgroundWallet] Eligibility certified on-chain');
    } finally {
      _certificationPromise = null;
    }
  })();

  return _certificationPromise;
}

/**
 * Self-grant initial 500 points from user's own PXE.
 * The contract's _verify_and_mark_initial_grant prevents double-granting on-chain.
 * Per-account localStorage flag prevents re-sending on subsequent logins.
 * Waits for account deploy so the tx has a deployed entrypoint.
 */
async function grantInitialPointsFromClient(client: any): Promise<void> {
  const { isInitialGrantSent, markInitialGrantSent, addOptimisticPoints } = await import('@/lib/pointsTracker');

  // Skip if already granted (per-account check via pointsTracker)
  if (isInitialGrantSent()) {
    console.log('[BackgroundWallet] Initial points already granted (per-account localStorage)');
    useAppStore.getState().setPointsGranted(true);
    return;
  }

  // Wait for deploy — grant tx requires the account entrypoint on-chain
  if (_deployPromise) await _deployPromise.catch(() => {});

  const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
  if (!profileAddress) return;

  const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getUserProfileArtifact();
  const addr = AztecAddress.fromString(profileAddress);

  // Register contract
  const node = client.getNode();
  if (node) {
    try {
      const instance = await node.getContract(addr);
      if (instance) await wallet.registerContract(instance, artifact);
    } catch { /* already registered */ }
  }

  const { Contract, NO_WAIT } = await import('@aztec/aztec.js/contracts');
  const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
  const contract = wrapContractWithCleanNames(await Contract.at(addr, artifact, wallet));

  const sendOpts: any = {
    ...(senderAddress ? { from: senderAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  // Fire-and-forget: proof + send (~15s), don't block on mining (~60s).
  // Optimistic 500 shows immediately after tx sent. On-chain sync confirms later.
  try {
    await contract.methods.grant_initial_points(BigInt(500)).send(sendOpts);
    console.log('[BackgroundWallet] grant_initial_points(500) tx sent (NO_WAIT)');

    // Mark AFTER successful send (proof generated, tx in mempool)
    markInitialGrantSent();
    addOptimisticPoints(500);
    useAppStore.getState().setPointsGranted(true);
    useAppStore.getState().setWalletStatus(null);
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg.includes('already granted') || msg.includes('already')) {
      console.log('[BackgroundWallet] Points already granted on-chain — skipping');
      markInitialGrantSent();
      useAppStore.getState().setPointsGranted(true);
      useAppStore.getState().setWalletStatus(null);
    } else {
      console.warn('[BackgroundWallet] Grant failed:', msg);
      // Don't mark as sent — will retry on next login
      useAppStore.getState().setWalletStatus(null);
    }
  }
}

// ===== INITIAL POINTS GRANT (on-chain, self-service) =====

/**
 * Grant 500 starting points on-chain from the user's own PXE.
 * Uses NO_WAIT — proof + send (~15s), mining happens in background (~60s).
 * On-chain _verify_and_mark_initial_grant prevents double-granting.
 * consume_points also auto-grants on first vote as fallback.
 */
async function grantInitialPointsOnChain(client: any): Promise<void> {
  const { isInitialGrantSent, markInitialGrantSent } = await import('@/lib/pointsTracker');

  if (isInitialGrantSent()) {
    console.log('[BackgroundWallet] Initial points already granted (per-account localStorage)');
    return;
  }

  // Wait for deploy
  if (_deployPromise) await _deployPromise.catch(() => {});

  const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
  if (!profileAddress) return;

  const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getUserProfileArtifact();
  const addr = AztecAddress.fromString(profileAddress);

  const node = client.getNode();
  if (node) {
    try {
      const instance = await node.getContract(addr);
      if (instance) await wallet.registerContract(instance, artifact);
    } catch { /* already registered */ }
  }

  const { Contract, NO_WAIT } = await import('@aztec/aztec.js/contracts');
  const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
  const contract = wrapContractWithCleanNames(await Contract.at(addr, artifact, wallet));

  const sendOpts: any = {
    ...(senderAddress ? { from: senderAddress } : {}),
    ...(paymentMethod ? { fee: { paymentMethod } } : {}),
    wait: NO_WAIT,
  };

  try {
    await contract.methods.grant_initial_points(BigInt(500)).send(sendOpts);
    markInitialGrantSent();
    // Persist 500 to localStorage without firing store listeners.
    // The store already shows 500 from the display hint in useAuthCompletion.
    // Using addOptimisticPoints would fire the listener and double-count to 1000.
    const { setOptimisticPointsQuiet, getOptimisticPoints } = await import('@/lib/pointsTracker');
    if (getOptimisticPoints() === 0) {
      setOptimisticPointsQuiet(500);
    }
    console.log('[BackgroundWallet] grant_initial_points(500) tx sent (NO_WAIT)');
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg.includes('already granted') || msg.includes('already')) {
      markInitialGrantSent();
      console.log('[BackgroundWallet] Points already granted on-chain');
    } else {
      throw err;
    }
  }
}

// ===== VOTE DIRECTION SYNC =====

/**
 * Populate vote directions from cached vote stakes (localStorage).
 * Called on login for instant DuelCard vote indicators.
 */
async function syncVoteDirectionsFromCache(): Promise<void> {
  try {
    const { getCachedVoteStakes } = await import('@/lib/pointsTracker');
    const { setVoteDirection } = await import('@/lib/voteTracker');
    const userAddr = useAppStore.getState().userAddress;
    if (!userAddr) return;

    const stakes = getCachedVoteStakes();
    for (const s of stakes) {
      if (s.dbDuelId == null) continue;
      if (s.direction === 0 || s.direction === 1) {
        setVoteDirection(userAddr, s.dbDuelId, 'dir', String(s.direction));
      }
    }
    console.log(`[BackgroundWallet] Synced ${stakes.length} vote directions from cache`);
  } catch { /* non-fatal */ }
}

/**
 * Background: read VoteStakeNotes from PXE and update vote directions + cache.
 * Called after PXE has had time to sync blocks. Source of truth for directions.
 */
async function syncVoteDirectionsFromPXE(): Promise<void> {
  try {
    const { getAztecClient } = await import('@/lib/aztec/client');
    const client = getAztecClient();
    if (!client?.hasWallet()) return;

    const duelCloakAddress = (import.meta as any).env?.VITE_DUELCLOAK_ADDRESS;
    if (!duelCloakAddress) return;

    const { getDuelCloakArtifact } = await import('@/lib/aztec/contracts');
    const { DuelCloakService } = await import('@/lib/templates/DuelCloakService');
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');
    const { getCachedVoteStakes, cacheVoteStakes } = await import('@/lib/pointsTracker');
    const { setVoteDirection } = await import('@/lib/voteTracker');

    const wallet = client.getWallet();
    const senderAddress = client.getAddress() ?? undefined;
    const paymentMethod = client.getPaymentMethod();
    const artifact = await getDuelCloakArtifact();
    const addr = AztecAddress.fromString(duelCloakAddress);

    const node = client.getNode();
    if (node) {
      try {
        const instance = await node.getContract(addr);
        if (instance) await wallet.registerContract(instance, artifact);
      } catch { /* already registered */ }
    }

    const svc = new DuelCloakService(wallet, senderAddress, paymentMethod);
    await svc.connect(addr, artifact);
    const notes = await svc.getMyVoteStakeNotes();

    if (notes.length === 0) return;

    // Filter: only keep notes for non-finalized duels (active stakes).
    // Finalized ones should be claimed by auto-claim; orphaned ones are ignored.
    const activeNotes: typeof notes = [];
    for (const n of notes) {
      try {
        const finalized = await svc.isDuelFinalized(n.duelId);
        if (!finalized) activeNotes.push(n);
      } catch {
        activeNotes.push(n); // can't check — include to be safe
      }
    }

    const userAddr = useAppStore.getState().userAddress;

    // Merge PXE notes with existing cache to preserve title (PXE notes don't have title)
    const existingCache = getCachedVoteStakes();
    const stakes = activeNotes.map((n) => {
      const cached = existingCache.find((c) => c.duelId === n.duelId);
      return {
        duelId: n.duelId,
        dbDuelId: n.dbDuelId || cached?.dbDuelId || undefined,
        direction: n.direction,
        stakeAmount: n.stakeAmount,
        slug: cached?.slug || undefined,
        title: cached?.title || undefined,
      };
    });
    cacheVoteStakes(stakes);

    // Update vote directions from on-chain source of truth
    if (userAddr) {
      for (const n of activeNotes) {
        if (!n.dbDuelId) continue;
        if (n.direction === 0 || n.direction === 1) {
          setVoteDirection(userAddr, n.dbDuelId, 'dir', String(n.direction));
        }
      }
    }

    console.log(`[BackgroundWallet] Synced ${notes.length} vote directions from PXE (on-chain)`);
  } catch (err: any) {
    console.warn('[BackgroundWallet] PXE vote direction sync failed:', err?.message);
  }
}

// ===== AUTO-CLAIM REWARDS (Market Voting V9) =====

const AUTO_CLAIM_INTERVAL_MS = 60_000; // Check every 60s
let _autoClaimTimer: ReturnType<typeof setInterval> | null = null;
let _autoClaimRunning = false;

/**
 * Auto-claim rewards for finalized duels.
 * Reads VoteStakeNotes from PXE, checks outcomes via RPC, claims winning bets.
 */
export async function autoClaimRewards(): Promise<number> {
  if (_autoClaimRunning) return 0;
  _autoClaimRunning = true;

  try {
    const { getAztecClient } = await import('@/lib/aztec/client');
    const client = getAztecClient();
    if (!client?.hasWallet()) return 0;

    const duelCloakAddress = (import.meta as any).env?.VITE_DUELCLOAK_ADDRESS;
    if (!duelCloakAddress) return 0;

    const { getDuelCloakArtifact } = await import('@/lib/aztec/contracts');
    const { DuelCloakService } = await import('@/lib/templates/DuelCloakService');
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');
    const { addOptimisticPoints, getDuelSlugMap } = await import('@/lib/pointsTracker');
    const { addLocalNotification } = await import('@/lib/notifications/localNotifications');

    // Fetch slug map to resolve full slugs + titles (on-chain slugs are truncated)
    const slugMap = await getDuelSlugMap();

    const wallet = client.getWallet();
    const senderAddress = client.getAddress() ?? undefined;
    const paymentMethod = client.getPaymentMethod();
    const artifact = await getDuelCloakArtifact();
    const addr = AztecAddress.fromString(duelCloakAddress);

    // Register contract
    const node = client.getNode();
    if (node) {
      try {
        const instance = await node.getContract(addr);
        if (instance) await wallet.registerContract(instance, artifact);
      } catch { /* already registered */ }
    }

    const svc = new DuelCloakService(wallet, senderAddress, paymentMethod);
    await svc.connect(addr, artifact);

    const notes = await svc.getMyVoteStakeNotes();
    if (notes.length === 0) return 0;

    let claimed = 0;
    for (const note of notes) {
      try {
        const finalized = await svc.isDuelFinalized(note.duelId);
        if (!finalized) continue;

        const outcome = await svc.getDuelOutcome(note.duelId);
        if (outcome === null) continue;

        // Add random jitter (0-15s) to reduce timing correlation
        await new Promise((r) => setTimeout(r, Math.random() * 15_000));

        if (note.direction === outcome) {
          // Winner — claim 100 pts
          try {
            await svc.claimReward(note.duelId, note.direction);
            addOptimisticPoints(100);
            const mapEntry = note.dbDuelId ? slugMap[note.dbDuelId] : null;
            addLocalNotification('market_win', note.duelId, note.stakeAmount, 100, mapEntry?.slug, mapEntry?.title, note.dbDuelId);
            console.log(`[autoClaim] Reward claimed: duel=${note.duelId}, +100 pts`);
            claimed++;
          } catch (err: any) {
            if (err?.message?.includes('nullifier')) continue; // already claimed
            console.warn('[autoClaim] Claim failed:', err?.message);
          }
        } else {
          // Loser — stake already consumed, nothing to do on-chain
          const mapEntry = note.dbDuelId ? slugMap[note.dbDuelId] : null;
          addLocalNotification('market_loss', note.duelId, note.stakeAmount, 0, mapEntry?.slug, mapEntry?.title, note.dbDuelId);
          console.log(`[autoClaim] Loss detected: duel=${note.duelId}, stake=${note.stakeAmount} burned`);
        }
      } catch (err: any) {
        console.warn(`[autoClaim] Error processing duel ${note.duelId}:`, err?.message);
      }
    }

    return claimed;
  } catch (err: any) {
    console.warn('[autoClaim] Failed:', err?.message);
    return 0;
  } finally {
    _autoClaimRunning = false;
  }
}

/**
 * Start periodic auto-claim checking (called after wallet creation).
 */
export function startAutoClaimTimer(): void {
  if (_autoClaimTimer) return;
  // Initial check after 30s (let PXE sync first)
  setTimeout(() => autoClaimRewards().catch(() => {}), 30_000);
  _autoClaimTimer = setInterval(() => autoClaimRewards().catch(() => {}), AUTO_CLAIM_INTERVAL_MS);
}

/**
 * Stop auto-claim timer (call on logout).
 */
export function stopAutoClaimTimer(): void {
  if (_autoClaimTimer) {
    clearInterval(_autoClaimTimer);
    _autoClaimTimer = null;
  }
}

/**
 * Store username on-chain via UserProfile contract.
 * Background tx — does not block wallet creation or voting.
 */
async function storeUsernameOnChain(client: any, username: string): Promise<void> {
  const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
  if (!profileAddress) {
    console.log('[BackgroundWallet] No VITE_USER_PROFILE_ADDRESS — skipping username store');
    return;
  }

  // Wait for account deploy + constructor confirmation before sending username tx
  if (_deployPromise) await _deployPromise.catch(() => {});

  const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
  const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getUserProfileArtifact();
  const addr = AztecAddress.fromString(profileAddress);

  // Register contract with PXE (retry up to 3 times — node may not have indexed it yet)
  const node = client.getNode();
  if (node) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const instance = await node.getContract(addr);
        if (instance) {
          await wallet.registerContract(instance, artifact);
          break;
        }
      } catch { /* may already be registered */ }
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }

  const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
  await svc.connect(addr, artifact);
  await svc.setUsername(username);
  console.log(`[BackgroundWallet] Username "${username}" stored on-chain`);
}
