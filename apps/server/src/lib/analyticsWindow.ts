/**
 * Pure helpers behind GET /api/analytics.
 *
 * They live here rather than in the route for two reasons: the route handler
 * has to stay readable, and every honesty property this endpoint now claims
 * (one row per day, no silent gaps, a window with hard edges) is a property of
 * these functions, so they are the things worth unit-testing directly.
 *
 * Everything here is UTC. `date(created_at)` and `strftime('%w', …)` in SQLite
 * bucket by UTC, so any JS-side day arithmetic that used local time would
 * disagree with the SQL by up to a day near midnight — the exact class of
 * off-by-one that makes a chart lie quietly.
 */

/** A UTC calendar day, `YYYY-MM-DD` — the shape `date(created_at)` returns. */
export type IsoDate = string;

/**
 * The window every windowed number in the response was computed over.
 *
 * `start`/`end` are inclusive calendar days; `startedAt`/`endsBefore` are the
 * same interval as half-open instants (`>= startedAt`, `< endsBefore`), for a
 * caller that wants to reproduce the range without re-deriving midnight.
 * Charts should be labelled from `start`/`end`.
 */
export interface AnalyticsWindow {
  days: number;
  start: IsoDate;
  end: IsoDate;
  startedAt: string;
  endsBefore: string;
  generatedAt: string;
  timezone: 'UTC';
}

/** One point on the growth series. Always present for every day in the window. */
export interface DailyGrowthPoint {
  date: IsoDate;
  /** Memories created on this day and still active — a rate, not a running total. */
  count: number;
  /**
   * Memories still active NOW that were created on or before this day.
   *
   * Deliberately not called "the size of the store that day". Every scope in
   * this endpoint filters `archived_at is null` as evaluated at request time,
   * so a memory created three days ago and archived this morning is absent
   * from both this running total and from its own day's `count`. A store that
   * forgets a lot therefore draws a curve that is flatter in the past than the
   * store really was — true of the number, false of the label, which is
   * exactly the confusion this endpoint exists to stop making.
   */
  cumulative: number;
}

export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 365;
export const DEFAULT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Start of the UTC day containing `ms`.
 *
 * Floor division is exact here: JS time is a count of milliseconds with no
 * leap seconds, so every UTC midnight is an exact multiple of 86_400_000.
 */
function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function toIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Clamp a caller-supplied `days` to the documented bounds.
 *
 * The route schema already rejects anything outside 1–365, so this is the
 * second line of defence rather than the first: it guarantees that no code
 * path — a future internal caller, a schema someone loosens — can turn an
 * absurd value into an unbounded scan or a million-element array.
 */
export function clampDays(days: number | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_WINDOW_DAYS;
  const whole = Math.floor(days);
  if (whole < MIN_WINDOW_DAYS) return MIN_WINDOW_DAYS;
  if (whole > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return whole;
}

/**
 * The last `days` UTC calendar days, ending with the day `now` falls in.
 *
 * Deliberately day-aligned rather than a rolling `now - days * 24h`: a rolling
 * bound puts a partial day at each end, so a "30 day" window produced 31
 * buckets, the first of them short. Aligning means the series is exactly
 * `days` long and every bucket covers a full day except the current one.
 */
export function buildWindow(days: number, now: Date = new Date()): AnalyticsWindow {
  const span = clampDays(days);
  const endDay = startOfUtcDay(now.getTime());
  const startDay = endDay - (span - 1) * DAY_MS;

  return {
    days: span,
    start: toIsoDate(startDay),
    end: toIsoDate(endDay),
    startedAt: new Date(startDay).toISOString(),
    endsBefore: new Date(endDay + DAY_MS).toISOString(),
    generatedAt: now.toISOString(),
    timezone: 'UTC',
  };
}

/** Every calendar day in the window, ascending. Length is always `win.days`. */
export function enumerateDays(win: AnalyticsWindow): IsoDate[] {
  const startMs = Date.parse(win.startedAt);
  return Array.from({ length: win.days }, (_, i) => toIsoDate(startMs + i * DAY_MS));
}

/**
 * Turn sparse `GROUP BY date(created_at)` rows into one point per day.
 *
 * The gap is the whole point. Grouped rows only exist for days that had at
 * least one memory, and a client plotting those on a category axis draws a
 * two-day gap the same width as a one-day step — then splines straight
 * through it, inventing a value for a day that had none. Days with no rows are
 * zeros, and a caller should never have to work out which ones we dropped.
 *
 * `baseline` seeds `cumulative`: the number of still-active memories created
 * before the window opened, so the running total does not restart at zero
 * every time the window moves. See `DailyGrowthPoint.cumulative` for what that
 * total does and does not claim about the past.
 */
export function fillDailyGrowth(
  rows: readonly { date: string | null; count: number }[],
  win: AnalyticsWindow,
  baseline: number
): DailyGrowthPoint[] {
  const counts = new Map<IsoDate, number>();
  for (const row of rows) {
    if (!row.date) continue;
    counts.set(row.date, (counts.get(row.date) ?? 0) + Number(row.count ?? 0));
  }

  let running = baseline;
  return enumerateDays(win).map((date) => {
    const count = counts.get(date) ?? 0;
    running += count;
    return { date, count, cumulative: running };
  });
}

/**
 * How many times each weekday occurs in the window, indexed the way SQLite's
 * `strftime('%w', …)` numbers them (0 = Sunday).
 *
 * A 30-day window contains five Mondays and four Tuesdays. Without this, an
 * hour-by-weekday heatmap makes the extra weekday look ~25% busier than it is,
 * and nothing in the payload says otherwise. Clients that want a rate rather
 * than a raw count divide by this.
 *
 * One caveat the divisor cannot express: the last day of the window is today,
 * and today is partial. Its weekday is counted as a whole day, so at 06:00 UTC
 * that weekday's rate is understated by roughly the three quarters of the day
 * that have not happened yet, and its not-yet-reached hours read as zero
 * rather than as absent. `window.generatedAt` is the hour to cut at.
 */
export function weekdayCoverage(win: AnalyticsWindow): number[] {
  const coverage = [0, 0, 0, 0, 0, 0, 0];
  for (const date of enumerateDays(win)) {
    const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    coverage[dow] = (coverage[dow] ?? 0) + 1;
  }
  return coverage;
}

/**
 * Fold `GROUP BY <column>` rows into a `{ key: count }` object.
 *
 * Written as an addition rather than `Object.fromEntries` on purpose: NULL and
 * the literal string `'unknown'` are two separate groups in SQL but the same
 * key here, and `fromEntries` silently keeps only the last of them — so the
 * object's values would not sum to the total that sits beside it.
 *
 * The accumulator is a Map this function owns and never hands out, so summing
 * into it is not the mutation the style rules are about. Spreading a fresh
 * object per row would be: `bySource` is deliberately unlimited over a
 * writer-controlled column, and copying the accumulator N times makes an
 * unbounded input quadratic.
 */
export function foldCounts(
  rows: readonly { key: string | null; count: number }[],
  fallbackKey = 'unknown'
): Record<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.key ?? fallbackKey;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.count ?? 0));
  }
  return Object.fromEntries(totals);
}
