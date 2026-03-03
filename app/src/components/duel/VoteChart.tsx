import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { fetchDuelChart } from '@/lib/api/duelClient';
import type { ChartSnapshot } from '@/lib/api/duelClient';

type ChartRange = '24h' | 'day' | 'week' | 'month' | 'all';

interface VoteChartProps {
  duelId: number;
  createdAt: string;
  agreeVotes: number;
  disagreeVotes: number;
  totalVotes: number;
  isEnded: boolean;
  refreshKey?: number;
  periodId?: number;
  cloakAddress?: string; // kept for backward compat, unused
  isTallied?: boolean; // alias for isEnded
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

function getPollingInterval(createdAt: string): number {
  const age = Date.now() - new Date(createdAt).getTime();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (age <= HOUR) return 30_000;        // 30s for fresh duels
  if (age <= DAY) return 5 * 60_000;    // 5 min
  if (age <= 7 * DAY) return 30 * 60_000;  // 30 min
  if (age <= 30 * DAY) return 6 * HOUR;
  return 12 * HOUR;
}

/**
 * Monotone cubic Hermite spline — smooth curves that never overshoot data values.
 * Control points are clamped between adjacent Y values so the line can't show
 * false dips or phantom peaks beyond what the actual data contains.
 */
function monotoneSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  const n = points.length;

  // Compute slopes with Fritsch-Carlson monotone adjustment
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
  }

  // Tangents
  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      // Local extremum — zero tangent to prevent overshoot
      tangents.push(0);
    } else {
      tangents.push((m[i - 1] + m[i]) / 2);
    }
  }
  tangents.push(m[n - 2]);

  // Fritsch-Carlson: clamp tangents to stay monotone within each segment
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / m[i];
      const beta = tangents[i + 1] / m[i];
      const mag = alpha * alpha + beta * beta;
      if (mag > 9) {
        const s = 3 / Math.sqrt(mag);
        tangents[i] = s * alpha * m[i];
        tangents[i + 1] = s * beta * m[i];
      }
    }
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i] / 3;
    const cp1x = points[i].x + seg;
    const cp1y = points[i].y + tangents[i] * seg;
    const cp2x = points[i + 1].x - seg;
    const cp2y = points[i + 1].y - tangents[i + 1] * seg;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${points[i + 1].x.toFixed(1)} ${points[i + 1].y.toFixed(1)}`;
  }

  return d;
}

function formatTime(dateStr: string, duelAge: number): string {
  const d = new Date(dateStr);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (duelAge <= HOUR) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (duelAge <= DAY) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (duelAge <= 7 * DAY) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function VoteChart({
  duelId, createdAt,
  agreeVotes, disagreeVotes, totalVotes, isEnded, isTallied,
  refreshKey = 0, periodId,
}: VoteChartProps) {
  const ended = isEnded || isTallied || false;

  // Default range: duels < 24h → 'all', >= 24h → '24h'
  const duelAgeMs = Date.now() - new Date(createdAt).getTime();
  const defaultRange: ChartRange = duelAgeMs < 24 * 3600 * 1000 ? 'all' : '24h';

  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [mounted, setMounted] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const livePct = totalVotes > 0 ? (agreeVotes / totalVotes) * 100 : 50;

  const loadTimeline = useCallback(async () => {
    try {
      const data = await fetchDuelChart(duelId, range, periodId);
      setSnapshots(data);
      setChartLoaded(true);
    } catch { setChartLoaded(true); }
  }, [duelId, range, periodId]);

  useEffect(() => {
    setChartLoaded(false);
    loadTimeline();
    const ms = ended ? 0 : getPollingInterval(createdAt);
    if (ms > 0) {
      intervalRef.current = setInterval(loadTimeline, ms);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadTimeline, createdAt, ended, refreshKey]);

  // Map snapshots to the old TimelinePoint format for rendering
  const points = snapshots.map((s) => ({
    agreePct: s.totalVotes > 0 ? (s.agreeCount / s.totalVotes) * 100 : 50,
    agreeVotes: s.agreeCount,
    disagreeVotes: s.disagreeCount,
    totalVotes: s.totalVotes,
    snapshotAt: s.snapshotAt,
  }));

  // Animate on mount
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Build data series: timeline points + live point
  const now = new Date().toISOString();
  const series: { pct: number; time: string }[] = points.map((p) => ({
    pct: p.agreePct,
    time: p.snapshotAt,
  }));

  // If no snapshots yet, start with 50% at creation time
  if (series.length === 0) {
    series.push({ pct: 50, time: createdAt });
  }

  // Add live current point
  if (!ended) {
    series.push({ pct: livePct, time: now });
  }

  // Time range
  const tStart = new Date(series[0].time).getTime();
  const tEnd = new Date(series[series.length - 1].time).getTime();
  const tRange = Math.max(tEnd - tStart, 1);
  const duelAge = Date.now() - new Date(createdAt).getTime();

  // Map data to SVG coords
  const coords = series.map((s) => ({
    x: PAD_L + ((new Date(s.time).getTime() - tStart) / tRange) * CHART_W,
    y: PAD_T + (1 - s.pct / 100) * CHART_H,
    pct: s.pct,
    time: s.time,
  }));

  // Build smooth path using monotone cubic Hermite (no false dips/peaks)
  const linePath = monotoneSmoothPath(coords.map((c) => ({ x: c.x, y: c.y })));

  // Agree/disagree fill area (clipped by 50% line)
  const midY = PAD_T + CHART_H / 2;
  const agreeAreaPath = coords.length > 1
    ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${midY} L ${coords[0].x.toFixed(1)} ${midY} Z`
    : '';
  const disagreeAreaPath = agreeAreaPath; // Same path, clipped differently

  // Last point for blinking dot
  const last = coords[coords.length - 1];

  // Y-axis labels
  const yLabels = [0, 25, 50, 75, 100];

  // X-axis: ~4-5 labels evenly spaced
  const xLabelCount = Math.min(5, series.length);
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i / (xLabelCount - 1)) * (series.length - 1));
    if (idx < series.length) {
      const s = series[idx];
      const x = PAD_L + ((new Date(s.time).getTime() - tStart) / tRange) * CHART_W;
      xLabels.push({ x, label: formatTime(s.time, duelAge) });
    }
  }

  // Outcome
  const outcome = ended
    ? (agreeVotes > disagreeVotes ? 'Agree' : agreeVotes < disagreeVotes ? 'Disagree' : 'Tie')
    : null;

  const ranges: { key: ChartRange; label: string }[] = [
    { key: '24h', label: '24h' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-2">
      {/* Time filter bar */}
      <div className="flex gap-1">
        {ranges.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              range === r.key
                ? 'bg-accent text-white'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

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

          {/* Live blinking dot */}
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
            <span className="w-2 h-2 rounded-full bg-status-success" /> Agree
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-error" /> Disagree
          </span>
          <span>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
        </div>
      </motion.div>

      {/* Outcome box (when duel ended) */}
      {outcome && (
        <div className={`flex-shrink-0 w-28 rounded-lg border-2 p-3 text-center ${
          outcome === 'Agree'
            ? 'border-status-success/40 bg-status-success/5'
            : outcome === 'Disagree'
              ? 'border-status-error/40 bg-status-error/5'
              : 'border-foreground-muted/40 bg-foreground-muted/5'
        }`}>
          <p className="text-[10px] uppercase tracking-wider text-foreground-muted font-medium mb-1">
            Outcome
          </p>
          <p className={`text-lg font-bold ${
            outcome === 'Agree' ? 'text-status-success' : outcome === 'Disagree' ? 'text-status-error' : 'text-foreground-muted'
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
