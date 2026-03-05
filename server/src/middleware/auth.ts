import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// In-memory challenge store: nonce -> { createdAt, userAddress }
const challengeStore = new Map<string, { createdAt: number; userAddress: string }>();
const CHALLENGE_TTL_MS = 30 * 1000; // 30 seconds

// JWT signing secret: derived from KEEPER_API_SECRET for simplicity
function getJwtSecret(): string {
  const secret = process.env.KEEPER_API_SECRET;
  if (!secret) throw new Error('KEEPER_API_SECRET not configured');
  return crypto.createHash('sha256').update(`jwt:${secret}`).digest('hex');
}

// --- Challenge-based auth endpoints ---

/** Generate a random challenge nonce for a given user address. */
export function createChallenge(userAddress: string): string {
  // Clean up expired challenges
  const now = Date.now();
  for (const [nonce, data] of challengeStore) {
    if (now - data.createdAt > CHALLENGE_TTL_MS) {
      challengeStore.delete(nonce);
    }
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  challengeStore.set(nonce, { createdAt: now, userAddress });
  return nonce;
}

/** Verify a challenge nonce was issued for this user address, then consume it. */
export function consumeChallenge(nonce: string, userAddress: string): boolean {
  const data = challengeStore.get(nonce);
  if (!data) return false;

  challengeStore.delete(nonce);

  // Check expiry
  if (Date.now() - data.createdAt > CHALLENGE_TTL_MS) return false;

  // Check address matches
  if (data.userAddress.toLowerCase() !== userAddress.toLowerCase()) return false;

  return true;
}

/** Issue a JWT token for a verified user. */
export function issueToken(userAddress: string, userName: string): string {
  const secret = getJwtSecret();
  return jwt.sign(
    { address: userAddress, name: userName },
    secret,
    { expiresIn: '24h' },
  );
}

/** Verify a JWT token and return the decoded payload. */
export function verifyToken(token: string): { address: string; name: string } | null {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as { address: string; name: string };
    return decoded;
  } catch {
    return null;
  }
}

// --- Middleware ---

export interface AuthenticatedRequest extends Request {
  user?: { address: string; name: string };
}

/**
 * Middleware that extracts user identity from JWT.
 * Does NOT block unauthenticated requests — use requireUserAuth for that.
 */
export function extractUser(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
}

/**
 * Middleware that requires a valid JWT.
 * Returns 401 if no valid auth is present.
 */
export function requireUserAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}

/** Require keeper-level authentication (Bearer token matching KEEPER_API_SECRET). */
export function requireKeeperAuth(req: Request, res: Response, next: NextFunction) {
  const apiSecret = process.env.KEEPER_API_SECRET;
  if (!apiSecret) {
    return res.status(500).json({ error: 'Keeper not configured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${apiSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * Require either keeper auth OR user JWT auth.
 * Used for deployment endpoints that need elevated access.
 */
export function requireKeeperOrUserAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const apiSecret = process.env.KEEPER_API_SECRET;

  // Check keeper auth first
  const authHeader = req.headers.authorization;
  if (apiSecret && authHeader === `Bearer ${apiSecret}`) {
    return next();
  }

  // Fall back to user JWT auth
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}
