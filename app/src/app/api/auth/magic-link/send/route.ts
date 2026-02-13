/**
 * POST /api/auth/magic-link/send
 *
 * Sends a magic link email for passwordless authentication.
 * Rate limited: 3 per email per 10 minutes.
 */

import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';
import { getPool } from '@/lib/db/pool';

const resend = new Resend(process.env.RESEND_API_KEY);
const RATE_LIMIT = 3;
const RATE_WINDOW_MIN = 10;
const TOKEN_TTL_MIN = 10;

function hashSha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email: string | undefined = body.email;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailHash = hashSha256(normalizedEmail);
    const pool = getPool();

    // Rate limit: count recent tokens for this email hash
    const rateCheck = await pool.query(
      `SELECT COUNT(*) as cnt FROM magic_link_tokens
       WHERE email_hash = $1 AND created_at > NOW() - INTERVAL '${RATE_WINDOW_MIN} minutes'`,
      [emailHash],
    );

    if (parseInt(rateCheck.rows[0].cnt, 10) >= RATE_LIMIT) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a few minutes before trying again.' },
        { status: 429 },
      );
    }

    // Generate token
    const tokenRaw = randomBytes(32).toString('hex');
    const tokenHash = hashSha256(tokenRaw);

    // Store hash in DB
    await pool.query(
      `INSERT INTO magic_link_tokens (email_hash, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${TOKEN_TTL_MIN} minutes')`,
      [emailHash, tokenHash],
    );

    // Build magic link URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const magicLink = `${appUrl}/onboarding/email/verify?token=${tokenRaw}`;

    // Send email via Resend
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Cloakboard <noreply@cloakboard.com>';
    await resend.emails.send({
      from: fromEmail,
      to: normalizedEmail,
      subject: 'Sign in to Cloakboard',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a2e; margin-bottom: 8px;">Sign in to Cloakboard</h2>
          <p style="color: #666; font-size: 14px; line-height: 1.5;">
            Click the button below to sign in. This link expires in ${TOKEN_TTL_MIN} minutes.
          </p>
          <a href="${magicLink}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; margin: 24px 0;">
            Sign in to Cloakboard
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 32px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[magic-link/send] Error:', error?.message, error?.stack || error);
    return NextResponse.json(
      { error: error?.message || 'Failed to send magic link' },
      { status: 500 },
    );
  }
}
