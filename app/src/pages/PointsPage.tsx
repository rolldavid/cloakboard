import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion';
import { fetchUserProfile } from '@/lib/api/duelClient';
import type { UserProfile, ActiveStake, ResolvedStake } from '@/lib/api/duelClient';
import { useAppStore } from '@/store/index';
import { useCountdown } from '@/hooks/useCountdown';
import { getLocalNotifications } from '@/lib/notifications/localNotifications';
import type { LocalNotification } from '@/lib/notifications/localNotifications';
import { getCachedVoteStakes, cacheVoteStakes, getDuelSlugMap, lookupDuelFromMap } from '@/lib/pointsTracker';

const MIN_VOTES_THRESHOLD = parseInt((import.meta as any).env?.VITE_MIN_VOTES_THRESHOLD || '5', 10);
const BOOTSTRAP_AVG = 5;

function AnimatedNumber({ value, loading }: { value: number; loading?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    motionVal.set(value);
  }, [value, motionVal]);

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsubscribe;
  }, [display]);

  if (loading) {
    return (
      <span className="inline-flex items-center justify-center gap-1.5 text-sm text-foreground-muted">
        <span className="w-4 h-4 border-2 border-foreground-muted/40 border-t-accent rounded-full animate-spin" />
      </span>
    );
  }

  return <span ref={ref}>{value.toLocaleString()}</span>;
}

