/**
 * SLOT: Memory Constellations — the one 2D member of the reference-styled set.
 *
 * THE FORM
 * A star chart. Every memory is a star; the number of links it holds is its
 * magnitude. The link structure is cut into groups (deterministic Louvain,
 * modularity printed live — 0.79 on this store, 27 groups), and each group is
 * drawn the way an atlas draws Orion: not every star joined to every star, but
 * the FEWEST, STRONGEST lines that hold the group together — its maximum
 * spanning tree, Kruskal by strength. That is the decision this slot lives or
 * dies on, so it is a radio at bottom-left with the alternatives beside it
 * (one strongest tie per star; the contradiction forest; every link — the
 * hairball the chart exists to avoid), and the number drawn against the number
 * left out is on screen for whichever rule is active.
 *
 * ─── What is derived, and from what ────────────────────────────────────────
 *
 *   Groups        Louvain over the renderable links (3,103 on the snapshot
 *                 measured), weighted by strength. Node order is fixed and
 *                 there is no random restart, so the partition is the same
 *                 on every load of the same store.
 *   Names         The store has no topic taxonomy and none is invented. A
 *                 group is named after its busiest member's own label (the
 *                 alpha star), skipping a label a bigger group already took;
 *                 if every label in the group is taken, the day the busiest
 *                 one was written is appended. Markdown is stripped; a label
 *                 stored in shouting caps is set in sentence case. Groups under NAME_MIN members are
 *                 unnamed asterisms and are counted as such.
 *   Magnitude     Links held (degree, 0–66 here). Importance was the obvious
 *                 choice and is refused on measurement: its interquartile
 *                 range on this store is 0.80–0.82, so it would draw a flat
 *                 sky. The refusal is printed bottom-right with the live
 *                 figures.
 *   Positions     PCA 1 and 2 — the projection the store already has, which
 *                 keeps 38% of the variance and piles the two lobes of this
 *                 store (reflection output around PC1 −25, lived memories
 *                 around +30) on top of themselves. Each axis is spread by
 *                 rank so the chart fills, and the graticule is drawn at
 *                 fixed PCA values, so the distortion is visible as uneven
 *                 tick spacing rather than hidden. Stars closer than
 *                 STAR_GAP are nudged apart; the largest nudge is printed.
 *   Background    The 37 memories with no renderable link are the faintest
 *                 stars. A chart is the one form in which an unjoined point
 *                 is not a failure; they are counted top-right.
 *
 * ─── Colour and the glow relaxation ────────────────────────────────────────
 *
 * Hue means link kind and nothing else, so stars are `--memory`, neutral, and
 * bright stars get brighter by an additive halo of the same neutral rather
 * than by a new token. Figure lines paint with `linkColor` (kind × step).
 *
 * The set allows additive glow. Measured before it was allowed here: a glow
 * under every step at α 0.18 drops the weak step to 2.65:1 over its own halo,
 * under the 3:1 mark floor — the same wash failure `tokens.css` documents. So
 * glow scales WITH strength: the strong step glows at α 0.10 × 4px, the mid
 * step at α 0.05 × 3px, the weak step not at all. Under that rule every core
 * keeps ≥ 3.06:1 over its own glow, the three steps stay a monotone ramp
 * (validator `--ordinal` PASS, ΔL ≥ 0.06), and kind separation stays ΔE ≥ 21
 * under protan simulation. The 'Every link' view draws 3,103 lines and
 * therefore glows nothing — additive glow at that density is a wash by
 * construction.
 *
 * Contract rules 4–9: density is line count, never a wash; retention is a
 * word in the callout and never a colour; `reducedMotion` renders the settled
 * chart at once; the entrance and every state change animate only opacity
 * (canvas alpha, CSS opacity) and the draw-on of a line's own length; every
 * count is against a real denominator from `data.stats`; nothing is framed.
 *
 * The pure stages (`buildScene`, `buildSky`, `layoutNames`, `growthOf`,
 * `cleanLabel`) are exported only so the headless measurement can run them
 * on the real store; the registry imports `memoryConstellations` alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { format } from 'date-fns';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  linkColor,
  type DemoModule,
  type DemoProps,
  type LinkKind,
  type MemoryType,
  type ObsData,
  type ObsLink,
  type ObsNode,
} from './contract';

// ─── Measurements ───────────────────────────────────────────────────────────

const PAD = 28;
/** Height of the top band the field starts under, and of the bottom band. */
const TOP = 126;
const BOTTOM = 134;
/** The margin columns that carry constellation names. */
const MARGIN_MIN = 200;
const MARGIN_MAX = 252;
const MARGIN_SHARE = 0.17;
/** Below this width the margins go and names with them. */
const NARROW = 760;
/** A margin narrower than this sets its caps lines in the narrow cut. */
const TIGHT = 232;
/** One named constellation in a margin column. */
const ROW = 36;
/** A group smaller than this is an unnamed asterism. */
const NAME_MIN = 4;
const NAME_CHARS = 34;
/** Stars nearer than this are nudged apart, deterministically. */
const STAR_GAP = 5;
const SEPARATION_PASSES = 30;
const HIT_RADIUS = 9;
const RING_R = 5;
const CORE_WIDTH = 1.25;
/** Glow by strength step — none, mid, strong. See the header for the measurement. */
const GLOW_ALPHA: readonly [number, number, number] = [0, 0.05, 0.1];
const GLOW_WIDTH: readonly [number, number, number] = [0, 3, 4];
const HALO_ALPHA = 0.16;
/** The brightest few percent of stars by degree get a halo. */
const HALO_SHARE = 0.06;
const ENTRANCE_MS = 1100;
/** Focus dims context by alpha. A focus state, not an encoding. */
const DIM_LINE = 0.22;
const DIM_STAR = 0.35;
const TICK_STEP = 10;

const nf = new Intl.NumberFormat('en-US');

type View = 'figures' | 'strongest' | 'disputes' | 'every';

