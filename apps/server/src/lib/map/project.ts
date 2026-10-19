import type { SimulationNodeDatum } from 'd3-force';
import { pca2, type Vec2 } from '../pca.js';

export interface MapLink { sourceId: string; targetId: string; strength: number }
export interface Point { id: string; x: number; y: number }
export interface Projection {
  points: Point[];
  method: 'pca2+knn' | 'fallback';
  explainedVariance: Vec2;
}

function fallback(id: string): Vec2 {
  let hash = 2166136261;
  for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const angle = (hash >>> 0) / 4294967296 * 2 * Math.PI;
  return [0.8 * Math.cos(angle), 0.8 * Math.sin(angle)];
}

/** New nodes never move an existing point or change the coordinate scale. */
export function insertPoints(ids: string[], links: MapLink[], previous: Point[]): Point[] {
  const known = new Map(previous.map((p) => [p.id, p]));
  const neighbours = new Map<string, { x: number; y: number; weight: number }>();
  for (const link of links) {
    for (const [id, other] of [[link.sourceId, link.targetId], [link.targetId, link.sourceId]] as const) {
      const point = known.get(other);
      if (!point || known.has(id)) continue;
      const sum = neighbours.get(id) ?? { x: 0, y: 0, weight: 0 };
      sum.x += point.x * link.strength;
      sum.y += point.y * link.strength;
      sum.weight += link.strength;
      neighbours.set(id, sum);
    }
  }
  return ids.map((id) => {
    const old = known.get(id);
    if (old) return { ...old };
    const sum = neighbours.get(id);
    const [x, y] = sum && sum.weight > 0
      ? [sum.x / sum.weight, sum.y / sum.weight] : fallback(id);
    return { id, x: x!, y: y! };
  });
}

/** Least-squares similarity Procrustes, including a possible reflection. */
export function align(points: Point[], previous: Point[]): Point[] {
  const old = new Map(previous.map((p) => [p.id, p]));
  const pairs = points.flatMap((p) => old.has(p.id) ? [[p, old.get(p.id)!] as const] : []);
  if (pairs.length < 2) return points;
  let x = 0, y = 0, u = 0, v = 0;
  for (const [p, q] of pairs) { x += p.x; y += p.y; u += q.x; v += q.y; }
  x /= pairs.length; y /= pairs.length; u /= pairs.length; v /= pairs.length;
  let a = 0, b = 0, c = 0, d = 0, norm = 0;
  for (const [p, q] of pairs) {
    const px = p.x - x, py = p.y - y, qx = q.x - u, qy = q.y - v;
    a += px * qx + py * qy; b += px * qy - py * qx;
    c += px * qx - py * qy; d += px * qy + py * qx;
    norm += px * px + py * py;
  }
  if (norm < 1e-12) return points;
  const reflect = c * c + d * d > a * a + b * b;
  if (reflect) { a = c; b = d; }
  return points.map((p) => {
    const px = p.x - x, py = (p.y - y) * (reflect ? -1 : 1);
    return { id: p.id, x: (a * px - b * py) / norm + u, y: (b * px + a * py) / norm + v };
  });
}

export async function project(
  rows: { id: string; vector: Float32Array | null }[], links: MapLink[], previous: Point[] = []
): Promise<Projection> {
  if (!rows.length) return { points: [], method: 'fallback', explainedVariance: [0, 0] };
  // Native import is required: the REST server emits CommonJS, d3-force is ESM.
  const { forceSimulation, forceLink, forceManyBody } = await import('d3-force');
  const embedded = rows.filter((r): r is { id: string; vector: Float32Array } => r.vector !== null);
  const pca = pca2(embedded.map((r) => r.vector));
  const seeds = new Map<string, Vec2>();
  if (pca) {
    const extent = Math.max(1e-9, ...pca.coords.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
    embedded.forEach((r, i) => seeds.set(r.id, [pca.coords[i]![0] / extent, pca.coords[i]![1] / extent]));
  }
  const old = new Map(insertPoints(rows.map((r) => r.id), links, previous).map((p) => [p.id, p]));
  const nodes: (Point & SimulationNodeDatum)[] = rows.map(({ id }) => {
    const p = old.get(id)!;
    const [x, y] = previous.length ? [p.x, p.y] : seeds.get(id) ?? fallback(id);
    return { id, x: x!, y: y! };
  });
  // Explicit LCG seed; the simulation is stopped immediately, so no timer runs.
  let seed = 1;
  const forceLinks = links.map((l) => ({ source: l.sourceId, target: l.targetId, strength: l.strength }));
  const simulation = forceSimulation(nodes).stop()
    .alphaDecay(1 - Math.pow(0.001, 1 / 25))
    .randomSource(() => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296))
    .force('links', forceLink<Point & SimulationNodeDatum, (typeof forceLinks)[number]>(forceLinks)
      .id((p) => p.id).distance(0.08).strength((l) => l.strength))
    .force('charge', forceManyBody().strength(-0.0002).theta(1.2));
  // Refine the PCA seed in 25 ticks, cooling to alphaMin within that budget.
  // A coarser Barnes–Hut approximation suits the weak repulsion at 5k nodes.
  simulation.tick(25);
  await new Promise<void>((resolve) => setImmediate(resolve));
  let points = nodes.map(({ id, x, y }) => ({ id, x, y }));
  if (previous.length) points = align(points, previous);
  else {
    const extent = Math.max(1, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
    points = points.map((p) => ({ id: p.id, x: p.x / extent, y: p.y / extent }));
  }
  points = points.map((p) => ({ id: p.id, x: Math.max(-1, Math.min(1, p.x)), y: Math.max(-1, Math.min(1, p.y)) }));
  return { points, method: pca ? 'pca2+knn' : 'fallback', explainedVariance: pca?.explained ?? [0, 0] };
}
