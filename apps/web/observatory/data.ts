/**
 * Loads the real store from the running API and derives everything the three
 * demos share, once, so no demo has to re-derive it and no two demos can
 * disagree about what the numbers are.
 *
 * Three requests, in parallel:
 *   GET /api/graph/layout       every memory + its PCA coordinate
 *   GET /api/graph/edges        every renderable link + the honest totals
 *   GET /api/decay/policy       the half-life retention is computed against
 *
 * No fixtures and no fallbacks. If a request fails the page says so and
 * renders nothing — a demo drawn from invented data would be worse than no
 * demo, because the whole point is to judge these visualizations against this
 * store's actual shape.
 */

import type {
  LinkKind,
  MemoryType,
  ObsData,
  ObsLink,
  ObsNode,
  RetentionBand,
} from './demos/contract';

const DAY_MS = 86_400_000;

interface LayoutResponse {
  halfExtent: number;
  count: number;
  explainedVariance: number[];
  nodes: {
    id: string;
    type: MemoryType;
    label: string;
    importance: number;
    accessCount: number;
    createdAt: string;
    x: number;
    y: number;
    z: number;
    projected: boolean;
  }[];
}

interface EdgesResponse {
  total: number;
  stored: number;
  matching: number;
  returned: number;
  truncated: boolean;
  edges: { id: string; sourceId: string; targetId: string; relationship: string; strength: number }[];
}

interface PolicyResponse {
  halfLifeDays: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Which of the three ordinal strength steps a link paints with.
 *  Cut at the store's own quartiles rather than at round numbers: strength
 *  runs 0.4–1.0 with a median of 0.706, so thirds of the RANGE would put
 *  almost everything in one step. */
function strengthStep(strength: number): 0 | 1 | 2 {
  if (strength >= 0.9) return 2;
  if (strength >= 0.62) return 1;
  return 0;
}

function bandOf(retention: number): RetentionBand {
  if (retention >= 0.5) return 'vivid';
  if (retention >= 0.25) return 'holding';
  if (retention >= 0.05) return 'fading';
  return 'threshold';
}

/** Relationship name → the two kinds this store contains. Anything unexpected
 *  is treated as an association rather than dropped, and would show up in the
 *  agrees count. */
function kindOf(relationship: string): LinkKind {
  return relationship === 'contradicts' ? 'contradicts' : 'agrees';
}

export async function loadObservatoryData(): Promise<ObsData> {
  const [layout, edges, policy] = await Promise.all([
    getJson<LayoutResponse>('/api/graph/layout'),
    getJson<EdgesResponse>('/api/graph/edges?limit=20000'),
    getJson<PolicyResponse>('/api/decay/policy'),
  ]);

  const now = Date.now();
  const halfLifeDays = policy.halfLifeDays;

  const nodes: ObsNode[] = layout.nodes.map((n) => {
    const ageDays = Math.max(0, (now - Date.parse(n.createdAt)) / DAY_MS);
    const retention = Math.pow(2, -ageDays / halfLifeDays);
    return {
      ...n,
      degree: 0,
      agreeDegree: 0,
      contradictDegree: 0,
      component: -1,
      retention,
      retentionBand: bandOf(retention),
    };
  });

  const indexOf = new Map<string, number>();
  nodes.forEach((n, i) => indexOf.set(n.id, i));

  const links: ObsLink[] = [];
  for (const e of edges.edges) {
    const source = indexOf.get(e.sourceId);
    const target = indexOf.get(e.targetId);
    if (source === undefined || target === undefined) continue;
    const a = nodes[source]!;
    const b = nodes[target]!;
    const kind = kindOf(e.relationship);
    a.degree++;
    b.degree++;
    if (kind === 'agrees') {
      a.agreeDegree++;
      b.agreeDegree++;
    } else {
      a.contradictDegree++;
      b.contradictDegree++;
    }
    links.push({
      id: e.id,
      sourceId: e.sourceId,
      targetId: e.targetId,
      kind,
      strength: e.strength,
      step: strengthStep(e.strength),
      source,
      target,
      span: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
    });
  }

  assignComponents(nodes, links);

  return {
    nodes,
    links,
    halfExtent: layout.halfExtent,
    stats: buildStats(nodes, links, edges, layout, halfLifeDays),
  };
}

/** Connected components by iterative flood fill, largest first, so
 *  `component === 0` is always the giant one (538 members on this store). */
function assignComponents(nodes: ObsNode[], links: ObsLink[]): void {
  const adjacency: number[][] = nodes.map(() => []);
  for (const l of links) {
    adjacency[l.source]!.push(l.target);
    adjacency[l.target]!.push(l.source);
  }

  const raw = new Int32Array(nodes.length).fill(-1);
  const sizes: number[] = [];
  for (let seed = 0; seed < nodes.length; seed++) {
    if (raw[seed] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [seed];
    raw[seed] = id;
    while (stack.length) {
      const v = stack.pop()!;
      size++;
      for (const w of adjacency[v]!) {
        if (raw[w] === -1) {
          raw[w] = id;
          stack.push(w);
        }
      }
    }
    sizes.push(size);
  }

  // Re-rank so 0 is the largest component.
  const order = sizes.map((size, id) => ({ size, id })).sort((a, b) => b.size - a.size);
  const rank = new Int32Array(sizes.length);
  order.forEach((entry, i) => {
    rank[entry.id] = i;
  });
  nodes.forEach((n, i) => {
    n.component = rank[raw[i]!]!;
  });
}

function buildStats(
  nodes: ObsNode[],
  links: ObsLink[],
  edges: EdgesResponse,
  layout: LayoutResponse,
  halfLifeDays: number
): ObsData['stats'] {
  const degrees = nodes.map((n) => n.degree).filter((d) => d > 0).sort((a, b) => a - b);
  const componentSizes = new Map<number, number>();
  const retention: Record<RetentionBand, number> = { vivid: 0, holding: 0, fading: 0, threshold: 0 };
  const byType: Record<MemoryType, number> = { episodic: 0, semantic: 0, procedural: 0 };
  for (const n of nodes) {
    componentSizes.set(n.component, (componentSizes.get(n.component) ?? 0) + 1);
    retention[n.retentionBand]++;
    byType[n.type]++;
  }

  // Isolated memories each form their own component; count only the ones that
  // are actually a cluster of two or more, which is what a reader means by
  // "cluster".
  let clusters = 0;
  let largest = 0;
  for (const size of componentSizes.values()) {
    if (size > 1) clusters++;
    if (size > largest) largest = size;
  }

  const agrees = links.filter((l) => l.kind === 'agrees').length;

  return {
    memories: layout.count,
    connected: degrees.length,
    isolated: nodes.length - degrees.length,
    linksDrawn: links.length,
    linksStored: edges.stored,
    linksToArchived: edges.stored - edges.total,
    agrees,
    contradicts: links.length - agrees,
    components: clusters,
    largestComponent: largest,
    degree: {
      median: degrees.length ? degrees[Math.floor(degrees.length / 2)]! : 0,
      max: degrees.length ? degrees[degrees.length - 1]! : 0,
    },
    explainedVariance: layout.explainedVariance.reduce((a, b) => a + b, 0),
    retention,
    byType,
    halfLifeDays,
  };
}
