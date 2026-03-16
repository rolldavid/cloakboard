// Duel & category API client — typed fetch wrappers for the new category-based structure.

import { apiUrl } from '@/lib/api';
import { buildAuthHeaders } from './authToken';

// ─── Types ───────────────────────────────────────────────────────

export type DuelType = 'binary' | 'multi' | 'level';
export type TimingType = 'duration';
export type DuelSort = 'trending' | 'new' | 'controversial' | 'ending';
export type CommentSort = 'best' | 'top' | 'new' | 'old';

export interface Category {
  id: number;
  name: string;
  slug: string;
  subcategories: Subcategory[];
  activeDuelCount: number;
}

export interface Subcategory {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  activity: number;
  activeDuelCount: number;
}

export interface DuelOption {
  id: number;
  label: string;
  voteCount: number;
  addedBy?: string;
  createdAt?: string;
}

export interface DuelLevel {
  level: number;
  voteCount: number;
  label?: string | null;
}

export interface DuelPeriod {
  id: number;
  periodStart: string;
  periodEnd: string;
  onChainId: number | null;
  agreeCount: number;
  disagreeCount: number;
  totalVotes: number;
  slug: string | null;
  endBlock: number | null;
  status: 'active' | 'ended';
  options?: DuelOption[];
  levels?: DuelLevel[];
}

export interface Duel {
  id: number;
  slug: string;
  onChainId: number | null;
  title: string;
  description: string | null;
  duelType: DuelType;
  timingType: TimingType;
  endsAt: string | null;
  startsAt: string | null;
  durationSeconds: number | null;
  recurrence: string | null;
  status: 'active' | 'ended' | 'cancelled';
  agreeCount: number;
  disagreeCount: number;
  totalVotes: number;
  commentCount: number;
  createdAt: string;
  createdBy: string | null;
  subcategoryId: number | null;
  subcategoryName: string | null;
  subcategorySlug: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySlug: string | null;
  options: DuelOption[] | null;
  levels?: DuelLevel[];
  periods?: DuelPeriod[];
  levelLowLabel?: string | null;
  levelHighLabel?: string | null;
  chartMode?: 'top_n' | 'threshold' | null;
  chartTopN?: number | null;
  endBlock?: number | null;
  isBreaking?: boolean;
  breakingSourceUrl?: string | null;
  breakingHeadline?: string | null;
  breakingImageUrl?: string | null;
  // Queue + staking fields
  queueStatus?: 'queued' | 'staked' | 'live' | 'failed' | null;
  stakedAmount?: number;
  stakerAddress?: string | null;
  stakeMultiplier?: number;
  stakeStatus?: 'pending' | 'locked' | 'returned' | 'burned' | 'rewarded' | null;
  stakeReward?: number;
  // Market voting fields (V9)
  winningDirection?: number | null;
  finalizedAt?: string | null;
  stakeCosts?: {
    agree?: number;
    disagree?: number;
    options?: Record<number, number>;
    levels?: Record<number, number>;
  };
}

export interface TrendingDuel {
  id: number;
  slug: string;
  title: string;
  duelType: DuelType;
  totalVotes: number;
  commentCount: number;
  agreeCount: number;
  disagreeCount: number;
  categoryName: string | null;
  categorySlug: string | null;
  isBreaking?: boolean;
}

export interface RecentlyEndedDuel {
  id: number;
  slug: string;
  title: string;
  duelType: DuelType;
  timingType: string;
  totalVotes: number;
  agreeCount: number;
  disagreeCount: number;
  categoryName: string | null;
  categorySlug: string | null;
  isBreaking?: boolean;
  endsAt: string;
  createdAt: string;
  durationSeconds: number | null;
  winner: string | null;
  winnerPct: number | null;
}

export interface ChartSnapshot {
  snapshotAt: string;
  agreeCount: number;
  disagreeCount: number;
  totalVotes: number;
  optionCounts: Record<string, number> | null;
}

