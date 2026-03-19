/**
 * Seed Vault — Encrypts auth seeds at rest using AES-256-GCM.
 *
 * Session key stored in localStorage (persists across tab closes / browser restarts).
 * Ciphertext stored in localStorage under a different prefix.
 * BroadcastChannel propagates logout (key clearing) to other open tabs.
 *
 * Security model: The encryption prevents casual inspection of seeds (e.g. shoulder
 * surfing localStorage in devtools). It does NOT protect against a full XSS attack
 * since the key is in the same origin's storage. The real security boundary is the
 * browser's same-origin policy.
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
    // Propagate logout: if another tab clears the key, clear ours too
    if (e.data?.type === 'session-key-cleared') {
      sessionKeyHex = null;
    }
    // Propagate new key to other open tabs (login in another tab)
    if (e.data?.type === 'session-key-update' && e.data.key) {
      sessionKeyHex = e.data.key;
    }
  };
}

/**
 * Initialize the vault. Restores session key from localStorage.
 * This is synchronous for the common case (key in localStorage).
 * Only awaitable for the legacy sessionStorage migration path.
 */
export async function initSeedVault(): Promise<void> {
  initChannel();

  // localStorage is the source of truth for persisted sessions.
  // If the key is there, load it. If not, user needs to log in again.
  try {
    const stored = localStorage.getItem(SESSION_KEY_STORAGE);
    if (stored) {
      sessionKeyHex = stored;
      return;
    }
  } catch (err) {
    // localStorage threw — Safari private browsing, quota, or storage disabled.
    // Cannot persist sessions in this mode; user will need to re-login each time.
    console.warn('[SeedVault] localStorage unavailable:', err);
  }

  // Migration: check sessionStorage for users who had key there before the
  // localStorage persistence change. Move it to localStorage and clean up.
  try {
    const legacy = sessionStorage.getItem(SESSION_KEY_STORAGE);
    if (legacy) {
      sessionKeyHex = legacy;
      try { localStorage.setItem(SESSION_KEY_STORAGE, legacy); } catch { /* ignore */ }
      try { sessionStorage.removeItem(SESSION_KEY_STORAGE); } catch { /* ignore */ }
      return;
    }
  } catch { /* ignore */ }

  // No key found — this is either first visit or storage was cleared.
  // createSessionKey() will be called during login flow.
}

/** Generate a fresh session key (call on login). No-op if one already exists. */
export function createSessionKey(): void {
  if (sessionKeyHex) return; // Already have a key for this session
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  sessionKeyHex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(SESSION_KEY_STORAGE, sessionKeyHex); } catch { /* ignore */ }
  // Notify other open tabs about the new key
  bc?.postMessage({ type: 'session-key-update', key: sessionKeyHex });
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

/** Store an encrypted value in localStorage. Requires session key to exist. */
export async function encryptAndStore(name: string, plaintext: string): Promise<void> {
  const key = await getKey();
  if (!key) {
    // No session key — this should not happen during normal flow because
    // createSessionKey() is called during login before seeds are stored.
    // Store plaintext as last resort (will be migrated on next initSeedVault).
    console.warn(`[SeedVault] encryptAndStore('${name}') called without session key — storing plaintext`);
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

/**
 * Retrieve and decrypt a value from localStorage.
 * Returns { value, error } to let callers distinguish "missing" from "decrypt failed".
 */
export async function decryptAndRetrieve(name: string): Promise<string | null> {
  // Try encrypted first
  try {
    const encrypted = localStorage.getItem(`${SEED_CIPHER_PREFIX}${name}`);
    if (encrypted) {
      const key = await getKey();
      if (!key) {
        // Encrypted data exists but no session key — this means localStorage was
        // partially cleared (key gone, ciphertext remains). Can't recover.
        console.warn(`[SeedVault] Encrypted '${name}' found but session key missing — cannot decrypt`);
        // Still check plaintext fallback below
      } else {
        try {
          const ivHex = encrypted.substring(0, 24); // 12 bytes = 24 hex chars
          const ctHex = encrypted.substring(24);
          const iv = hexToBytes(ivHex);
          const ct = hexToBytes(ctHex);
          const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource);
          return new TextDecoder().decode(plaintext);
        } catch {
          console.warn(`[SeedVault] Decrypt failed for '${name}' — wrong key or corrupted data`);
          // Fall through to plaintext check
        }
      }
    }
  } catch (err) {
    console.warn(`[SeedVault] localStorage read failed for '${name}':`, err);
  }

  // Fallback: check for plaintext (pre-migration or encryptAndStore fallback)
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
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
  // Propagate logout to other open tabs
  bc?.postMessage({ type: 'session-key-cleared' });
}

/** Check if vault has an active session key. */
export function hasSessionKey(): boolean {
  return sessionKeyHex !== null;
}
