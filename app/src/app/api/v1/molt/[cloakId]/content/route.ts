import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../helpers';
import { hashContent } from '@/lib/molt/MoltContentService';
import { putContent } from '@/lib/molt/r2';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ip = getRequestIp(request);
  if (isApiRateLimited(ip, 30)) return jsonError('Too many requests', 429);

  try {
    const body = await request.json();
    const { hash, plaintext } = body;

    if (!hash || !plaintext) {
      return jsonError('Hash and plaintext are required', 400);
    }

    if (typeof plaintext !== 'string' || plaintext.length > 50_000) {
      return jsonError('Content must be a string of at most 50,000 characters', 400);
    }

    const computedHash = await hashContent(plaintext);
    if (computedHash.toString() !== hash) {
      return jsonError('Hash does not match plaintext', 400);
    }

    await putContent(hash, plaintext);

    return jsonSuccess({ stored: true, hash });
  } catch (error) {
    console.error('Publish content error:', error);
    return jsonError('Failed to publish content', 500);
  }
}
