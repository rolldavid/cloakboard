/**
 * Anonymous username generator.
 * Deterministically derives a username from a seed (e.g. user address hash)
 * so the same user always gets the same name, or generates a random one.
 *
 * Format: {Adjective}{Noun}{00-99} — max 21 chars, fits in 31 bytes (FieldCompressedString).
 */

import { adjectives, nouns } from './wordlists';

/**
 * Generate a deterministic username from a seed string.
 * Uses a simple hash to pick adjective, noun, and number.
 */
export function generateUsername(seed: string): string {
  const hash = simpleHash(seed);
  const adjIdx = hash[0] % adjectives.length;
  const nounIdx = hash[1] % nouns.length;
  const num = hash[2] % 100;
  return `${adjectives[adjIdx]}${nouns[nounIdx]}${num.toString().padStart(2, '0')}`;
}

/**
 * Generate a random username (no seed).
 */
export function generateRandomUsername(): string {
  const adjIdx = Math.floor(Math.random() * adjectives.length);
  const nounIdx = Math.floor(Math.random() * nouns.length);
  const num = Math.floor(Math.random() * 100);
  return `${adjectives[adjIdx]}${nouns[nounIdx]}${num.toString().padStart(2, '0')}`;
}

/**
 * Encode a username string into a Field-compatible bigint (big-endian, max 31 bytes).
 * This matches Aztec's FieldCompressedString encoding.
 */
export function usernameToField(name: string): bigint {
  const bytes = new TextEncoder().encode(name.slice(0, 31));
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return value;
}

/**
 * Decode a Field bigint back to a username string.
 */
export function fieldToUsername(field: bigint): string {
  if (field === 0n) return '';
  const bytes: number[] = [];
  let v = field;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xFFn));
    v >>= 8n;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Simple deterministic hash: returns 3 numbers from a string seed. */
function simpleHash(str: string): [number, number, number] {
  let h1 = 0x9e3779b9;
  let h2 = 0x517cc1b7;
  let h3 = 0x6a09e667;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0xc2b2ae35) >>> 0;
    h3 = Math.imul(h3 ^ ch, 0x165667b1) >>> 0;
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0];
}
