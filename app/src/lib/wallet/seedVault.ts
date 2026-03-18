/**
 * Seed Vault — Encrypts auth seeds at rest using AES-256-GCM.
 *
 * Session key stored in localStorage (persists across tab closes / browser restarts).
 * Ciphertext stored in localStorage under a different prefix.
 * BroadcastChannel syncs key to new tabs (avoids stale in-memory copy).
 */

const SESSION_KEY_STORAGE = 'duelcloak-session-key';
const SEED_CIPHER_PREFIX = 'duelcloak-enc-';
const CHANNEL_NAME = 'duelcloak-seed-sync';

let sessionKeyHex: string | null = null;
let bc: BroadcastChannel | null = null;

function initChannel(): void {
  if (bc || typeof BroadcastChannel === 'undefined') return;
  bc = new BroadcastChannel(CHANNEL_NAME);
  bc.onmessage = (e) => {
    if (e.data?.type === 'session-key-response' && e.data.key && !sessionKeyHex) {
      sessionKeyHex = e.data.key;
      try { localStorage.setItem(SESSION_KEY_STORAGE, sessionKeyHex!); } catch { /* ignore */ }
    }
    if (e.data?.type === 'session-key-request' && sessionKeyHex) {
      bc?.postMessage({ type: 'session-key-response', key: sessionKeyHex });
    }
  };
}

/** Initialize the vault. Restores session key from localStorage or peer tabs. */
export async function initSeedVault(): Promise<void> {
  initChannel();

  // Try localStorage first (persists across tab close / browser restart)
  try {
    const stored = localStorage.getItem(SESSION_KEY_STORAGE);
    if (stored) {
      sessionKeyHex = stored;
      return;
    }
  } catch { /* ignore */ }

  // Migration: check sessionStorage for users who had key there before this change
  try {
    const legacy = sessionStorage.getItem(SESSION_KEY_STORAGE);
    if (legacy) {
      sessionKeyHex = legacy;
      try { localStorage.setItem(SESSION_KEY_STORAGE, legacy); } catch { /* ignore */ }
      try { sessionStorage.removeItem(SESSION_KEY_STORAGE); } catch { /* ignore */ }
      return;
    }
  } catch { /* ignore */ }

  // Ask other tabs for the key (fallback)
  if (bc) {
    return new Promise<void>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'session-key-response' && e.data.key && !sessionKeyHex) {
          sessionKeyHex = e.data.key;
          try { localStorage.setItem(SESSION_KEY_STORAGE, sessionKeyHex!); } catch { /* ignore */ }
          resolve();
        }
      };
      bc!.addEventListener('message', handler);
      bc!.postMessage({ type: 'session-key-request' });
      setTimeout(() => {
        bc?.removeEventListener('message', handler);
        resolve();
      }, 200);
    });
  }
}

/** Generate a fresh session key (call on login). No-op if one already exists. */
export function createSessionKey(): void {
  if (sessionKeyHex) return; // Already have a key for this session
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  sessionKeyHex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(SESSION_KEY_STORAGE, sessionKeyHex); } catch { /* ignore */ }
  // Broadcast to other tabs
  bc?.postMessage({ type: 'session-key-response', key: sessionKeyHex });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function getKey(): Promise<CryptoKey | null> {
  if (!sessionKeyHex) return null;
  const raw = hexToBytes(sessionKeyHex);
  return crypto.subtle.importKey('raw', raw as unknown as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Store an encrypted value in localStorage. */
export async function encryptAndStore(name: string, plaintext: string): Promise<void> {
  const key = await getKey();
  if (!key) {
    // Fallback: no session key yet, store plaintext (will be migrated on next init)
    try { localStorage.setItem(name, plaintext); } catch { /* quota */ }
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, encoded as unknown as BufferSource);
  // Pack iv + ciphertext as hex
  const ivHex = Array.from(iv, b => b.toString(16).padStart(2, '0')).join('');
  const ctHex = Array.from(new Uint8Array(ciphertext), b => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(`${SEED_CIPHER_PREFIX}${name}`, ivHex + ctHex);
    localStorage.removeItem(name); // Remove plaintext
  } catch { /* quota */ }
}

/** Retrieve and decrypt a value from localStorage. */
export async function decryptAndRetrieve(name: string): Promise<string | null> {
  // Try encrypted first
  const encrypted = localStorage.getItem(`${SEED_CIPHER_PREFIX}${name}`);
  if (encrypted) {
    const key = await getKey();
    if (!key) return null; // No session key -- can't decrypt
    try {
      const ivHex = encrypted.substring(0, 24); // 12 bytes = 24 hex chars
      const ctHex = encrypted.substring(24);
      const iv = hexToBytes(ivHex);
      const ct = hexToBytes(ctHex);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource);
      return new TextDecoder().decode(plaintext);
    } catch {
      return null; // Corrupted or wrong key
    }
  }

  // Fallback: check for plaintext (pre-migration)
  return localStorage.getItem(name);
}

/** Migrate a plaintext localStorage value to encrypted storage. */
export async function migrateToEncrypted(name: string): Promise<void> {
  const plaintext = localStorage.getItem(name);
  if (plaintext && sessionKeyHex) {
    await encryptAndStore(name, plaintext);
  }
}

/** Remove both encrypted and plaintext versions. */
export function removeSeedData(name: string): void {
  try {
    localStorage.removeItem(`${SEED_CIPHER_PREFIX}${name}`);
    localStorage.removeItem(name);
  } catch { /* ignore */ }
}

/** Clear session key (call on logout). */
export function clearSessionKey(): void {
  sessionKeyHex = null;
  try { localStorage.removeItem(SESSION_KEY_STORAGE); } catch { /* ignore */ }
  try { sessionStorage.removeItem(SESSION_KEY_STORAGE); } catch { /* ignore */ } // legacy cleanup
}

/** Check if vault has an active session key. */
export function hasSessionKey(): boolean {
  return sessionKeyHex !== null;
}
