import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; postId: string }> }
) {
  const { cloakId, postId } = await params;

  try {
    const id = parseInt(postId);
    if (isNaN(id) || id < 1) return jsonError('Invalid post ID', 400);

    // Return post_id for client to read from contract
    return jsonSuccess({
      post_id: id,
      cloak_id: cloakId,
      contract_method: 'get_post',
      contract_args: { post_id: id },
    });
  } catch (error) {
    console.error('Get post error:', error);
    return jsonError('Failed to get post', 500);
  }
}

export async function DELETE(
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

    // Return post_id for client to call delete_post on contract
    return jsonSuccess({
      post_id: id,
      cloak_id: cloakId,
      contract_method: 'delete_post',
      contract_args: { post_id: id },
    });
  } catch (error) {
    console.error('Delete post error:', error);
    return jsonError('Failed to delete post', 500);
  }
}
