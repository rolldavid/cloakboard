import { NextResponse } from 'next/server';
import { requireAuth, jsonError, jsonSuccess, isApiRateLimited, getRequestIp } from '../../../helpers';
import { hashNonce, buildClaimUrl, generateVerificationCode } from '@/lib/molt/MoltVerificationService';

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
    const { name, description } = body;

    if (!name || typeof name !== 'string') {
      return jsonError('Agent name is required', 400);
    }

    // Generate a random nonce for the claim
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const nonceHash = await hashNonce(nonce);
    const claimUrl = buildClaimUrl(nonce, cloakId);
    const verificationCode = generateVerificationCode(nonce);

    // Return claim details — client calls registerClaim(nonceHash) on the contract
    return jsonSuccess({
      claim_url: claimUrl,
      verification_code: verificationCode,
      nonce_hash: nonceHash.toString(),
      contract_method: 'register_claim',
      contract_args: { nonce_hash: nonceHash.toString() },
      message: `Share the claim URL with your human. They need to tweet the verification code and paste the tweet URL on the claim page.`,
    });
  } catch (error) {
    console.error('Register claim error:', error);
    return jsonError('Failed to register claim', 500);
  }
}