function projectedReward(totalVotes: number, stakeAmount: number, _multiplier: number): number {
  if (totalVotes < MIN_VOTES_THRESHOLD) return 0;
  const minStake = 10;
  const ratio = totalVotes / Math.max(BOOTSTRAP_AVG, 1);
  const baseReward = 60 * Math.log(1 + ratio);
  const stakeMultiplier = Math.sqrt(Math.max(stakeAmount, minStake) / minStake);
  return Math.min(500, Math.floor(baseReward * stakeMultiplier));
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface VoteStake {
  duelId: number;
  dbDuelId?: number;
  direction: number;
  stakeAmount: number;
  slug?: string;
  title?: string;
  isFinalized?: boolean;
  outcome?: number | null; // winning direction, or 255=refund, or null=unknown
}

export function PointsPage() {
  const { userName, userAddress, whisperPoints, pointsLoading } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // On-chain points — synced in background, optimistic shown immediately
  const [onChainPoints, setOnChainPoints] = useState<number | null>(null);

  // Active vote stakes (private — cached from last PXE read, updated from PXE when ready)
  const [voteStakes, setVoteStakes] = useState<VoteStake[]>(() => getCachedVoteStakes());

  useEffect(() => {
    if (!userName) return;
    setLoading(true);
    fetchUserProfile(userName, userAddress ? { address: userAddress } : undefined)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userName, userAddress]);

  // Fetch duel slug map for resolving vote stake links (public, no privacy concern)
  const [slugMap, setSlugMap] = useState<Record<number, { slug: string; title: string; status?: string }>>({});
  useEffect(() => {
    getDuelSlugMap().then(setSlugMap).catch(() => {});
  }, []);

  // Background on-chain sync (non-blocking — optimistic value shows immediately)
  useEffect(() => {
    (async () => {
      try {
        const { refreshPointsOnChain } = await import('@/lib/wallet/backgroundWalletService');
        await refreshPointsOnChain();
        setOnChainPoints(useAppStore.getState().whisperPoints);
      } catch (err: any) {
        console.warn('[Points] On-chain points fetch failed:', err?.message);
      }
    })();
  }, []);

  // Background PXE vote stake sync (non-blocking — cached stakes show immediately)
  useEffect(() => {
    (async () => {
      try {
        const { getAztecClient } = await import('@/lib/aztec/client');
        const client = getAztecClient();
        if (!client?.hasWallet()) return;

        const duelCloakAddress = (import.meta as any).env?.VITE_DUELCLOAK_ADDRESS;
        if (!duelCloakAddress) return;

        const { getDuelCloakArtifact } = await import('@/lib/aztec/contracts');
        const { DuelCloakService } = await import('@/lib/templates/DuelCloakService');
        const { AztecAddress } = await import('@aztec/aztec.js/addresses');

        const wallet = client.getWallet();
        const senderAddress = client.getAddress() ?? undefined;
        const paymentMethod = client.getPaymentMethod();
        const artifact = await getDuelCloakArtifact();
        const addr = AztecAddress.fromString(duelCloakAddress);

        const node = client.getNode();
        if (node) {
          try {
            const instance = await node.getContract(addr);
            if (instance) await wallet.registerContract(instance, artifact);
          } catch { /* already registered */ }
        }

        const svc = new DuelCloakService(wallet, senderAddress, paymentMethod);
        await svc.connect(addr, artifact);
        const notes = await svc.getMyVoteStakeNotes();

        // Annotate all notes with finalized status + outcome
        const annotatedNotes: VoteStake[] = [];
        for (const n of notes) {
          let isFinalized = false;
          let outcome: number | null = null;
          try {
            isFinalized = await svc.isDuelFinalized(n.duelId);
            if (isFinalized) {
              outcome = await svc.getDuelOutcome(n.duelId);
            }
          } catch { /* can't check — treat as active */ }
          annotatedNotes.push({
            duelId: n.duelId,
            dbDuelId: n.dbDuelId,
            direction: n.direction,
            stakeAmount: n.stakeAmount,
            isFinalized,
            outcome,
          });
        }

        // Merge with cached stakes (for titles + slugs from this session)
        const cached = getCachedVoteStakes();
        const mergedStakes = annotatedNotes.map((n) => {
          const c = cached.find((s) => s.duelId === n.duelId);
          return { ...n, slug: c?.slug, title: c?.title };
        });
        // Include cached stakes not found in PXE (optimistic, pre-mine)
        for (const c of cached) {
          if (!mergedStakes.some((m) => m.duelId === c.duelId)) {
            mergedStakes.push(c);
          }
        }
        setVoteStakes(mergedStakes);
        cacheVoteStakes(mergedStakes);
      } catch (err: any) {
        console.warn('[Points] Vote stakes fetch failed:', err?.message);
      }
    })();
  }, []);

  // Resolved vote outcomes (wins/losses/refunds) from local notifications
  const allNotifs = getLocalNotifications();
  const marketNotifs = allNotifs.filter(
    (n) => n.type === 'market_win' || n.type === 'market_loss',
  );

  // Split vote stakes into active (still running) vs finalized (ended, won/lost/pending)
  // Fallback: if on-chain finalization hasn't happened yet, check DB status from slug map
  const isEnded = (s: VoteStake) => {
    if (s.isFinalized) return true;
    if (s.dbDuelId) {
      const entry = slugMap[s.dbDuelId];
      if (entry?.status === 'ended') return true;
    }
    return false;
  };
  const activeVoteStakes = voteStakes.filter((s) => !isEnded(s));
  const finalizedVoteStakes = voteStakes.filter((s) => isEnded(s));

  // Use optimistic points from store (updated reactively by addOptimisticPoints/syncOptimisticPoints)
  const availablePoints = whisperPoints;
  const voteStakedTotal = activeVoteStakes.reduce((sum, s) => sum + s.stakeAmount, 0);
  const creatorStakedPoints = profile?.staking?.totalStaked ?? 0;
  const stakedPoints = creatorStakedPoints + voteStakedTotal;
  const hasAnyPoints = availablePoints > 0 || stakedPoints > 0
    || (profile?.staking?.totalRewarded ?? 0) > 0
    || (profile?.staking?.totalBurned ?? 0) > 0;

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="max-w-3xl mx-auto space-y-4"
      >
        <div className="bg-card border border-border rounded-md p-6 animate-pulse">
          <div className="h-6 bg-background-tertiary rounded w-1/3 mb-2" />
          <div className="h-4 bg-background-tertiary rounded w-1/4" />
        </div>
      </motion.div>
    );
  }

  const hasActivity = hasAnyPoints
    || voteStakes.length > 0
    || marketNotifs.length > 0
    || (profile?.staking?.activeStakesList?.length ?? 0) > 0
    || (profile?.staking?.resolvedStakesList?.length ?? 0) > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Points summary — always shown */}
      <div className="bg-card border border-border rounded-md p-6">
        <h1 className="text-lg font-bold text-foreground mb-4">Whisper Points</h1>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-hover rounded-xl p-5 text-center">
            <div className="text-3xl font-bold text-accent tabular-nums">
              <AnimatedNumber value={availablePoints} loading={pointsLoading} />
            </div>
            <div className="text-xs text-foreground-muted mt-1.5 uppercase tracking-wide">Available</div>
          </div>
          <div className="bg-surface-hover rounded-xl p-5 text-center">
            <div className="text-3xl font-bold text-amber-400 tabular-nums">
              <AnimatedNumber value={stakedPoints} />
            </div>
            <div className="text-xs text-foreground-muted mt-1.5 uppercase tracking-wide">At Risk</div>
          </div>
        </div>

        {/* Staking history stats */}
        {profile?.staking && (profile.staking.totalRewarded > 0 || profile.staking.totalBurned > 0) && (
          <div className="flex items-center justify-center gap-4 text-xs text-foreground-muted mt-4">
            {profile.staking.totalRewarded > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {profile.staking.totalRewarded} earned
              </span>
            )}
            {profile.staking.totalBurned > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {profile.staking.totalBurned} burned
              </span>
            )}
          </div>
        )}
      </div>

      {/* How it works — shown when no activity yet (skip while points still loading) */}
      {!hasActivity && !pointsLoading && <HowItWorksCard />}

      {/* Your Votes — active (non-finalized) stakes only */}
      {(activeVoteStakes.length > 0 || marketNotifs.length > 0) && (
        <div className="bg-card border border-border rounded-md p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground">Active Votes</h2>
          {activeVoteStakes.map((vs) => (
            <VoteStakeRow key={`stake-${vs.duelId}-${vs.direction}`} stake={vs} slugMap={slugMap} />
          ))}
          {marketNotifs.map((n) => (
            <MarketOutcomeRow key={n.id} notification={n} />
          ))}
        </div>
      )}

      {/* Active creator stakes */}
      {profile?.staking && profile.staking.activeStakesList.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground">Active Staked Duels</h2>
          {profile.staking.activeStakesList.map((stake) => (
            <StakeRow key={stake.duelId} stake={stake} />
          ))}
        </div>
      )}

      {/* Results — finalized vote stakes + resolved creator stakes */}
      {(finalizedVoteStakes.length > 0 || (profile?.staking && profile.staking.resolvedStakesList.length > 0)) && (
        <div className="bg-card border border-border rounded-md p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground">Vote Results</h2>
          {finalizedVoteStakes.map((vs) => (
            <VoteStakeRow key={`stake-${vs.duelId}-${vs.direction}`} stake={vs} slugMap={slugMap} />
          ))}
          {profile?.staking?.resolvedStakesList.map((stake) => (
            <ResolvedStakeRow key={stake.duelId} stake={stake} />
          ))}
        </div>
      )}

      {/* Market outcomes are now merged into "Your Votes" above */}
    </div>
  );
}

