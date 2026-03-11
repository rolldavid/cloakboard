import { Link } from 'react-router-dom';
import type { Duel } from '@/lib/api/duelClient';
import { VoteChart } from '@/components/duel/VoteChart';
import { MultiOptionChart } from '@/components/duel/MultiOptionChart';
import { useCountdown } from '@/hooks/useCountdown';
import { applyOptimisticVoteToDuel } from '@/lib/voteTracker';
import { motion } from 'framer-motion';

interface FeaturedDuelProps {
  duel: Duel;
}

export function FeaturedDuel({ duel: rawDuel }: FeaturedDuelProps) {
  const duel = applyOptimisticVoteToDuel(rawDuel);
  const { timeLeft, secondsLeft, isClosing, hasEnded } = useCountdown(duel.endBlock);
  const isEndingSoon = secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 3600;
  const activePeriod = duel.periods?.find((p) => {
    const now = Date.now();
    return new Date(p.periodStart).getTime() <= now && new Date(p.periodEnd).getTime() > now;
  });

  const total = duel.totalVotes || 0;
  const agreePct = total > 0 ? Math.round((duel.agreeCount / total) * 100) : 50;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-surface border rounded-lg p-5 mb-4 ${
        isClosing ? 'border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.15)]' :
        isEndingSoon ? 'border-amber-500/40' :
        'border-border'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-accent font-medium">
            {duel.subcategoryName || duel.categoryName || 'General'}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
            Featured
          </span>
        </div>
        {timeLeft && (
          <span className={`text-[11px] flex items-center gap-1 rounded-full px-2 py-0.5 ${
            hasEnded ? 'text-foreground-muted bg-foreground-muted/10' :
            isClosing ? 'text-red-400 bg-red-500/10 font-medium animate-pulse' :
            isEndingSoon ? 'text-amber-400 bg-amber-500/10 font-medium' :
            'text-foreground-secondary bg-surface-hover'
          }`}>
            {!hasEnded && (
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
              </svg>
            )}
            {hasEnded ? 'Ended' : isClosing || isEndingSoon ? `${timeLeft} left` : timeLeft}
          </span>
        )}
      </div>

      {/* Breaking headline context (above title) */}
      {duel.isBreaking && duel.breakingHeadline && (
        <div className="bg-surface-hover/50 border border-border rounded-lg px-3 py-2 mb-3 flex items-center gap-2.5">
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-600 text-white rounded">
            Breaking
          </span>
          <p className="text-sm text-foreground-secondary italic leading-snug flex-1 line-clamp-2">
            {duel.breakingHeadline}
          </p>
          {duel.breakingSourceUrl && (
            <a
              href={duel.breakingSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-accent hover:text-accent-hover transition-colors whitespace-nowrap flex-shrink-0"
            >
              {new URL(duel.breakingSourceUrl).hostname.replace(/^www\./, '')} &rarr;
            </a>
          )}
        </div>
      )}

      {/* Title (statement) */}
      <Link to={`/d/${duel.slug}`} className="block mb-1">
        <h2 className="text-lg font-semibold text-foreground leading-snug hover:text-accent transition-colors">
          {duel.title}
        </h2>
      </Link>

      {/* Description (non-breaking only) */}
      {!duel.isBreaking && duel.description && (
        <p className="text-sm text-foreground-muted line-clamp-2 mb-3">{duel.description}</p>
      )}

      {/* Chart */}
      <div className="mb-3">
        {duel.duelType === 'binary' ? (
          <VoteChart
            duelId={duel.id}
            createdAt={activePeriod?.periodStart || duel.createdAt}
            endsAt={activePeriod?.periodEnd || duel.endsAt}
            agreeVotes={duel.agreeCount}
            disagreeVotes={duel.disagreeCount}
            totalVotes={total}
            isEnded={hasEnded}
            periodId={activePeriod?.id}
            isBreaking={duel.isBreaking}
          />
        ) : duel.duelType === 'multi' && duel.options ? (
          <MultiOptionChart
            duelId={duel.id}
            createdAt={duel.createdAt}
            endsAt={duel.endsAt}
            options={duel.options}
            totalVotes={total}
            isEnded={hasEnded}
            chartMode={duel.chartMode || 'top_n'}
            chartTopN={duel.chartTopN || 5}
            periodId={activePeriod?.id}
          />
        ) : duel.duelType === 'level' && duel.levels && duel.levels.length > 0 ? (
          <div className="flex items-center gap-3 py-3">
            {duel.levels.slice(0, 5).map((lvl) => {
              const lvlPct = total > 0 ? Math.round((lvl.voteCount / total) * 100) : 0;
              return (
                <div key={lvl.level} className="flex-1 text-center">
                  <div className="text-sm font-medium text-foreground">{lvlPct}%</div>
                  <div className="text-xs text-foreground-muted mt-0.5">
                    {lvl.label || `Level ${lvl.level}`}
                  </div>
                  <div className="mt-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                    <div
                      className="h-full bg-vote-option/60 rounded-full"
                      style={{ width: `${Math.max(lvlPct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-foreground-muted">
          <span>{total} vote{total !== 1 ? 's' : ''}</span>
          {duel.commentCount > 0 && <span>{duel.commentCount} comment{duel.commentCount !== 1 ? 's' : ''}</span>}
          {duel.duelType === 'binary' && total > 0 && (
            <span className="text-foreground-secondary">{agreePct}% agree</span>
          )}
        </div>
        <Link
          to={`/d/${duel.slug}`}
          className="text-xs text-accent hover:text-accent/80 font-medium transition-colors"
        >
          View details &rarr;
        </Link>
      </div>
    </motion.div>
  );
}
