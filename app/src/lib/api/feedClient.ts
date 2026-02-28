// Feed & social layer API client — typed fetch wrappers.

import { apiUrl } from '@/lib/api';
import { buildAuthHeaders } from './authToken';

export type FeedSort = 'best' | 'hot' | 'controversial' | 'ending_soon' | 'recently_concluded' | 'top';
export type TopTime = 'day' | 'week' | 'month' | 'year' | 'all';
export type CommentSort = 'top' | 'new' | 'controversial' | 'old';

export interface FeedDuel {
  cloakAddress: string;
  cloakName: string;
  cloakSlug: string;
  duelId: number;
  statementText: string;
  startBlock: number;
  endBlock: number;
  totalVotes: number;
  agreeVotes: number;
  disagreeVotes: number;
  isTallied: boolean;
  commentCount: number;
  qualityUpvotes: number;
  qualityDownvotes: number;
  myQualityVote: 1 | -1 | null;
  isJoinedCloak: boolean;
  createdAt: string;
  endTime: string | null;
}

export interface Comment {
  id: number;
  duelId: number;
  cloakAddress: string;
  parentId: number | null;
  authorAddress: string;
  authorName: string;
  body: string;
  upvotes: number;
  downvotes: number;
  score: number;
  isDeleted: boolean;
  myVote: 1 | -1 | null;
  createdAt: string;
}

export interface CloakInfo {
  description: string | null;
  council: { userAddress: string; username: string | null; role: number }[];
  nextDuelAt: string | null;
  duelIntervalSeconds: number | null;
  pendingInvite?: boolean;
}

export interface CouncilInvite {
  id: number;
  username: string;
  invitedBy: string;
  createdAt: string;
}

export interface RemovalProposal {
  id: number;
  targetUsername: string | null;
  targetAddress: string;
  proposedBy: string;
  createdAt: string;
  endsAt: string;
  resolved: boolean;
  outcome: string | null;
  votesFor: number;
  votesAgainst: number;
  myVote: boolean | null;
  totalMembers: number;
}

export interface CloakSummary {
  address: string;
  name: string;
  slug: string;
}

export interface CloakExploreItem extends CloakSummary {
  duel_count: number;
  vote_count: number;
  last_activity: string;
}

export interface BanEntry {
  username: string;
  userAddress: string;
  reason: string | null;
  bannedAt: string;
}

export interface UserProfile {
  username: string;
  address: string;
  comments: {
    id: number;
    body: string;
    score: number;
    duelId: number;
    cloakAddress: string;
    cloakName: string;
    cloakSlug: string;
    createdAt: string;
  }[];
}

// --- Helpers ---

interface AuthUser {
  address: string;
  name: string;
}

function authHeaders(user: AuthUser): Record<string, string> {
  return buildAuthHeaders(user);
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(url: string, body: any, user?: AuthUser): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user ? authHeaders(user) : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

async function apiPut<T>(url: string, body: any, user: AuthUser): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(user),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

async function apiDelete<T>(url: string, body?: any, user?: AuthUser): Promise<T> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(user ? authHeaders(user) : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

// --- Feed ---

export async function fetchFeed(opts: {
  sort?: FeedSort;
  time?: TopTime;
  cloak?: string;
  cursor?: string;
  limit?: number;
  viewer?: string;
  active?: boolean;
}): Promise<{ duels: FeedDuel[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.time) params.set('time', opts.time);
  if (opts.cloak) params.set('cloak', opts.cloak);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.viewer) params.set('viewer', opts.viewer);
  if (opts.active) params.set('active', '1');
  return apiGet(apiUrl(`/api/duels/feed?${params}`));
}

// --- Comments ---

export async function fetchComments(opts: {
  duelId: number;
  cloakAddress: string;
  sort?: CommentSort;
  limit?: number;
  viewer?: string;
}): Promise<{ comments: Comment[]; totalCount: number }> {
  const params = new URLSearchParams({
    duelId: String(opts.duelId),
    cloakAddress: opts.cloakAddress,
  });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.viewer) params.set('viewer', opts.viewer);
  return apiGet(apiUrl(`/api/comments?${params}`));
}

export async function createComment(
  user: AuthUser,
  data: { duelId: number; cloakAddress: string; parentId?: number; body: string },
): Promise<Comment> {
  return apiPost(apiUrl('/api/comments'), data, user);
}

export async function deleteComment(user: AuthUser, commentId: number): Promise<void> {
  await apiDelete(apiUrl(`/api/comments/${commentId}`), undefined, user);
}

export async function voteComment(
  user: AuthUser,
  commentId: number,
  direction: 1 | -1 | 0,
): Promise<{ upvotes: number; downvotes: number; myVote: 1 | -1 | null }> {
  return apiPut(apiUrl(`/api/comments/${commentId}/vote`), { direction }, user);
}

// --- Cloak Joins ---

export async function joinCloak(user: AuthUser, cloakAddress: string): Promise<void> {
  await apiPost(apiUrl('/api/cloaks/join'), { cloakAddress }, user);
}