function StakeRow({ stake }: { stake: ActiveStake }) {
  const { timeLeft } = useCountdown(stake.endBlock);
  const reward = projectedReward(stake.totalVotes, stake.amount, stake.multiplier);
  const willBurn = stake.totalVotes < MIN_VOTES_THRESHOLD;
  const votesNeeded = Math.max(0, MIN_VOTES_THRESHOLD - stake.totalVotes);

  return (
    <Link
      to={`/d/${stake.slug}`}
      className="block rounded-lg border border-border bg-surface p-3 hover:border-border-hover transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-foreground leading-snug line-clamp-2">{stake.title}</span>
        <span className="text-sm font-bold text-amber-400 tabular-nums shrink-0">{stake.amount}</span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2 text-xs text-foreground-muted tabular-nums">
          <span>{stake.totalVotes} vote{stake.totalVotes !== 1 ? 's' : ''}</span>
          {timeLeft && (
            <>
              <span className="text-foreground-muted/40">·</span>
              <span>{timeLeft}</span>
            </>
          )}
        </div>
        {willBurn ? (
          <span className="text-xs text-red-400 tabular-nums">
            -{stake.amount} pts ({votesNeeded} more to save)
          </span>
        ) : (
          <span className="text-xs text-green-400 tabular-nums">
            +{reward} pts projected
          </span>
        )}
      </div>
    </Link>
  );
}

const HOW_IT_WORKS_STEPS = [
  {
    title: 'Vote with conviction',
    description: 'Every vote costs points based on the odds. Voting with the minority is cheap, majority is expensive.',
  },
  {
    title: 'Winners earn 100 pts',
    description: 'When the duel ends, the majority side wins. Winners automatically receive 100 points.',
  },
  {
    title: 'Rewards are automatic',
    description: 'No claiming needed. Your balance updates automatically when duels you voted on end.',
  },
];

function HowItWorksCard() {
  return (
    <div className="bg-card border border-border rounded-md p-5 space-y-5">
      <div>
        <h2 className="text-sm font-medium text-foreground">How it works</h2>
      </div>

      <div className="space-y-4">
        {HOW_IT_WORKS_STEPS.map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.1, duration: 0.25 }}
            className="flex gap-3.5"
          >
            <div className="shrink-0 w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-base font-bold text-accent">
              {i + 1}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
              <p className="text-xs text-foreground-muted mt-0.5 leading-relaxed">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <Link
        to="/"
        className="block w-full py-3 text-sm font-semibold bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors shadow-sm shadow-accent/20 text-center"
      >
        Vote on a duel to get started
      </Link>
    </div>
  );
}

