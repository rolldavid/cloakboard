// Feed & social layer API client — typed fetch wrappers.

export type FeedSort = 'best' | 'hot' | 'controversial' | 'ending_soon' | 'top';
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
  starCount: number;
  commentCount: number;
  isStarred: boolean;
  createdAt: string;
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

export interface WhisperStats {
  totalPoints: number;
  duelVotes: number;
  comments: number;
  commentVotes: number;
  stars: number;
  level: number;
  levelName: string;
  nextLevel: { level: number; name: string; minPoints: number } | null;
}

export interface UserProfile {
  username: string;
  address: string;
  whisper: { totalPoints: number; level: number; levelName: string };
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
  return {
    'x-user-address': user.address,
    'x-user-name': user.name,
  };
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
}): Promise<{ duels: FeedDuel[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.time) params.set('time', opts.time);
  if (opts.cloak) params.set('cloak', opts.cloak);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.viewer) params.set('viewer', opts.viewer);
  return apiGet(`/api/duels/feed?${params}`);
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
  return apiGet(`/api/comments?${params}`);
}

export async function createComment(
  user: AuthUser,
  data: { duelId: number; cloakAddress: string; parentId?: number; body: string },
): Promise<Comment> {
  return apiPost('/api/comments', data, user);
}

export async function deleteComment(user: AuthUser, commentId: number): Promise<void> {
  await apiDelete(`/api/comments/${commentId}`, undefined, user);
}

export async function voteComment(
  user: AuthUser,
  commentId: number,
  direction: 1 | -1 | 0,
): Promise<{ upvotes: number; downvotes: number; myVote: 1 | -1 | null }> {
  return apiPut(`/api/comments/${commentId}/vote`, { direction }, user);
}

// --- Stars ---

export async function starDuel(user: AuthUser, cloakAddress: string, duelId: number): Promise<void> {
  await apiPost('/api/duels/star', { cloakAddress, duelId }, user);
}

export async function unstarDuel(user: AuthUser, cloakAddress: string, duelId: number): Promise<void> {
  await apiDelete('/api/duels/star', { cloakAddress, duelId }, user);
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
  const data = await apiGet<{ snapshots: TimelinePoint[] }>(`/api/duels/timeline?${params}`);
  return data.snapshots;
}

// --- Vote Sync ---

export async function syncDuelVotes(
  cloakAddress: string,
  duelId: number,
  expectedMinVotes?: number,
): Promise<{ totalVotes: number; agreeVotes: number; disagreeVotes: number; isTallied: boolean }> {
  return apiPost('/api/duels/sync', { cloakAddress, duelId, expectedMinVotes });
}

// --- Cloaks ---

export async function fetchRecentCloaks(limit?: number): Promise<CloakSummary[]> {
  const params = limit ? `?limit=${limit}` : '';
  const data = await apiGet<{ cloaks: CloakSummary[] }>(`/api/cloaks/recent${params}`);
  return data.cloaks;
}

export async function fetchExploreCloaks(): Promise<CloakExploreItem[]> {
  const data = await apiGet<{ cloaks: CloakExploreItem[] }>('/api/cloaks/explore');
  return data.cloaks;
}

export async function fetchCloakInfo(addressOrSlug: string): Promise<CloakInfo> {
  return apiGet(`/api/cloaks/${encodeURIComponent(addressOrSlug)}/info`);
}

// --- Bans ---

export async function banMember(
  user: AuthUser,
  cloakAddress: string,
  username: string,
  reason?: string,
): Promise<void> {
  await apiPost(`/api/cloaks/${encodeURIComponent(cloakAddress)}/bans`, { username, reason }, user);
}

export async function unbanMember(user: AuthUser, cloakAddress: string, username: string): Promise<void> {
  await apiDelete(`/api/cloaks/${encodeURIComponent(cloakAddress)}/bans`, { username }, user);
}

export async function fetchBans(cloakAddress: string): Promise<BanEntry[]> {
  const data = await apiGet<{ bans: BanEntry[] }>(`/api/cloaks/${encodeURIComponent(cloakAddress)}/bans`);
  return data.bans;
}

// --- Whispers ---

export async function fetchWhisperStats(address: string): Promise<WhisperStats> {
  return apiGet(`/api/whispers/${encodeURIComponent(address)}`);
}

// --- Users ---

export async function fetchUserProfile(username: string): Promise<UserProfile> {
  return apiGet(`/api/users/${encodeURIComponent(username)}`);
}
