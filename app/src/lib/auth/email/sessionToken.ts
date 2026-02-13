/**
 * Server-Side Session Token
 *
 * HMAC-SHA256 signed tokens for linking magic link verification
 * to the OPRF evaluation step. 5-minute TTL, single-use.
 */

import { createHmac } from 'crypto';

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not configured');
  return secret;
}

/**
 * Create a session token for a verified email hash.
 * Format: base64(JSON({emailHash, exp})).base64(HMAC-SHA256(payload))
 */
export function createSessionToken(emailHash: string): string {
  const payload = JSON.stringify({
    emailHash,
    exp: Date.now() + SESSION_TTL_MS,
  });

  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');

  return `${payloadB64}.${sig}`;
}

/**
 * Verify a session token and return the email hash if valid.
 */
export function verifySessionToken(token: string): { emailHash: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  if (sig !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    if (typeof payload.emailHash !== 'string') return null;
    return { emailHash: payload.emailHash };
  } catch {
    return null;
  }
}