function VoteStakeRow({ stake, slugMap }: { stake: VoteStake; slugMap: Record<number, { slug: string; title: string }> }) {
  // Resolve full slug and title from the public duel map (covers truncated on-chain slugs)
  const mapEntry = stake.dbDuelId ? lookupDuelFromMap(slugMap, stake.dbDuelId) : null;
  const displayTitle = stake.title || mapEntry?.title || (stake.slug ? stake.slug.replace(/-/g, ' ') : `Duel #${stake.duelId}`);
  const linkSlug = mapEntry?.slug || stake.slug;

  const isWon = stake.isFinalized && stake.outcome != null && stake.direction === stake.outcome;
  const isLost = stake.isFinalized && stake.outcome != null && stake.direction !== stake.outcome;
  const isPending = stake.isFinalized && stake.outcome == null;

  let statusColor = 'text-amber-400';
  let dotColor = 'bg-amber-500';
  let statusLabel = 'At risk';
  let pointsColor = 'text-amber-400';
  let pointsLabel = `${stake.stakeAmount} pts`;
  let detail = 'Win 100 pts if your side wins';

  if (isWon) {
    statusColor = 'text-green-400';
    dotColor = 'bg-green-500';
    statusLabel = 'Won';
    pointsColor = 'text-green-400';
    pointsLabel = '+100 pts';
    detail = `Staked ${stake.stakeAmount} pts`;
  } else if (isLost) {
    statusColor = 'text-red-400';
    dotColor = 'bg-red-500';
    statusLabel = 'Lost';
    pointsColor = 'text-red-400';
    pointsLabel = `-${stake.stakeAmount} pts`;
    detail = 'Stake burned';
  } else if (isPending) {
    statusColor = 'text-foreground-muted';
    dotColor = 'bg-foreground-muted';
    statusLabel = 'Ended';
    detail = 'Resolving...';
  }

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-foreground leading-snug line-clamp-2">
          {displayTitle}
        </span>
        <span className={`text-sm font-bold tabular-nums shrink-0 ${pointsColor}`}>
          {pointsLabel}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-xs text-foreground-muted tabular-nums">
        <span className={`flex items-center gap-1 ${statusColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          {statusLabel}
        </span>
        <span className="text-foreground-muted/40">·</span>
        <span>{detail}</span>
      </div>
    </>
  );

  if (linkSlug) {
    return (
      <Link to={`/d/${linkSlug}`} className="block rounded-lg border border-border bg-surface p-3 hover:border-border-hover transition-colors">
        {inner}
      </Link>
    );
  }
  return <div className="rounded-lg border border-border bg-surface p-3">{inner}</div>;
}

function MarketOutcomeRow({ notification: n }: { notification: LocalNotification }) {
  const isWin = n.type === 'market_win';
  const pointsDelta = isWin ? `+${n.rewardAmount}` : `-${n.stakeAmount}`;
  const colorClass = isWin ? 'text-green-400' : 'text-red-400';
  const dotClass = isWin ? 'bg-green-500' : 'bg-red-500';
  const label = isWin ? 'Won' : 'Lost';

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-foreground leading-snug line-clamp-2">
          {n.title || (n.slug ? n.slug.replace(/-/g, ' ') : `Duel #${n.duelId}`)}
        </span>
        <span className={`text-sm font-bold tabular-nums shrink-0 ${colorClass}`}>
          {pointsDelta}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-xs text-foreground-muted tabular-nums">
        <span className={`flex items-center gap-1 ${colorClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          {label}
        </span>
        <span className="text-foreground-muted/40">·</span>
        <span>Staked {n.stakeAmount} pts</span>
        <span className="text-foreground-muted/40">·</span>
        <span>{timeAgo(n.createdAt)}</span>
      </div>
    </>
  );

  if (n.slug) {
    return (
      <Link to={`/d/${n.slug}`} className="block rounded-lg border border-border bg-surface p-3 hover:border-border-hover transition-colors">
        {inner}
      </Link>
    );
  }
  return <div className="rounded-lg border border-border bg-surface p-3">{inner}</div>;
}

function ResolvedStakeRow({ stake }: { stake: ResolvedStake }) {
  const rewarded = stake.status === 'rewarded';
  return (
    <Link
      to={`/d/${stake.slug}`}
      className="block rounded-lg border border-border bg-surface p-3 hover:border-border-hover transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-foreground leading-snug line-clamp-2">{stake.title}</span>
        <span className={`text-sm font-bold tabular-nums shrink-0 ${rewarded ? 'text-green-400' : 'text-red-400'}`}>
          {rewarded ? `+${stake.reward}` : `-${stake.amount}`}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-xs text-foreground-muted tabular-nums">
        <span className={`flex items-center gap-1 ${rewarded ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${rewarded ? 'bg-green-500' : 'bg-red-500'}`} />
          {rewarded ? 'Earned' : 'Burned'}
        </span>
        <span className="text-foreground-muted/40">·</span>
        <span>{stake.totalVotes} vote{stake.totalVotes !== 1 ? 's' : ''}</span>
        <span className="text-foreground-muted/40">·</span>
        <span>{timeAgo(stake.resolvedAt)}</span>
      </div>
    </Link>
  );
}
