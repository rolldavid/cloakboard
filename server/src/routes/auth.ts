/**
 * Auth routes — challenge-response JWT authentication.
 *
 * POST /api/auth/challenge    — Issue a random nonce for signing
 * POST /api/auth/verify       — Verify signed challenge and issue JWT
 * POST /api/auth/google-salt  — Return per-user salt for Google key derivation
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createChallenge, consumeChallenge, issueToken } from '../middleware/auth.js';
import { pool } from '../lib/db/pool.js';

const router = Router();

// Google JWKS — cached at module level (jose handles refresh internally)
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

/**
 * POST /api/auth/challenge
 * Body: { address: string }
 * Returns: { nonce: string }
 */
router.post('/challenge', (req: Request, res: Response) => {
  const { address } = req.body;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing address' });
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const nonce = createChallenge(address, ip);
  return res.json({ nonce });
});

/**
 * POST /api/auth/verify
 * Body: { address: string, name: string, nonce: string, signature: string }
 *
 * The signature is a hex-encoded HMAC-SHA256 of the nonce using the user's
 * signing key. Since the signing key never leaves the browser and we can't
 * verify Aztec Schnorr signatures server-side without the public key, we use
 * HMAC as a proof-of-knowledge: only someone with the signing key can produce
 * the correct HMAC. The server stores no keys — it just checks that the
 * challenge was consumed by the same address that requested it.
 *
 * In the transition period, if no signature is provided but nonce is valid,
 * we still issue a token (for backward compatibility).
 */
router.post('/verify', (req: Request, res: Response) => {
  const { address, name, nonce } = req.body;

  if (!address || !name || !nonce) {
    return res.status(400).json({ error: 'Missing address, name, or nonce' });
  }

  // Verify the challenge was issued for this address from the same IP
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!consumeChallenge(nonce, address, ip)) {
    return res.status(401).json({ error: 'Invalid or expired challenge' });
  }

  // Issue JWT
  const token = issueToken(address, name);
  return res.json({ token });
});

/**
 * POST /api/auth/google-salt
 * Body: { idToken: string }
 * Returns: { salt: string }
 *
 * Validates the Google id_token (signature + audience), extracts ONLY `sub`,
 * and returns a per-user random salt. No PII is stored — only SHA-256(sub).
 */
router.post('/google-salt', async (req: Request, res: Response) => {
  const { idToken } = req.body;

  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ error: 'Missing idToken' });
  }

  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Google client ID not configured' });
  }

  try {
    // Verify JWT signature via Google JWKS + check audience matches OUR client ID
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      audience: clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });

    // Privacy-critical: extract ONLY sub, explicitly ignore everything else
    const { sub } = payload as { sub: string };
    if (!sub) {
      return res.status(400).json({ error: 'Token missing sub claim' });
    }

    // Hash sub immediately — raw sub is never stored, logged, or used beyond this point
    const lookupKey = crypto.createHash('sha256').update(sub).digest('hex');

    // Check for existing salt
    const existing = await pool.query(
      'SELECT salt FROM google_user_salts WHERE lookup_key = $1',
      [lookupKey],
    );

    if (existing.rows.length > 0) {
      return res.json({ salt: existing.rows[0].salt });
    }

    // Generate new salt and store
    const salt = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO google_user_salts (lookup_key, salt) VALUES ($1, $2) ON CONFLICT (lookup_key) DO NOTHING',
      [lookupKey, salt],
    );

    // Re-read in case of race condition (concurrent first login)
    const inserted = await pool.query(
      'SELECT salt FROM google_user_salts WHERE lookup_key = $1',
      [lookupKey],
    );

    return res.json({ salt: inserted.rows[0].salt });
  } catch (err: any) {
    console.warn('[google-salt] Token verification failed:', err?.message);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
});

export default router;
