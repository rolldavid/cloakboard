/** EST offset: midnight EST = 05:00 UTC. */
const EST_OFFSET_H = 5;

/** Get year/month/day in EST from a UTC Date. */
function estComponents(date: Date): { y: number; m: number; d: number } {
  const estMs = date.getTime() - EST_OFFSET_H * 3_600_000;
  const shifted = new Date(estMs);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

/** Compute the EST calendar boundary for the end of the current period. */
export function computeCalendarPeriodEnd(recurrence: string, periodStart: Date): Date {
  const { y, m, d } = estComponents(periodStart);
  // All boundaries are midnight EST = 05:00 UTC on the target date
  switch (recurrence) {
    case 'daily':   return new Date(Date.UTC(y, m, d + 1, EST_OFFSET_H));
    case 'monthly': return new Date(Date.UTC(y, m + 1, 1, EST_OFFSET_H));
    case 'yearly':  return new Date(Date.UTC(y + 1, 0, 1, EST_OFFSET_H));
    default:        return new Date(Date.UTC(y, m, d + 1, EST_OFFSET_H));
  }
}

/** Compute the NEXT full calendar period boundaries (after the given periodEnd). */
export function computeNextPeriod(recurrence: string, periodEnd: Date): { start: Date; end: Date } {
  const start = periodEnd; // next period starts where previous ended
  return { start, end: computeCalendarPeriodEnd(recurrence, start) };
}

/** Generate a URL-friendly slug for a period (using EST date). */
export function generatePeriodSlug(recurrence: string, periodStart: Date): string {
  const { y, m, d } = estComponents(periodStart);
  const ms = String(m + 1).padStart(2, '0');
  const ds = String(d).padStart(2, '0');
  switch (recurrence) {
    case 'daily':   return `${y}-${ms}-${ds}`;
    case 'monthly': return `${y}-${ms}`;
    case 'yearly':  return `${y}`;
    default:        return `${y}-${ms}-${ds}`;
  }
}
