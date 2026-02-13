/**
 * POST /api/auth/magic-link/verify
 *
 * Verifies a magic link token and returns a session token
 * for the subsequent OPRF evaluation step.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getPool } from '@/lib/db/pool';
import { createSessionToken } from '@/lib/auth/email/sessionToken';

function hashSha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token: string | undefined = body.token;

    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const tokenHash = hashSha256(token);
    const pool = getPool();

    // Look up token
    const result = await pool.query(
      `SELECT id, email_hash, expires_at, used_at FROM magic_link_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    }

    const row = result.rows[0];

    // Check if already used
    if (row.used_at) {
      return NextResponse.json({ error: 'This link has already been used' }, { status: 400 });
    }

    // Check expiry
    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired. Please request a new one.' }, { status: 400 });
    }

    // Mark as used
    await pool.query(
      `UPDATE magic_link_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id],
    );

    // Create a session token for the OPRF step
    const sessionToken = createSessionToken(row.email_hash);

    return NextResponse.json({ ok: true, sessionToken });
  } catch (error: any) {
    console.error('[magic-link/verify] Error:', error);
    return NextResponse.json(
      { error: 'Failed to verify token' },
      { status: 500 },
    );
  }
}
