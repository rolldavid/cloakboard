/** Compute the UTC calendar boundary for the end of the current period. */
export function computeCalendarPeriodEnd(recurrence: string, periodStart: Date): Date {
  const y = periodStart.getUTCFullYear();
  const m = periodStart.getUTCMonth();
  const d = periodStart.getUTCDate();
  switch (recurrence) {
    case 'daily':   return new Date(Date.UTC(y, m, d + 1));      // next midnight UTC
    case 'monthly': return new Date(Date.UTC(y, m + 1, 1));      // 1st of next month
    case 'yearly':  return new Date(Date.UTC(y + 1, 0, 1));      // Jan 1 next year
    default:        return new Date(Date.UTC(y, m, d + 1));       // fallback to daily
  }
}

/** Compute the NEXT full calendar period boundaries (after the given periodEnd). */
export function computeNextPeriod(recurrence: string, periodEnd: Date): { start: Date; end: Date } {
  const start = periodEnd; // next period starts where previous ended
  return { start, end: computeCalendarPeriodEnd(recurrence, start) };
}

/** Generate a URL-friendly slug for a period. */
export function generatePeriodSlug(recurrence: string, periodStart: Date): string {
  const y = periodStart.getUTCFullYear();
  const m = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
  const d = String(periodStart.getUTCDate()).padStart(2, '0');
  switch (recurrence) {
    case 'daily':   return `${y}-${m}-${d}`;
    case 'monthly': return `${y}-${m}`;
    case 'yearly':  return `${y}`;
    default:        return `${y}-${m}-${d}`;
  }
}