const VIEWS: readonly { id: View; name: string; rule: string }[] = [
  { id: 'figures', name: 'Figures', rule: 'The fewest, strongest lines that hold each group together' },
  { id: 'strongest', name: 'Strongest tie', rule: 'One line per star, to whatever it is most strongly linked' },
  { id: 'disputes', name: 'Disputes', rule: 'The fewest contradiction lines that hold each group’s disputes together' },
  { id: 'every', name: 'Every link', rule: 'All of them — the hairball the chart exists to avoid' },
];

const TYPE_ORDER: readonly MemoryType[] = ['semantic', 'procedural', 'episodic'];

// ─── Small helpers ──────────────────────────────────────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A token colour with an alpha, for canvas. Non-hex values pass through. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

/** A memory's label as a chart would print it: markdown stripped, shouting
 *  caps set in sentence case, trailing punctuation dropped. Never reworded. */
export function cleanLabel(raw: string): string {
  let s = raw
    .replace(/[*_`#>[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:;,.\-–—]+$/, '')
    .trim();
  const letters = s.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length > 6 && upper.length / letters.length > 0.8) {
    s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return s || raw.trim() || 'Untitled memory';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// ─── Groups: deterministic Louvain ──────────────────────────────────────────

interface Weighted {
  s: number;
  t: number;
  w: number;
}

/** Louvain with aggregation, weighted by strength. Fixed node order and no
 *  random restart, so the same store yields the same partition every time. */
function louvain(n: number, links: readonly ObsLink[]): Int32Array {
  let count = n;
  let edges: Weighted[] = links.map((l) => ({ s: l.source, t: l.target, w: l.strength }));
  const membership = new Int32Array(n);
  for (let i = 0; i < n; i++) membership[i] = i;

  for (let level = 0; level < 12; level++) {
    const adj: [number, number][][] = Array.from({ length: count }, () => []);
    const k = new Float64Array(count);
    let m2 = 0;
    for (const e of edges) {
      if (e.s === e.t) {
        k[e.s] = k[e.s]! + 2 * e.w;
        m2 += 2 * e.w;
        continue;
      }
      adj[e.s]!.push([e.t, e.w]);
      adj[e.t]!.push([e.s, e.w]);
      k[e.s] = k[e.s]! + e.w;
      k[e.t] = k[e.t]! + e.w;
      m2 += 2 * e.w;
    }
    if (m2 === 0) break;

    const com = new Int32Array(count);
    for (let v = 0; v < count; v++) com[v] = v;
    const tot = Float64Array.from(k);
    let movedAny = false;
    for (let pass = 0; pass < 50; pass++) {
      let moved = false;
      for (let v = 0; v < count; v++) {
        const cv = com[v]!;
        const kv = k[v]!;
        const weights = new Map<number, number>();
        for (const [u, w] of adj[v]!) {
          const cu = com[u]!;
          weights.set(cu, (weights.get(cu) ?? 0) + w);
        }
        tot[cv] = tot[cv]! - kv;
        let best = cv;
        let bestGain = (weights.get(cv) ?? 0) - (tot[cv]! * kv) / m2;
        for (const [c, w] of weights) {
          if (c === cv) continue;
          const gain = w - (tot[c]! * kv) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        tot[best] = tot[best]! + kv;
        if (best !== cv) {
          com[v] = best;
          moved = true;
          movedAny = true;
        }
      }
      if (!moved) break;
    }

    const remap = new Map<number, number>();
    const next = new Int32Array(count);
    for (let v = 0; v < count; v++) {
      const c = com[v]!;
      let id = remap.get(c);
      if (id === undefined) {
        id = remap.size;
        remap.set(c, id);
      }
      next[v] = id;
    }
    for (let i = 0; i < n; i++) membership[i] = next[membership[i]!]!;
    if (!movedAny || remap.size === count) break;

    const agg = new Map<string, Weighted>();
    for (const e of edges) {
      const a = next[e.s]!;
      const b = next[e.t]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const prev = agg.get(key);
      agg.set(
        key,
        prev ? { ...prev, w: prev.w + e.w } : { s: Math.min(a, b), t: Math.max(a, b), w: e.w }
      );
    }
    edges = [...agg.values()];
    count = remap.size;
  }
  return membership;
}

function modularityOf(n: number, links: readonly ObsLink[], memb: Int32Array): number {
  const k = new Float64Array(n);
  let m2 = 0;
  for (const l of links) {
    k[l.source] = k[l.source]! + l.strength;
    k[l.target] = k[l.target]! + l.strength;
    m2 += 2 * l.strength;
  }
  if (m2 === 0) return 0;
  const inside = new Map<number, number>();
  const total = new Map<number, number>();
  for (const l of links) {
    const c = memb[l.source]!;
    if (c === memb[l.target]) inside.set(c, (inside.get(c) ?? 0) + l.strength);
  }
  for (let i = 0; i < n; i++) total.set(memb[i]!, (total.get(memb[i]!) ?? 0) + k[i]!);
  let q = 0;
  for (const [c, t] of total) q += (2 * (inside.get(c) ?? 0)) / m2 - (t / m2) ** 2;
  return q;
}

// ─── Figure lines: the selection rules ──────────────────────────────────────

/** Kruskal, strongest first, inside each group: a maximum spanning forest.
 *  With `kind` set, only links of that kind are eligible. Ties go to an
 *  agreeing link, then to the earlier index, so the forest is deterministic. */
function spanningForest(
  n: number,
  links: readonly ObsLink[],
  memb: Int32Array,
  kind?: LinkKind
): number[] {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cur = x;
    while (parent[cur] !== root) {
      const nx = parent[cur]!;
      parent[cur] = root;
      cur = nx;
    }
    return root;
  };
  const order: number[] = [];
  links.forEach((l, i) => {
    if (memb[l.source] === memb[l.target] && (!kind || l.kind === kind)) order.push(i);
  });
  order.sort((a, b) => {
    const la = links[a]!;
    const lb = links[b]!;
    return (
      lb.strength - la.strength ||
      Number(la.kind === 'contradicts') - Number(lb.kind === 'contradicts') ||
      a - b
    );
  });
  const chosen: number[] = [];
  for (const i of order) {
    const l = links[i]!;
    const a = find(l.source);
    const b = find(l.target);
    if (a === b) continue;
    parent[a] = b;
    chosen.push(i);
  }
  return chosen;
}

/** Each star's single strongest link, de-duplicated where two stars pick the same one. */
function strongestTies(n: number, links: readonly ObsLink[]): number[] {
  const best = new Int32Array(n).fill(-1);
  links.forEach((l, i) => {
    for (const v of [l.source, l.target]) {
      const b = best[v]!;
      if (b < 0) {
        best[v] = i;
        continue;
      }
      const cur = links[b]!;
      const stronger =
        l.strength > cur.strength ||
        (l.strength === cur.strength && cur.kind === 'contradicts' && l.kind === 'agrees');
      if (stronger) best[v] = i;
    }
  });
  const set = new Set<number>();
  for (const b of best) if (b >= 0) set.add(b);
  return [...set].sort((a, b) => a - b);
}

// ─── The scene: everything derived once from `data` ────────────────────────

interface Constellation {
  id: number;
  members: number[];
  /** The star the group is named after — its busiest member, name not already taken. */
  alpha: number;
  name: string;
  /** Links inside the group, and how many of them contradict. */
  links: number;
  contradicts: number;
}

interface Scene {
  memb: Int32Array;
  modularity: number;
  constellations: Constellation[];
  lines: Record<View, number[]>;
  maxDegree: number;
  haloFrom: number;
  /** The interquartile range of importance — the reason it is not magnitude. */
  importanceMiddle: { lo: number; hi: number };
}

export function buildScene(data: ObsData): Scene {
  const { nodes, links } = data;
  const n = nodes.length;
  const memb = louvain(n, links);
  const modularity = modularityOf(n, links, memb);

  const groups = new Map<number, number[]>();
  nodes.forEach((node, i) => {
    if (node.degree === 0) return;
    const c = memb[i]!;
    const g = groups.get(c);
    if (g) g.push(i);
    else groups.set(c, [i]);
  });
  const inside = new Map<number, { links: number; contradicts: number }>();
  for (const l of links) {
    const c = memb[l.source]!;
    if (c !== memb[l.target]) continue;
    const e = inside.get(c) ?? { links: 0, contradicts: 0 };
    inside.set(c, {
      links: e.links + 1,
      contradicts: e.contradicts + (l.kind === 'contradicts' ? 1 : 0),
    });
  }
  const busiest = (a: number, b: number): number =>
    nodes[b]!.degree - nodes[a]!.degree || nodes[b]!.importance - nodes[a]!.importance || a - b;

  const used = new Set<string>();
  const constellations: Constellation[] = [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .map(([id, members]) => {
      const ranked = members.slice().sort(busiest);
      const alpha =
        ranked.find((m) => !used.has(cleanLabel(nodes[m]!.label))) ?? ranked[0]!;
      const label = cleanLabel(nodes[alpha]!.label);
      // Every label in this group is already a bigger group's name (the
      // reflection job writes many memories under one heading), so the day
      // the busiest one was written tells them apart — real, and the store's own.
      const name = used.has(label)
        ? `${truncate(label, NAME_CHARS - 8)}, ${format(new Date(nodes[alpha]!.createdAt), 'd MMM')}`
        : label;
      used.add(name);
      const e = inside.get(id) ?? { links: 0, contradicts: 0 };
      return { id, members, alpha, name, links: e.links, contradicts: e.contradicts };
    });

  const degrees = nodes.map((node) => node.degree).sort((a, b) => a - b);
  const maxDegree = degrees[degrees.length - 1] ?? 0;
  const haloFrom = Math.max(1, degrees[Math.floor((1 - HALO_SHARE) * (degrees.length - 1))] ?? 1);

  const importances = nodes.map((node) => node.importance).sort((a, b) => a - b);
  const quartile = (p: number): number => importances[Math.floor(p * (importances.length - 1))] ?? 0;
  const importanceMiddle = { lo: quartile(0.25), hi: quartile(0.75) };

  return {
    memb,
    modularity,
    constellations,
    lines: {
      figures: spanningForest(n, links, memb),
      strongest: strongestTies(n, links),
      disputes: spanningForest(n, links, memb, 'contradicts'),
      every: links.map((_, i) => i),
    },
    maxDegree,
    haloFrom,
    importanceMiddle,
  };
}

// ─── The sky: positions on the chart ───────────────────────────────────────

interface Field {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Tick {
  value: number;
  at: number;
}

interface Sky {
  px: Float64Array;
  py: Float64Array;
  maxShift: number;
  ticksX: Tick[];
  ticksY: Tick[];
}

/** Each value's rank as a 0–1 fraction. Monotone, so order along the axis is kept. */
function rankSpread(values: readonly number[]): Float64Array {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const out = new Float64Array(values.length);
  const last = Math.max(1, values.length - 1);
  order.forEach((i, r) => {
    out[i] = r / last;
  });
  return out;
}

/** Where a raw PCA value lands on a rank-spread axis. */
function rankOf(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo / Math.max(1, sorted.length - 1);
}

/** Push stars nearer than `gap` apart, in fixed order, and report the largest move. */
function separate(px: Float64Array, py: Float64Array, gap: number, passes: number): number {
  const n = px.length;
  const ox = Float64Array.from(px);
  const oy = Float64Array.from(py);
  const cell = gap * 2;
  const keyOf = (x: number, y: number): number =>
    (Math.floor(x / cell) + 1024) * 65536 + (Math.floor(y / cell) + 1024);
  for (let pass = 0; pass < passes; pass++) {
    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const key = keyOf(px[i]!, py[i]!);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(keyOf(px[i]! + dx * cell, py[i]! + dy * cell));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let ddx = px[j]! - px[i]!;
            let ddy = py[j]! - py[i]!;
            let d = Math.hypot(ddx, ddy);
            if (d >= gap) continue;
            if (d < 1e-6) {
              ddx = ((i * 7919) % 13) - 6;
              ddy = ((j * 104729) % 11) - 5;
              d = Math.hypot(ddx, ddy) || 1;
            }
            const push = (gap - d) / 2 / d;
            px[i] = px[i]! - ddx * push;
            py[i] = py[i]! - ddy * push;
            px[j] = px[j]! + ddx * push;
            py[j] = py[j]! + ddy * push;
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.hypot(px[i]! - ox[i]!, py[i]! - oy[i]!));
  return max;
}

function ticksFor(sorted: readonly number[], from: number, span: number, flip: boolean): Tick[] {
  if (sorted.length === 0) return [];
  const lo = Math.ceil(sorted[0]! / TICK_STEP) * TICK_STEP;
  const hi = Math.floor(sorted[sorted.length - 1]! / TICK_STEP) * TICK_STEP;
  const ticks: Tick[] = [];
  for (let v = lo; v <= hi; v += TICK_STEP) {
    const r = rankOf(sorted, v);
    ticks.push({ value: v, at: flip ? from + span - r * span : from + r * span });
  }
  return ticks;
}

export function buildSky(nodes: readonly ObsNode[], field: Field): Sky {
  const n = nodes.length;
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const rx = rankSpread(xs);
  const ry = rankSpread(ys);
  const fw = field.x1 - field.x0;
  const fh = field.y1 - field.y0;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = field.x0 + rx[i]! * fw;
    py[i] = field.y1 - ry[i]! * fh;
  }
  const maxShift = separate(px, py, STAR_GAP, SEPARATION_PASSES);
  for (let i = 0; i < n; i++) {
    px[i] = Math.min(field.x1, Math.max(field.x0, px[i]!));
    py[i] = Math.min(field.y1, Math.max(field.y0, py[i]!));
  }
  const sortedX = xs.slice().sort((a, b) => a - b);
  const sortedY = ys.slice().sort((a, b) => a - b);
  return {
    px,
    py,
    maxShift,
    ticksX: ticksFor(sortedX, field.x0, fw, false),
    ticksY: ticksFor(sortedY, field.y0, fh, true),
  };
}

// ─── Entrance order: each figure grows out of its alpha star ───────────────

interface Growth {
  /** 0–1 per chosen line: when in the entrance it starts drawing. */
  start: Float32Array;
  /** Whether the line draws from its `source` end (else from `target`). */
  fromSource: Uint8Array;
}

export function growthOf(
  n: number,
  links: readonly ObsLink[],
  chosen: readonly number[],
  roots: readonly number[]
): Growth {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const li of chosen) {
    const l = links[li]!;
    adj[l.source]!.push(l.target);
    adj[l.target]!.push(l.source);
  }
  const depth = new Int32Array(n).fill(-1);
  const bfs = (root: number): void => {
    if (depth[root] !== -1) return;
    depth[root] = 0;
    const queue = [root];
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]!;
      for (const w of adj[v]!) {
        if (depth[w] === -1) {
          depth[w] = depth[v]! + 1;
          queue.push(w);
        }
      }
    }
  };
  for (const r of roots) bfs(r);
  for (let i = 0; i < n; i++) if (adj[i]!.length > 0) bfs(i);

  let maxDepth = 1;
  for (const d of depth) if (d > maxDepth) maxDepth = d;
  const start = new Float32Array(chosen.length);
  const fromSource = new Uint8Array(chosen.length);
  chosen.forEach((li, k) => {
    const l = links[li]!;
    const ds = depth[l.source]!;
    const dt = depth[l.target]!;
    fromSource[k] = ds <= dt ? 1 : 0;
    start[k] = Math.min(ds, dt) / maxDepth;
  });
  return { start, fromSource };
}

// ─── Constellation names in the margins ────────────────────────────────────

interface Placed {
  c: Constellation;
  side: 'left' | 'right';
  y: number;
}

export function layoutNames(
  named: readonly Constellation[],
  sky: Sky,
  width: number,
  leftRange: readonly [number, number],
  rightRange: readonly [number, number]
): Placed[] {
  const capacity = (range: readonly [number, number]): number =>
    Math.max(0, Math.floor((range[1] - range[0]) / ROW));
  const left: Constellation[] = [];
  const right: Constellation[] = [];
  for (const c of named) {
    const side = sky.px[c.alpha]! < width / 2 ? left : right;
    const cap = capacity(side === left ? leftRange : rightRange);
    if (side.length < cap) side.push(c);
  }
  const place = (
    bucket: Constellation[],
    range: readonly [number, number],
    side: 'left' | 'right'
  ): Placed[] => {
    const sorted = bucket.slice().sort((a, b) => sky.py[a.alpha]! - sky.py[b.alpha]!);
    const ys = sorted.map((c) =>
      Math.min(range[1] - ROW, Math.max(range[0], sky.py[c.alpha]! - ROW / 2))
    );
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + ROW);
    const over = ys.length ? ys[ys.length - 1]! + ROW - range[1] : 0;
    if (over > 0) {
      ys[ys.length - 1] = ys[ys.length - 1]! - over;
      for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i]!, ys[i + 1]! - ROW);
    }
    return sorted.map((c, i) => ({ c, side, y: ys[i]! }));
  };
  return [...place(left, leftRange, 'left'), ...place(right, rightRange, 'right')];
}

/** A two-segment leader: a stub out of the label, then straight to the ring. */
function leaderPath(p: Placed, sky: Sky, margin: number, width: number): string {
  const ax = sky.px[p.c.alpha]!;
  const ay = sky.py[p.c.alpha]!;
  const y = p.y + 8;
  const x0 = p.side === 'left' ? margin - 10 : width - margin + 10;
  const x1 = p.side === 'left' ? margin + 6 : width - margin - 6;
  const dx = ax - x1;
  const dy = ay - y;
  const d = Math.hypot(dx, dy) || 1;
  const ex = ax - (dx / d) * (RING_R + 1);
  const ey = ay - (dy / d) * (RING_R + 1);
  return `M${x0.toFixed(1)} ${y.toFixed(1)}H${x1.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

// ─── Painting ───────────────────────────────────────────────────────────────

interface PaintState {
  view: View;
  chosen: readonly number[];
  growth: Growth;
  focus: number | null;
  filter: MemoryType | null;
  hover: number;
  selected: number;
  progress: number;
}

function segment(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  f: number
): void {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
  ctx.stroke();
}

function paint(
  canvas: HTMLCanvasElement,
  data: ObsData,
  scene: Scene,
  sky: Sky,
  field: Field,
  st: PaintState
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { nodes, links } = data;
  const { px, py } = sky;
  const { memb, maxDegree, haloFrom } = scene;
  const memory = PLATE_COLORS.memory;
  const starIn = clamp01(st.progress / 0.35);

  // The graticule: fixed PCA values on rank-spread axes, so the spacing is uneven on purpose.
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(PLATE_COLORS.rule, 0.9);
  ctx.beginPath();
  for (const t of sky.ticksX) {
    const x = Math.round(t.at) + 0.5;
    ctx.moveTo(x, field.y0);
    ctx.lineTo(x, field.y1);
  }
  for (const t of sky.ticksY) {
    const y = Math.round(t.at) + 0.5;
    ctx.moveTo(field.x0, y);
    ctx.lineTo(field.x1, y);
  }
  ctx.stroke();

  const typeOk = (i: number): boolean => st.filter === null || nodes[i]!.type === st.filter;
  const focusOk = (i: number): boolean => st.focus === null || memb[i] === st.focus;

  const lineAlpha = (l: ObsLink): number => {
    let a = 1;
    if (!(focusOk(l.source) && focusOk(l.target))) a *= DIM_LINE;
    if (!(typeOk(l.source) && typeOk(l.target))) a *= DIM_LINE;
    return a;
  };
  const drawn = (k: number): number => {
    const s = st.growth.start[k]!;
    return clamp01((st.progress - (0.25 + 0.55 * s)) / 0.2);
  };

  ctx.lineCap = 'round';
  const glowOn = st.view !== 'every';
  // Glow, additive, only where the core has the headroom for it.
  if (glowOn) {
    ctx.globalCompositeOperation = 'lighter';
    st.chosen.forEach((li, k) => {
      const l = links[li]!;
      if (l.step === 0 || lineAlpha(l) < 1) return;
      const f = drawn(k);
      if (f <= 0) return;
      const fromSource = st.growth.fromSource[k] === 1;
      const a = fromSource ? l.source : l.target;
      const b = fromSource ? l.target : l.source;
      ctx.strokeStyle = withAlpha(linkColor(l), GLOW_ALPHA[l.step] * f);
      ctx.lineWidth = GLOW_WIDTH[l.step];
      segment(ctx, px[a]!, py[a]!, px[b]!, py[b]!, f);
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  // Cores: the token colour itself, over whatever the glow lifted. A weak-step
  // core has no glow of its own and only 3.17:1 of headroom, so where it
  // crosses another line's glow band it first strokes the plate back under
  // itself — the surface ring a chart gives an overlapping mark, so it keeps
  // its contrast against the ground rather than against a neighbour's halo.
  const plate = PLATE_COLORS.plate;
  st.chosen.forEach((li, k) => {
    const l = links[li]!;
    const f = drawn(k);
    if (f <= 0) return;
    const alpha = lineAlpha(l);
    const fromSource = st.growth.fromSource[k] === 1;
    const a = fromSource ? l.source : l.target;
    const b = fromSource ? l.target : l.source;
    if (glowOn && l.step === 0 && alpha === 1) {
      ctx.strokeStyle = plate;
      ctx.lineWidth = CORE_WIDTH + 2;
      segment(ctx, px[a]!, py[a]!, px[b]!, py[b]!, f);
    }
    ctx.strokeStyle = alpha < 1 ? withAlpha(linkColor(l), alpha) : linkColor(l);
    ctx.lineWidth = CORE_WIDTH;
    segment(ctx, px[a]!, py[a]!, px[b]!, py[b]!, f);
  });

  // Halos, additive and neutral: the brightest stars get brighter without a new hue.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.degree < haloFrom) continue;
    if (!(focusOk(i) && typeOk(i))) continue;
    const m = Math.sqrt(node.degree / Math.max(1, maxDegree));
    const r = 5 + 9 * m;
    const g = ctx.createRadialGradient(px[i]!, py[i]!, 0, px[i]!, py[i]!, r);
    g.addColorStop(0, withAlpha(memory, HALO_ALPHA * starIn));
    g.addColorStop(1, withAlpha(memory, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px[i]!, py[i]!, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Star cores. Magnitude is degree: radius and alpha, never a hue.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const m = Math.sqrt(node.degree / Math.max(1, maxDegree));
    let alpha = (0.7 + 0.3 * m) * starIn;
    if (!focusOk(i)) alpha *= DIM_STAR;
    if (!typeOk(i)) alpha *= DIM_STAR;
    const live = i === st.hover || i === st.selected;
    const r = 0.8 + 2.4 * m + (live ? 0.6 : 0);
    ctx.fillStyle = live ? PLATE_COLORS.memoryLive : withAlpha(memory, alpha);
    ctx.beginPath();
    ctx.arc(px[i]!, py[i]!, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── The plate ──────────────────────────────────────────────────────────────

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const { nodes, links, stats } = data;
  const scene = useMemo(() => buildScene(data), [data]);

  const margin = width < NARROW ? 0 : Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, width * MARGIN_SHARE));
  const field = useMemo<Field>(() => {
    const gutter = margin || 40;
    return {
      x0: gutter,
      x1: Math.max(gutter + 80, width - gutter),
      y0: Math.min(TOP, height * 0.22),
      y1: Math.max(Math.min(TOP, height * 0.22) + 80, height - Math.min(BOTTOM, height * 0.24)),
    };
  }, [margin, width, height]);
  const sky = useMemo(() => buildSky(nodes, field), [nodes, field]);

  const [view, setView] = useState<View>('figures');
  const [filter, setFilter] = useState<MemoryType | null>(null);
  const [hover, setHover] = useState(-1);
  const [labelFocus, setLabelFocus] = useState<number | null>(null);
  const [entered, setEntered] = useState(reducedMotion);

  const chosen = scene.lines[view];
  const growth = useMemo(
    () => growthOf(nodes.length, links, chosen, scene.constellations.map((c) => c.alpha)),
    [nodes.length, links, chosen, scene.constellations]
  );

  const selected = useMemo(
    () => (selectedId === null ? -1 : nodes.findIndex((node) => node.id === selectedId)),
    [nodes, selectedId]
  );
  const communityOf = (i: number): number | null =>
    i >= 0 && nodes[i]!.degree > 0 ? scene.memb[i]! : null;
  const focus = labelFocus ?? communityOf(hover) ?? communityOf(selected);

  // Names in the margins.
  const named = useMemo(
    () => (margin === 0 ? [] : scene.constellations.filter((c) => c.members.length >= NAME_MIN)),
    [scene.constellations, margin]
  );
  const placed = useMemo(
    () =>
      layoutNames(
        named,
        sky,
        width,
        [field.y0 + 74, field.y1 - 20],
        [PAD + 78, field.y1 - 6]
      ),
    [named, sky, width, field]
  );
  const asterisms = scene.constellations.length - named.length;

  // Counts for the chrome, all from the live selection.
  const agreeing = useMemo(
    () => chosen.reduce((n, li) => n + (links[li]!.kind === 'agrees' ? 1 : 0), 0),
    [chosen, links]
  );
  const keyBlue = chosen.length ? Math.max(2, Math.round((96 * agreeing) / chosen.length)) : 2;
  const keyOrange = Math.max(2, 96 - keyBlue);

  // ── Painting: a ref to the latest closure, so the entrance loop never paints stale state.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(reducedMotion ? 1 : 0);
  const paintRef = useRef<() => void>(() => {});
  useEffect(() => {
    paintRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      paint(canvas, data, scene, sky, field, {
        view,
        chosen,
        growth,
        focus,
        filter,
        hover,
        selected,
        progress: progressRef.current,
      });
    };
    paintRef.current();
  });

  useEffect(() => {
    if (reducedMotion) {
      progressRef.current = 1;
      paintRef.current();
      return;
    }
    if (progressRef.current >= 1) return;
    let frame = 0;
    const began = performance.now();
    const tick = (now: number): void => {
      progressRef.current = clamp01((now - began) / ENTRANCE_MS);
      paintRef.current();
      if (progressRef.current < 1) frame = requestAnimationFrame(tick);
      else setEntered(true);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  // ── Pointer: nearest star within HIT_RADIUS.
  const nearest = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): number => {
      const box = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      let best = -1;
      let bestD = HIT_RADIUS;
      for (let i = 0; i < nodes.length; i++) {
        const d = Math.hypot(sky.px[i]! - x, sky.py[i]! - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    [nodes.length, sky]
  );
  const onMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => setHover(nearest(event)),
    [nearest]
  );
  const onLeave = useCallback(() => setHover(-1), []);
  const onClick = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const i = nearest(event);
      onSelect(i >= 0 ? nodes[i]!.id : null);
    },
    [nearest, nodes, onSelect]
  );

  const callout = hover >= 0 ? hover : selected;
  const calloutNode = callout >= 0 ? nodes[callout]! : null;
  const calloutGroup =
    calloutNode && calloutNode.degree > 0
      ? scene.constellations.find((c) => c.id === scene.memb[callout])
      : undefined;
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const showNotes = width >= 900;
  const settled = entered || reducedMotion;

  return (
    <div className="mc-root">
      <style href="observatory-constellations" precedence="medium">
        {CSS}
      </style>

      <canvas
        ref={canvasRef}
        className="mc-sky"
        width={Math.round(width * dpr)}
        height={Math.round(height * dpr)}
        style={{ width, height, cursor: hover >= 0 ? 'pointer' : 'default' }}
        role="img"
        aria-label={`Star chart of ${nf.format(stats.memories)} memories in ${scene.constellations.length} groups, ${nf.format(chosen.length)} of ${nf.format(stats.linksDrawn)} links drawn as figure lines`}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onClick={onClick}
      />

      {/* Leaders, rings and the graticule's figures — crisp, above the sky, untouchable. */}
      <svg className={`mc-overlay${settled ? ' mc-in' : ''}`} width={width} height={height} aria-hidden>
        {sky.ticksX.map((t) => (
          <text key={`x${t.value}`} x={t.at} y={field.y0 - 8} textAnchor="middle" className="mc-tick">
            {t.value > 0 ? `+${t.value}` : t.value}
          </text>
        ))}
        {sky.ticksY.map((t) => (
          <text key={`y${t.value}`} x={field.x0 - 6} y={t.at + 3.5} textAnchor="end" className="mc-tick">
            {t.value > 0 ? `+${t.value}` : t.value}
          </text>
        ))}
        <text x={field.x0} y={field.y0 - 24} className="mc-tick mc-axis">
          PC 1, each axis spread by rank
        </text>
        <text x={field.x0 - 6} y={field.y0 + 12} textAnchor="end" className="mc-tick mc-axis">
          PC 2
        </text>
        {placed.map((p) => {
          const dim = focus !== null && focus !== p.c.id;
          return (
            <g key={p.c.id} className={dim ? 'mc-lead mc-dim' : 'mc-lead'}>
              <path d={leaderPath(p, sky, margin, width)} />
              <circle cx={sky.px[p.c.alpha]!} cy={sky.py[p.c.alpha]!} r={RING_R} />
            </g>
          );
        })}
        {callout >= 0 ? (
          <circle
            className="mc-live-ring"
            cx={sky.px[callout]!}
            cy={sky.py[callout]!}
            r={RING_R + 2.5}
          />
        ) : null}
      </svg>

      {/* Top-left: title, subtitle, the key as the underline, and the type filter. */}
      <header className="mc-title">
        <h1 className="mc-mast">Memory constellations</h1>
        <div className="mc-caps">A star chart of {nf.format(stats.memories)} memories</div>
        <div className="mc-key" aria-hidden>
          <span style={{ width: keyBlue, background: 'var(--agrees)' }} />
          <span style={{ width: keyOrange, background: 'var(--contradicts)' }} />
        </div>
        <nav className="mc-nav" aria-label="Memory type">
          <button
            type="button"
            className="mc-word"
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            <span>All types</span>
            <span className="mc-count">{nf.format(stats.memories)}</span>
          </button>
          {TYPE_ORDER.map((type) => (
            <button
              key={type}
              type="button"
              className="mc-word"
              aria-pressed={filter === type}
              onClick={() => setFilter(filter === type ? null : type)}
            >
              <span>{type}</span>
              <span className="mc-count">{nf.format(stats.byType[type])}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Top-right: the figures, every one against its denominator. */}
      <div className="mc-figures" style={{ maxWidth: Math.max(240, width - 420) }}>
        <div className="mc-figure">
          <div className="mc-num">{nf.format(stats.memories)}</div>
          <div className="mc-caps">memories</div>
        </div>
        <div className="mc-figure">
          <div className="mc-num">{nf.format(chosen.length)}</div>
          <div className="mc-caps">of {nf.format(stats.linksDrawn)} links</div>
        </div>
        <div className="mc-figure">
          <div className="mc-num">{nf.format(scene.constellations.length)}</div>
          <div className="mc-caps">
            figures, {nf.format(placed.length)} named
          </div>
        </div>
        <div className="mc-figure">
          <div className="mc-num">{nf.format(stats.isolated)}</div>
          <div className="mc-caps">without a link</div>
        </div>
        <span className="mc-pill mc-caps" title="Read once from the running store; it does not stream">
          <span className="mc-dot" aria-hidden />
          Snapshot
        </span>
      </div>

      {/* The margins: constellation names, each a button that lights its figure. */}
      {placed.map((p) => {
        const dim = focus !== null && focus !== p.c.id;
        const share = p.c.links ? Math.round((100 * p.c.contradicts) / p.c.links) : 0;
        return (
          <button
            key={p.c.id}
            type="button"
            className={`mc-name mc-${p.side}${dim ? ' mc-dim' : ''}${settled ? ' mc-in' : ''}${margin < TIGHT ? ' mc-tight' : ''}`}
            style={{ top: p.y, width: margin - PAD - 14 }}
            aria-label={`${p.c.name}: ${p.c.members.length} memories, ${share}% of its links contradict`}
            onPointerEnter={() => setLabelFocus(p.c.id)}
            onPointerLeave={() => setLabelFocus(null)}
            onFocus={() => setLabelFocus(p.c.id)}
            onBlur={() => setLabelFocus(null)}
            onClick={() => onSelect(nodes[p.c.alpha]!.id)}
          >
            <span className="mc-name-text">{truncate(p.c.name, NAME_CHARS)}</span>
            <span className="mc-caps">
              {nf.format(p.c.members.length)} stars, {share}% contradict
            </span>
          </button>
        );
      })}

      {/* Bottom-left: which links become figure lines, and what that leaves out. */}
      <div className="mc-switch">
        <div role="radiogroup" aria-label="Which links become figure lines">
          {VIEWS.map((v) => {
            const active = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={active}
                className="mc-radio"
                title={v.rule}
                onClick={() => setView(v.id)}
              >
                <span className={`mc-radio-dot${active ? ' mc-on' : ''}`} aria-hidden />
                <span className="mc-caps mc-radio-name">{v.name}</span>
                <span className="mc-caps mc-count">{nf.format(scene.lines[v.id].length)}</span>
              </button>
            );
          })}
        </div>
        <p className="mc-caps mc-denominator">
          {nf.format(chosen.length)} of {nf.format(stats.linksDrawn)} links drawn:{' '}
          {nf.format(agreeing)} agree, {nf.format(chosen.length - agreeing)} contradict.{' '}
          {nf.format(stats.linksToArchived)} more stored links point at archived memories.
        </p>
      </div>

      {/* Bottom-right: what was refused, and what the positions are. */}
      {showNotes ? (
        <div className="mc-notes mc-caps">
          <div>
            {scene.constellations.length} groups found in the links at modularity{' '}
            {scene.modularity.toFixed(2)}, named by their busiest memory; {asterisms} too small to name
          </div>
          <div>
            Magnitude is links held, 0 to {stats.degree.max}. Importance runs{' '}
            {scene.importanceMiddle.lo.toFixed(2)} to {scene.importanceMiddle.hi.toFixed(2)} across
            the middle half of memories, too flat to draw
          </div>
          <div>
            PCA 1 and 2 keep {Math.round(stats.explainedVariance * 100)}% of the variance. Stars nudged
            apart by up to {sky.maxShift.toFixed(1)} px
          </div>
        </div>
      ) : null}

      {/* The callout for the star under the pointer, or the selected one. */}
      {calloutNode ? (
        <div
          className="mc-callout"
          style={{
            left: sky.px[callout]! > width - 280 ? undefined : sky.px[callout]! + 14,
            right: sky.px[callout]! > width - 280 ? width - sky.px[callout]! + 14 : undefined,
            top: sky.py[callout]! < 70 ? sky.py[callout]! + 12 : undefined,
            bottom: sky.py[callout]! < 70 ? undefined : height - sky.py[callout]! + 10,
          }}
        >
          <div className="mc-callout-name">{truncate(cleanLabel(calloutNode.label), 48)}</div>
          <div className="mc-caps">
            {calloutNode.type}, {nf.format(calloutNode.degree)} links
            {calloutNode.contradictDegree
              ? `, ${nf.format(calloutNode.contradictDegree)} contradict`
              : ''}
            , {RETENTION_LABEL[calloutNode.retentionBand]}
          </div>
          {calloutGroup ? (
            <div className="mc-caps mc-callout-group">
              in {truncate(calloutGroup.name, NAME_CHARS)}
            </div>
          ) : calloutNode.degree === 0 ? (
            <div className="mc-caps mc-callout-group">a background star, no link</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
.mc-root {
  position: absolute; inset: 0; overflow: hidden;
  font-family: var(--font-instrument); color: var(--ink);
  user-select: none;
}
.mc-sky { position: absolute; left: 0; top: 0; display: block; touch-action: none; }
.mc-overlay {
  position: absolute; left: 0; top: 0; pointer-events: none;
  opacity: 0; transition: opacity 420ms var(--ease);
}
.mc-overlay.mc-in { opacity: 1; }
.mc-tick {
  font-size: 11px; font-weight: 500; font-stretch: 78%;
  fill: var(--ink-3); opacity: 0.85;
}
.mc-axis { letter-spacing: 0.08em; text-transform: uppercase; }
.mc-lead path { fill: none; stroke: var(--ink-3); stroke-width: 1; opacity: 0.55; }
.mc-lead circle { fill: none; stroke: var(--ink-2); stroke-width: 1; }
.mc-lead { transition: opacity var(--dur) var(--ease); }
.mc-lead.mc-dim { opacity: 0.3; }
.mc-live-ring { fill: none; stroke: var(--ink); stroke-width: 1; }

.mc-caps {
  font-size: 11px; font-weight: 500; line-height: 1.3;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3);
}
.mc-count { font-variant-numeric: tabular-nums; }

.mc-title { position: absolute; left: ${PAD}px; top: ${PAD}px; pointer-events: none; }
.mc-mast {
  margin: 0; font-family: var(--font-note); font-weight: 200;
  font-size: 34px; line-height: 1.06; letter-spacing: -0.01em; color: var(--ink);
  white-space: nowrap;
}
.mc-title > .mc-caps { margin-top: 7px; }
.mc-key { display: flex; gap: 2px; height: 1px; margin-top: 10px; }
.mc-key span { display: block; height: 1px; transition: opacity var(--dur) var(--ease); }
.mc-nav { display: flex; flex-direction: column; gap: 2px; margin-top: 18px; pointer-events: auto; }
.mc-word {
  display: flex; align-items: baseline; gap: 10px; height: 17px;
  font-size: 11px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-3); text-align: left;
  transition: color var(--dur) var(--ease);
}
.mc-word:hover { color: var(--ink-2); }
.mc-word[aria-pressed='true'] { color: var(--ink); }

.mc-figures {
  position: absolute; right: ${PAD}px; top: ${PAD}px;
  display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: flex-start;
  row-gap: 10px; pointer-events: none;
}
.mc-figure { padding: 0 16px; border-left: 1px solid var(--rule); }
.mc-figure:first-child { border-left: none; padding-left: 0; }
.mc-num { font-size: 26px; font-weight: 400; line-height: 1.05; color: var(--ink); }
.mc-figure > .mc-caps { margin-top: 5px; white-space: nowrap; }
.mc-pill {
  display: inline-flex; align-items: center; gap: 7px;
  margin-left: 18px; margin-top: 4px; padding: 4px 10px 4px 8px;
  border: 1px solid var(--rule); border-radius: 999px; pointer-events: auto;
}
.mc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--memory); }

.mc-name {
  position: absolute; display: flex; flex-direction: column; gap: 1px;
  text-align: left; pointer-events: auto;
  opacity: 0; transition: opacity 420ms var(--ease), color var(--dur) var(--ease);
}
.mc-name.mc-in { opacity: 1; }
.mc-name.mc-in.mc-dim { opacity: 0.35; }
.mc-left { left: ${PAD}px; }
.mc-right { right: ${PAD}px; text-align: right; align-items: flex-end; }
.mc-name-text {
  font-size: 12.5px; font-weight: 400; line-height: 1.2; color: var(--ink-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
  transition: color var(--dur) var(--ease);
}
.mc-name > .mc-caps { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-stretch: 88%; }
.mc-name.mc-tight > .mc-caps { font-stretch: 78%; letter-spacing: 0.1em; }
.mc-name:hover .mc-name-text, .mc-name:focus-visible .mc-name-text { color: var(--ink); }

.mc-switch { position: absolute; left: ${PAD}px; bottom: ${PAD}px; pointer-events: auto; }
.mc-radio {
  display: flex; align-items: center; gap: 9px; height: 17px;
  color: var(--ink-3); transition: color var(--dur) var(--ease);
}
.mc-radio .mc-caps { color: inherit; }
.mc-radio:hover { color: var(--ink-2); }
.mc-radio[aria-checked='true'] { color: var(--ink); }
.mc-radio-dot {
  width: 7px; height: 7px; border-radius: 50%; box-sizing: border-box;
  border: 1px solid var(--ink-3); transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.mc-radio-dot.mc-on { background: var(--ink); border-color: var(--ink); }
.mc-radio-name { width: 104px; text-align: left; }
.mc-radio .mc-count { width: 42px; text-align: right; }
.mc-denominator { margin: 10px 0 0; max-width: 46ch; }

.mc-notes {
  position: absolute; right: ${PAD}px; bottom: ${PAD}px;
  display: flex; flex-direction: column; gap: 2px;
  text-align: right; max-width: 56ch; pointer-events: none;
}

.mc-callout {
  position: absolute; pointer-events: none; max-width: 264px;
  padding: 7px 10px 8px; background: var(--margin); border: 1px solid var(--rule);
}
.mc-callout-name { font-size: 12.5px; line-height: 1.3; color: var(--ink); overflow-wrap: anywhere; }
.mc-callout > .mc-caps { margin-top: 3px; }
.mc-callout-group { color: var(--ink-2); margin-top: 1px; }

@media (prefers-reduced-motion: reduce) {
  .mc-overlay, .mc-name { transition: none; }
}
`;

export const memoryConstellations: DemoModule = {
  id: 'constellations',
  name: 'Memory Constellations',
  dimension: '2D',
  claim:
    'A star chart joins each group by its fewest, strongest links and lets the rest be background — a principled selection is more legible than every link, and says which it is.',
  Plate,
};
