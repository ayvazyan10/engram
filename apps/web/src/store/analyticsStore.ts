import { create } from 'zustand';

/**
 * The analytics contract, as the server now states it.
 *
 * The old payload was flat — `total`, `byType`, `bySource`, `dailyGrowth` — with
 * no statement of what any of it covered, and the scopes silently disagreed:
 * `byType` and `bySource` summed to 87 while the `total` beside them said 651,
 * because two of the six figures were windowed and four were not. The response
 * now separates `windowed` from `allTime` and carries an explicit, machine-
 * readable `window`, so a surface can say which one it is showing instead of
 * leaving the reader to guess.
 */

/** The slice every `windowed` figure covers. Inclusive calendar days, UTC. */
export interface AnalyticsWindow {
  days: number;
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day, `YYYY-MM-DD` — today, and therefore partial. */
  end: string;
  startedAt: string;
  /** Exclusive upper bound. */
  endsBefore: string;
  generatedAt: string;
  timezone: string;
}

/**
 * One day of the growth series. The series is contiguous and zero-filled to
 * exactly `window.days` entries now, so a gap is a real zero rather than an
 * absent row a line chart would draw straight through.
 */
export interface DailyGrowth {
  date: string;
  /** Memories created that day — a rate, and what the area chart plots. */
  count: number;
  /** `baseline` plus the running sum — the stored total at end of that day. */
  cumulative: number;
}

export interface HourlyActivity {
  hour: number;
  /** 0 = Sunday. */
  dayOfWeek: number;
  count: number;
}

export interface TopConcept {
  concept: string;
  count: number;
  avgImportance: number;
}

export interface WindowedAnalytics {
  total: number;
  /** Null when the window holds no memories — "no data", never zero. */
  avgImportance: number | null;
  byType: Record<string, number>;
  /** Complete and never truncated; sums to `total`. A null source is 'unknown'. */
  bySource: Record<string, number>;
  sourceCount: number;
  /** The real statistic. `topConcepts.length` is a page size, not a count. */
  conceptCount: number;
  topConcepts: TopConcept[];
  topConceptsLimit: number;
  /** Stored memories at the instant the window opened. */
  baseline: number;
  dailyGrowth: DailyGrowth[];
  /** Sparse over the fixed 7x24 grid — an absent cell is unambiguously zero. */
  hourlyActivity: HourlyActivity[];
  /** How many times each weekday fell inside the window, indexed by dayOfWeek.
   *  Without it, raw per-weekday counts are not comparable to each other. */
  weekdayCoverage: number[];
}

export interface AllTimeAnalytics {
  total: number;
  avgImportance: number | null;
  conceptCount: number;
  sourceCount: number;
}

export interface AnalyticsData {
  window: AnalyticsWindow;
  excludesArchived: boolean;
  windowed: WindowedAnalytics;
  allTime: AllTimeAnalytics;
}

/**
 * Never trust the response shape (coding-style: validate at system boundaries).
 * A payload missing its scopes must reach the error branch, not render a page
 * of `undefined` — the previous shape had no such guard and the view read
 * `data.byType` straight out of whatever came back.
 */
export function isAnalyticsData(value: unknown): value is AnalyticsData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AnalyticsData>;
  return (
    typeof v.window?.days === 'number' &&
    typeof v.window?.start === 'string' &&
    typeof v.window?.end === 'string' &&
    typeof v.windowed?.total === 'number' &&
    Array.isArray(v.windowed?.dailyGrowth) &&
    Array.isArray(v.windowed?.hourlyActivity) &&
    typeof v.allTime?.total === 'number'
  );
}

interface AnalyticsState {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  days: number;
  setData: (data: AnalyticsData) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /**
   * W15: deliberate future API — AnalyticsView already reads `days` and
   * passes it straight to `api.getAnalytics(days)`, so a date-range control
   * is a UI-only addition away, not a re-plumbing. No control calls this
   * yet, so `days` is fixed at its 30-day default.
   */
  setDays: (days: number) => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  data: null,
  loading: false,
  error: null,
  days: 30,
  setData: (data) => set({ data, error: null }),
  setLoading: (loading) => set({ loading }),
  // Was `set({ error, loading: false })` — coupling `loading` to every call
  // meant AnalyticsView's fetch effect (setLoading(true) immediately
  // followed by setError(null), to clear a stale error before a new fetch
  // starts) silently clobbered its own loading:true one line later. Turning
  // loading off belongs solely to the fetch's own .finally(), which already
  // runs on both the success and failure paths.
  setError: (error) => set({ error }),
  setDays: (days) => set({ days }),
}));
