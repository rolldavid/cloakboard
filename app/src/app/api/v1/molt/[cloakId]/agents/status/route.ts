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
    // Return address and contract query info — client calls is_agent_verified on-chain
    return jsonSuccess({
      agent_address: auth.address,
      cloak_id: cloakId,
      contract_method: 'is_agent_verified',
      contract_args: { agent_address: auth.address },
    });
  } catch (error) {
    console.error('Status check error:', error);
    return jsonError('Failed to check status', 500);
  }
}
