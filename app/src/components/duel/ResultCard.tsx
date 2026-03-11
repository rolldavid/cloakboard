import { Link } from 'react-router-dom';
import type { RecentlyEndedDuel } from '@/lib/api/duelClient';
import { motion } from 'framer-motion';

function formatPeriod(createdAt: string, endsAt: string): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  const start = new Date(createdAt);
  const end = new Date(endsAt);

  // If same day, compress: "Mar 10, 2:00 PM – 8:00 PM"
  const sameDay = start.toLocaleDateString() === end.toLocaleDateString();

  if (sameDay) {
    const timeFmt = (d: Date) =>
      d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeFmt(start)} – ${timeFmt(end)}`;
  }

  return `${fmt(start)} – ${fmt(end)}`;
}

export function ResultCard({ duel }: { duel: RecentlyEndedDuel }) {
  const total = duel.totalVotes || 0;
  const agreePct = total > 0 ? Math.round((duel.agreeCount / total) * 100) : 50;
  const disagreePct = 100 - agreePct;

  const agreeLabel = 'Agree';
  const disagreeLabel = 'Disagree';

  return (
    <div className="bg-surface border border-border rounded-lg p-4 hover:border-border-hover transition-colors flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-accent font-medium flex items-center gap-1.5">
          {duel.isBreaking && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-600 text-white rounded">
              Breaking
            </span>
          )}
          {duel.categoryName || 'General'}
        </span>
        <span className="text-[10px] uppercase tracking-wider font-medium text-foreground-muted">
          {duel.duelType === 'binary' ? 'Binary' : duel.duelType === 'multi' ? 'Multi' : 'Level'}
        </span>
      </div>

      {/* Title */}
      <Link to={`/d/${duel.slug}`} className="block mb-2">
        <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2 hover:text-accent transition-colors">
          {duel.title}
        </h3>
      </Link>

      {/* Voting period */}
      <p className="text-[11px] text-foreground-muted mb-3">
        {formatPeriod(duel.createdAt, duel.endsAt)}
      </p>

      {/* Result bars */}
      <div className="space-y-1.5 mb-3 flex-1">
        {duel.duelType === 'binary' ? (
          <>
            <ResultBar
              label={agreeLabel}
              pct={agreePct}
              isWinner={duel.agreeCount > duel.disagreeCount}
              isTie={duel.winner === 'Tie'}
              color="green"
            />
            <ResultBar
              label={disagreeLabel}
              pct={disagreePct}
              isWinner={duel.disagreeCount > duel.agreeCount}
              isTie={duel.winner === 'Tie'}
              color="red"
            />
          </>
        ) : duel.winner ? (
          <div className="flex items-center gap-2 py-1">
            <span className="text-xs font-semibold text-accent">
              {duel.winner}{duel.winnerPct != null ? ` ${duel.winnerPct}%` : ''}
            </span>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-foreground-muted">
        <span>{total} votes</span>
      </div>

      {/* Winner badge */}
      {duel.winner && (
        <div className={`mt-3 pt-3 border-t border-border text-center text-xs font-medium ${
          duel.winner === 'Tie' ? 'text-foreground-muted' : 'text-accent'
        }`}>
          {duel.winner === 'Tie' ? 'Tied' : `Winner: ${duel.winner} ${duel.winnerPct ?? ''}%`}
        </div>
      )}
    </div>
  );
}

function ResultBar({ label, pct, isWinner, isTie, color }: {
  label: string;
  pct: number;
  isWinner: boolean;
  isTie: boolean;
  color: 'green' | 'red';
}) {
  const barColor = color === 'green'
    ? (isWinner ? 'bg-vote-agree' : 'bg-vote-agree/40')
    : (isWinner ? 'bg-vote-disagree' : 'bg-vote-disagree/40');

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-5 bg-surface-hover rounded-full overflow-hidden relative">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={false}
          animate={{ width: `${Math.max(pct, 2)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
        <span className={`absolute inset-0 flex items-center px-2 text-[11px] font-medium ${
          isWinner || isTie ? 'text-foreground' : 'text-foreground-muted'
        }`}>
          {pct}% {label}
          {isWinner && !isTie && ' ✓'}
        </span>
      </div>
    </div>
  );
}
