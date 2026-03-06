/**
 * PXE Warmup — Eagerly initialize EmbeddedWallet (PXE + WASM prover + threads)
 * before authentication completes.
 *
 * EmbeddedWallet.create() does NOT need account keys — it initializes PXE,
 * loads WASM, sets up threads, and registers protocol contracts independently.
 *
 * Strategy:
 * - Google OAuth: warmup at module-load of GoogleCallback.tsx (redirect kills prior state)
 * - Ethereum/Solana/Passkey: warmup on login page (wallet popup, no redirect)
 * - Returning users: warmup on app boot via main.tsx
 *
 * All calls are idempotent — the singleton promise is created once.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { useAppStore } from '@/store';

type WalletLike = any;

let warmupPromise: Promise<{ wallet: WalletLike; node: any }> | null = null;
let artifactPromise: Promise<void> | null = null;

/**
 * Start PXE + WASM prover initialization. Safe to call multiple times (singleton).
 */
export function startPxeWarmup(): void {
  if (warmupPromise) return;
  warmupPromise = doWarmup();
}

/**
 * Get the warmup promise. Returns null if warmup hasn't started.
 */
export function getPxeWarmupPromise(): Promise<{ wallet: WalletLike; node: any }> | null {
  return warmupPromise;
}

/**
 * Reset the warmup singleton. Must be called on logout so the next login
 * gets a fresh EmbeddedWallet without the previous account's keys registered.
 */
export function resetPxeWarmup(): void {
  warmupPromise = null;
}

/**
 * Pre-cache DuelCloak + UserProfile + VoteHistory artifacts (dynamic imports).
 * Safe to call multiple times (singleton).
 */
export function preloadArtifacts(): void {
  if (artifactPromise) return;
  artifactPromise = (async () => {
    try {
      const { getDuelCloakArtifact, getUserProfileArtifact, getVoteHistoryArtifact } = await import('./contracts');
      await Promise.all([getDuelCloakArtifact(), getUserProfileArtifact(), getVoteHistoryArtifact()]);
      console.log('[PXE Warmup] Artifacts pre-cached');
    } catch (err: any) {
      console.warn('[PXE Warmup] Artifact preload failed:', err?.message);
    }
  })();
}

