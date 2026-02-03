import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatVotingPower(power: bigint | number): string {
  const value = typeof power === 'bigint' ? Number(power) : power;
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toString();
}

export function calculatePercentage(part: bigint | number, total: bigint | number): number {
  const partNum = typeof part === 'bigint' ? Number(part) : part;
  const totalNum = typeof total === 'bigint' ? Number(total) : total;

  if (totalNum === 0) return 0;
  return (partNum / totalNum) * 100;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isValidAztecAddress(address: string): boolean {
  // Aztec addresses are 32-byte hex strings (64 chars + 0x prefix)
  return /^0x[a-fA-F0-9]{64}$/.test(address);
}
