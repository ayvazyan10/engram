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
  setDays: (days: number) => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  data: null,
  loading: false,
  error: null,
  days: 30,
  setData: (data) => set({ data, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setDays: (days) => set({ days }),
}));
