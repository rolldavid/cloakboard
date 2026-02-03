import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, hashContentServer, isApiRateLimited, getRequestIp } from '../../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;

  try {
    // Return params for client-side contract reads
    return jsonSuccess({
      cloak_id: cloakId,
      contract_queries: [
        { method: 'get_submolt_count', args: {} },
        { method: 'get_submolts', args: {} },
      ],
    });
  } catch (error) {
    console.error('List submolts error:', error);
    return jsonError('Failed to list submolts', 500);
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
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return jsonError('Submolt name is required', 400);
    }

    // Hash the name and return prepared call data
    const nameHash = await hashContentServer(name);

    return jsonSuccess({
      name_hash: nameHash.toString(),
      cloak_id: cloakId,
      contract_method: 'create_submolt',
      contract_args: { name_hash: nameHash.toString() },
    });
  } catch (error) {
    console.error('Create submolt error:', error);
    return jsonError('Failed to create submolt', 500);
  }
}
