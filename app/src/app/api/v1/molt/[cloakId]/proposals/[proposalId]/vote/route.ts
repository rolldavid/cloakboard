import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; proposalId: string }> }
) {
  const { proposalId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ip = getRequestIp(request);
  if (isApiRateLimited(ip, 30)) return jsonError('Too many requests', 429);

  try {
    const id = parseInt(proposalId);
    if (isNaN(id) || id < 1) return jsonError('Invalid proposal ID', 400);

    const body = await request.json();
    const { support } = body;

    if (typeof support !== 'boolean') {
      return jsonError('Support (boolean) is required', 400);
    }

    // Return params for client to call cast_vote on contract
    return jsonSuccess({
      proposal_id: id,
      support,
      contract_method: 'cast_vote',
      contract_args: { proposal_id: id, support },
    });
  } catch (error) {
    console.error('Cast vote error:', error);
    return jsonError('Failed to cast vote', 500);
  }
}
