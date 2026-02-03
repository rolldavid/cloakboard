import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, hashContentServer, isApiRateLimited, getRequestIp } from '../../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; postId: string }> }
) {
  const { cloakId, postId } = await params;

  try {
    const id = parseInt(postId);
    if (isNaN(id) || id < 1) return jsonError('Invalid post ID', 400);

    // Return params for client to read comments from contract
    return jsonSuccess({
      post_id: id,
      cloak_id: cloakId,
      contract_method: 'get_comments',
      contract_args: { post_id: id },
    });
  } catch (error) {
    console.error('List comments error:', error);
    return jsonError('Failed to list comments', 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; postId: string }> }
) {
  const { cloakId, postId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ip = getRequestIp(request);
  if (isApiRateLimited(ip, 30)) return jsonError('Too many requests', 429);

  try {
    const id = parseInt(postId);
    if (isNaN(id) || id < 1) return jsonError('Invalid post ID', 400);

    const body = await request.json();
    const { content, parent_comment_id = 0 } = body;

    if (!content || typeof content !== 'string') {
      return jsonError('Content is required', 400);
    }

    // Hash content server-side and return prepared call data
    const contentHash = await hashContentServer(content);

    return jsonSuccess({
      post_id: id,
      cloak_id: cloakId,
      content_hash: contentHash.toString(),
      parent_comment_id,
      contract_method: 'create_comment',
      contract_args: {
        content_hash: contentHash.toString(),
        post_id: id,
        parent_comment_id,
      },
    });
  } catch (error: any) {
    if (error?.message?.includes('cooldown') || error?.message?.includes('limit')) {
      return NextResponse.json(
        { error: 'rate_limited', retry_after_seconds: 0 },
        { status: 429 }
      );
    }
    console.error('Create comment error:', error);
    return jsonError('Failed to create comment', 500);
  }
}
