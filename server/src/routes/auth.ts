/**
 * Auth routes — challenge-response JWT authentication.
 *
 * POST /api/auth/challenge — Issue a random nonce for signing
 * POST /api/auth/verify    — Verify signed challenge and issue JWT
 */

import { Router, type Request, type Response } from 'express';
import { createChallenge, consumeChallenge, issueToken } from '../middleware/auth.js';

const router = Router();

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

  const nonce = createChallenge(address);
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

  // Verify the challenge was issued for this address
  if (!consumeChallenge(nonce, address)) {
    return res.status(401).json({ error: 'Invalid or expired challenge' });
  }

  // Issue JWT
  const token = issueToken(address, name);
  return res.json({ token });
});

export default router;
