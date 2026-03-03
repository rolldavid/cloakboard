import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { fetchDuelChart } from '@/lib/api/duelClient';
import type { ChartSnapshot, DuelOption } from '@/lib/api/duelClient';

type ChartRange = '24h' | 'day' | 'week' | 'month' | 'all';

interface MultiOptionChartProps {
  duelId: number;
  createdAt: string;
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

function getPollingInterval(createdAt: string): number {
  const age = Date.now() - new Date(createdAt).getTime();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (age <= HOUR) return 30_000;
  if (age <= DAY) return 5 * 60_000;
  if (age <= 7 * DAY) return 30 * 60_000;
  if (age <= 30 * DAY) return 6 * HOUR;
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

function formatTime(dateStr: string, duelAge: number): string {
  const d = new Date(dateStr);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (duelAge <= HOUR) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (duelAge <= DAY) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (duelAge <= 7 * DAY) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function MultiOptionChart({
  duelId, createdAt, options, totalVotes, isEnded, chartMode, chartTopN, refreshKey = 0, periodId,
}: MultiOptionChartProps) {
  const duelAgeMs = Date.now() - new Date(createdAt).getTime();
  const defaultRange: ChartRange = duelAgeMs < 24 * 3600 * 1000 ? 'all' : '24h';

  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [mounted, setMounted] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTimeline = useCallback(async () => {
    try {
      const data = await fetchDuelChart(duelId, range, periodId);
      setSnapshots(data);
      setChartLoaded(true);
    } catch { setChartLoaded(true); /* show current data even on error */ }
  }, [duelId, range, periodId]);

  useEffect(() => {
    setChartLoaded(false);
    loadTimeline();
    const ms = isEnded ? 0 : getPollingInterval(createdAt);
    if (ms > 0) {
      intervalRef.current = setInterval(loadTimeline, ms);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadTimeline, createdAt, isEnded, refreshKey]);

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
    // top_n
    return sorted.slice(0, chartTopN);
  })();

  // Map option IDs to colors
  const optionColorMap = new Map<number, string>();
  filteredOptions.forEach((opt, i) => {
    optionColorMap.set(opt.id, COLORS[i % COLORS.length]);
  });

  // Build time series data: for each snapshot, compute per-option percentage
  const now = new Date().toISOString();
  const timePoints = snapshots.map((s) => s.snapshotAt);
  if (timePoints.length === 0) timePoints.push(createdAt);
  if (!isEnded) timePoints.push(now);

  const tStart = new Date(timePoints[0]).getTime();
  const tEnd = new Date(timePoints[timePoints.length - 1]).getTime();
  const tRange = Math.max(tEnd - tStart, 1);
  const duelAge = Date.now() - new Date(createdAt).getTime();

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

    // Add start point if no snapshots
    if (points.length === 0) {
      points.push({
        x: PAD_L,
        y: PAD_T + CHART_H, // 0%
        pct: 0,
        time: createdAt,
      });
    }

    // Add live point
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

  // Y-axis labels
  const yLabels = [0, 25, 50, 75, 100];

  // X-axis labels
  const allTimes = timePoints;
  const xLabelCount = Math.min(5, allTimes.length);
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (allTimes.length - 1));
    if (idx < allTimes.length) {
      const t = new Date(allTimes[idx]).getTime();
      const x = PAD_L + ((t - tStart) / tRange) * CHART_W;
      xLabels.push({ x, label: formatTime(allTimes[idx], duelAge) });
    }
  }

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
