/**
 * Shared chart utilities for VoteChart and MultiOptionChart.
 * Time constants, range logic, x-axis labels, spline, and time-window clamping.
 */

// ─── Time Constants ──────────────────────────────────────────────

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;
export const YEAR = 365 * DAY;

// ─── Chart Range ─────────────────────────────────────────────────

export type ChartRange = '1h' | '6h' | '24h' | '1w' | '1m' | '1y' | 'all';

export const RANGE_MS: Record<Exclude<ChartRange, 'all'>, number> = {
  '1h': HOUR,
  '6h': 6 * HOUR,
  '24h': DAY,
  '1w': WEEK,
  '1m': MONTH,
  '1y': YEAR,
};

export type ServerRange = '1h' | '6h' | '12h' | '24h' | 'day' | 'week' | 'month' | '1y' | 'all';

/** Map ChartRange to the server-side range param. */
export function serverRange(range: ChartRange): ServerRange {
  const map: Record<ChartRange, ServerRange> = {
    '1h': '1h',
    '6h': '6h',
    '24h': '24h',
    '1w': 'week',
    '1m': 'month',
    '1y': '1y',
    'all': 'all',
  };
  return map[range];
}

// ─── Range Selection ─────────────────────────────────────────────

export function getAvailableRanges(
  createdAt: string,
  endsAt?: string | null,
): { key: ChartRange; label: string }[] {
  const created = new Date(createdAt).getTime();
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const spanMs = end ? end - created : Date.now() - created;

  if (spanMs < HOUR) return [{ key: 'all', label: 'All' }];
  if (spanMs < 6 * HOUR) return [{ key: '1h', label: '1h' }, { key: 'all', label: 'All' }];
  if (spanMs < DAY) return [{ key: '1h', label: '1h' }, { key: '6h', label: '6h' }, { key: 'all', label: 'All' }];
  if (spanMs < WEEK) return [{ key: '6h', label: '6h' }, { key: '24h', label: '24h' }, { key: 'all', label: 'All' }];
  if (spanMs < MONTH) return [{ key: '6h', label: '6h' }, { key: '24h', label: '24h' }, { key: '1w', label: '1W' }, { key: 'all', label: 'All' }];
  if (spanMs < YEAR) return [{ key: '24h', label: '24h' }, { key: '1w', label: '1W' }, { key: '1m', label: '1M' }, { key: 'all', label: 'All' }];
  return [{ key: '24h', label: '24h' }, { key: '1w', label: '1W' }, { key: '1m', label: '1M' }, { key: '1y', label: '1Y' }, { key: 'all', label: 'All' }];
}

export function getDefaultRange(createdAt: string): ChartRange {
  const age = Date.now() - new Date(createdAt).getTime();
  if (age < DAY) return 'all';
  return '24h';
}

// ─── Polling Interval ────────────────────────────────────────────

export function getPollingInterval(range: ChartRange, createdAt: string): number {
  if (range === '1h') return 30_000;
  if (range === '6h') return 2 * 60_000;
  if (range === '24h') return 5 * 60_000;
  if (range === '1y') return 12 * HOUR;
  // For week/month/all, use age-based logic
  const age = Date.now() - new Date(createdAt).getTime();
  if (age <= DAY) return 5 * 60_000;
  if (age <= WEEK) return 30 * 60_000;
  if (age <= MONTH) return 6 * HOUR;
  return 12 * HOUR;
}

// ─── X-Axis Labels ───────────────────────────────────────────────

const NICE_INTERVALS = [
  60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 6 * HOUR, 8 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 3 * DAY, WEEK, 2 * WEEK, MONTH, 3 * MONTH, 6 * MONTH, YEAR,
];

