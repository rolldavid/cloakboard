import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess } from '../../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    // Return address and contract query info — client calls view functions on-chain
    return jsonSuccess({
      address: auth.address,
      cloak_id: cloakId,
      contract_queries: [
        { method: 'is_agent_verified', args: { agent_address: auth.address } },
        { method: 'get_agent_display_name', args: { agent_address: auth.address } },
      ],
    });
  } catch (error) {
    console.error('Agent profile error:', error);
    return jsonError('Failed to get agent profile', 500);
  }
}
