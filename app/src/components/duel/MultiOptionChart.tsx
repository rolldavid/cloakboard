import { useEffect, useState, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import { fetchDuelChart } from '@/lib/api/duelClient';
import type { ChartSnapshot, DuelOption } from '@/lib/api/duelClient';
import {
  type ChartRange, RANGE_MS, serverRange,
  getAvailableRanges, getDefaultRange, getPollingInterval,
  generateXLabels, monotoneSmoothPath, clampMultiSeriesToWindow,
} from './chartUtils';

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

export const MultiOptionChart = memo(function MultiOptionChart({
  duelId, createdAt, endsAt, options, totalVotes, isEnded, chartMode, chartTopN, refreshKey = 0, periodId,
}: MultiOptionChartProps) {
  const availableRanges = isEnded ? [{ key: 'all' as ChartRange, label: 'All' }] : getAvailableRanges(createdAt, endsAt);
  const defaultRange = isEnded ? 'all' as ChartRange : getDefaultRange(createdAt);
  const safeDefault = availableRanges.some((r) => r.key === defaultRange) ? defaultRange : availableRanges[availableRanges.length - 1].key;

  const [range, setRange] = useState<ChartRange>(safeDefault);
  const effectiveRange = isEnded ? 'all' as ChartRange : (availableRanges.some((r) => r.key === range) ? range : safeDefault);
  const [snapshots, setSnapshots] = useState<ChartSnapshot[]>([]);
  const [mounted, setMounted] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear stale data only when the underlying data source changes (period or duel switch)
  useEffect(() => {
    setSnapshots([]);
    setChartLoaded(false);
  }, [duelId, periodId]);

  // Fetch + poll (pauses when tab is hidden)
  useEffect(() => {
    let stale = false;
    const load = async () => {
      if (document.hidden) return; // skip poll when tab not visible
      try {
        const data = await fetchDuelChart(duelId, serverRange(effectiveRange), periodId);
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

  // Build time series data with window clamping
  const now = new Date().toISOString();

  // Determine time window
  const lastTimeStr = !isEnded ? now : (snapshots.length > 0 ? snapshots[snapshots.length - 1].snapshotAt : createdAt);
  const rawEnd = new Date(lastTimeStr).getTime();
  const rangeMs = effectiveRange !== 'all' ? RANGE_MS[effectiveRange] : undefined;

  let tStart: number;
  let tEnd: number;

  // Clamp snapshots for non-"all" ranges
  let clampedSnapshots = snapshots;
  if (rangeMs) {
    tEnd = rawEnd;
    tStart = tEnd - rangeMs;
    clampedSnapshots = clampMultiSeriesToWindow(snapshots, tStart, tEnd);
  } else {
    // For 'all' range: use createdAt as start, and endsAt (if ended) as end
    tStart = new Date(createdAt).getTime();
    tEnd = isEnded && endsAt ? Math.max(new Date(endsAt).getTime(), rawEnd) : rawEnd;
  }
  const tRange = Math.max(tEnd - tStart, 1);

  // Build per-option line data
  const optionLines = filteredOptions.map((opt) => {
    const points: { x: number; y: number; pct: number; time: string }[] = [];

    for (const snap of clampedSnapshots) {
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
      // Live duel: extend line to current time with live percentage
      const livePct = totalVotes > 0 ? (opt.voteCount / totalVotes) * 100 : 0;
      const t = new Date(now).getTime();
      points.push({
        x: PAD_L + ((t - tStart) / tRange) * CHART_W,
        y: PAD_T + (1 - livePct / 100) * CHART_H,
        pct: livePct,
        time: now,
      });
    } else if (points.length > 0) {
      // Ended duel: extend line to the right edge with the last known percentage
      const lastPt = points[points.length - 1];
      const endX = PAD_L + CHART_W; // right edge
      if (lastPt.x < endX - 1) {
        points.push({
          x: endX,
          y: lastPt.y,
          pct: lastPt.pct,
          time: endsAt || now,
        });
      }
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
  const xLabels = generateXLabels(tStart, tEnd, PAD_L, CHART_W);

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
                {/* Live dot — outside clip so never cut */}
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
});
