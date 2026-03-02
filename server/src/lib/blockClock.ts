/**
 * In-memory block clock — updated by keeperCron, read by feed endpoint.
 *
 * Computes average seconds-per-block from real on-chain block timestamps
 * (last 100 blocks) so that feed endTime estimates are accurate regardless
 * of how fast or slow the L2 is producing blocks.
 */

interface BlockClock {
  blockNumber: number;
  /** On-chain timestamp of the latest block (unix seconds) */
  blockTimestamp: number;
  /** When this reading was taken (for aging the estimate) */
  observedAt: Date;
  /** Measured average seconds per block (from last 100 blocks) */
  avgBlockTime: number;
}

const DEFAULT_BLOCK_TIME = 30; // fallback before first measurement

let latest: BlockClock = {
  blockNumber: 0,
  blockTimestamp: 0,
  observedAt: new Date(),
  avgBlockTime: DEFAULT_BLOCK_TIME,
};

/**
 * Update the block clock with fresh data from the Aztec node.
 * Called by keeperCron every cycle.
 *
 * @param node - Aztec node client (has getBlock, getBlockNumber)
 */
export async function refreshBlockClock(node: any): Promise<void> {
  try {
    const currentBlock = await node.getBlock('latest');
    if (!currentBlock) return;

    const currentNumber = Number(currentBlock.number ?? (await node.getBlockNumber()));
    const currentTs = Number(currentBlock.timestamp);

    // Compute average block time from a block ~100 blocks ago
    let avgBlockTime = DEFAULT_BLOCK_TIME;
    const lookback = Math.min(100, currentNumber - 1);
    if (lookback > 0) {
      try {
        const pastBlock = await node.getBlock(currentNumber - lookback);
        if (pastBlock) {
          const pastTs = Number(pastBlock.timestamp);
          const elapsed = currentTs - pastTs;
          if (elapsed > 0 && lookback > 0) {
            avgBlockTime = elapsed / lookback;
          }
        }
      } catch { /* use default */ }
    }

    const prev = latest;
    latest = {
      blockNumber: currentNumber,
      blockTimestamp: currentTs,
      observedAt: new Date(),
      avgBlockTime,
    };

    // Log on first init or when block time changes significantly
    if (prev.blockNumber === 0 || Math.abs(prev.avgBlockTime - avgBlockTime) > 0.5) {
      console.log(`[BlockClock] block=${currentNumber} avgBlockTime=${avgBlockTime.toFixed(2)}s (from ${lookback} blocks)`);
    }
  } catch { /* non-fatal */ }
}

/** Simple update when only block number is available (fallback). */
export function updateBlockClock(blockNumber: number): void {
  latest = { ...latest, blockNumber, observedAt: new Date() };
}

export function getBlockClock(): BlockClock {
  return latest;
}