export interface Comment {
  id: number;
  duelId: number;
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

export interface ActiveStake {
  duelId: number;
  title: string;
  slug: string;
  amount: number;
  endBlock: number | null;
  totalVotes: number;
  multiplier: number;
}

export interface ResolvedStake {
  duelId: number;
  title: string;
  slug: string;
  amount: number;
  reward: number;
  status: 'rewarded' | 'burned';
  totalVotes: number;
  resolvedAt: string;
}

export interface CreatedDuel {
  id: number;
  title: string;
  slug: string;
  agreeCount: number;
  disagreeCount: number;
  totalVotes: number;
  duelType: DuelType;
  endsAt: string | null;
  stakedAmount: number | null;
  stakeStatus: 'locked' | 'rewarded' | 'burned' | null;
  stakeReward: number | null;
}

export interface UserProfile {
  username: string;
  address: string;
  staking?: {
    totalStaked: number;
    totalRewarded: number;
    totalBurned: number;
    activeStakes: number;
    activeStakesList: ActiveStake[];
    resolvedStakesList: ResolvedStake[];
  };
  comments: {
    id: number;
    body: string;
    score: number;
    duelId: number;
    duelSlug: string;
    subcategoryName: string | null;
    createdAt: string;
  }[];
  createdDuels?: CreatedDuel[];
}

export type NotificationType = 'comment_reply' | 'created_duel_ended' | 'stake_resolved';

export interface AppNotification {
  id: number;
  type: NotificationType;
  duelId: number | null;
  duelSlug: string | null;
  duelTitle: string | null;
  message: string;
  metadata: Record<string, any> | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  commentReplies: boolean;
  createdDuelEnded: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────

interface AuthUser {
  address: string;
  name: string;
}

function authHeaders(): Record<string, string> {
  return buildAuthHeaders();
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

async function apiGetAuth<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
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
      ...(user ? authHeaders() : {}),
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
      ...authHeaders(),
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
      ...(user ? authHeaders() : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error ${res.status}`);
  }
  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────

export async function fetchGoogleSalt(idToken: string): Promise<string> {
  const data = await apiPost<{ salt: string }>(apiUrl('/api/auth/google-salt'), { idToken });
  return data.salt;
}

// ─── Block Clock ─────────────────────────────────────────────────

export interface BlockClock {
  blockNumber: number;
  avgBlockTime: number;
  observedAt: string;
}

export async function fetchBlockClock(): Promise<BlockClock> {
  return apiGet(apiUrl('/api/block-clock'));
}

// ─── Categories ──────────────────────────────────────────────────

export async function fetchCategories(): Promise<Category[]> {
  const data = await apiGet<{ categories: Category[] }>(apiUrl('/api/categories'));
  return data.categories;
}

export async function createSubcategory(
  user: AuthUser,
  categoryId: number,
  name: string,
): Promise<Subcategory> {
  return apiPost(apiUrl('/api/subcategories'), { categoryId, name }, user);
}

// ─── Duels ───────────────────────────────────────────────────────

export async function fetchDuels(opts: {
  category?: string;
  subcategory?: string;
  sort?: DuelSort;
  page?: number;
  limit?: number;
  type?: DuelType;
  breaking?: boolean;
}): Promise<{ duels: Duel[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.subcategory) params.set('subcategory', opts.subcategory);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.type) params.set('type', opts.type);
  if (opts.breaking) params.set('breaking', 'true');
  return apiGet(apiUrl(`/api/duels?${params}`));
}

export async function fetchDuel(idOrSlug: number | string): Promise<Duel> {
  const data = await apiGet<{ duel: Duel }>(apiUrl(`/api/duels/${encodeURIComponent(idOrSlug)}`));
  return data.duel;
}

export type FeaturedDuels = Record<DuelSort, Duel | null>;

export async function fetchFeaturedDuels(opts?: { category?: string }): Promise<FeaturedDuels & { breaking?: Duel | null }> {
  const params = new URLSearchParams();
  if (opts?.category) params.set('category', opts.category);
  const qs = params.toString();
  const data = await apiGet<{ trending: Duel | null; controversial: Duel | null; new: Duel | null; ending: Duel | null; breaking: Duel | null }>(
    apiUrl(`/api/duels/featured${qs ? `?${qs}` : ''}`)
  );
  return { trending: data.trending, controversial: data.controversial, new: data.new, ending: data.ending, breaking: data.breaking };
}

export async function fetchTrendingDuels(): Promise<TrendingDuel[]> {
  const data = await apiGet<{ trending: TrendingDuel[] }>(apiUrl('/api/duels/trending'));
  return data.trending;
}

export async function fetchRecentlyEndedDuels(opts?: {
  category?: string;
  page?: number;
  limit?: number;
}): Promise<{ duels: RecentlyEndedDuel[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.category) params.set('category', opts.category);
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiGet(apiUrl(`/api/duels/recently-ended${qs ? `?${qs}` : ''}`));
}

export async function searchDuels(
  q: string,
  page?: number,
): Promise<{ duels: Duel[]; total: number }> {
  const params = new URLSearchParams({ q });
  if (page) params.set('page', String(page));
  return apiGet(apiUrl(`/api/duels/search?${params}`));
}

export async function createDuel(
  user: AuthUser,
  data: {
    title: string;
    description?: string;
    duelType: DuelType;
    timingType: TimingType;
    categoryId: number;
    durationSeconds?: number;
    options?: string[];
    levelLowLabel?: string;
    levelHighLabel?: string;
    chartMode?: 'top_n' | 'threshold';
    chartTopN?: number;
    stakeAmount: number;
  },
): Promise<{ id: number; slug: string; createdAt: string }> {
  return apiPost(apiUrl('/api/duels'), data, user);
}

export async function addDuelOption(
  user: AuthUser,
  duelId: number,
  label: string,
): Promise<DuelOption> {
  return apiPost(apiUrl(`/api/duels/${duelId}/options`), { label }, user);
}

export interface SyncResult {
  agreeCount: number;
  disagreeCount: number;
  totalVotes: number;
  status: string;
  options?: Array<{ id: number; label: string; voteCount: number }>;
  levels?: Array<{ level: number; voteCount: number }>;
}

export async function syncDuelVotes(
  duelId: number,
  periodId?: number,
): Promise<SyncResult> {
  const params = periodId ? `?periodId=${periodId}` : '';
  return apiPost(apiUrl(`/api/duels/${duelId}/sync${params}`), {});
}

export async function fetchDuelChart(
  duelId: number,
  range: '1h' | '6h' | '12h' | '24h' | 'day' | 'week' | 'month' | '1y' | 'all' = 'all',
  periodId?: number,
): Promise<ChartSnapshot[]> {
  const params = new URLSearchParams({ range });
  if (periodId) params.set('periodId', String(periodId));
  const data = await apiGet<{ snapshots: ChartSnapshot[] }>(apiUrl(`/api/duels/${duelId}/chart?${params}`));
  return data.snapshots;
}

// ─── Comments ────────────────────────────────────────────────────

export async function fetchComments(opts: {
  duelId: number;
  sort?: CommentSort;
  limit?: number;
  viewer?: string;
  periodId?: number;
}): Promise<{ comments: Comment[]; totalCount: number }> {
  const params = new URLSearchParams({ duelId: String(opts.duelId) });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.viewer) params.set('viewer', opts.viewer);
  if (opts.periodId) params.set('periodId', String(opts.periodId));
  return apiGet(apiUrl(`/api/comments?${params}`));
}

export async function createComment(
  user: AuthUser,
  data: { duelId: number; parentId?: number; body: string; periodId?: number },
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

// ─── Statement Evaluation ────────────────────────────────────────

export interface StatementEvaluation {
  approved: boolean;
  reason?: string;
  suggestion: string;
  categorySlug: string;
  overlap?: string;
}

export async function evaluateStatement(statement: string): Promise<StatementEvaluation> {
  return apiPost(apiUrl('/api/evaluate-statement'), { statement });
}

export interface StakingInfo {
  avgVotes: number;
  minVotesThreshold: number;
  maxReward: number;
  minStake: number;
}

export async function fetchStakingInfo(): Promise<StakingInfo> {
  return apiGet(apiUrl('/api/evaluate-statement/staking-info'));
}

// ─── Users ───────────────────────────────────────────────────────

export async function fetchUserProfile(username: string, opts?: { address?: string }): Promise<UserProfile> {
  const params = opts?.address ? `?address=${encodeURIComponent(opts.address)}` : '';
  return apiGet(apiUrl(`/api/users/${encodeURIComponent(username)}${params}`));
}

// ─── Notifications ────────────────────────────────────────────────

export async function fetchNotifications(
  limit = 20,
  unreadOnly = false,
): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (unreadOnly) params.set('unreadOnly', 'true');
  return apiGetAuth(apiUrl(`/api/notifications?${params}`));
}

export async function markNotificationRead(id: number): Promise<void> {
  await apiPut(apiUrl(`/api/notifications/${id}/read`), {}, { address: '', name: '' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiPut(apiUrl(`/api/notifications/read-all`), {}, { address: '', name: '' });
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return apiGetAuth(apiUrl('/api/notifications/preferences'));
}

export async function updateNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
  await apiPut(apiUrl('/api/notifications/preferences'), prefs, { address: '', name: '' });
}

