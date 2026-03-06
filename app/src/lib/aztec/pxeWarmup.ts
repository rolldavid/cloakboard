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
    console.log(`[PXE Warmup] Starting...`);

    const nodeUrl = (import.meta as any).env?.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com';
    const sponsoredFpcAddress = (import.meta as any).env?.VITE_SPONSORED_FPC_ADDRESS;

    const { createAztecNodeClient, waitForNode } = await import('@aztec/aztec.js/node');
    const node = createAztecNodeClient(nodeUrl);
    await waitForNode(node);
    console.log(`[PXE Warmup] Node connected [${elapsed()}]`);

    const { EmbeddedWallet } = await import('@aztec/wallets/embedded');
    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    const hwThreads = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || 4) : 4;
    // Mobile: cap at 4 threads to avoid thermal throttling + reduce memory pressure.
    // Desktop: use all available cores up to 32.
    const threads = isMobile ? Math.min(hwThreads, 4) : Math.min(hwThreads, 32);

    const proverOpts: any = { threads };
    // Android gets desktop WASM defaults (64MB SRS, 4GB memory). Cap memory like iOS.
    if (isMobile && /Android/.test(navigator.userAgent)) {
      proverOpts.memory = { maximum: 16384 }; // 1GB (same as iOS default)
    }

    console.log(`[PXE Warmup] Creating EmbeddedWallet (${threads} threads, mobile=${isMobile})... [${elapsed()}]`);
    const wallet = await EmbeddedWallet.create(node as any, {
      ephemeral: true,
      pxeConfig: { proverEnabled: true, l2BlockBatchSize: isMobile ? 15 : 50 },
      pxeOptions: { proverOrOptions: proverOpts },
    });
    console.log(`[PXE Warmup] EmbeddedWallet ready (${threads} threads) [${elapsed()}]`);

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
