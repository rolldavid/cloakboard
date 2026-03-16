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
  warmupPromise = doWarmupWithRetry();
}

async function doWarmupWithRetry(): Promise<{ wallet: WalletLike; node: any }> {
  try {
    return await doWarmup();
  } catch (err: any) {
    // Auto-retry once on timeout — mobile Safari often succeeds on second attempt
    // (first attempt may fail due to cold network/IndexedDB/WASM cache)
    if (err?.message?.includes('timed out')) {
      console.log('[PXE Warmup] Retrying after timeout...');
      try {
        useAppStore.getState().setWalletStatus('Retrying initialization...');
      } catch { /* store not ready */ }
      return await doWarmup();
    }
    throw err;
  }
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
    setStatus('Connecting...');

    const isMobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
    const isAndroid = isMobile && typeof navigator !== 'undefined'
      && /Android/.test(navigator.userAgent);

    // Early check: SharedArrayBuffer requires crossOriginIsolated (COOP + COEP headers).
    // Safari does NOT support COEP: credentialless — only require-corp.
    // Without crossOriginIsolated, bb.js uses single-threaded non-shared WASM.
    const crossOriginOk = typeof self !== 'undefined' && self.crossOriginIsolated;
    if (!crossOriginOk) {
      console.warn('[PXE Warmup] crossOriginIsolated=false — using single-threaded WASM. On iOS, COEP must be require-corp (credentialless not supported by WebKit).');
    }

    // Patch bb.js defaults for mobile BEFORE any Barretenberg initialization.
    // bb.js only auto-reduces SRS + memory for /iPad|iPhone/ — Android gets desktop
    // defaults (67MB SRS, 4GB memory) which cause OOM. Patch both.
    if (isMobile) {
      try {
        const bbjs = await import('@aztec/bb.js');
        if (isAndroid && bbjs.Barretenberg?.prototype?.getDefaultSrsSize) {
          bbjs.Barretenberg.prototype.getDefaultSrsSize = () => 2 ** 18;
          console.log(`[PXE Warmup] Patched Android SRS to 2^18 (16MB) [${elapsed()}]`);
        }
      } catch (err: any) {
        console.warn('[PXE Warmup] BB SRS patch failed (non-fatal):', err?.message);
      }

      // Cap WebAssembly.Memory maximum for ALL mobile. bb.js's
      // BarretenbergWasmMain.getDefaultMaximumMemoryPages() only reduces memory
      // for /iPad|iPhone/ — Android gets 4GB (2^16 pages) → OOM.
      // BarretenbergSync is a SEPARATE WASM instance that doesn't receive our
      // proverOpts.memory setting, so we must cap at the WebAssembly level.
      // 16384 pages = 1GB — sufficient for all proving operations.
      try {
        const OrigMemory = WebAssembly.Memory;
        const MOBILE_MAX_PAGES = 2 ** 14; // 1GB
        WebAssembly.Memory = function PatchedMemory(
          descriptor: WebAssembly.MemoryDescriptor,
        ) {
          if (descriptor.maximum && descriptor.maximum > MOBILE_MAX_PAGES) {
            descriptor.maximum = MOBILE_MAX_PAGES;
          }
          return new OrigMemory(descriptor);
        } as any;
        // Preserve prototype chain for instanceof checks
        (WebAssembly.Memory as any).prototype = OrigMemory.prototype;
        console.log(`[PXE Warmup] Patched WebAssembly.Memory cap to ${MOBILE_MAX_PAGES} pages (1GB) [${elapsed()}]`);
      } catch (err: any) {
        console.warn('[PXE Warmup] Memory cap patch failed (non-fatal):', err?.message);
      }
    }

    // Pre-initialize BarretenbergSync (fire-and-forget). This WASM singleton is
    // triggered during EmbeddedWallet.create() → registerProtocolContracts() →
    // poseidon2Hash/vkAsFieldsMegaHonk. Pre-warming it here overlaps WASM compile
    // with the node connection. BarretenbergSync is separate from the async
    // Barretenberg used for proving.
    const bbSyncPreInit = (async () => {
      try {
        const { BarretenbergSync } = await import('@aztec/bb.js');
        await BarretenbergSync.initSingleton();
        console.log(`[PXE Warmup] BarretenbergSync pre-initialized [${elapsed()}]`);
      } catch (err: any) {
        console.warn('[PXE Warmup] BarretenbergSync pre-init failed:', err?.message);
      }
    })();

    // Pre-fetch SRS (CRS) into IndexedDB cache (fire-and-forget). The SRS is a
    // ~16MB download (at 2^18) that normally happens lazily on first proof. By
    // triggering it here in parallel with node connection + EmbeddedWallet creation,
    // it's already cached by the time the first vote proof runs.
    (async () => {
      try {
        const { Crs } = await import('@aztec/bb.js');
        const srsSize = isMobile ? 2 ** 18 : 2 ** 20;
        const crs = new Crs(srsSize);
        await crs.init();
        console.log(`[PXE Warmup] SRS pre-cached (2^${Math.log2(srsSize)}, ${srsSize * 64 / 1024 / 1024}MB) [${elapsed()}]`);
      } catch (err: any) {
        console.warn('[PXE Warmup] SRS pre-cache failed (non-fatal):', err?.message);
      }
    })();

    const nodeUrl = (import.meta as any).env?.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
    const sponsoredFpcAddress = (import.meta as any).env?.VITE_SPONSORED_FPC_ADDRESS;

    const { createAztecNodeClient, waitForNode } = await import('@aztec/aztec.js/node');
    const node = createAztecNodeClient(nodeUrl);

    // waitForNode uses retryUntil with timeout=0 (infinite). Wrap in a timeout
    // so mobile doesn't hang forever if the Aztec node is unreachable.
    const NODE_TIMEOUT_MS = 30_000;
    const nodeResult = await Promise.race([
      waitForNode(node).then(() => ({ ok: true as const })),
      new Promise<{ ok: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false }), NODE_TIMEOUT_MS),
      ),
    ]);
    if (!nodeResult.ok) {
      throw new Error(`Aztec node unreachable after ${NODE_TIMEOUT_MS / 1000}s`);
    }
    console.log(`[PXE Warmup] Node connected [${elapsed()}]`);
    setStatus('Getting your account ready...');

    const { EmbeddedWallet } = await import('@aztec/wallets/embedded');
    const hwThreads = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || 4) : 4;
    // Mobile: 2 threads if crossOriginIsolated (SharedArrayBuffer available),
    // else 1 thread. Desktop: use all cores up to 32.
    const threads = isMobile
      ? (crossOriginOk ? Math.min(hwThreads, 2) : 1)
      : Math.min(hwThreads, 32);

    const proverOpts: any = { threads };
    if (isMobile) {
      proverOpts.memory = { maximum: 16384 }; // 1GB — cap for both iOS and Android
    }

    console.log(`[PXE Warmup] Creating EmbeddedWallet (${threads} threads, mobile=${isMobile})... [${elapsed()}]`);

    // Tick status every 3s so the user sees progress (EmbeddedWallet.create is a black box
    // that does network calls, IndexedDB, WASM init, protocol contract registration — any
    // of which can silently hang on mobile Safari). Also enforce a hard timeout.
    const EMBEDDED_WALLET_TIMEOUT_MS = isMobile ? 120_000 : 60_000;
    const statusTick = setInterval(() => {
      setStatus(`Getting your account ready... ${Math.floor((Date.now() - t0) / 1000)}s`);
    }, 3000);

    let wallet: WalletLike;
    try {
      const createResult = await Promise.race([
        EmbeddedWallet.create(node as any, {
          ephemeral: false,
          pxeConfig: { proverEnabled: true, l2BlockBatchSize: isMobile ? 50 : 500 },
          pxeOptions: { proverOrOptions: proverOpts },
        }).then((w) => ({ ok: true as const, wallet: w })),
        new Promise<{ ok: false }>((resolve) =>
          setTimeout(() => resolve({ ok: false }), EMBEDDED_WALLET_TIMEOUT_MS),
        ),
      ]);

      if (!createResult.ok) {
        throw new Error(`EmbeddedWallet.create() timed out after ${EMBEDDED_WALLET_TIMEOUT_MS / 1000}s`);
      }
      wallet = createResult.wallet;
    } finally {
      clearInterval(statusTick);
    }

    console.log(`[PXE Warmup] EmbeddedWallet ready (${threads} threads) [${elapsed()}]`);
    setStatus('Almost ready...');

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
    console.error(`[PXE Warmup] Failed:`, err?.message, err);
    try {
      // Show actual error on mobile so user can report the exact failure
      const errMsg = err?.message?.slice(0, 120) || 'unknown error';
      useAppStore.getState().setWalletStatus(`Error: ${errMsg}`);
    } catch { /* store not ready */ }
    // Reset so caller falls through to normal init
    warmupPromise = null;
    throw err;
  }
}
