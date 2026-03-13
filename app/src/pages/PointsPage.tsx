import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion';
import { fetchUserProfile } from '@/lib/api/duelClient';
import type { UserProfile, ActiveStake, ResolvedStake } from '@/lib/api/duelClient';
import { useAppStore } from '@/store/index';
import { useCountdown } from '@/hooks/useCountdown';

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

export function PointsPage() {
  const { userName, userAddress, whisperPoints } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // On-chain points (private PXE read)
  const [onChainPoints, setOnChainPoints] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  useEffect(() => {
    if (!userName) return;
    setLoading(true);
    fetchUserProfile(userName, userAddress ? { address: userAddress } : undefined)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userName, userAddress]);

  useEffect(() => {
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
        console.warn('[Points] On-chain points fetch failed:', err?.message);
      } finally {
        setPointsLoading(false);
      }
    })();
  }, []);

  const availablePoints = onChainPoints ?? whisperPoints;
  const stakedPoints = profile?.staking?.totalStaked ?? 0;
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
            <div className="text-xs text-foreground-muted mt-1.5 uppercase tracking-wide">Staked</div>
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

      {/* How it works — shown when no activity yet */}
      {!hasActivity && <HowItWorksCard />}

      {/* Active stakes */}
      {profile?.staking && profile.staking.activeStakesList.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground">Active Stakes</h2>
          {profile.staking.activeStakesList.map((stake) => (
            <StakeRow key={stake.duelId} stake={stake} />
          ))}
        </div>
      )}

      {/* Results */}
      {profile?.staking && profile.staking.resolvedStakesList.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground">Results</h2>
          {profile.staking.resolvedStakesList.map((stake) => (
            <ResolvedStakeRow key={stake.duelId} stake={stake} />
          ))}
        </div>
      )}
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
    title: 'Vote privately, earn points',
    description: 'Cast anonymous votes on duels and engage with the community. Every vote earns you whisper points.',
  },
  {
    title: 'Stake to create duels',
    description: 'Wager your points to launch duels for the community. Your stake backs the debate.',
  },
  {
    title: 'Earn rewards',
    description: 'The more people participate in your duel, the more points you earn back. Popular duels pay off big.',
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
