import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalyticsStore, type AnalyticsData } from '../analyticsStore.js';

function makeData(overrides: Partial<AnalyticsData> = {}): AnalyticsData {
  return {
    total: 10,
    avgImportance: 0.5,
    byType: { semantic: 10 },
    bySource: {},
    dailyGrowth: [],
    hourlyActivity: [],
    topConcepts: [],
    ...overrides,
  };
}

describe('analyticsStore', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
  });

  it('setData replaces data and clears a stale error', () => {
    useAnalyticsStore.setState({ error: 'boom' });
    useAnalyticsStore.getState().setData(makeData());
    expect(useAnalyticsStore.getState().data?.total).toBe(10);
    expect(useAnalyticsStore.getState().error).toBeNull();
  });

  it('setLoading toggles the loading flag', () => {
    useAnalyticsStore.getState().setLoading(true);
    expect(useAnalyticsStore.getState().loading).toBe(true);
  });

  it('setError sets the error without touching loading — the fetch effect\'s own .finally() owns that', () => {
    useAnalyticsStore.setState({ loading: true });
    useAnalyticsStore.getState().setError('network down');
    expect(useAnalyticsStore.getState().error).toBe('network down');
    expect(useAnalyticsStore.getState().loading).toBe(true);
  });

  it('setDays updates the day-range window', () => {
    useAnalyticsStore.getState().setDays(7);
    expect(useAnalyticsStore.getState().days).toBe(7);
  });

  it('clearing the error with setError(null) does not clobber a loading state set just before it', () => {
    // AnalyticsView's fetch effect does exactly this on every run —
    // setLoading(true) immediately followed by setError(null) to clear a
    // stale error before a new fetch starts. setError forcing loading back
    // to false made the loading state unreachable: "Loading analytics…"
    // never had a chance to render.
    useAnalyticsStore.getState().setLoading(true);
    useAnalyticsStore.getState().setError(null);
    expect(useAnalyticsStore.getState().loading).toBe(true);
  });
});
