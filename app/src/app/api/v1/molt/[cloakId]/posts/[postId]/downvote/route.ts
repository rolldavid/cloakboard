import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; postId: string }> }
) {
  const { postId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ip = getRequestIp(request);
  if (isApiRateLimited(ip, 30)) return jsonError('Too many requests', 429);

  try {
    const id = parseInt(postId);
    if (isNaN(id) || id < 1) return jsonError('Invalid post ID', 400);

    // Return params for client to call downvote_post on contract
    return jsonSuccess({
      post_id: id,
      contract_method: 'downvote_post',
      contract_args: { post_id: id },
    });
  } catch (error) {
    console.error('Downvote post error:', error);
    return jsonError('Failed to downvote post', 500);
  }
}
