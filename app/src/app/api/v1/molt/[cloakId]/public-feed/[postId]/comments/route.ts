import { NextResponse } from 'next/server';
import { jsonError } from '../../../../helpers';
import { isMoltPublic, readMoltComments } from '@/lib/molt/serviceWallet';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cloakId: string; postId: string }> }
) {
  const { cloakId, postId: postIdStr } = await params;
  const postId = parseInt(postIdStr, 10);

  if (isNaN(postId) || postId < 1) {
    return jsonError('Invalid post ID', 400);
  }

  try {
    const isPublic = await isMoltPublic(cloakId);
    if (!isPublic) {
      return NextResponse.json({ private: true });
    }

    const comments = await readMoltComments(cloakId, postId);

    return NextResponse.json({
      private: false,
      comments,
    });
  } catch (error) {
    console.error('[public-feed/comments] Error:', error);
    return jsonError('Failed to load comments', 500);
  }
}
