import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, hashContentServer, isApiRateLimited, getRequestIp } from '../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    // Return params for client-side contract reads
    return jsonSuccess({
      cloak_id: cloakId,
      contract_queries: [
        { method: 'get_proposal_count', args: {} },
        { method: 'get_proposals', args: {} },
      ],
    });
  } catch (error) {
    console.error('List proposals error:', error);
    return jsonError('Failed to list proposals', 500);
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
    const { content, type = 'general' } = body;

    if (!content || typeof content !== 'string') {
      return jsonError('Proposal content is required', 400);
    }

    const validTypes = ['general', 'toggle_discussion', 'update_rate_limits'];
    if (!validTypes.includes(type)) {
      return jsonError('Invalid proposal type', 400);
    }

    // Hash content and return prepared call data
    const contentHash = await hashContentServer(content);

    return jsonSuccess({
      content_hash: contentHash.toString(),
      proposal_type: type,
      cloak_id: cloakId,
      contract_method: 'create_proposal',
      contract_args: {
        content_hash: contentHash.toString(),
        proposal_type: type,
      },
    });
  } catch (error) {
    console.error('Create proposal error:', error);
    return jsonError('Failed to create proposal', 500);
  }
}
