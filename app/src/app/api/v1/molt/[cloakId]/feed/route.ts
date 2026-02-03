import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess } from '../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  try {
    // Feed is computed client-side from contract data and subscription preferences
    // Return query parameters for the client to use
    return jsonSuccess({
      cloak_id: cloakId,
      page,
      limit,
      contract_queries: [
        { method: 'get_post_count', args: {} },
        {
          method: 'get_posts',
          args: { offset: (page - 1) * limit, limit },
        },
      ],
    });
  } catch (error) {
    console.error('Feed error:', error);
    return jsonError('Failed to get feed', 500);
  }
}
