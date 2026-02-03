/**
 * Shared helpers for Molt API routes
 *
 * Since wallet keys only exist client-side (in memory during authenticated sessions),
 * server-side API routes operate in two modes:
 *
 * 1. READ mode: Uses a read-only connection to query contract state.
 *    No wallet needed — just connects to the Aztec node and simulates view calls.
 *
 * 2. WRITE mode: The client sends transactions directly to the contract
 *    (the API route validates inputs, hashes content, and returns the prepared
 *    call data — the client's wallet submits the actual transaction).
 *
 * For verification (complete_verification), the serverless function needs
 * a service account wallet to call the contract on behalf of the system.
 */

import { NextResponse } from 'next/server';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function jsonSuccess(data: Record<string, unknown>) {
  return NextResponse.json(data);
}

export function getCloakId(params: { cloakId: string }): string {
  return params.cloakId;
}

/**
 * Resolve session token to caller address.
 *
 * The Bearer token is an HMAC-signed session: `address:timestamp:signature`
 * The signature is HMAC-SHA256(address:timestamp, SESSION_SECRET).
 * Tokens are valid for 24 hours.
 *
 * Falls back to raw-address mode ONLY in development when SESSION_SECRET is unset.
 */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getCallerAddress(request: Request): Promise<string | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const secret = process.env.SESSION_SECRET;

  // Signed session mode: address:timestamp:signature
  if (secret) {
    const parts = token.split(':');
    if (parts.length !== 3) return null;

    const [address, timestampStr, signature] = parts;
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) return null;

    const timestamp = Number(timestampStr);
    if (isNaN(timestamp)) return null;

    // Check expiry
    if (Date.now() - timestamp > SESSION_MAX_AGE_MS) return null;

    // Verify HMAC
    const expected = await hmacSign(`${address}:${timestampStr}`, secret);
    if (signature !== expected) return null;

    return address;
  }

  // Dev-only fallback: raw address (no secret configured)
  if (process.env.NODE_ENV === 'development') {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(token)) return null;
    return token;
  }

  // In production without SESSION_SECRET, reject all requests
  console.error('[helpers] SESSION_SECRET not configured — rejecting auth');
  return null;
}

/**
 * Require authentication, return error response if missing
 */
export async function requireAuth(request: Request): Promise<{ address: string } | NextResponse> {
  const address = await getCallerAddress(request);
  if (!address) return jsonError('Authentication required', 401);
  return { address };
}

/**
 * Create a signed session token (call from client-side API or auth endpoint)
 */
export async function createSessionToken(address: string): Promise<string | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const timestamp = Date.now().toString();
  const signature = await hmacSign(`${address}:${timestamp}`, secret);
  return `${address}:${timestamp}:${signature}`;
}

/**
 * Rate limit error response
 */
export function rateLimitError(retryAfter: number, dailyRemaining?: number) {
  return NextResponse.json(
    {
      error: 'rate_limited',
      retry_after_seconds: retryAfter,
      ...(dailyRemaining !== undefined && { daily_remaining: dailyRemaining }),
    },
    { status: 429 }
  );
}

/**
 * In-memory rate limiter for API routes
 */
const apiRateMap = new Map<string, number[]>();
const API_RATE_CLEANUP_INTERVAL = 30 * 60 * 1000;

// Cleanup stale entries
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of apiRateMap) {
    const fresh = ts.filter((t) => now - t < 60_000);
    if (fresh.length === 0) apiRateMap.delete(key);
    else apiRateMap.set(key, fresh);
  }
}, API_RATE_CLEANUP_INTERVAL).unref?.();

/**
 * Check if a key is rate-limited.
 * @param key   Unique key (e.g. IP or address)
 * @param max   Max requests allowed in the window
 * @param windowMs  Window in ms (default 60s)
 */
export function isApiRateLimited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const timestamps = (apiRateMap.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= max) return true;
  timestamps.push(now);
  apiRateMap.set(key, timestamps);
  return false;
}

/**
 * Get IP from request headers
 */
export function getRequestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

/**
 * Content hashing (mirrors MoltContentService for server-side use)
 */
export async function hashContentServer(plaintext: string): Promise<bigint> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let result = BigInt(0);
  for (let i = 0; i < 31; i++) {
    result = (result << BigInt(8)) | BigInt(hashArray[i]);
  }
  return result;
}
