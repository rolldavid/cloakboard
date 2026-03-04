import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { fetchDuelChart } from '@/lib/api/duelClient';
import type { ChartSnapshot, DuelOption } from '@/lib/api/duelClient';

type ChartRange = '1h' | '6h' | '12h' | '24h' | 'week' | 'month' | 'all';

interface MultiOptionChartProps {
  duelId: number;
  createdAt: string;
  endsAt?: string | null;
  options: DuelOption[];
  totalVotes: number;
  isEnded: boolean;
  chartMode: 'top_n' | 'threshold';
  chartTopN: number;
  refreshKey?: number;
  periodId?: number;
}

// Chart dimensions
const W = 600;
const H = 280;
const PAD_L = 42;
const PAD_R = 16;
const PAD_T = 20;
const PAD_B = 32;
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

// 10 distinct colors for option lines
const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
];

function getPollingInterval(range: ChartRange, createdAt: string): number {
  if (range === '1h') return 30_000;
  if (range === '6h') return 2 * 60_000;
  if (range === '12h' || range === '24h') return 5 * 60_000;
  const age = Date.now() - new Date(createdAt).getTime();
  if (age <= DAY) return 5 * 60_000;
  if (age <= WEEK) return 30 * 60_000;
  if (age <= MONTH) return 6 * HOUR;
  return 12 * HOUR;
}

/**
 * Monotone cubic Hermite spline — smooth curves that never overshoot data values.
 */
function monotoneSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  const n = points.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
  }

  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m[i - 1] + m[i]) / 2);
    }
  }
  tangents.push(m[n - 2]);

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

/** Compute which time range buttons to show based on duel lifespan. */
function getAvailableRanges(createdAt: string, endsAt?: string | null): { key: ChartRange; label: string }[] {
  const created = new Date(createdAt).getTime();
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const spanMs = end ? (end - created) : (Date.now() - created);

  if (spanMs <= HOUR) return [{ key: '1h', label: '1h' }, { key: 'all', label: 'All' }];
  if (spanMs <= 6 * HOUR) return [{ key: '1h', label: '1h' }, { key: '6h', label: '6h' }, { key: 'all', label: 'All' }];
  if (spanMs <= DAY) return [{ key: '1h', label: '1h' }, { key: '6h', label: '6h' }, { key: '24h', label: '24h' }, { key: 'all', label: 'All' }];
  if (spanMs <= WEEK) return [{ key: '1h', label: '1h' }, { key: '6h', label: '6h' }, { key: '24h', label: '24h' }, { key: 'week', label: 'Week' }, { key: 'all', label: 'All' }];
  return [{ key: '24h', label: '24h' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'all', label: 'All' }];
}

/** Smart default range based on duel age. */
function getDefaultRange(createdAt: string): ChartRange {
  const age = Date.now() - new Date(createdAt).getTime();
  if (age < HOUR) return '1h';
  if (age < 6 * HOUR) return '6h';
  return '24h';
}

