import type {
  AllTimeAnalytics, AnalyticsData, AnalyticsWindow, WindowedAnalytics,
} from '../store/analyticsStore.js';

/**
 * A response in the shape `GET /api/analytics` actually returns.
 *
 * Built from the live payload rather than invented: the endpoint was
 * restructured from a flat, scope-mixed object into `window` / `windowed` /
 * `allTime`, and a fixture that drifts from it would let this dashboard pass
 * its tests against a contract the server no longer serves.
 */
export function analyticsWindow(overrides: Partial<AnalyticsWindow> = {}): AnalyticsWindow {
  return {
    days: 30,
    start: '2026-08-06',
    end: '2026-09-04',
    startedAt: '2026-08-06T00:00:00.000Z',
    endsBefore: '2026-09-05T00:00:00.000Z',
    generatedAt: '2026-09-04T15:11:29.799Z',
    timezone: 'UTC',
    ...overrides,
  };
}

export function windowedAnalytics(overrides: Partial<WindowedAnalytics> = {}): WindowedAnalytics {
  return {
    total: 42,
    avgImportance: 0.6,
    byType: { semantic: 20, episodic: 15, procedural: 7 },
    bySource: { dashboard: 30, mcp: 12 },
    sourceCount: 2,
    conceptCount: 9,
    topConcepts: [{ concept: 'TypeScript', count: 4, avgImportance: 0.7 }],
    topConceptsLimit: 20,
    baseline: 564,
    dailyGrowth: [{ date: '2026-09-04', count: 3, cumulative: 567 }],
    hourlyActivity: [{ hour: 9, dayOfWeek: 1, count: 5 }],
    weekdayCoverage: [4, 4, 4, 4, 5, 5, 4],
    ...overrides,
  };
}

export function allTimeAnalytics(overrides: Partial<AllTimeAnalytics> = {}): AllTimeAnalytics {
  return { total: 651, avgImportance: 0.81, conceptCount: 228, sourceCount: 15, ...overrides };
}

export function analyticsPayload(
  overrides: { window?: Partial<AnalyticsWindow>; windowed?: Partial<WindowedAnalytics>; allTime?: Partial<AllTimeAnalytics>; excludesArchived?: boolean } = {}
): AnalyticsData {
  return {
    window: analyticsWindow(overrides.window),
    excludesArchived: overrides.excludesArchived ?? true,
    windowed: windowedAnalytics(overrides.windowed),
    allTime: allTimeAnalytics(overrides.allTime),
  };
}
