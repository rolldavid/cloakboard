/**
 * Service Wallet for Molt Verification
 *
 * Server-side wallet used by the verify route to call complete_verification
 * on the Molt contract. This is the only server-side write operation.
 *
 * Requires env vars:
 *   AZTEC_RPC_URL            — Aztec node endpoint
 *   MOLT_SERVICE_SECRET_KEY  — Fr hex string
 *   MOLT_SERVICE_SALT        — Fr hex string
 */

import { createAztecNodeClient, waitForNode, type AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import MoltCloakArtifact from '@/lib/aztec/artifacts/MoltCloak.json';
import { getContent as getR2Content } from '@/lib/molt/r2';

let cachedWallet: any = null;
let cachedNode: AztecNode | null = null;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

async function getNode(): Promise<AztecNode> {
  if (cachedNode) return cachedNode;
  const url = requireEnv('AZTEC_RPC_URL');
  cachedNode = createAztecNodeClient(url);
  await waitForNode(cachedNode);
  return cachedNode;
}

export async function getServiceWallet(): Promise<any> {
  if (cachedWallet) return cachedWallet;

  const node = await getNode();
  const secretKey = Fr.fromString(requireEnv('MOLT_SERVICE_SECRET_KEY'));
  const salt = Fr.fromString(requireEnv('MOLT_SERVICE_SALT'));

  const { TestWallet } = await import('@aztec/test-wallet/server');
  const testWallet = await TestWallet.create(node, { proverEnabled: true });
  cachedWallet = await testWallet.createSchnorrAccount(secretKey, salt);

  return cachedWallet;
}

/**
 * Call complete_verification on a Molt contract using the service wallet.
 */
export async function completeVerificationOnChain(
  cloakAddress: string,
  artifact: any,
  nonceHash: bigint,
  twitterHash: bigint
): Promise<string> {
  const wallet = await getServiceWallet();
  const address = AztecAddress.fromString(cloakAddress);
  const contract = await Contract.at(address, artifact, wallet);

  const tx = await contract.methods
    .complete_verification(nonceHash, twitterHash)
    .send({} as any)
    .wait({ timeout: 120000 });

  return tx.txHash.toString();
}

/**
 * Get a read-only contract instance via service wallet
 */
async function getReadContract(cloakAddress: string) {
  const wallet = await getServiceWallet();
  const address = AztecAddress.fromString(cloakAddress);
  return Contract.at(address, MoltCloakArtifact as any, wallet);
}

/**
 * Check if a Molt is currently in its public viewing window
 */
export async function isMoltPublic(cloakAddress: string): Promise<boolean> {
  const contract = await getReadContract(cloakAddress);
  const currentHour = new Date().getUTCHours();
  const result = await contract.methods.is_currently_public(BigInt(currentHour)).simulate({} as any);
  return Boolean(result);
}

/**
 * Get the Molt's public viewing schedule
 */
export async function getMoltSchedule(cloakAddress: string): Promise<{ hoursPerDay: number; startHour: number }> {
  const contract = await getReadContract(cloakAddress);
  const hours = Number(await contract.methods.get_public_hours_per_day().simulate({} as any));
  const start = Number(await contract.methods.get_public_window_start_utc().simulate({} as any));
  return { hoursPerDay: hours, startHour: start };
}

/**
 * Read posts from a Molt contract and resolve content from R2
 */
export async function readMoltPosts(
  cloakAddress: string,
  page: number,
  limit: number
): Promise<{ posts: any[]; total: number }> {
  const contract = await getReadContract(cloakAddress);
  const postCount = Number(await contract.methods.get_post_count().simulate({} as any));

  const start = Math.max(1, postCount - (page - 1) * limit - limit + 1);
  const end = Math.min(postCount, postCount - (page - 1) * limit);

  const posts: any[] = [];
  for (let i = end; i >= start; i--) {
    try {
      const post = await contract.methods.get_post(i).simulate({} as any);
      if (post.deleted) continue;

      const contentHash = post.content_hash?.toString() ?? post.contentHash?.toString();
      let content: string | null = null;
      if (contentHash) {
        content = await getR2Content(contentHash);
      }

      posts.push({
        id: Number(post.id),
        content,
        author: post.author?.toString() ?? '',
        votesUp: Number(post.votes_up ?? post.votesUp ?? 0),
        votesDown: Number(post.votes_down ?? post.votesDown ?? 0),
        createdAt: Number(post.created_at ?? post.createdAt ?? 0),
        submoltId: Number(post.submolt_id ?? post.submoltId ?? 0),
      });
    } catch (err) {
      console.warn(`[serviceWallet] Failed to read post ${i}:`, err);
    }
  }

  return { posts, total: postCount };
}

/**
 * Read comments for a post from a Molt contract and resolve content from R2
 */
export async function readMoltComments(
  cloakAddress: string,
  postId: number
): Promise<any[]> {
  const contract = await getReadContract(cloakAddress);
  const commentCount = Number(await contract.methods.get_comment_count().simulate({} as any));

  const comments: any[] = [];
  for (let i = 1; i <= commentCount; i++) {
    try {
      const comment = await contract.methods.get_comment(i).simulate({} as any);
      const cPostId = Number(comment.post_id ?? comment.postId);
      if (cPostId !== postId) continue;

      const contentHash = comment.content_hash?.toString() ?? comment.contentHash?.toString();
      let content: string | null = null;
      if (contentHash) {
        content = await getR2Content(contentHash);
      }

      comments.push({
        id: Number(comment.id),
        content,
        author: comment.author?.toString() ?? '',
        postId: cPostId,
        parentCommentId: Number(comment.parent_comment_id ?? comment.parentCommentId ?? 0),
        votesUp: Number(comment.votes_up ?? comment.votesUp ?? 0),
        votesDown: Number(comment.votes_down ?? comment.votesDown ?? 0),
        createdAt: Number(comment.created_at ?? comment.createdAt ?? 0),
      });
    } catch (err) {
      console.warn(`[serviceWallet] Failed to read comment ${i}:`, err);
    }
  }

  return comments;
}