/** Generate time-aligned x-axis label positions. */
function generateXLabels(
  range: ChartRange,
  tStart: number,
  tEnd: number,
): { x: number; label: string }[] {
  const span = tEnd - tStart;
  if (span <= 0) return [];

  let intervalMs: number;
  let formatFn: (d: Date) => string;

  if (range === 'all') {
    if (span < HOUR) {
      intervalMs = 15 * 60_000;
      formatFn = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (span < 6 * HOUR) {
      intervalMs = HOUR;
      formatFn = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (span < DAY) {
      intervalMs = 4 * HOUR;
      formatFn = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (span < WEEK) {
      intervalMs = DAY;
      formatFn = (d) => d.toLocaleDateString([], { weekday: 'short' });
    } else if (span < MONTH) {
      intervalMs = WEEK;
      formatFn = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else {
      intervalMs = MONTH;
      formatFn = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  } else {
    const config: Record<string, { interval: number; format: (d: Date) => string }> = {
      '1h': { interval: 15 * 60_000, format: (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      '6h': { interval: HOUR, format: (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      '12h': { interval: 2 * HOUR, format: (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      '24h': { interval: 4 * HOUR, format: (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      'week': { interval: DAY, format: (d) => d.toLocaleDateString([], { weekday: 'short' }) },
      'month': { interval: WEEK, format: (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) },
    };
    const c = config[range] || config['24h'];
    intervalMs = c.interval;
    formatFn = c.format;
  }

  const firstMarker = Math.ceil(tStart / intervalMs) * intervalMs;
  const labels: { x: number; label: string }[] = [];
  for (let t = firstMarker; t <= tEnd; t += intervalMs) {
    const x = PAD_L + ((t - tStart) / span) * CHART_W;
    if (x < PAD_L + 15 || x > PAD_L + CHART_W - 15) continue;
    labels.push({ x, label: formatFn(new Date(t)) });
  }
  return labels;
}

export function MultiOptionChart({
  duelId, createdAt, endsAt, options, totalVotes, isEnded, chartMode, chartTopN, refreshKey = 0, periodId,
}: MultiOptionChartProps) {
  const availableRanges = getAvailableRanges(createdAt, endsAt);
  const defaultRange = getDefaultRange(createdAt);
  const safeDefault = availableRanges.some((r) => r.key === defaultRange) ? defaultRange : availableRanges[availableRanges.length - 1].key;

  const [range, setRange] = useState<ChartRange>(safeDefault);
  const effectiveRange = availableRanges.some((r) => r.key === range) ? range : safeDefault;
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [mounted, setMounted] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        const data = await fetchDuelChart(duelId, effectiveRange, periodId);
        if (!stale) { setSnapshots(data); setChartLoaded(true); }
      } catch { if (!stale) setChartLoaded(true); }
    };
    load();
    const ms = isEnded ? 0 : getPollingInterval(effectiveRange, createdAt);
    if (ms > 0) {
      intervalRef.current = setInterval(load, ms);
    }
    return () => { stale = true; if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [duelId, effectiveRange, periodId, createdAt, isEnded, refreshKey]);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Determine which options to chart based on criteria
  const filteredOptions = (() => {
    const sorted = [...options].sort((a, b) => b.voteCount - a.voteCount);
    if (chartMode === 'threshold') {
      const threshold = totalVotes > 0 ? totalVotes * 0.01 : 0;
      return sorted.filter((o) => o.voteCount > threshold).slice(0, 10);
    }
    return sorted.slice(0, chartTopN);
  })();

  // Map option IDs to colors
  const optionColorMap = new Map<number, string>();
  filteredOptions.forEach((opt, i) => {
    optionColorMap.set(opt.id, COLORS[i % COLORS.length]);
  });

  // Build time series data
  const now = new Date().toISOString();
  const timePoints = snapshots.map((s) => s.snapshotAt);
  if (timePoints.length === 0) timePoints.push(createdAt);
  if (!isEnded) timePoints.push(now);

  const tStart = new Date(timePoints[0]).getTime();
  const tEnd = new Date(timePoints[timePoints.length - 1]).getTime();
  const tRange = Math.max(tEnd - tStart, 1);

  // Build per-option line data
  const optionLines = filteredOptions.map((opt) => {
    const points: { x: number; y: number; pct: number; time: string }[] = [];

    for (const snap of snapshots) {
      const snapTotal = snap.totalVotes || 0;
      const optCount = snap.optionCounts?.[String(opt.id)] ?? 0;
      const pct = snapTotal > 0 ? (optCount / snapTotal) * 100 : 0;
      const t = new Date(snap.snapshotAt).getTime();
      points.push({
        x: PAD_L + ((t - tStart) / tRange) * CHART_W,
        y: PAD_T + (1 - pct / 100) * CHART_H,
        pct,
        time: snap.snapshotAt,
      });
    }

    if (points.length === 0) {
      points.push({ x: PAD_L, y: PAD_T + CHART_H, pct: 0, time: createdAt });
    }

    if (!isEnded) {
      const livePct = totalVotes > 0 ? (opt.voteCount / totalVotes) * 100 : 0;
      const t = new Date(now).getTime();
      points.push({
        x: PAD_L + ((t - tStart) / tRange) * CHART_W,
        y: PAD_T + (1 - livePct / 100) * CHART_H,
        pct: livePct,
        time: now,
      });
    }

    return {
      optionId: opt.id,
      label: opt.label,
      color: optionColorMap.get(opt.id) || COLORS[0],
      points,
    };
  });

  const yLabels = [0, 25, 50, 75, 100];

  // X-axis: time-aligned markers
  const xLabels = generateXLabels(effectiveRange, tStart, tEnd);

  return (
    <div className="space-y-2">
      {/* Time filter bar */}
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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: mounted ? 1 : 0 }}
        transition={{ duration: 0.5 }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* Grid lines */}
          {yLabels.map((v) => {
            const y = PAD_T + (1 - v / 100) * CHART_H;
            return (
              <g key={v}>
                <line
                  x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                  stroke="currentColor"
                  className="text-background-tertiary"
                  strokeWidth={0.5}
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

          {/* Option lines */}
          {optionLines.map((line) => {
            const path = monotoneSmoothPath(line.points.map((p) => ({ x: p.x, y: p.y })));
            const last = line.points[line.points.length - 1];
            return (
              <g key={line.optionId}>
                {line.points.length > 1 && (
                  <path
                    d={path}
                    fill="none"
                    stroke={line.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {/* Live dot */}
                {!isEnded && last && (
                  <circle cx={last.x} cy={last.y} r="3" fill={line.color}>
                    <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Percentage label at end */}
                {last && (
                  <text
                    x={Math.min(last.x + 8, W - PAD_R - 24)}
                    y={last.y - 6}
                    className="text-[9px] font-bold"
                    fill={line.color}
                  >
                    {Math.round(last.pct)}%
                  </text>
                )}
              </g>
            );
          })}

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
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs text-foreground-muted">
          {optionLines.map((line) => (
            <span key={line.optionId} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: line.color }} />
              <span className="truncate max-w-[120px]">{line.label}</span>
            </span>
          ))}
          <span>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
        </div>
      </motion.div>
      )}
    </div>
  );
}
