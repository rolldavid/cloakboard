import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; commentId: string }> }
) {
  const { commentId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ip = getRequestIp(request);
  if (isApiRateLimited(ip, 30)) return jsonError('Too many requests', 429);

  try {
    const id = parseInt(commentId);
    if (isNaN(id) || id < 1) return jsonError('Invalid comment ID', 400);

    // Return params for client to call upvote_comment on contract
    return jsonSuccess({
      comment_id: id,
      contract_method: 'upvote_comment',
      contract_args: { comment_id: id },
    });
  } catch (error) {
    console.error('Upvote comment error:', error);
    return jsonError('Failed to upvote comment', 500);
  }
}
