/**
 * Username Generator
 *
 * Generates random usernames from curated word lists.
 * Format: PrefixSuffix (e.g., CosmicVoyager, TerraGuardian)
 */

import {
  ALL_PREFIXES,
  ALL_SUFFIXES,
  USERNAME_THEMES,
  type UsernameTheme,
} from './wordlists';

/**
 * Generate a random username using all available words
 */
export function generateUsername(): string {
  const prefix = ALL_PREFIXES[Math.floor(Math.random() * ALL_PREFIXES.length)];
  const suffix = ALL_SUFFIXES[Math.floor(Math.random() * ALL_SUFFIXES.length)];
  return `${prefix}${suffix}`;
}

/**
 * Generate a themed username
 */
export function generateThemedUsername(theme: UsernameTheme): string {
  const { prefixes, suffixes } = USERNAME_THEMES[theme];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix}${suffix}`;
}

/**
 * Generate multiple username suggestions
 */
export function generateUsernameSuggestions(count: number = 5): string[] {
  const usernames = new Set<string>();

  while (usernames.size < count) {
    usernames.add(generateUsername());
  }

  return Array.from(usernames);
}

/**
 * Generate themed username suggestions
 */
export function generateThemedSuggestions(
  theme: UsernameTheme,
  count: number = 5
): string[] {
  const usernames = new Set<string>();

  while (usernames.size < count) {
    usernames.add(generateThemedUsername(theme));
  }

  return Array.from(usernames);
}

/**
 * Generate a deterministic username from a seed (address or hash)
 * Useful for creating consistent usernames from wallet addresses
 */
export function generateDeterministicUsername(seed: string): string {
  // Simple hash function for seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Use absolute value and modulo to get indices
  const prefixIndex = Math.abs(hash) % ALL_PREFIXES.length;
  const suffixIndex = Math.abs(hash >> 8) % ALL_SUFFIXES.length;

  return `${ALL_PREFIXES[prefixIndex]}${ALL_SUFFIXES[suffixIndex]}`;
}

/**
 * Validate username format
 * Rules:
 * - 3-20 characters
 * - Alphanumeric only
 * - Cannot start with a number
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username) {
    return { valid: false, error: 'Username is required' };
  }

  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }

  if (username.length > 20) {
    return { valid: false, error: 'Username must be at most 20 characters' };
  }

  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(username)) {
    return {
      valid: false,
      error: 'Username must start with a letter and contain only letters and numbers',
    };
  }

  return { valid: true };
}

/**
 * Normalize username for comparison (lowercase)
 */
export function normalizeUsername(username: string): string {
  return username.toLowerCase().trim();
}

/**
 * Check if two usernames are equivalent (case-insensitive)
 */
export function usernamesMatch(a: string, b: string): boolean {
  return normalizeUsername(a) === normalizeUsername(b);
}

/**
 * Generate a variation of a username if the original is taken
 * Appends random numbers to make it unique
 */
export function generateUsernameVariation(baseUsername: string): string {
  const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const trimmed = baseUsername.slice(0, 17); // Leave room for 3-digit suffix
  return `${trimmed}${suffix}`;
}
