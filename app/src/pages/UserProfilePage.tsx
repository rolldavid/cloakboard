import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion';
import { fetchUserProfile } from '@/lib/api/duelClient';
import type { UserProfile, ActiveStake } from '@/lib/api/duelClient';
import { useAppStore } from '@/store/index';
import { useCountdown } from '@/hooks/useCountdown';

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

const MIN_VOTES_THRESHOLD = 10;
const BOOTSTRAP_AVG = 5;

function projectedReward(totalVotes: number, stakeAmount: number, _multiplier: number): number {
  if (totalVotes < MIN_VOTES_THRESHOLD) return 0;
  const ratio = totalVotes / Math.max(BOOTSTRAP_AVG, 1);
  const minStake = 10;
  let baseReward: number;
  if (ratio <= 1) {
    baseReward = 200 * ratio;
  } else {
    baseReward = 200 + 800 * (1 - Math.exp(-0.15 * (ratio - 1)));
  }
  const stakeBonus = 0.1 * Math.log(Math.max(stakeAmount, minStake) / minStake);
  return Math.min(1000, Math.floor(baseReward * (1 + stakeBonus)));
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

export function UserProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { userName: currentUserName, userAddress, whisperPoints } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isOwnProfile = username === currentUserName;

  // On-chain points (private PXE read)
  const [onChainPoints, setOnChainPoints] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    fetchUserProfile(username, isOwnProfile && userAddress ? { address: userAddress } : undefined)
      .then(setProfile)
      .catch((err) => setError(err?.message || 'User not found'))
      .finally(() => setLoading(false));
  }, [username, isOwnProfile, userAddress]);

  // Fetch true on-chain points privately for own profile
  useEffect(() => {
    if (!isOwnProfile) return;
    setPointsLoading(true);
    (async () => {
      try {
        const { refreshPointsOnChain } = await import('@/lib/wallet/backgroundWalletService');
        await refreshPointsOnChain();
        const { getAztecClient } = await import('@/lib/aztec/client');
        const client = getAztecClient();
        if (client?.hasWallet()) {
          const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
          if (profileAddress) {
            const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
            const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
            const { AztecAddress } = await import('@aztec/aztec.js/addresses');
            const wallet = client.getWallet();
            const senderAddress = client.getAddress() ?? undefined;
            const paymentMethod = client.getPaymentMethod();
            const artifact = await getUserProfileArtifact();
            const addr = AztecAddress.fromString(profileAddress);
            const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
            await svc.connect(addr, artifact);
            setOnChainPoints(await svc.getMyPoints());
          }
        }
      } catch (err: any) {
        console.warn('[Profile] On-chain points fetch failed:', err?.message);
      } finally {
        setPointsLoading(false);
      }
    })();
  }, [isOwnProfile]);

  const availablePoints = onChainPoints ?? whisperPoints;
  const stakedPoints = profile?.staking?.totalStaked ?? 0;
  const totalPoints = availablePoints + stakedPoints;

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="space-y-4"
      >
        <div className="bg-card border border-border rounded-md p-6 animate-pulse">
          <div className="h-6 bg-background-tertiary rounded w-1/3 mb-2" />
          <div className="h-4 bg-background-tertiary rounded w-1/4" />
        </div>
      </motion.div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-md p-8 text-center">
          <p className="text-foreground-muted">{error || 'User not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Profile header */}
      <div className="bg-card border border-border rounded-md p-6">
        <h1 className="text-xl font-bold text-foreground">{profile.username}</h1>
        {isOwnProfile ? (
          <div className="mt-5 space-y-3">
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
                <div className="text-xs text-foreground-muted mt-1.5 uppercase tracking-wide">Staked</div>
              </div>
            </div>
            {/* Active stakes list */}
            {profile.staking && profile.staking.activeStakesList.length > 0 && (
              <div className="space-y-2">
                {profile.staking.activeStakesList.map((stake) => (
                  <StakeRow key={stake.duelId} stake={stake} />
                ))}
              </div>
            )}
            {/* Staking history stats */}
            {profile.staking && (profile.staking.totalRewarded > 0 || profile.staking.totalBurned > 0) && (
              <div className="flex items-center justify-center gap-4 text-xs text-foreground-muted">
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
        ) : (
          <p className="text-sm text-foreground-muted mt-1">Whisper points are private</p>
        )}
      </div>

      {/* Recent Comments */}
      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Recent Comments</h2>
        </div>
        {profile.comments.length === 0 ? (
          <div className="px-4 py-8 text-center space-y-3">
            <p className="text-sm text-foreground-muted">
              Vote on duels and join the conversation to earn your first whisper points.
            </p>
            <Link
              to="/"
              className="inline-block text-sm font-medium text-accent hover:underline"
            >
              Browse duels &rarr;
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {profile.comments.map((comment) => (
              <Link
                key={comment.id}
                to={`/d/${comment.duelSlug}#comment-${comment.id}`}
                className="block px-4 py-3 hover:bg-background-secondary transition-colors"
              >
                <p className="text-sm text-foreground">{comment.body}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                  <span>in</span>
                  <span className="text-accent">
                    {comment.subcategoryName || 'General'}
                  </span>
                  <span>·</span>
                  <span>{timeAgo(comment.createdAt)}</span>
                  <span>·</span>
                  <span className={comment.score >= 0 ? 'text-status-success' : 'text-status-error'}>
                    {comment.score > 0 ? '+' : ''}{comment.score}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
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

