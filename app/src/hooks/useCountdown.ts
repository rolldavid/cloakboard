import { useState, useEffect, useRef } from 'react';
import { fetchBlockClock, type BlockClock } from '@/lib/api/duelClient';

const NEVER_ENDING_BLOCK = 4294967295; // u32::MAX
const VOTING_BUFFER_SECONDS = 90;
const CLOCK_REFRESH_INTERVAL = 60_000; // refresh block clock every 60s

// Module-level cached block clock (shared across all hook instances)
let cachedClock: BlockClock | null = null;
let clockFetchPromise: Promise<BlockClock> | null = null;
let lastFetchTime = 0;

async function getBlockClock(forceRefresh = false): Promise<BlockClock | null> {
  const now = Date.now();
  if (!forceRefresh && cachedClock && now - lastFetchTime < CLOCK_REFRESH_INTERVAL) {
    return cachedClock;
  }
  if (clockFetchPromise) return clockFetchPromise;
  clockFetchPromise = fetchBlockClock()
    .then((clock) => {
      cachedClock = clock;
      lastFetchTime = Date.now();
      clockFetchPromise = null;
      return clock;
    })
    .catch(() => {
      clockFetchPromise = null;
      return cachedClock;
    });
  return clockFetchPromise;
}

function estimateSecondsRemaining(clock: BlockClock, endBlock: number): number {
  // If the clock was never initialized (blockNumber 0) or is too stale (>10min), we can't estimate reliably
  if (clock.blockNumber === 0) return Infinity;

  // Estimate the current block based on time elapsed since observation
  const elapsedSinceObs = (Date.now() - new Date(clock.observedAt).getTime()) / 1000;
  // Cap extrapolation at 10 minutes — beyond that the drift is too large
  const cappedElapsed = Math.min(elapsedSinceObs, 600);
  const estimatedCurrentBlock = clock.blockNumber + cappedElapsed / clock.avgBlockTime;
  const remainingBlocks = endBlock - estimatedCurrentBlock;
  return Math.max(0, remainingBlocks * clock.avgBlockTime);
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Ended';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export interface CountdownResult {
  /** Formatted countdown string, or null if no end block */
  timeLeft: string | null;
  /** Seconds remaining, or null if no end block */
  secondsLeft: number | null;
  /** True when voting should be disabled (< 90s remaining) */
  isClosing: boolean;
  /** True when the duel has ended */
  hasEnded: boolean;
}

export function useCountdown(endBlock: number | null | undefined): CountdownResult {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const clockRef = useRef<BlockClock | null>(null);

  // Fetch block clock and set up refresh
  useEffect(() => {
    if (!endBlock || endBlock >= NEVER_ENDING_BLOCK) return;

    let cancelled = false;

    const refresh = async () => {
      const clock = await getBlockClock();
      if (!cancelled && clock) {
        clockRef.current = clock;
        setSecondsLeft(estimateSecondsRemaining(clock, endBlock));
      }
    };

    refresh();
    const refreshInterval = setInterval(() => getBlockClock(true).then((c) => {
      if (!cancelled && c) clockRef.current = c;
    }), CLOCK_REFRESH_INTERVAL);

    return () => { cancelled = true; clearInterval(refreshInterval); };
  }, [endBlock]);

  // Tick every second
  useEffect(() => {
    if (!endBlock || endBlock >= NEVER_ENDING_BLOCK) return;
    if (!clockRef.current) return;

    const interval = setInterval(() => {
      if (clockRef.current) {
        setSecondsLeft(estimateSecondsRemaining(clockRef.current, endBlock));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [endBlock, clockRef.current !== null]);

  if (!endBlock || endBlock >= NEVER_ENDING_BLOCK) {
    return { timeLeft: null, secondsLeft: null, isClosing: false, hasEnded: false };
  }

  const hasEnded = secondsLeft !== null && isFinite(secondsLeft) && secondsLeft <= 0;
  const isClosing = secondsLeft !== null && isFinite(secondsLeft) && secondsLeft > 0 && secondsLeft <= VOTING_BUFFER_SECONDS;
  const timeLeft = secondsLeft !== null && isFinite(secondsLeft) ? formatCountdown(secondsLeft) : null;

  return { timeLeft, secondsLeft, isClosing, hasEnded };
}
