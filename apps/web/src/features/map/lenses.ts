import type { MapNode, MapPayload, MapRegion } from '../../lib/api.js';
import type { IconName } from '../../shell/icons.js';
import { TYPE_NAME } from '../memory/MemoryRow.js';

/**
 * The map's three lenses. Meaning is the ground itself: where a memory sits
 * is what it is about. Faults draws the contradictions as lines between the
 * two memories. Time fades everything older than the scrubber.
 */
export type Lens = 'meaning' | 'faults' | 'time';

export const LENSES: readonly { lens: Lens; label: string; icon: IconName; hint: string }[] = [
  { lens: 'meaning', label: 'Meaning', icon: 'map', hint: 'Memories placed by what they are about' },
  { lens: 'faults', label: 'Faults', icon: 'fault', hint: 'Lines join memories that contradict each other' },
  { lens: 'time', label: 'Time', icon: 'time', hint: 'Fade memories older than a number of days' },
];

export const DAY_MS = 86_400_000;

export function ageDays(createdMs: number, now: number): number {
  return Math.max(0, (now - createdMs) / DAY_MS);
}

/** The faintest a memory is drawn: still findable, clearly on its way out. */
const FAINT = 0.3;

/**
 * Retention as strength. A protected memory is never archived, so it is drawn
 * at full strength whatever its score. Any other memory fades on a log scale
 * from full (retention 1) to FAINT at the archive threshold, where the next
 * decay sweep takes it.
 */
export function retentionAlpha(node: Pick<MapNode, 'retention' | 'protected'>, threshold: number): number {
  if (node.protected) return 1;
  if (!(node.retention > threshold) || threshold <= 0 || threshold >= 1) return FAINT;
  const t = Math.min(1, Math.log(node.retention / threshold) / Math.log(1 / threshold));
  return FAINT + (1 - FAINT) * t;
}

export interface LensState {
  lens: Lens;
  /** Time lens: memories older than this many days fade out. */
  cutDays: number;
  now: number;
  /** The search results, when a search is on; everything else steps back. */
  hits: ReadonlySet<string> | null;
  regionId: string | null;
  /** Archived a moment ago and waiting out the undo: not drawn at all. */
  hidden?: ReadonlySet<string>;
}

/** What a memory looks like when the Time lens has cut it: a trace, not a mark. */
export const CUT_ALPHA = 0.06;

/** How much the lens, the open region and the search leave of a mark's
 *  strength, multiplied into its retention strength. */
export function lensAlpha(node: MapNode, createdMs: number, s: LensState): number {
  if (s.hidden?.has(node.id)) return 0;
  if (s.lens === 'time' && ageDays(createdMs, s.now) > s.cutDays) return CUT_ALPHA;
  let a = 1;
  if (s.lens === 'faults' && node.contradictCount === 0) a *= 0.3;
  if (s.hits && !s.hits.has(node.id)) a *= 0.22;
  if (s.regionId && node.regionId !== s.regionId) a *= 0.25;
  return a;
}

/** Whether a memory can be hovered, clicked or stepped to under the lens. */
export function pickable(createdMs: number, s: Pick<LensState, 'lens' | 'cutDays' | 'now'>): boolean {
  return s.lens !== 'time' || ageDays(createdMs, s.now) <= s.cutDays;
}

/**
 * The fault lines to draw, as pairs of model indices: those of the open
 * memory if there is one on the map, else those touching the open region,
 * else all of them. Pairs with an end off the map (another project, archived)
 * are left out.
 */
export function faultLines(
  edges: readonly (readonly [string, string])[],
  at: ReadonlyMap<string, number>,
  nodes: readonly Pick<MapNode, 'regionId'>[],
  selectedId: string | null,
  regionId: string | null
): [number, number][] {
  const out: [number, number][] = [];
  const selected = selectedId !== null && at.has(selectedId) ? at.get(selectedId)! : -1;
  for (const [a, b] of edges) {
    const i = at.get(a);
    const j = at.get(b);
    if (i === undefined || j === undefined) continue;
    if (selected !== -1 && i !== selected && j !== selected) continue;
    if (selected === -1 && regionId && nodes[i]!.regionId !== regionId && nodes[j]!.regionId !== regionId) continue;
    out.push([i, j]);
  }
  return out;
}

/** Memories stored per day, index 0 being today, over `days` days. */
export function dayCounts(created: ArrayLike<number>, now: number, days: number): number[] {
  const counts = new Array<number>(days).fill(0);
  for (let i = 0; i < created.length; i++) {
    const d = Math.floor(ageDays(created[i]!, now));
    if (d < days) counts[d]!++;
  }
  return counts;
}

/** How many days back the oldest memory goes, at least one week. */
export function spanDays(created: ArrayLike<number>, now: number): number {
  let oldest = now;
  for (let i = 0; i < created.length; i++) if (created[i]! > 0) oldest = Math.min(oldest, created[i]!);
  return Math.max(7, Math.ceil(ageDays(oldest, now)));
}

/** A region's name on this device: the reader's rename, or the server's
 *  automatic name with its first letter raised. */
export function regionName(region: Pick<MapRegion, 'id' | 'name'>, names: Readonly<Record<string, string>>): string {
  const own = names[region.id];
  if (own) return own;
  return region.name.charAt(0).toUpperCase() + region.name.slice(1);
}

/** What the live region says about the memory the keyboard is on. */
export function describeNode(node: MapNode, region: string | null): string {
  const kind = node.isReflection ? `${TYPE_NAME[node.type]} reflection` : TYPE_NAME[node.type];
  const text = node.label.length > 80 ? `${node.label.slice(0, 79)}…` : node.label;
  const extra = [
    node.protected ? 'protected' : null,
    node.contradictCount > 0 ? `${node.contradictCount} ${node.contradictCount === 1 ? 'contradiction' : 'contradictions'}` : null,
  ].filter(Boolean);
  return `${kind}${region ? `, ${region}` : ''}: ${text}${extra.length ? `. ${extra.join(', ')}.` : ''}`;
}

/** The legend's honesty line: how far to trust a distance on this map. */
export function honesty(payload: Pick<MapPayload, 'method' | 'explainedVariance'>): string {
  if (payload.method === 'fallback') {
    return 'Too few memories have embeddings to place them by meaning, so positions here are only a fallback.';
  }
  const kept = Math.round((payload.explainedVariance[0] + payload.explainedVariance[1]) * 100);
  return `Closer means more alike in meaning. Approximate: two axes keep ${kept}% of the differences.`;
}
