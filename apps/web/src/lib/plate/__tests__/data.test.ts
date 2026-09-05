import { describe, it, expect, beforeEach, vi } from 'vitest';
import { derivePlateData, loadPlateData } from '../data.js';
import { api, type EdgeSummary, type LayoutResponse } from '../../api.js';

/**
 * The derivation is what every plate reads, and no plate re-derives any of it —
 * that is the whole reason it lives here, so five visualizations cannot
 * disagree about what the numbers are. Split from the fetch so it can be
 * asserted against a known store without a network.
 */

vi.mock('../../api.js', () => ({
  api: { getGraphLayout: vi.fn(), getGraphEdges: vi.fn(), getDecayPolicy: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-09-05T00:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function layoutOf(
  nodes: { id: string; createdAt?: string; type?: 'episodic' | 'semantic' | 'procedural' }[],
  overrides: Partial<LayoutResponse> = {}
): LayoutResponse {
  return {
    method: 'pca3',
    fingerprint: 'f',
    generatedAt: daysAgo(0),
    halfExtent: 42,
    count: nodes.length,
    projected: nodes.length,
    unprojected: 0,
    explainedVariance: [0.24, 0.094, 0.046],
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    computeMs: 4,
    nodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type ?? 'semantic',
      label: `label ${n.id}`,
      importance: 0.5,
      source: null,
      accessCount: 0,
      createdAt: n.createdAt ?? daysAgo(0),
      lastAccessedAt: null,
      x: i * 3,
      y: 0,
      z: 0,
      projected: true,
    })),
    ...overrides,
  };
}

function edgesOf(
  edges: { id: string; sourceId: string; targetId: string; relationship?: string; strength?: number }[],
  overrides: Partial<EdgeSummary> = {}
): EdgeSummary {
  const rows = edges.map((e) => ({
    id: e.id,
    sourceId: e.sourceId,
    targetId: e.targetId,
    relationship: e.relationship ?? 'relates_to',
    strength: e.strength ?? 0.7,
  }));
  return {
    total: rows.length,
    stored: rows.length,
    matching: rows.length,
    returned: rows.length,
    truncated: false,
    minStrength: 0,
    limit: 20000,
    edges: rows,
    ...overrides,
  };
}

describe('retention is computed against the SERVER\'s half-life', () => {
  it('is 2^(-ageDays / halfLife), taking the half-life from the argument', () => {
    const layout = layoutOf([
      { id: 'now', createdAt: daysAgo(0) },
      { id: 'one-half-life', createdAt: daysAgo(7) },
      { id: 'two', createdAt: daysAgo(14) },
    ]);
    const { nodes } = derivePlateData(layout, edgesOf([]), 7, NOW);

    expect(nodes[0]!.retention).toBeCloseTo(1, 6);
    expect(nodes[1]!.retention).toBeCloseTo(0.5, 6);
    expect(nodes[2]!.retention).toBeCloseTo(0.25, 6);
  });

  it('moves with the policy rather than a client-side constant', () => {
    const layout = layoutOf([{ id: 'a', createdAt: daysAgo(30) }]);
    const seven = derivePlateData(layout, edgesOf([]), 7, NOW).nodes[0]!.retention;
    const thirty = derivePlateData(layout, edgesOf([]), 30, NOW).nodes[0]!.retention;
    expect(thirty).toBeGreaterThan(seven);
    expect(thirty).toBeCloseTo(0.5, 6);
  });

  it('bands it in words, at the cuts the plates name — never on colour', () => {
    const layout = layoutOf([
      { id: 'vivid', createdAt: daysAgo(3) },
      { id: 'holding', createdAt: daysAgo(12) },
      { id: 'fading', createdAt: daysAgo(30) },
      { id: 'threshold', createdAt: daysAgo(60) },
    ]);
    const { nodes, stats } = derivePlateData(layout, edgesOf([]), 7, NOW);
    expect(nodes.map((n) => n.retentionBand)).toEqual(['vivid', 'holding', 'fading', 'threshold']);
    expect(stats.retention).toEqual({ vivid: 1, holding: 1, fading: 1, threshold: 1 });
    expect(stats.halfLifeDays).toBe(7);
  });

  it('never reads retention as negative age for a memory stored in the future', () => {
    const layout = layoutOf([{ id: 'a', createdAt: new Date(NOW + 5 * DAY_MS).toISOString() }]);
    expect(derivePlateData(layout, edgesOf([]), 7, NOW).nodes[0]!.retention).toBe(1);
  });
});

describe('connected components, re-ranked so 0 is the largest', () => {
  it('numbers the giant component 0 whatever order the store returns it in', () => {
    // A pair first, then a triple: raw flood-fill order would make the pair 0.
    const layout = layoutOf([
      { id: 'p1' }, { id: 'p2' },
      { id: 't1' }, { id: 't2' }, { id: 't3' },
      { id: 'lonely' },
    ]);
    const edges = edgesOf([
      { id: 'e1', sourceId: 'p1', targetId: 'p2' },
      { id: 'e2', sourceId: 't1', targetId: 't2' },
      { id: 'e3', sourceId: 't2', targetId: 't3' },
    ]);
    const { nodes, stats } = derivePlateData(layout, edges, 7, NOW);
    const by = new Map(nodes.map((n) => [n.id, n.component]));

    expect(by.get('t1')).toBe(0);
    expect(by.get('t2')).toBe(0);
    expect(by.get('t3')).toBe(0);
    expect(by.get('p1')).toBe(1);
    expect(by.get('p1')).toBe(by.get('p2'));
    expect(by.get('lonely')).toBeGreaterThan(1);

    expect(stats.largestComponent).toBe(3);
    // An isolated memory is its own component but is not a cluster.
    expect(stats.components).toBe(2);
    expect(stats.isolated).toBe(1);
    expect(stats.connected).toBe(5);
  });

  it('counts degree by kind on both endpoints', () => {
    const layout = layoutOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const edges = edgesOf([
      { id: 'e1', sourceId: 'a', targetId: 'b', relationship: 'relates_to' },
      { id: 'e2', sourceId: 'a', targetId: 'c', relationship: 'contradicts' },
    ]);
    const { nodes } = derivePlateData(layout, edges, 7, NOW);
    const a = nodes.find((n) => n.id === 'a')!;
    expect(a.degree).toBe(2);
    expect(a.agreeDegree).toBe(1);
    expect(a.contradictDegree).toBe(1);
  });
});

describe('links', () => {
  it('steps strength at the store\'s quartiles, not at thirds of the range', () => {
    const layout = layoutOf([{ id: 'a' }, { id: 'b' }]);
    const step = (strength: number) =>
      derivePlateData(
        layout,
        edgesOf([{ id: 'e', sourceId: 'a', targetId: 'b', strength }]),
        7,
        NOW
      ).links[0]!.step;

    expect(step(0.4)).toBe(0);
    expect(step(0.61)).toBe(0);
    expect(step(0.62)).toBe(1);
    expect(step(0.89)).toBe(1);
    expect(step(0.9)).toBe(2);
    expect(step(1)).toBe(2);
  });

  it('reads any unexpected relationship as an association rather than dropping it', () => {
    const layout = layoutOf([{ id: 'a' }, { id: 'b' }]);
    const { links, stats } = derivePlateData(
      layout,
      edgesOf([{ id: 'e', sourceId: 'a', targetId: 'b', relationship: 'derived_from' }]),
      7,
      NOW
    );
    expect(links[0]!.kind).toBe('agrees');
    expect(stats.agrees).toBe(1);
    expect(stats.contradicts).toBe(0);
  });

  it('drops an edge whose endpoint is not on the plate, and carries indices and span', () => {
    const layout = layoutOf([{ id: 'a' }, { id: 'b' }]);
    const { links } = derivePlateData(
      layout,
      edgesOf([
        { id: 'e1', sourceId: 'a', targetId: 'b' },
        { id: 'e2', sourceId: 'a', targetId: 'archived' },
      ]),
      7,
      NOW
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe(0);
    expect(links[0]!.target).toBe(1);
    expect(links[0]!.span).toBeCloseTo(3, 6);
  });
});

describe('the stats block is honest about what is not drawn', () => {
  it('reports stored, drawn, and the difference as links onto archived memories', () => {
    const layout = layoutOf([{ id: 'a' }, { id: 'b' }]);
    const edges = edgesOf([{ id: 'e1', sourceId: 'a', targetId: 'b' }], {
      total: 1,
      stored: 9,
      matching: 1,
      returned: 1,
    });
    const { stats } = derivePlateData(layout, edges, 7, NOW);
    expect(stats.linksDrawn).toBe(1);
    expect(stats.linksStored).toBe(9);
    expect(stats.linksToArchived).toBe(8);
  });

  it('sums the projection\'s explained variance, which is what a plate has to own up to', () => {
    const { stats } = derivePlateData(layoutOf([{ id: 'a' }]), edgesOf([]), 7, NOW);
    expect(stats.explainedVariance).toBeCloseTo(0.38, 5);
  });

  it('takes the memory count from the server, not from the node array it happened to send', () => {
    const layout = layoutOf([{ id: 'a' }, { id: 'b' }], { count: 656 });
    expect(derivePlateData(layout, edgesOf([]), 7, NOW).stats.memories).toBe(656);
  });

  it('counts by type and reports degree median and max over connected memories only', () => {
    const layout = layoutOf([
      { id: 'a', type: 'episodic' },
      { id: 'b', type: 'semantic' },
      { id: 'c', type: 'procedural' },
      { id: 'd', type: 'semantic' },
    ]);
    const edges = edgesOf([
      { id: 'e1', sourceId: 'a', targetId: 'b' },
      { id: 'e2', sourceId: 'b', targetId: 'c' },
      { id: 'e3', sourceId: 'b', targetId: 'd' },
    ]);
    const { stats } = derivePlateData(layout, edges, 7, NOW);
    expect(stats.byType).toEqual({ episodic: 1, semantic: 2, procedural: 1 });
    expect(stats.degree.max).toBe(3);
    expect(stats.degree.median).toBe(1);
  });
});

describe('loadPlateData goes through lib/api', () => {
  beforeEach(() => {
    vi.mocked(api.getGraphLayout).mockReset().mockResolvedValue(layoutOf([{ id: 'a' }, { id: 'b' }]));
    vi.mocked(api.getGraphEdges).mockReset().mockResolvedValue(edgesOf([{ id: 'e1', sourceId: 'a', targetId: 'b' }]));
    vi.mocked(api.getDecayPolicy).mockReset().mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05 });
  });

  /** Not bare fetch: `api` is the one place that attaches the key, applies the
   *  timeout, and locks the auth store on a 401 so the unlock gate comes up. */
  it('makes its three requests through the shared api object', async () => {
    await loadPlateData();
    expect(api.getGraphLayout).toHaveBeenCalledTimes(1);
    expect(api.getGraphEdges).toHaveBeenCalledTimes(1);
    expect(api.getDecayPolicy).toHaveBeenCalledTimes(1);
  });

  it('returns the raw responses beside the derived data, so one load feeds both consumers', async () => {
    const load = await loadPlateData();
    expect(load.layout.nodes).toHaveLength(2);
    expect(load.edges.edges).toHaveLength(1);
    expect(load.data.stats.memories).toBe(2);
    expect(load.data.links).toHaveLength(1);
  });

  it('takes the half-life from the policy call rather than assuming one', async () => {
    vi.mocked(api.getDecayPolicy).mockResolvedValue({ halfLifeDays: 30, archiveThreshold: 0.05 });
    const load = await loadPlateData();
    expect(load.data.stats.halfLifeDays).toBe(30);
  });

  /** No fixtures and no fallbacks: a failure propagates so the surface can say
   *  so, rather than being papered over with invented data. */
  it('rejects rather than substituting anything when a request fails', async () => {
    vi.mocked(api.getGraphEdges).mockRejectedValue(new Error('API 500: /graph/edges'));
    await expect(loadPlateData()).rejects.toThrow('API 500: /graph/edges');
  });
});
