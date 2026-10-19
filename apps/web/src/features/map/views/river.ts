import { stack, stackOffsetWiggle, stackOrderInsideOut } from 'd3-shape';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import type { MapNode, MapPayload } from '../../../lib/api.js';

export type FlowEdge = { sourceId: string; targetId: string; relationship: string; strength: number };
export type TimeWindow = [number, number];
export const DAY = 86_400_000;
export const dateLabel = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function hash(id: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** The prototype exposes retention logarithmically: five orders of magnitude. */
export const retentionDepth = (retention: number) => Math.max(0, Math.min(1, (Math.log10(Math.max(retention, 1e-12)) + 5) / 5));

export function historyWindow(nodes: MapNode[]): TimeWindow {
  const times = nodes.map((n) => Date.parse(n.createdAt)).filter(Number.isFinite);
  return times.length ? [Math.min(...times) - 2 * DAY, Math.max(...times) + 2 * DAY] : [0, 4 * DAY];
}

export function binRiver(payload: MapPayload, window: TimeWindow, width: number) {
  const steps = Math.max(18, Math.min(72, Math.round(width / 20)));
  const duration = (window[1] - window[0]) / steps;
  const keys = [...payload.regions].sort((a, b) => b.count - a.count).map((r) => r.id);
  const rows = Array.from({ length: steps + 8 }, () => Object.fromEntries(keys.map((id) => [id, 0])));
  const bin = (t: number) => Math.floor((t - window[0]) / duration);
  for (const node of payload.nodes) {
    const row = rows[bin(Date.parse(node.createdAt)) + 4];
    if (row && keys.includes(node.regionId)) row[node.regionId]!++;
  }
  const scaled = rows.map((row) => {
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    return Object.fromEntries(keys.map((id) => [id, total ? row[id]! / Math.sqrt(total) : 0]));
  });
  return { steps, duration, keys, rows, scaled, bin };
}

export function whirlpoolCounts(nodes: MapNode[], edges: FlowEdge[], window: TimeWindow, duration: number) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cells = new Map<string, { regionId: string; bin: number; count: number; from: number }>();
  for (const edge of edges) {
    if (edge.relationship !== 'contradicts') continue;
    const a = byId.get(edge.sourceId), b = byId.get(edge.targetId);
    if (!a || !b) continue;
    const late = Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b;
    const time = Date.parse(late.createdAt);
    if (!Number.isFinite(time) || time < window[0] || time > window[1]) continue;
    const bin = Math.min(Math.ceil((window[1] - window[0]) / duration) - 1, Math.floor((time - window[0]) / duration));
    const key = `${late.regionId}:${bin}`;
    const cell = cells.get(key) ?? { regionId: late.regionId, bin, count: 0, from: window[0] + bin * duration };
    cell.count++;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/** Uniform cubic B-spline, matching curveBasis away from the padded ends. */
export function spline(series: { 0: number; 1: number }[], position: number, side: 0 | 1): number {
  const j = Math.floor(position), u = position - j;
  const p = (i: number) => series[Math.max(0, Math.min(series.length - 1, i))]![side];
  return ((1 - u) ** 3 * p(j - 1) + (3 * u ** 3 - 6 * u * u + 4) * p(j)
    + (-3 * u ** 3 + 3 * u * u + 3 * u + 1) * p(j + 1) + u ** 3 * p(j + 2)) / 6;
}

export function riverLayout(payload: MapPayload, edges: FlowEdge[], window: TimeWindow, width: number, height: number) {
  const bins = binRiver(payload, window, width);
  const series = stack().keys(bins.keys).offset(stackOffsetWiggle).order(stackOrderInsideOut)(bins.scaled);
  const mid = bins.rows.map((_, i) => series.length ? (Math.min(...series.map((s) => s[i]![0])) + Math.max(...series.map((s) => s[i]![1]))) / 2 : 0);
  // Remove slow baseline drift, preserving the wiggle inside the viewport.
  const trend = mid.map((_, i) => {
    let weight = 0, value = 0;
    mid.forEach((m, j) => { const w = Math.exp(-((i - j) ** 2) / 32); weight += w; value += w * m; });
    return value / weight;
  });
  series.forEach((s) => s.forEach((d, i) => { d[0] -= trend[i]!; d[1] -= trend[i]!; }));
  const values = series.flatMap((s) => s.flatMap((d) => [d[0], d[1]]));
  const low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
  const y = scaleLinear().domain([low, high]).range([height - 44, 30]);
  const dx = width / bins.steps;
  const bands = series.map((s) => ({
    id: s.key, series: s, region: payload.regions.find((r) => r.id === s.key)!,
    bounds: (x: number): [number, number] => [y(spline(s, x / dx + 3.5, 1)), y(spline(s, x / dx + 3.5, 0))],
  }));
  const importance = payload.nodes.map((n) => n.importance);
  const size = scaleSqrt().domain(importance.length ? [Math.min(...importance), Math.max(...importance)] : [0, 1]).range([1.4, 4.6]);
  const particles = payload.nodes.filter((n) => {
    const t = Date.parse(n.createdAt);
    return t >= window[0] && t <= window[1] && bins.keys.includes(n.regionId);
  }).map((node) => ({ node, bin: Math.min(bins.steps - 1, bins.bin(Date.parse(node.createdAt))), radius: size(node.importance), retention: retentionDepth(node.retention) }));
  const eddies = whirlpoolCounts(payload.nodes, edges, window, bins.duration).flatMap((cell) => {
    const band = bands.find((b) => b.id === cell.regionId);
    if (!band) return [];
    const x = (cell.bin + 0.5) * dx, [top, bottom] = band.bounds(x);
    return [{ ...cell, x, y: (top + bottom) / 2, radius: Math.min(22, 4 + dx * 0.45, 3 + Math.sqrt(cell.count) * 1.9) }];
  });
  return { ...bins, bands, particles, eddies, width, height, dx, y, window, pixelsPerUnit: (height - 74) / (high - low || 1) };
}

export type RiverModel = ReturnType<typeof riverLayout>;

export function particlePosition(p: RiverModel['particles'][number], model: RiverModel, seconds: number, still: boolean) {
  const fraction = still ? 0.5 : (hash(p.node.id, 1) + seconds * 5 / model.dx) % 1;
  // Drift only within the creation time step, never into a neighbouring date bin.
  const x = (p.bin + fraction) * model.dx;
  const [top, bottom] = model.bands.find((b) => b.id === p.node.regionId)!.bounds(x);
  const depth = Math.max(0.04, Math.min(0.96, 0.12 + 0.76 * (1 - p.retention) + (hash(p.node.id, 2) - 0.5) * 0.18));
  const y = top + (bottom - top) * depth;
  return { x, y, alpha: (0.2 + 0.8 * p.retention) * (still ? 1 : Math.sqrt(Math.sin(Math.PI * fraction))) };
}
