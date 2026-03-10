import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { fetchDuelChart } from '@/lib/api/duelClient';
import type { ChartSnapshot } from '@/lib/api/duelClient';
import {
  type ChartRange, RANGE_MS, serverRange,
  getAvailableRanges, getDefaultRange, getPollingInterval,
  generateXLabels, monotoneSmoothPath, clampSeriesToWindow,
} from './chartUtils';

interface VoteChartProps {
  duelId: number;
  createdAt: string;
  endsAt?: string | null;
  agreeVotes: number;
  disagreeVotes: number;
  totalVotes: number;
  isEnded: boolean;
  refreshKey?: number;
  periodId?: number;
  cloakAddress?: string;
  isTallied?: boolean;
  isBreaking?: boolean;
}

// Chart dimensions
const W = 600;
const H = 240;
const PAD_L = 42;
const PAD_R = 16;
const PAD_T = 20;
const PAD_B = 32;
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;

export function VoteChart({
  duelId, createdAt, endsAt,
  agreeVotes, disagreeVotes, totalVotes, isEnded, isTallied,
  refreshKey = 0, periodId, isBreaking,
}: VoteChartProps) {
  const ended = isEnded || isTallied || false;

  const availableRanges = getAvailableRanges(createdAt, endsAt);
  const defaultRange = getDefaultRange(createdAt);
  const safeDefault = availableRanges.some((r) => r.key === defaultRange) ? defaultRange : availableRanges[availableRanges.length - 1].key;

  const [range, setRange] = useState<ChartRange>(safeDefault);
  const effectiveRange = availableRanges.some((r) => r.key === range) ? range : safeDefault;
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [mounted, setMounted] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const livePct = totalVotes > 0 ? (agreeVotes / totalVotes) * 100 : 50;

  // Clear stale data only when the underlying data source changes (period or duel switch)
  useEffect(() => {
    setSnapshots([]);
    setChartLoaded(false);
  }, [duelId, periodId]);

  // Fetch + poll
  useEffect(() => {
    let stale = false;
    const load = async () => {
      try {
        const data = await fetchDuelChart(duelId, serverRange(effectiveRange), periodId);
        if (!stale) { setSnapshots(data); setChartLoaded(true); }
      } catch { if (!stale) setChartLoaded(true); }
    };
    load();
    const ms = ended ? 0 : getPollingInterval(effectiveRange, createdAt);
    if (ms > 0) {
      intervalRef.current = setInterval(load, ms);
    }
    return () => { stale = true; if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [duelId, effectiveRange, periodId, createdAt, ended, refreshKey]);

  // Map snapshots to rendered points
  const points = snapshots.map((s) => ({
    agreePct: s.totalVotes > 0 ? (s.agreeCount / s.totalVotes) * 100 : 50,
    agreeVotes: s.agreeCount,
    disagreeVotes: s.disagreeCount,
    totalVotes: s.totalVotes,
    snapshotAt: s.snapshotAt,
  }));

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Build data series: timeline points + live point
  const now = new Date().toISOString();
  let series: { pct: number; time: string }[] = points.map((p) => ({
    pct: p.agreePct,
    time: p.snapshotAt,
  }));

  if (series.length === 0) {
    series.push({ pct: 50, time: createdAt });
  } else if (effectiveRange === 'all') {
    const firstTime = new Date(series[0].time).getTime();
    const createTime = new Date(createdAt).getTime();
    if (firstTime - createTime > 10_000) {
      series.unshift({ pct: 50, time: createdAt });
    }
  }

  if (!ended) {
    series.push({ pct: livePct, time: now });
  }

  // Time range — fixed window with interpolated boundary for non-"all" ranges
  const rawEnd = new Date(series[series.length - 1].time).getTime();
  const rangeMs = effectiveRange !== 'all' ? RANGE_MS[effectiveRange] : undefined;
  let tStart: number;
  let tEnd: number;

  if (rangeMs) {
    tEnd = rawEnd;
    tStart = tEnd - rangeMs;
    series = clampSeriesToWindow(series, tStart, tEnd);
  } else {
    tStart = new Date(series[0].time).getTime();
    tEnd = rawEnd;
  }
  const tRange = Math.max(tEnd - tStart, 1);

  // Map data to SVG coords
  const coords = series.map((s) => ({
    x: PAD_L + ((new Date(s.time).getTime() - tStart) / tRange) * CHART_W,
    y: PAD_T + (1 - s.pct / 100) * CHART_H,
    pct: s.pct,
    time: s.time,
  }));

  const linePath = monotoneSmoothPath(coords.map((c) => ({ x: c.x, y: c.y })));

  const midY = PAD_T + CHART_H / 2;
  const agreeAreaPath = coords.length > 1
    ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${midY} L ${coords[0].x.toFixed(1)} ${midY} Z`
    : '';
  const disagreeAreaPath = agreeAreaPath;

  const last = coords[coords.length - 1];
  const yLabels = [0, 25, 50, 75, 100];

  // X-axis: time-aligned markers
  const xLabels = generateXLabels(tStart, tEnd, PAD_L, CHART_W);

  const agreeLabel = 'Agree';
  const disagreeLabel = 'Disagree';
  const outcome = ended
    ? (agreeVotes > disagreeVotes ? agreeLabel : agreeVotes < disagreeVotes ? disagreeLabel : 'Tie')
    : null;

  return (
    <div className="space-y-2">
      {/* Time filter bar — only show if more than one range available */}
      {availableRanges.length > 1 && (
      <div className="flex gap-1">
        {availableRanges.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              effectiveRange === r.key
                ? 'bg-accent text-white'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      )}

      {!chartLoaded ? (
        <div className="w-full" style={{ aspectRatio: `${W}/${H}` }}>
          <div className="w-full h-full bg-surface-hover rounded animate-pulse" />
        </div>
      ) : (
      <div className="flex gap-3 items-start">
      <motion.div
        className="flex-1 min-w-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: mounted ? 1 : 0 }}
        transition={{ duration: 0.5 }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
        >
          <defs>
            <clipPath id={`clip-above-${duelId}`}>
              <rect x={PAD_L} y={PAD_T} width={CHART_W} height={CHART_H / 2} />
            </clipPath>
            <clipPath id={`clip-below-${duelId}`}>
              <rect x={PAD_L} y={midY} width={CHART_W} height={CHART_H / 2} />
            </clipPath>
          </defs>

          {/* Grid lines */}
          {yLabels.map((v) => {
            const y = PAD_T + (1 - v / 100) * CHART_H;
            return (
              <g key={v}>
                <line
                  x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                  stroke="currentColor"
                  className={v === 50 ? 'text-foreground-muted' : 'text-background-tertiary'}
                  strokeWidth={v === 50 ? 1.5 : 0.5}
                  strokeDasharray={v === 50 ? '6 3' : undefined}
                />
                <text
                  x={PAD_L - 6} y={y + 4}
                  textAnchor="end"
                  className="fill-foreground-muted text-[10px]"
                >
                  {v}%
                </text>
              </g>
            );
          })}

          {/* Agree fill (green above 50%) */}
          {agreeAreaPath && (
            <path
              d={agreeAreaPath}
              clipPath={`url(#clip-above-${duelId})`}
              className="fill-status-success/10"
            />
          )}

          {/* Disagree fill (red below 50%) */}
          {disagreeAreaPath && (
            <path
              d={disagreeAreaPath}
              clipPath={`url(#clip-below-${duelId})`}
              className="fill-status-error/10"
            />
          )}

          {/* Line */}
          {coords.length > 1 && (
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              className={last.pct >= 50 ? 'text-status-success' : 'text-status-error'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Live blinking dot — outside clip so pulse ring is never cut */}
          {!ended && last && (
            <g>
              <circle
                cx={last.x} cy={last.y} r="4"
                className={last.pct >= 50 ? 'fill-status-success' : 'fill-status-error'}
              >
                <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx={last.x} cy={last.y} r="8" fill="none"
                className={last.pct >= 50 ? 'text-status-success' : 'text-status-error'}
                stroke="currentColor" strokeWidth="1" opacity="0.3"
              >
                <animate attributeName="r" values="4;12;4" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* Current value label next to dot */}
          {last && (
            <text
              x={Math.min(last.x + 10, W - PAD_R - 30)}
              y={last.y - 8}
              className={`text-[11px] font-bold ${last.pct >= 50 ? 'fill-status-success' : 'fill-status-error'}`}
            >
              {Math.round(last.pct)}%
            </text>
          )}

          {/* X-axis labels */}
          {xLabels.map((xl, i) => (
            <text
              key={i}
              x={xl.x}
              y={H - 6}
              textAnchor="middle"
              className="fill-foreground-muted text-[9px]"
            >
              {xl.label}
            </text>
          ))}

          {/* Axis border */}
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="currentColor" className="text-border" strokeWidth="1" />
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-1 text-xs text-foreground-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-success" /> {agreeLabel}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-error" /> {disagreeLabel}
          </span>
          <span>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
        </div>
      </motion.div>

      {/* Outcome box (when duel ended) */}
      {outcome && (
        <div className={`flex-shrink-0 w-28 rounded-lg border-2 p-3 text-center ${
          outcome === agreeLabel
            ? 'border-status-success/40 bg-status-success/5'
            : outcome === disagreeLabel
              ? 'border-status-error/40 bg-status-error/5'
              : 'border-foreground-muted/40 bg-foreground-muted/5'
        }`}>
          <p className="text-[10px] uppercase tracking-wider text-foreground-muted font-medium mb-1">
            Outcome
          </p>
          <p className={`text-lg font-bold ${
            outcome === agreeLabel ? 'text-status-success' : outcome === disagreeLabel ? 'text-status-error' : 'text-foreground-muted'
          }`}>
            {outcome}
          </p>
          <div className="mt-2 space-y-0.5 text-[10px] text-foreground-muted">
            <p><span className="text-status-success font-medium">{agreeVotes}</span> agree</p>
            <p><span className="text-status-error font-medium">{disagreeVotes}</span> disagree</p>
          </div>
        </div>
      )}
    </div>
      )}
    </div>
  );
}
