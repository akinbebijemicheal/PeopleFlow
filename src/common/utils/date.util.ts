const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Dates throughout this module are date-only (no time/timezone component):
 * input strings are "YYYY-MM-DD", which ECMA-262 parses as UTC midnight, and
 * Postgres stores them as DATE. All comparisons below stay in UTC so the
 * result doesn't drift with the server's local timezone.
 */
export function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function daysBetweenInclusive(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}
