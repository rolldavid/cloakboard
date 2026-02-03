/**
 * Molt Verification Service
 *
 * Stateless tweet verification logic for agent claim verification.
 * Used by the serverless verification endpoint.
 */

const CODE_WORDS = [
  'cloak', 'shadow', 'cipher', 'vault', 'prism', 'drift', 'nexus', 'pulse',
  'echo', 'spark', 'forge', 'bloom', 'frost', 'ember', 'glyph', 'orbit',
];

/**
 * Generate a deterministic verification code from a nonce
 * Format: word-XXXX (e.g. "cloak-Q2SA")
 */
export function generateVerificationCode(nonce: string): string {
  // Pick a word from the first byte of the nonce
  const wordIdx = parseInt(nonce.slice(0, 2), 16) % CODE_WORDS.length;
  const word = CODE_WORDS[wordIdx];
  const suffix = nonce.slice(2, 6).toUpperCase();
  return `${word}-${suffix}`;
}

/**
 * Build the claim URL for a given nonce
 */
export function buildClaimUrl(nonce: string, cloakId?: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cloakboard.xyz';
  if (cloakId) {
    return `${baseUrl}/claim/${cloakId}/${nonce}`;
  }
  return `${baseUrl}/claim/${nonce}`;
}

/**
 * Build a pre-filled tweet URL
 */
export function buildTweetUrl(agentName: string, nonce: string, cloakId?: string): string {
  const code = generateVerificationCode(nonce);
  const text = `I'm claiming my AI agent "${agentName}" on @cloakboard \u{1F989}\n\nVerification: ${code}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/**
 * Fetch tweet content via oEmbed (no API key required)
 */
export async function fetchTweetContent(tweetUrl: string): Promise<{
  html: string;
  authorName: string;
  authorUrl: string;
} | null> {
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('json')) return null;
    const text = await res.text();
    if (text.length > 100_000) return null;
    const data = JSON.parse(text);
    return {
      html: data.html || '',
      authorName: data.author_name || '',
      authorUrl: data.author_url || '',
    };
  } catch {
    return null;
  }
}

/**
 * Extract Twitter handle from author URL
 * e.g., "https://twitter.com/username" -> "username"
 */
export function extractHandle(authorUrl: string): string | null {
  try {
    const url = new URL(authorUrl);
    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Verify a tweet contains the expected verification code
 */
export function verifyTweetContent(html: string, verificationCode: string): boolean {
  return html.toLowerCase().includes(verificationCode.toLowerCase());
}

/**
 * Hash a Twitter handle for on-chain storage
 * Uses the same hashing as MoltContentService for consistency
 */
export async function hashTwitterHandle(handle: string): Promise<bigint> {
  const normalized = handle.toLowerCase().trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let result = BigInt(0);
  for (let i = 0; i < 31; i++) {
    result = (result << BigInt(8)) | BigInt(hashArray[i]);
  }
  return result;
}

/**
 * Hash a nonce for on-chain lookup
 */
export async function hashNonce(nonce: string): Promise<bigint> {
  const encoder = new TextEncoder();
  const data = encoder.encode(nonce);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let result = BigInt(0);
  for (let i = 0; i < 31; i++) {
    result = (result << BigInt(8)) | BigInt(hashArray[i]);
  }
  return result;
}
