import type { MapNode, MapPayload, MapRegion } from '../../../lib/api.js';

export const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const DAY = 86_400_000;

export function node(id: string, overrides: Partial<MapNode> = {}): MapNode {
  return {
    id,
    x: 0,
    y: 0,
    type: 'semantic',
    importance: 0.5,
    retention: 0.5,
    protected: false,
    createdAt: new Date(NOW - DAY).toISOString(),
    lastAccessedAt: null,
    namespace: null,
    source: 'claude-code',
    isReflection: false,
    regionId: 'r1',
    degree: 1,
    contradictCount: 0,
    label: `Memory ${id}`,
    ...overrides,
  };
}

export function region(id: string, overrides: Partial<MapRegion> = {}): MapRegion {
  return {
    id,
    name: `place · ${id}`,
    autoName: `place · ${id}`,
    count: 1,
    x: 0,
    y: 0,
    reflectionShare: 0,
    contradictions: 0,
    newThisWeek: 0,
    topTags: [],
    ...overrides,
  };
}

/**
 * Two regions side by side: r1 on the left (a, b, c), r2 on the right (d, e).
 * b is a reflection, c is old and contradicts d, e is protected.
 */
export function payload(overrides: Partial<MapPayload> = {}): MapPayload {
  const nodes = [
    node('a', { x: -0.6, y: 0.1, importance: 0.9, label: 'Sync is end to end encrypted' }),
    node('b', { x: -0.5, y: -0.1, isReflection: true, source: 'reflection', label: 'Trend analysis' }),
    node('c', { x: -0.7, y: -0.2, type: 'episodic', createdAt: new Date(NOW - 90 * DAY).toISOString(), contradictCount: 1 }),
    node('d', { x: 0.5, y: 0.2, type: 'procedural', regionId: 'r2', contradictCount: 1, label: 'Release by pushing a tag' }),
    node('e', { x: 0.6, y: -0.1, regionId: 'r2', protected: true, retention: 0.0001 }),
  ];
  return {
    fingerprint: 'm:5',
    generatedAt: new Date(NOW).toISOString(),
    computeMs: 10,
    method: 'pca2+knn',
    explainedVariance: [0.23, 0.08],
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    nodes,
    regions: [
      region('r1', { name: 'sync · encryption', count: 3, x: -0.6, y: 0, reflectionShare: 1 / 3, contradictions: 1 }),
      region('r2', { name: 'release · npm', count: 2, x: 0.55, y: 0.05, newThisWeek: 2 }),
    ],
    ...overrides,
  };
}
