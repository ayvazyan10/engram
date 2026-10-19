import type { MapPayload, RecallExplanation } from '../../../lib/api.js';
import type { FlowEdge } from './river.js';

export const START_MS = 600, WAVE_MS = 5200, THREAD_MS = 520, END_MS = 6800;
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

/** Inclusion is authoritative from the server. Never re-run a different budget policy. */
export function budgetWalk(recall: RecallExplanation) {
  let spentChars = 0;
  return [...recall.items].sort((a, b) => a.rank - b.rank).map((item) => {
    // The server budgets characters, then rounds the total once (4 chars/token).
    // Summing rounded per-memory tokens can falsely report an exhausted budget.
    const remaining = recall.budget.maxTokens - spentChars / 4;
    const why = item.included
      ? `In the context as #${item.position} (${item.section})${item.chars / 4 > remaining ? '; the top memory is always included, even over budget' : ''}`
      : item.chars / 4 > remaining || item.reason === 'over_budget'
        ? `Left out: needs ${item.tokens} tokens, ${Math.max(0, remaining)} left in the budget`
        : 'Left out by the recall';
    const offset = spentChars / 4;
    if (item.included) spentChars += item.chars;
    return { ...item, remaining, why, offset, budgetTokens: item.chars / 4 };
  });
}

export function inferPullers(items: RecallExplanation['items'], edges: FlowEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [a, b] of [[edge.sourceId, edge.targetId], [edge.targetId, edge.sourceId]] as const) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a)!.add(b);
    }
  }
  const ranked = [...items].sort((a, b) => a.rank - b.rank);
  return new Map(ranked.map((item) => {
    const earlier = ranked.filter((other) => other.rank < item.rank && adjacency.get(item.id)?.has(other.id));
    return [item.id, item.via === 'vector' ? null : (earlier.find((other) => other.via === 'vector') ?? earlier[0])?.id ?? null];
  }));
}

export function pulseLayout(recall: RecallExplanation, payload: MapPayload, edges: FlowEdge[], size: number) {
  const narrow = size < 520, outer = size / 2 - (narrow ? 30 : 64), center = Math.max(46, size * 0.12);
  const nodes = new Map(payload.nodes.map((n) => [n.id, n]));
  const pullers = inferPullers(recall.items, edges);
  const items = budgetWalk(recall).map((item) => ({ ...item, label: nodes.get(item.id)?.label ?? '(memory not on the map)',
    regionId: nodes.get(item.id)?.regionId ?? 'elsewhere', puller: pullers.get(item.id) ?? null,
    angle: 0, radius: 0, x: 0, y: 0, size: 0, time: 0 }));
  const radius = (rank: number) => center + 16 + (outer - center - 16) * Math.pow(clamp((rank - 1) / Math.max(1, items.length - 1)), 0.62);
  const groups = new Map<string, typeof items>();
  items.forEach((item) => { if (!groups.has(item.regionId)) groups.set(item.regionId, []); groups.get(item.regionId)!.push(item); });
  const gap = groups.size > 1 ? 0.05 : 0, total = items.length + 2 * groups.size;
  let start = -Math.PI / 2;
  const sectors = [...groups].map(([id, list]) => {
    // Leave a hairline seam on a single sector so its SVG rim is a real arc.
    const span = Math.min(Math.PI * 2 - 0.001, (Math.PI * 2 - gap * groups.size) * (list.length + 2) / total);
    const sector = { id, name: payload.regions.find((r) => r.id === id)?.name ?? 'Not on the map', start, end: start + span };
    list.forEach((item, k) => {
      const fraction = list.length === 1 ? 0.5 : 0.12 + 0.76 * ((k * 0.618034 + 0.31) % 1);
      item.angle = start + span * fraction;
      item.radius = radius(item.rank);
      item.x = Math.cos(item.angle) * item.radius; item.y = Math.sin(item.angle) * item.radius;
      item.size = 2.2 + Math.sqrt(item.tokens) * (narrow ? 0.17 : 0.24);
      item.time = START_MS + WAVE_MS * (item.radius - center) / (outer + 12 - center);
    });
    start += span + gap;
    return sector;
  });
  const included = items.filter((i) => i.included);
  const lastIncluded = included.length ? Math.max(...included.map((i) => i.rank)) : null;
  return { items, sectors, center, outer, radius, narrow, budgetRadius: lastIncluded === null ? null : radius(lastIncluded) + 5 };
}

export type PulseModel = ReturnType<typeof pulseLayout>;
export type PulseDot = PulseModel['items'][number];

/** Deterministic frames make replay, reduced motion, and frame review agree. */
export function dotFrame(item: PulseDot, elapsed: number) {
  const age = elapsed - item.time;
  if (age < 0) return { scale: 1, alpha: 0.28, outward: 0, fault: false, active: false };
  if (item.included) {
    const scale = age < 90 ? 1 + 0.9 * smooth(age / 90) : 1 + 0.9 * (1 - smooth((age - 90) / 520));
    return { scale, alpha: 1, outward: 0, fault: false, active: true };
  }
  const fall = clamp((age - 230) / 620) ** 3;
  return { scale: 1, alpha: age < 70 ? 0.95 : age < 160 ? 0.2 : age < 230 ? 0.8 : 0.8 - 0.48 * fall,
    outward: 5 * fall, fault: age < 230, active: true };
}

export function rimPath(start: number, end: number, radius: number) {
  const lower = Math.sin((start + end) / 2) > 0.05;
  const [a, b] = lower ? [end, start] : [start, end];
  return { lower, path: `M${Math.cos(a) * radius},${Math.sin(a) * radius}A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} ${lower ? 0 : 1} ${Math.cos(b) * radius},${Math.sin(b) * radius}` };
}
