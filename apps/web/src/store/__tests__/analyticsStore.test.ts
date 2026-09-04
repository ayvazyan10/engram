import { describe, it, expect, beforeEach } from 'vitest';
import { isAnalyticsData, useAnalyticsStore } from '../analyticsStore.js';
import { analyticsPayload } from '../../test/analyticsFixture.js';

const makeData = analyticsPayload;

describe('analyticsStore', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
  });

  it('setData replaces data and clears a stale error', () => {
    useAnalyticsStore.setState({ error: 'boom' });
    useAnalyticsStore.getState().setData(makeData());
    expect(useAnalyticsStore.getState().data?.windowed.total).toBe(42);
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

describe('isAnalyticsData (boundary guard)', () => {
  it('accepts the shape the server serves', () => {
    expect(isAnalyticsData(analyticsPayload())).toBe(true);
  });

  it('rejects the previous flat, scope-mixed shape rather than rendering it as undefined', () => {
    const legacy = {
      total: 651,
      avgImportance: 0.81,
      byType: { semantic: 54 },
      bySource: { 'claude-code': 62 },
      dailyGrowth: [{ date: '2026-09-04', count: 7 }],
      hourlyActivity: [],
      topConcepts: [],
    };
    expect(isAnalyticsData(legacy)).toBe(false);
  });

  it('rejects anything that is not an object, and any payload missing a scope', () => {
    for (const bad of [null, undefined, 'ok', 42, {}, { window: {}, windowed: {}, allTime: {} }]) {
      expect(isAnalyticsData(bad)).toBe(false);
    }
    const noAllTime = { ...analyticsPayload() } as unknown as Record<string, unknown>;
    delete noAllTime['allTime'];
    expect(isAnalyticsData(noAllTime)).toBe(false);
  });
});
