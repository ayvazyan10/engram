import { create } from 'zustand';

export interface DailyGrowth {
  date: string;
  count: number;
}

export interface HourlyActivity {
  hour: number;
  dayOfWeek: number;
  count: number;
}

export interface TopConcept {
  concept: string;
  count: number;
  avgImportance: number;
}

export interface AnalyticsData {
  total: number;
  avgImportance: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  dailyGrowth: DailyGrowth[];
  hourlyActivity: HourlyActivity[];
  topConcepts: TopConcept[];
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
