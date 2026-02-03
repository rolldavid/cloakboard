import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; submoltId: string }> }
) {
  const { submoltId } = await params;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const ip = getRequestIp(request);
  if (isApiRateLimited(ip, 30)) return jsonError('Too many requests', 429);

  try {
    const id = parseInt(submoltId);
    if (isNaN(id) || id < 1) return jsonError('Invalid submolt ID', 400);

    // Subscriptions are stored client-side in IndexedDB
    // This endpoint acknowledges the intent
    return jsonSuccess({ subscribed: true, submolt_id: id });
  } catch (error) {
    console.error('Subscribe error:', error);
    return jsonError('Failed to subscribe', 500);
  }
}
