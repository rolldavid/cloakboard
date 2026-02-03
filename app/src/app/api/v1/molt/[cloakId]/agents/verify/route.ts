import { jsonError, jsonSuccess, getCloakId, isApiRateLimited, getRequestIp } from '../../../helpers';
import {
  hashNonce,
  generateVerificationCode,
  fetchTweetContent,
  extractHandle,
  verifyTweetContent,
  hashTwitterHandle,
} from '@/lib/molt/MoltVerificationService';
import { completeVerificationOnChain } from '@/lib/molt/serviceWallet';
import MoltCloakArtifact from '@/lib/aztec/artifacts/MoltCloak.json';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;

  // Rate limit: 5 per minute per IP
  const ip = getRequestIp(request);
  if (isApiRateLimited(`verify:${ip}`, 5)) {
    return jsonError('Too many requests', 429);
  }

  try {
    const body = await request.json();
    const { nonce, tweet_url } = body;

    if (!nonce || typeof nonce !== 'string') {
      return jsonError('Nonce is required', 400);
    }
    if (!tweet_url || typeof tweet_url !== 'string') {
      return jsonError('Tweet URL is required', 400);
    }

    // Validate tweet URL format
    const urlPattern = /^https:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+$/;
    if (!urlPattern.test(tweet_url)) {
      return jsonError('Invalid tweet URL format', 400);
    }

    const nonceHash = await hashNonce(nonce);
    const verificationCode = generateVerificationCode(nonce);

    // Fetch tweet content via oEmbed (server-side)
    const tweet = await fetchTweetContent(tweet_url);
    if (!tweet) {
      return jsonError('Could not fetch tweet. Make sure the tweet is public.', 400);
    }

    // Verify tweet contains verification code
    if (!verifyTweetContent(tweet.html, verificationCode)) {
      return jsonError(`Tweet does not contain verification code: ${verificationCode}`, 400);
    }

    // Extract Twitter handle
    const handle = extractHandle(tweet.authorUrl);
    if (!handle) {
      return jsonError('Could not extract Twitter handle', 500);
    }

    const twitterHash = await hashTwitterHandle(handle);

    // Call contract via service wallet
    const txHash = await completeVerificationOnChain(
      cloakId,
      MoltCloakArtifact,
      nonceHash,
      twitterHash
    );

    return jsonSuccess({
      status: 'verified',
      twitter_handle: `@${handle}`,
      tx_hash: txHash,
    });
  } catch (error: any) {
    console.error('Verification error:', error);

    // Surface contract revert messages
    if (error.message?.includes('already verified') || error.message?.includes('claim_nonce_verified')) {
      return jsonError('This claim has already been verified', 409);
    }
    if (error.message?.includes('twitter_hash_used')) {
      return jsonError('This Twitter account has already been used for verification', 409);
    }

    return jsonError('Verification failed', 500);
  }
}
