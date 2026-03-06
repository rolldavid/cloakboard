/**
 * Profanity filter using the word list in prof.json.
 * Simple whole-word + substring matching — no regex evasion detection
 * since the list already includes common evasions (leet speak, spacing, etc).
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const words: string[] = JSON.parse(
  readFileSync(resolve(__dirname, 'prof.json'), 'utf-8'),
);

// Build a Set for fast exact-match lookup (lowercased)
const wordSet = new Set(words.map((w) => w.toLowerCase()));

// Multi-word phrases (contain spaces) need substring matching
const phrases = words
  .filter((w) => w.includes(' '))
  .map((w) => w.toLowerCase());

/**
 * Check if text contains profanity.
 * Returns the first matched word/phrase or null if clean.
 */
export function containsProfanity(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Check multi-word phrases first (substring match)
  for (const phrase of phrases) {
    if (lower.includes(phrase)) return phrase;
  }

  // Split into words and check each against the set
  const tokens = lower.split(/[^a-z0-9'-]+/).filter(Boolean);
  for (const token of tokens) {
    if (wordSet.has(token)) return token;
  }

  return null;
}

/**
 * Check multiple text fields for profanity.
 * Returns { clean: true } or { clean: false, field, word }.
 */
export function checkProfanity(
  fields: Record<string, string | undefined | null>,
): { clean: true } | { clean: false; field: string; word: string } {
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    const match = containsProfanity(text);
    if (match) {
      return { clean: false, field, word: match };
    }
  }
  return { clean: true };
}
