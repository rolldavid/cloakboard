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
}

async function createWalletInBackground(): Promise<string | null> {
  if (!_pending) return null;
  const { keys, username } = _pending;

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    console.log(`[BackgroundWallet] Starting wallet creation... [${elapsed()}]`);

    // 1. Initialize Aztec client
    const nodeUrl = (import.meta as any).env?.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com';
    const sponsoredFpcAddress = (import.meta as any).env?.VITE_SPONSORED_FPC_ADDRESS;
    const environment = ((import.meta as any).env?.VITE_DEFAULT_NETWORK || 'devnet') as AztecConfig['environment'];

    const config: AztecConfig = { nodeUrl, environment, sponsoredFpcAddress };
    const client = await createAztecClient(config);
    console.log(`[BackgroundWallet] Aztec client initialized [${elapsed()}]`);

    // 2. Import account from derived keys
    const { address } = await client.importAccountFromDerivedKeys(keys);
    const addressStr = address.toString();
    console.log(`[BackgroundWallet] Account imported: ${addressStr.slice(0, 14)}... [${elapsed()}]`);

    // 3. Deploy account (SponsoredFPC pays gas) — fire-and-forget, but track completion.
    //    Browser WASM proof generation can hang on mobile, so we race with a timeout
    //    and fall back to periodic on-chain rechecks.
    const DEPLOY_SEND_TIMEOUT_MS = 90_000; // 90s — generous for mobile WASM
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
          console.warn(`[BackgroundWallet] Deploy proof timed out after ${DEPLOY_SEND_TIMEOUT_MS / 1000}s (mobile?) [${elapsed()}]`);
        }

        // Fallback: periodic on-chain recheck (deploy may still complete in background,
        // or may have been done in a previous session)
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
        console.warn(`[BackgroundWallet] Deploy never confirmed [${elapsed()}]`);
      } catch (deployErr: any) {
        // "Already deployed" counts as success
        if (deployErr?.message?.includes('alreadyDeployed') || deployErr?.message?.includes('Already deployed')) {
          _deployResolved = true;
          useAppStore.getState().setDeployed(true);
          return;
        }
        console.warn(`[BackgroundWallet] Deploy failed (non-fatal): ${deployErr?.message}`);
      }
    })();

    // 4. Store username on UserProfile contract (background tx, fire-and-forget)
    if (username) {
      storeUsernameOnChain(client, username).catch((err: any) =>
        console.warn(`[BackgroundWallet] Username store failed (non-fatal): ${err?.message}`),
      );
    }

    // 5. Eagerly trigger certification using optimistic points (no PXE read needed).
    //    This fires immediately after deploy for returning users with enough points.
    const { getOptimisticPoints } = await import('@/lib/pointsTracker');
    if (getOptimisticPoints() >= CERTIFICATION_THRESHOLD && !isCertified()) {
      ensureCertification().catch((err: any) =>
        console.warn(`[BackgroundWallet] Eager certification failed (non-fatal): ${err?.message}`),
      );
    }

    // 6. Refresh whisper points from on-chain (after deploy + PXE sync)
    //    Also triggers certification if optimistic check above didn't fire.
    refreshPointsFromChain(client).catch((err: any) =>
      console.warn(`[BackgroundWallet] Points refresh failed (non-fatal): ${err?.message}`),
    );

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

  // Wait for account deploy so PXE has synced blocks with our notes
  if (_deployPromise) await _deployPromise.catch(() => {});

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
  const onChainPoints = await svc.getMyPoints();
  syncOptimisticPoints(onChainPoints);
  console.log(`[BackgroundWallet] On-chain points: ${onChainPoints}`);

  // If eligible, certify in background (one-time, tracked via localStorage)
  if (onChainPoints >= 10) {
    triggerCertification(svc, 10).catch((err: any) =>
      console.warn(`[BackgroundWallet] Certification failed (non-fatal): ${err?.message}`),
    );
  }
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

const CERTIFIED_KEY = 'duelcloak_eligible_certified';
const CERTIFICATION_THRESHOLD = 10;
let _certificationPromise: Promise<void> | null = null;

/**
 * Check if the user is already certified (localStorage flag).
 */
export function isCertified(): boolean {
  try {
    return localStorage.getItem(CERTIFIED_KEY) === '1';
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
      try { localStorage.setItem(CERTIFIED_KEY, '1'); } catch { /* ignore */ }
      console.log('[BackgroundWallet] Eligibility certified on-chain');
    } finally {
      _certificationPromise = null;
    }
  })();

  return _certificationPromise;
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