export async function leaveCloak(user: AuthUser, cloakAddress: string): Promise<void> {
  await apiDelete(apiUrl('/api/cloaks/join'), { cloakAddress }, user);
}

export async function fetchJoinedCloaks(userAddress: string): Promise<CloakSummary[]> {
  const data = await apiGet<{ cloaks: CloakSummary[] }>(apiUrl(`/api/cloaks/join?user=${encodeURIComponent(userAddress)}`));
  return data.cloaks;
}

// --- Vote Timeline ---

export interface TimelinePoint {
  agreePct: number;
  agreeVotes: number;
  disagreeVotes: number;
  totalVotes: number;
  snapshotAt: string;
}

export async function fetchVoteTimeline(
  cloakAddress: string,
  duelId: number,
): Promise<TimelinePoint[]> {
  const params = new URLSearchParams({ cloakAddress, duelId: String(duelId) });
  const data = await apiGet<{ snapshots: TimelinePoint[] }>(apiUrl(`/api/duels/timeline?${params}`));
  return data.snapshots;
}

// --- Duel Quality Votes ---

export async function voteDuel(
  user: AuthUser,
  cloakAddress: string,
  duelId: number,
  direction: 1 | -1 | 0,
): Promise<{ qualityUpvotes: number; qualityDownvotes: number; myVote: 1 | -1 | null }> {
  return apiPut(
    apiUrl(`/api/duels/vote/${encodeURIComponent(cloakAddress)}/${duelId}`),
    { direction },
    user,
  );
}

// --- Vote Sync ---

export async function syncDuelVotes(
  cloakAddress: string,
  duelId: number,
  expectedMinVotes?: number,
): Promise<{ totalVotes: number; agreeVotes: number; disagreeVotes: number; isTallied: boolean }> {
  return apiPost(apiUrl('/api/duels/sync'), { cloakAddress, duelId, expectedMinVotes });
}

// --- Cloaks ---

export async function fetchRecentCloaks(limit?: number): Promise<CloakSummary[]> {
  const params = limit ? `?limit=${limit}` : '';
  const data = await apiGet<{ cloaks: CloakSummary[] }>(apiUrl(`/api/cloaks/recent${params}`));
  return data.cloaks;
}

export async function fetchExploreCloaks(): Promise<CloakExploreItem[]> {
  const data = await apiGet<{ cloaks: CloakExploreItem[] }>(apiUrl('/api/cloaks/explore'));
  return data.cloaks;
}

export async function fetchCloakInfo(addressOrSlug: string, viewer?: string): Promise<CloakInfo> {
  const params = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
  return apiGet(apiUrl(`/api/cloaks/${encodeURIComponent(addressOrSlug)}/info${params}`));
}

// --- Bans ---

export async function banMember(
  user: AuthUser,
  cloakAddress: string,
  username: string,
  reason?: string,
): Promise<void> {
  await apiPost(apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/bans`), { username, reason }, user);
}

export async function unbanMember(user: AuthUser, cloakAddress: string, username: string): Promise<void> {
  await apiDelete(apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/bans`), { username }, user);
}

export async function fetchBans(cloakAddress: string): Promise<BanEntry[]> {
  const data = await apiGet<{ bans: BanEntry[] }>(apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/bans`));
  return data.bans;
}

// --- Users ---

export async function fetchUserProfile(username: string): Promise<UserProfile> {
  return apiGet(apiUrl(`/api/users/${encodeURIComponent(username)}`));
}

// --- Council Management ---

export async function inviteCouncilMember(
  user: AuthUser,
  cloakAddress: string,
  username: string,
): Promise<void> {
  await apiPost(apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/invite`), { username }, user);
}

export async function claimCouncilInvite(user: AuthUser, cloakAddress: string): Promise<void> {
  await apiPost(apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/claim`), {}, user);
}

export async function declineCouncilInvite(user: AuthUser, cloakAddress: string): Promise<void> {
  await apiPost(apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/decline`), {}, user);
}

export async function fetchCouncilInvites(cloakAddress: string): Promise<CouncilInvite[]> {
  const data = await apiGet<{ invites: CouncilInvite[] }>(
    apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/invites`),
  );
  return data.invites;
}

export async function proposeCouncilRemoval(
  user: AuthUser,
  cloakAddress: string,
  targetUsername: string,
): Promise<{ removalId: number }> {
  return apiPost(
    apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/propose-removal`),
    { targetUsername },
    user,
  );
}

export async function voteCouncilRemoval(
  user: AuthUser,
  cloakAddress: string,
  removalId: number,
  vote: boolean,
): Promise<void> {
  await apiPost(
    apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/removal/${removalId}/vote`),
    { vote },
    user,
  );
}

export async function fetchCouncilRemovals(
  cloakAddress: string,
  viewer?: string,
): Promise<RemovalProposal[]> {
  const params = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
  const data = await apiGet<{ removals: RemovalProposal[] }>(
    apiUrl(`/api/cloaks/${encodeURIComponent(cloakAddress)}/council/removals${params}`),
  );
  return data.removals;
}