function formatForInterval(intervalMs: number): (d: Date) => string {
  if (intervalMs < DAY) return (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (intervalMs < WEEK) return (d) => d.toLocaleDateString([], { weekday: 'short' });
  return (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function generateXLabels(
  tStart: number,
  tEnd: number,
  padL: number,
  chartW: number,
): { x: number; label: string }[] {
  const span = tEnd - tStart;
  if (span <= 0) return [];

  const TARGET = 5;
  const idealInterval = span / TARGET;
  let intervalMs = NICE_INTERVALS[NICE_INTERVALS.length - 1];
  for (const ni of NICE_INTERVALS) {
    if (ni >= idealInterval) {
      intervalMs = ni;
      break;
    }
  }

  const formatFn = formatForInterval(intervalMs);

  // Choose edge format based on span — show date+time for spans > 1 day, time for shorter
  const edgeFormat = span >= DAY
    ? (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Interior grid-aligned markers
  const firstMarker = Math.ceil(tStart / intervalMs) * intervalMs;
  const labels: { x: number; label: string }[] = [];

  // Always add start edge label
  labels.push({ x: padL + 4, label: edgeFormat(new Date(tStart)) });

  // Add grid-aligned interior markers (skip if too close to edges)
  const edgeMargin = chartW * 0.08; // 8% margin from edges to avoid overlap with edge labels
  for (let t = firstMarker; t <= tEnd; t += intervalMs) {
    const x = padL + ((t - tStart) / span) * chartW;
    if (x < padL + edgeMargin || x > padL + chartW - edgeMargin) continue;
    labels.push({ x, label: formatFn(new Date(t)) });
  }

  // Always add end edge label
  labels.push({ x: padL + chartW - 4, label: edgeFormat(new Date(tEnd)) });

  return labels;
}

// ─── Monotone Cubic Hermite Spline ───────────────────────────────

export function monotoneSmoothPath(points: { x: number; y: number }[]): string {
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

// ─── Time Window Clamping ────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a single-value series (VoteChart) to [tStart, tEnd].
 * If the anchor is before tStart, interpolates pct at the boundary.
 */
export function clampSeriesToWindow(
  series: { pct: number; time: string }[],
  tStart: number,
  tEnd: number,
): { pct: number; time: string }[] {
  if (series.length === 0) return series;

  const result: { pct: number; time: string }[] = [];
  let lastBefore: { pct: number; t: number } | null = null;

  for (const s of series) {
    const t = new Date(s.time).getTime();
    if (t < tStart) {
      lastBefore = { pct: s.pct, t };
    } else {
      // First point at or after tStart — interpolate boundary if needed
      if (result.length === 0 && lastBefore) {
        const span = t - lastBefore.t;
        const frac = span > 0 ? (tStart - lastBefore.t) / span : 0;
        const interpPct = lerp(lastBefore.pct, s.pct, frac);
        result.push({ pct: interpPct, time: new Date(tStart).toISOString() });
      }
      if (t <= tEnd) {
        result.push(s);
      }
    }
  }

  // If all points are before tStart, use the last known value at tStart
  if (result.length === 0 && lastBefore) {
    result.push({ pct: lastBefore.pct, time: new Date(tStart).toISOString() });
  }

  return result;
}

export interface MultiSnapshot {
  snapshotAt: string;
  agreeCount: number;
  disagreeCount: number;
  totalVotes: number;
  optionCounts: Record<string, number> | null;
}

/**
 * Clamp multi-option series to [tStart, tEnd].
 * Interpolates each option's value at the boundary independently.
 */
export function clampMultiSeriesToWindow(
  snapshots: MultiSnapshot[],
  tStart: number,
  tEnd: number,
): MultiSnapshot[] {
  if (snapshots.length === 0) return snapshots;

  const result: MultiSnapshot[] = [];
  let lastBefore: MultiSnapshot | null = null;
  let lastBeforeT = 0;

  for (const snap of snapshots) {
    const t = new Date(snap.snapshotAt).getTime();
    if (t < tStart) {
      lastBefore = snap;
      lastBeforeT = t;
    } else {
      if (result.length === 0 && lastBefore) {
        // Interpolate each option count at tStart
        const span = t - lastBeforeT;
        const frac = span > 0 ? (tStart - lastBeforeT) / span : 0;
        const interpTotal = Math.round(lerp(lastBefore.totalVotes, snap.totalVotes, frac));
        const interpAgree = Math.round(lerp(lastBefore.agreeCount, snap.agreeCount, frac));
        const interpDisagree = Math.round(lerp(lastBefore.disagreeCount, snap.disagreeCount, frac));
        const interpCounts: Record<string, number> = {};
        const allKeys = new Set([
          ...Object.keys(lastBefore.optionCounts || {}),
          ...Object.keys(snap.optionCounts || {}),
        ]);
        for (const k of allKeys) {
          const a = (lastBefore.optionCounts || {})[k] ?? 0;
          const b = (snap.optionCounts || {})[k] ?? 0;
          interpCounts[k] = Math.round(lerp(a, b, frac));
        }
        result.push({
          snapshotAt: new Date(tStart).toISOString(),
          agreeCount: interpAgree,
          disagreeCount: interpDisagree,
          totalVotes: interpTotal,
          optionCounts: interpCounts,
        });
      }
      if (t <= tEnd) {
        result.push(snap);
      }
    }
  }

  if (result.length === 0 && lastBefore) {
    result.push({
      ...lastBefore,
      snapshotAt: new Date(tStart).toISOString(),
    });
  }

  return result;
}
