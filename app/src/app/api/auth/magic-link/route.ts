/**
 * Magic Link API Route
 *
 * POST /api/auth/magic-link
 * Sends a magic link to the specified email address using Resend.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { setToken } from '@/lib/auth/magic-link/tokenStore';

// Lazy initialize Resend only when API key is present
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

// In-memory rate limiter: max 3 requests per email per 15 minutes, plus global IP-based limit
const emailRateMap = new Map<string, number[]>();
const ipRateMap = new Map<string, number[]>();
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 10;

function isRateLimited(key: string, map: Map<string, number[]>, max: number): boolean {
  const now = Date.now();
  const timestamps = (map.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= max) return true;
  timestamps.push(now);
  map.set(key, timestamps);
  return false;
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of emailRateMap) {
    const fresh = ts.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length === 0) emailRateMap.delete(key);
    else emailRateMap.set(key, fresh);
  }
  for (const [key, ts] of ipRateMap) {
    const fresh = ts.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length === 0) ipRateMap.delete(key);
    else ipRateMap.set(key, fresh);
  }
}, 30 * 60 * 1000).unref?.();

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Rate limit by email (3 per 15 min) and IP (10 per 15 min)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    if (isRateLimited(normalizedEmail, emailRateMap, MAX_PER_EMAIL)
      || isRateLimited(ip, ipRateMap, MAX_PER_IP)) {
      // Return generic success to prevent email enumeration via rate-limit timing
      return NextResponse.json({
        success: true,
        message: 'If the email is valid, a magic link has been sent',
      });
    }

    // Generate secure token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Store token using shared store
    setToken(token, normalizedEmail);

    // Build magic link URL — ignore user-supplied redirectUrl to prevent open redirect
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verifyUrl = `${baseUrl}/onboarding/magic-link/verify`;
    const magicLink = `${verifyUrl}?token=${token}`;

    // Check if Resend is configured
    if (!process.env.RESEND_API_KEY) {
      console.log('=================================');
      console.log('RESEND_API_KEY not configured');
      console.log('Magic Link (dev only):');
      console.log(magicLink);
      console.log('=================================');

      return NextResponse.json({
        success: true,
        message: 'Magic link generated (check console - email not configured)',
        // Only include link in development for testing
        ...(process.env.NODE_ENV === 'development' && { link: magicLink }),
      });
    }

    // Send email via Resend
    const resend = getResendClient();
    if (!resend) {
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 }
      );
    }

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Cloakboard <onboarding@resend.dev>',
      to: normalizedEmail,
      subject: 'Sign in to Cloakboard',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px; background: #f5f5f5;">
            <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h1 style="color: #1a1a1a; font-size: 24px; margin: 0 0 24px;">Sign in to Cloakboard</h1>
              <p style="color: #666; font-size: 16px; line-height: 1.5; margin: 0 0 24px;">
                Click the button below to sign in. This link will expire in 15 minutes.
              </p>
              <a href="${magicLink}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 500; font-size: 16px;">
                Sign in to Cloakboard
              </a>
              <p style="color: #999; font-size: 14px; margin: 32px 0 0;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);

      // In development, fall back to console logging if Resend fails
      // (common when using test API key with unverified domains)
      if (process.env.NODE_ENV === 'development') {
        console.log('=================================');
        console.log('Resend failed, falling back to dev mode');
        console.log('Magic Link (dev only):');
        console.log(magicLink);
        console.log('=================================');

        return NextResponse.json({
          success: true,
          message: 'Magic link generated (check console - email send failed)',
          ...(process.env.NODE_ENV === 'development' && { link: magicLink }),
        });
      }

      return NextResponse.json(
        { error: 'Failed to send email' },
        { status: 500 }
      );
    }

    console.log('Magic link email sent:', data?.id);

    return NextResponse.json({
      success: true,
      message: 'Magic link sent to your email',
    });
  } catch (error) {
    console.error('Magic link error:', error);
    return NextResponse.json(
      { error: 'Failed to send magic link' },
      { status: 500 }
    );
  }
}
