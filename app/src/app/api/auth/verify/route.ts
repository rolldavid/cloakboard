/**
 * Magic Link Verify API Route
 *
 * POST /api/auth/verify
 * Verifies a magic link token and returns the associated email.
 *
 * GET /api/auth/verify?token=xxx
 * Validates token without consuming it (for verify page to check)
 */

import { NextResponse } from 'next/server';
import { getToken, consumeToken, validateToken } from '@/lib/auth/magic-link/tokenStore';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    // Validate token parameter
    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Consume token (single use)
    const result = consumeToken(token);

    if (!result.valid) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      email: result.email,
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return NextResponse.json(
      { error: 'Failed to verify token' },
      { status: 500 }
    );
  }
}

// Allow GET for checking token validity (doesn't consume)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { error: 'Token is required' },
      { status: 400 }
    );
  }

  // Validate without consuming
  const result = validateToken(token);

  if (!result.valid) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    email: result.email,
  });
}