async function doWarmup(): Promise<{ wallet: WalletLike; node: any }> {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    const setStatus = (s: string) => {
      try { useAppStore.getState().setWalletStatus(s); } catch { /* store not ready */ }
    };
    console.log(`[PXE Warmup] Starting...`);
    setStatus('Connecting to Aztec network...');

    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    const isAndroid = isMobile && typeof navigator !== 'undefined'
      && /Android/.test(navigator.userAgent);

    // Early check: SharedArrayBuffer requires crossOriginIsolated (COOP + COEP headers).
    // Without it, bb.js WasmWorker backend can't use multi-threaded WASM.
    if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
      console.warn('[PXE Warmup] crossOriginIsolated=false — SharedArrayBuffer unavailable. Multi-threaded WASM proving will fail. Check COOP/COEP headers.');
    }

    // Android: bb.js only auto-reduces SRS for iPad/iPhone. Patch before any BB init
    // so Android gets 2^18 (16MB) instead of 2^20 (67MB).
    if (isAndroid) {
      try {
        const { Barretenberg } = await import('@aztec/bb.js');
        if (Barretenberg?.prototype?.getDefaultSrsSize) {
          Barretenberg.prototype.getDefaultSrsSize = () => 2 ** 18;
          console.log(`[PXE Warmup] Patched Android SRS to 2^18 (16MB) [${elapsed()}]`);
        }
      } catch { /* non-fatal */ }
    }

    const nodeUrl = (import.meta as any).env?.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com';
    const sponsoredFpcAddress = (import.meta as any).env?.VITE_SPONSORED_FPC_ADDRESS;

    const { createAztecNodeClient, waitForNode } = await import('@aztec/aztec.js/node');
    const node = createAztecNodeClient(nodeUrl);
    await waitForNode(node);
    console.log(`[PXE Warmup] Node connected [${elapsed()}]`);
    setStatus('Initializing voting engine...');

    const { EmbeddedWallet } = await import('@aztec/wallets/embedded');
    const hwThreads = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || 4) : 4;
    // Mobile: use 1 thread to avoid sub-worker SharedArrayBuffer contention.
    // Single-threaded is slower but completes reliably on iOS/Android.
    const threads = isMobile ? 1 : Math.min(hwThreads, 32);

    const proverOpts: any = { threads };
    if (isMobile) {
      proverOpts.memory = { maximum: 16384 }; // 1GB — cap for both iOS and Android
    }

    console.log(`[PXE Warmup] Creating EmbeddedWallet (${threads} threads, mobile=${isMobile})... [${elapsed()}]`);
    const wallet = await EmbeddedWallet.create(node as any, {
      ephemeral: true,
      pxeConfig: { proverEnabled: true, l2BlockBatchSize: isMobile ? 5 : 50 },
      pxeOptions: { proverOrOptions: proverOpts },
    });
    console.log(`[PXE Warmup] EmbeddedWallet ready (${threads} threads) [${elapsed()}]`);
    setStatus('Registering contracts...');

    // Pre-initialize Barretenberg singleton eagerly (fire-and-forget).
    // BB is lazily initialized by the prover — first proof (account deploy) would
    // otherwise pay the full init cost: WASM fetch + compile + SRS download (~16MB)
    // + worker threads. By pre-initializing here, this overlaps with auth flow.
    // Don't await — let it complete in background. The singleton pattern ensures
    // the lazy prover reuses our in-progress promise.
    (async () => {
      try {
        const { Barretenberg } = await import('@aztec/bb.js');
        await Barretenberg.initSingleton({ threads, memory: proverOpts.memory });
        console.log(`[PXE Warmup] Barretenberg pre-initialized [${elapsed()}]`);
      } catch (err: any) {
        console.warn('[PXE Warmup] BB pre-init failed (non-fatal):', err?.message);
      }
    })();

    // Register SponsoredFPC eagerly
    if (sponsoredFpcAddress) {
      try {
        const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
        const fpcAddr = AztecAddress.fromString(sponsoredFpcAddress);
        const fpcInstance = await node.getContract(fpcAddr);
        if (fpcInstance) {
          await wallet.registerContract(fpcInstance as any, SponsoredFPCContract.artifact as any);
          console.log(`[PXE Warmup] SponsoredFPC registered [${elapsed()}]`);
        }
      } catch (err: any) {
        console.warn('[PXE Warmup] FPC registration failed:', err?.message);
      }
    }

    // Register UserProfile eagerly — eliminates registration overhead from awardPointsInBackground
    const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
    if (profileAddress) {
      try {
        const { getUserProfileArtifact } = await import('./contracts');
        const profileAddr = AztecAddress.fromString(profileAddress);
        const profileInstance = await node.getContract(profileAddr);
        if (profileInstance) {
          const profileArtifact = await getUserProfileArtifact();
          await wallet.registerContract(profileInstance as any, profileArtifact as any);
          console.log(`[PXE Warmup] UserProfile registered [${elapsed()}]`);
        }
      } catch (err: any) {
        console.warn('[PXE Warmup] UserProfile registration failed:', err?.message);
      }
    }

    // Register VoteHistory eagerly — eliminates registration overhead from recordVoteInBackground
    const voteHistoryAddress = (import.meta as any).env?.VITE_VOTE_HISTORY_ADDRESS;
    if (voteHistoryAddress) {
      try {
        const { getVoteHistoryArtifact } = await import('./contracts');
        const vhAddr = AztecAddress.fromString(voteHistoryAddress);
        const vhInstance = await node.getContract(vhAddr);
        if (vhInstance) {
          const vhArtifact = await getVoteHistoryArtifact();
          await wallet.registerContract(vhInstance as any, vhArtifact as any);
          console.log(`[PXE Warmup] VoteHistory registered [${elapsed()}]`);
        }
      } catch (err: any) {
        console.warn('[PXE Warmup] VoteHistory registration failed:', err?.message);
      }
    }

    // Register DuelCloak eagerly — eliminates registration overhead from useDuelService (~2-3s saved)
    const duelCloakAddress = (import.meta as any).env?.VITE_DUELCLOAK_ADDRESS;
    if (duelCloakAddress) {
      try {
        const { getDuelCloakArtifact } = await import('./contracts');
        const dcAddr = AztecAddress.fromString(duelCloakAddress);
        const dcInstance = await node.getContract(dcAddr);
        if (dcInstance) {
          const dcArtifact = await getDuelCloakArtifact();
          await wallet.registerContract(dcInstance as any, dcArtifact as any);
          console.log(`[PXE Warmup] DuelCloak registered [${elapsed()}]`);
        }
      } catch (err: any) {
        console.warn('[PXE Warmup] DuelCloak registration failed:', err?.message);
      }
    }

    return { wallet, node };
  } catch (err: any) {
    console.error(`[PXE Warmup] Failed:`, err?.message);
    // Reset so caller falls through to normal init
    warmupPromise = null;
    throw err;
  }
}
