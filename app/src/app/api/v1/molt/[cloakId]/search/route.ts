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
  const query = url.searchParams.get('q');

  if (!query) {
    return jsonError('Search query (q) is required', 400);
  }

  try {
    // Search is performed client-side against locally cached content
    // Return the query parameters for the client to use
    return jsonSuccess({
      query,
      cloak_id: cloakId,
      results: [],
      message: 'Search is performed client-side against cached content. Use contract_queries to fetch all posts for local filtering.',
      contract_queries: [
        { method: 'get_post_count', args: {} },
        { method: 'get_posts', args: { offset: 0, limit: 50 } },
      ],
    });
  } catch (error) {
    console.error('Search error:', error);
    return jsonError('Failed to search', 500);
  }
}
