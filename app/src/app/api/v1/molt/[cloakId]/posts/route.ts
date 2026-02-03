import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, hashContentServer, isApiRateLimited, getRequestIp } from '../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort') || 'new';
  const submoltId = url.searchParams.get('submolt_id');
  const page = Math.max(1, Math.min(parseInt(url.searchParams.get('page') || '1') || 1, 10000));
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 50));

  try {
    // Return query params for client-side contract reads
    return jsonSuccess({
      cloak_id: cloakId,
      page,
      limit,
      sort,
      contract_queries: [
        { method: 'get_post_count', args: {} },
        {
          method: 'get_posts',
          args: {
            offset: (page - 1) * limit,
            limit,
            ...(submoltId ? { submolt_id: parseInt(submoltId) } : {}),
          },
        },
      ],
    });
  } catch (error) {
    console.error('List posts error:', error);
    return jsonError('Failed to list posts', 500);
  }
}

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
    const { content, submolt_id = 0 } = body;

    if (!content || typeof content !== 'string') {
      return jsonError('Content is required', 400);
    }

    if (content.length > 50_000) {
      return jsonError('Content must be at most 50,000 characters', 400);
    }

    // Hash content server-side and return prepared call data
    const contentHash = await hashContentServer(content);

    return jsonSuccess({
      content_hash: contentHash.toString(),
      submolt_id,
      cloak_id: cloakId,
      contract_method: 'create_post',
      contract_args: {
        content_hash: contentHash.toString(),
        submolt_id,
      },
    });
  } catch (error: any) {
    if (error?.message?.includes('cooldown')) {
      return NextResponse.json(
        { error: 'rate_limited', retry_after_seconds: 0 },
        { status: 429 }
      );
    }
    console.error('Create post error:', error);
    return jsonError('Failed to create post', 500);
  }
}
