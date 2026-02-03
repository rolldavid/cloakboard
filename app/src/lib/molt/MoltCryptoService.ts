/**
 * Molt Crypto Service — Client-side AES-256-GCM encryption for private Molt content
 *
 * For private cloaks, content is encrypted before upload to R2.
 * The shared encryption key is derived from a cloak-specific secret.
 * Public cloaks bypass encryption entirely.
 *
 * Encrypted payload format: base64(IV[12] + ciphertext + tag[16])
 */

const ALGO = 'AES-GCM';
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

/**
 * Derive an AES-256 key from a cloak secret using HKDF.
 * The secret is typically read from Aztec private state (only members can access).
 */
export async function deriveKeyFromSecret(
  secret: Uint8Array,
  cloakAddress: string
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secret.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey']
  );

  const encoder = new TextEncoder();
  const salt = encoder.encode(`molt-cloak-${cloakAddress}`);
  const info = encoder.encode('molt-content-encryption');

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Import a raw 32-byte key directly (for testing or when key is already derived).
 */
export async function importRawKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey.buffer as ArrayBuffer,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext content. Returns base64-encoded payload: IV + ciphertext + tag.
 */
export async function encryptContent(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    data
  );

  // Combine IV + ciphertext+tag into a single buffer
  const combined = new Uint8Array(IV_LENGTH + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), IV_LENGTH);

  return bufferToBase64(combined);
}

/**
 * Decrypt base64-encoded payload back to plaintext.
 */
export async function decryptContent(
  encryptedBase64: string,
  key: CryptoKey
): Promise<string> {
  const combined = base64ToBuffer(encryptedBase64);

  if (combined.length < IV_LENGTH + 16) {
    throw new Error('Invalid encrypted payload: too short');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(plainBuffer);
}

/**
 * Check if content looks like an encrypted payload (base64 with minimum length).
 */
export function isEncryptedPayload(content: string): boolean {
  // Encrypted payloads are base64 and at least IV(12) + tag(16) = 28 bytes → ~38 base64 chars
  if (content.length < 38) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(content);
}

// --- Helpers ---

function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
