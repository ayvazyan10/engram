/**
 * SLOT 1 of 3 — two dimensions. Position is computed from the links alone.
 *
 * A seriated arc diagram. Every memory gets one slot on a horizontal axis;
 * every renderable link is one arc springing from that axis — `agrees` above
 * it, `contradicts` below. Nothing is placed by the embedding.
 *
 * ─── Why a seriation and not a force layout ────────────────────────────────
 *
 * A spring simulation of 613 connected memories and 3,099 links is a hairball,
 * and a hairball is worse than the cloud it replaces. So the layout is not a
 * simulation. It is a seriation, in three steps, all from the link structure:
 *
 *   1. Weighted label propagation, restarted six times and kept by best
 *      modularity, partitions the graph. Measured on a snapshot of this
 *      still-growing store: 41 communities over the 613 connected memories at
 *      modularity 0.748, sized 90 / 90 / 89 / 72 / 37 / 23 / … — this graph
 *      genuinely has blocks. Label propagation is chaotic, so the exact
 *      community count moves with the store (41–50 across snapshots) while
 *      the modularity and the 90% within-community share barely do. Every
 *      figure the plate prints is computed live, never typed in.
 *   2. The communities are contracted into a quotient graph and ordered by
 *      its Fiedler vector, so communities that link to each other land
 *      adjacent on the axis.
 *   3. Inside each community, members are ordered by that community's own
 *      Fiedler vector and refined by barycentre passes.
 *
 * That is what keeps 3,099 links legible. After seriation 58% of them span
 * 10 slots or fewer and 92% span 40 or fewer, so the picture is a row of
 * dense, self-contained LOBES rather than a mesh. Around 300 links cross
 * between communities, and only those draw a long arc: at 1920×940 the median
 * within-community arc stands 28px above the axis and the median crossing arc
 * 101px, clearing the local hedge three and a half times over, and crossings
 * are stroked last so a lobe can never bury one. The claim under test is that
 * those few hundred crossings are what was ever really invisible.
 *
 * ─── The rules, and how they are met ───────────────────────────────────────
 *
 * Density is geometry (rule 4): a lobe is dense because arcs pack into it.
 * There is no wash anywhere, and no alpha is spent on density either, so a
 * single arc always sits at its full token colour above the 3:1 mark floor.
 *
 * Contradictions are not buried at the thin end. They own the whole lower
 * half-plane. On this store they are not rare — 1,539 against 1,560, an
 * almost exact half — and splitting the axis is the only treatment that says
 * so at a glance. It also exposes what the counts hide: 459 PAIRS both agree
 * and contradict, drawing a mirrored arc above and below. A lens isolates them.
 *
 * Deliberately not drawn: the embedding (unused — the point of the slot);
 * memory type (96% of links join two of the same type, so it partitions
 * nothing); retention as geometry (564 of 651 in one band, so a radius ramp
 * would be a flat line) — both survive as words in the readout, and rule 5
 * forbids retention on colour regardless. The 5,393 stored links onto
 * archived memories cannot be drawn by anyone; the denominator says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  linkColor,
  type DemoModule,
  type DemoProps,
  type LinkKind,
  type ObsData,
  type ObsNode,
} from './contract';

// ─── Measurements ───────────────────────────────────────────────────────────

/** Reserved bands the arcs never enter, so type never sits on a mark. */
const TOP_WIDE = 30;
const TOP_NARROW = 90;
const BOTTOM_WIDE = 140;
const BOTTOM_NARROW = 152;
/** The left margin that carries the two half-plane keys. */
const GUTTER = 148;
const EDGE = 24;
const NARROW = 780;

/** Arc height = ARC_MIN + (half - ARC_MIN) · (span / maxSpan)^ARC_EXP.
 *  A plain semicircle would make the median arc 4px tall and the longest one
 *  taller than the plate; the exponent lifts short arcs into view and folds
 *  the long tail back inside the box. It is a deliberate distortion and the
 *  note on screen says so. */
const ARC_MIN = 7;
const ARC_EXP = 0.7;

/** Focus dims context with a plate-coloured scrim ABOVE the base layer. This
 *  is a focus state, not an encoding — nothing about density rides on it. */
const SCRIM = 0.78;

const LABEL_PASSES = 40;
const POWER_PASSES = 260;
const BARY_PASSES = 32;
const RESTARTS = 6;
const SEED = 0x9e3779b9;

const nf = new Intl.NumberFormat('en-US');

// ─── Graph seriation ────────────────────────────────────────────────────────

type Adjacency = readonly (readonly (readonly [number, number])[])[];

/** Deterministic PRNG. The store is stable for the life of the page, so the
 *  layout must be too — an unseeded shuffle would move the picture on every
 *  resize, and the owner is comparing pictures. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** Newman-Girvan modularity of a partition. Used as the objective, so which
 *  partition ships is decided by a number rather than by which seed we happened
 *  to type. */
function modularityOf(adjacency: Adjacency, label: Int32Array): number {
  const n = adjacency.length;
  const degree = new Float64Array(n);
  let twiceM = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (const [, wt] of adjacency[i]!) d += wt;
    degree[i] = d;
    twiceM += d;
  }
  if (twiceM === 0) return 0;

  const inside = new Map<number, number>();
  const total = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = label[i]!;
    total.set(c, (total.get(c) ?? 0) + degree[i]!);
    for (const [j, wt] of adjacency[i]!) {
      if (label[j] === c) inside.set(c, (inside.get(c) ?? 0) + wt);
    }
  }

  let q = 0;
  for (const [c, tot] of total) {
    q += (inside.get(c) ?? 0) / twiceM - (tot / twiceM) ** 2;
  }
  return q;
}

/** Weighted label propagation, restarted from several seeds, keeping the
 *  partition with the highest modularity. Label propagation is order-sensitive
 *  and a single run is seed-luck; picking the best of RESTARTS by an explicit
 *  objective makes the answer reproducible and defensible. */
function detectCommunities(adjacency: Adjacency): { label: Int32Array; modularity: number } {
  let best: Int32Array | null = null;
  let bestQ = -Infinity;
  for (let restart = 0; restart < RESTARTS; restart++) {
    const candidate = propagate(adjacency, SEED + restart * 0x85ebca6b);
    const q = modularityOf(adjacency, candidate);
    if (q > bestQ) {
      bestQ = q;
      best = candidate;
    }
  }
  return { label: best ?? new Int32Array(adjacency.length), modularity: bestQ };
}

function propagate(adjacency: Adjacency, seed: number): Int32Array {
  const n = adjacency.length;
  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) label[i] = i;
  const random = seeded(seed);
  const order = Array.from({ length: n }, (_, i) => i);

  for (let pass = 0; pass < LABEL_PASSES; pass++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    let changed = 0;
    for (const v of order) {
      const neighbours = adjacency[v]!;
      if (neighbours.length === 0) continue;
      const weight = new Map<number, number>();
      for (const [w, wt] of neighbours) {
        const l = label[w]!;
        weight.set(l, (weight.get(l) ?? 0) + wt);
      }
      let best = label[v]!;
      let bestWeight = -1;
      for (const [l, wt] of weight) {
        if (wt > bestWeight || (wt === bestWeight && l < best)) {
          best = l;
          bestWeight = wt;
        }
      }
      if (best !== label[v]) {
        label[v] = best;
        changed++;
      }
    }
    if (changed === 0) break;
  }
  return label;
}

/**
 * Order a set of vertices by the Fiedler vector of their induced subgraph.
 *
 * Power iteration on (2·dmax·I − L) with the constant vector deflated out at
 * every step: the shift makes the smallest eigenvalue of L the largest of the
 * shifted matrix, and deflating the null vector leaves the second-smallest —
 * the Fiedler vector. Sorting by it is the classic linear seriation.
 */
function fiedlerOrder(members: readonly number[], adjacency: Adjacency): number[] {
  const n = members.length;
  if (n < 3) return members.slice();

  const local = new Map<number, number>();
  members.forEach((v, i) => local.set(v, i));

  const nb: [number, number][][] = members.map((v) => {
    const out: [number, number][] = [];
    for (const [w, wt] of adjacency[v]!) {
      const j = local.get(w);
      if (j !== undefined) out.push([j, wt]);
    }
    return out;
  });
  const degree = nb.map((list) => list.reduce((sum, [, wt]) => sum + wt, 0));
  const shift = 2 * Math.max(1, ...degree);

  let x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (i % 2 === 0 ? 1 : -1) * (1 + 0.001 * i);

  for (let pass = 0; pass < POWER_PASSES; pass++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i]!;
    mean /= n;
    let norm = 0;
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! - mean;
      norm += x[i]! * x[i]!;
    }
    norm = Math.sqrt(norm) || 1;
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = (shift - degree[i]!) * (x[i]! / norm);
      for (const [j, wt] of nb[i]!) acc += wt * (x[j]! / norm);
      next[i] = acc;
    }
    x = next;
  }

  return members
    .map((v, i) => ({ v, key: x[i]!, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((entry) => entry.v);
}

/** Barycentre crossing reduction: repeatedly move each vertex to the weighted
 *  mean of its neighbours' positions and re-sort. Converges quickly and only
 *  ever improves on the spectral order it is handed. */
function barycentre(order: readonly number[], adjacency: Adjacency): number[] {
  let current = order.slice();
  let position = new Map<number, number>(current.map((v, i) => [v, i]));

  for (let pass = 0; pass < BARY_PASSES; pass++) {
    const keyed = current.map((v, i) => {
      let sum = 0;
      let weight = 0;
      for (const [w, wt] of adjacency[v]!) {
        const p = position.get(w);
        if (p === undefined) continue;
        sum += p * wt;
        weight += wt;
      }
      return { v, key: weight > 0 ? sum / weight : i, i };
    });
    keyed.sort((a, b) => a.key - b.key || a.i - b.i);
    current = keyed.map((entry) => entry.v);
    position = new Map(current.map((v, i) => [v, i]));
  }
  return current;
}

// ─── The laid-out graph ─────────────────────────────────────────────────────

interface Arc {
  readonly a: number;
  readonly b: number;
  readonly span: number;
  readonly up: boolean;
  readonly kind: LinkKind;
  readonly step: 0 | 1 | 2;
  readonly crossing: boolean;
  readonly ambivalent: boolean;
}

interface Block {
  readonly from: number;
  readonly to: number;
  readonly isolated: boolean;
}

interface Layout {
  readonly order: Int32Array;
  readonly slotOf: Int32Array;
  readonly communityOf: Int32Array;
  readonly communitySize: Int32Array;
  readonly blocks: readonly Block[];
  readonly arcs: readonly Arc[];
  readonly arcsOf: readonly (readonly number[])[];
  readonly ambivalentNeighbours: Int32Array;
  readonly maxSpan: number;
  readonly communities: number;
  readonly modularity: number;
  readonly withinPercent: number;
  readonly counts: { all: number; crossing: number; ambivalent: number };
  readonly ambivalentPairs: number;
}

function buildLayout(data: ObsData): Layout {
  const nodes = data.nodes;
  const n = nodes.length;

  // Unique connections. A pair can carry one link of each kind — 459 of them
  // do — so the pair is what the community algorithm weighs, while the ARC is
  // still one per link so nothing is aggregated away.
  const pairs = new Map<number, { a: number; b: number; weight: number; both: boolean }>();
  for (const link of data.links) {
    if (link.source === link.target) continue;
    const a = Math.min(link.source, link.target);
    const b = Math.max(link.source, link.target);
    const key = a * n + b;
    const entry = pairs.get(key);
    if (entry) {
      entry.weight++;
      entry.both = true;
    } else {
      pairs.set(key, { a, b, weight: 1, both: false });
    }
  }

  const adjacency: [number, number][][] = Array.from({ length: n }, () => []);
  for (const pair of pairs.values()) {
    adjacency[pair.a]!.push([pair.b, pair.weight]);
    adjacency[pair.b]!.push([pair.a, pair.weight]);
  }

  const { label, modularity } = detectCommunities(adjacency);
  const grouped = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (adjacency[i]!.length === 0) continue;
    const l = label[i]!;
    const list = grouped.get(l);
    if (list) list.push(i);
    else grouped.set(l, [i]);
  }

  const communities = [...grouped.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  const communityOf = new Int32Array(n).fill(-1);
  communities.forEach((members, id) => members.forEach((v) => (communityOf[v] = id)));
  const communitySize = Int32Array.from(communities.map((m) => m.length));

  // Order the communities themselves by the Fiedler vector of the quotient
  // graph, so a link that leaves a community lands nearby rather than across
  // the plate. Measured: this alone cuts links spanning >100 slots from 7.5%
  // to 5.6%, and the mean span from 28.3 to 21.9.
  const quotient: [number, number][][] = communities.map(() => []);
  const quotientWeight = communities.map(() => new Map<number, number>());
  for (const pair of pairs.values()) {
    const ca = communityOf[pair.a]!;
    const cb = communityOf[pair.b]!;
    if (ca < 0 || cb < 0 || ca === cb) continue;
    quotientWeight[ca]!.set(cb, (quotientWeight[ca]!.get(cb) ?? 0) + pair.weight);
    quotientWeight[cb]!.set(ca, (quotientWeight[cb]!.get(ca) ?? 0) + pair.weight);
  }
  quotientWeight.forEach((m, i) => {
    quotient[i] = [...m.entries()];
  });
  const communityOrder = fiedlerOrder(
    communities.map((_, i) => i),
    quotient
  );

  // Slots: communities in that order, seriated inside, then the memories with
  // no link at all — kept, placed, and labelled rather than dropped.
  const order: number[] = [];
  const blocks: Block[] = [];
  for (const id of communityOrder) {
    const members = communities[id]!;
    const from = order.length;
    const seriated =
      members.length > 2 ? barycentre(fiedlerOrder(members, adjacency), adjacency) : members.slice();
    for (const v of seriated) order.push(v);
    blocks.push({ from, to: order.length - 1, isolated: false });
  }
  const isolatedFrom = order.length;
  for (let i = 0; i < n; i++) if (adjacency[i]!.length === 0) order.push(i);
  if (order.length > isolatedFrom) {
    blocks.push({ from: isolatedFrom, to: order.length - 1, isolated: true });
  }

  const slotOf = new Int32Array(n);
  order.forEach((v, slot) => (slotOf[v] = slot));

  // Arcs: one per renderable link. Nothing aggregated, nothing dropped.
  const arcs: Arc[] = [];
  const arcsOf: number[][] = Array.from({ length: n }, () => []);
  const ambivalentNeighbours = new Int32Array(n);
  let crossingCount = 0;
  let ambivalentCount = 0;

  for (const link of data.links) {
    if (link.source === link.target) continue;
    const lo = Math.min(link.source, link.target);
    const hi = Math.max(link.source, link.target);
    const both = pairs.get(lo * n + hi)?.both ?? false;
    const a = slotOf[link.source]!;
    const b = slotOf[link.target]!;
    const crossing = communityOf[link.source] !== communityOf[link.target];
    const index = arcs.length;
    arcs.push({
      a,
      b,
      span: Math.abs(a - b),
      up: link.kind === 'agrees',
      kind: link.kind,
      step: link.step,
      crossing,
      ambivalent: both,
    });
    arcsOf[link.source]!.push(index);
    arcsOf[link.target]!.push(index);
    if (crossing) crossingCount++;
    if (both) ambivalentCount++;
  }
  for (const pair of pairs.values()) {
    if (!pair.both) continue;
    ambivalentNeighbours[pair.a] = ambivalentNeighbours[pair.a]! + 1;
    ambivalentNeighbours[pair.b] = ambivalentNeighbours[pair.b]! + 1;
  }

  let maxSpan = 1;
  for (const arc of arcs) if (arc.span > maxSpan) maxSpan = arc.span;
  const within = arcs.length - crossingCount;

  return {
    order: Int32Array.from(order),
    slotOf,
    communityOf,
    communitySize,
    blocks,
    arcs,
    arcsOf,
    ambivalentNeighbours,
    maxSpan,
    communities: communities.length,
    modularity,
    withinPercent: arcs.length ? Math.round((within / arcs.length) * 100) : 0,
    counts: { all: arcs.length, crossing: crossingCount, ambivalent: ambivalentCount },
    ambivalentPairs: ambivalentCount / 2,
  };
}

// ─── Pixel geometry ─────────────────────────────────────────────────────────

interface Geometry {
  readonly xs: Float32Array;
  readonly lut: Int32Array;
  readonly axisY: number;
  readonly half: number;
  readonly step: number;
  readonly left: number;
  readonly right: number;
  readonly topStrip: number;
  readonly bottomStrip: number;
}

function geometryFor(layout: Layout, width: number, height: number, narrow: boolean): Geometry {
  const slots = layout.order.length;
  const left = narrow ? EDGE : GUTTER;
  const gap = Math.max(1, Math.min(4, width / 460));
  const gaps = Math.max(0, layout.blocks.length - 1) * gap;
  const step = Math.max(0.35, (width - left - EDGE - gaps) / Math.max(1, slots));

  const xs = new Float32Array(slots);
  let x = left;
  layout.blocks.forEach((block, i) => {
    if (i > 0) x += gap;
    for (let slot = block.from; slot <= block.to; slot++) {
      xs[slot] = x + step / 2;
      x += step;
    }
  });

  const topStrip = narrow ? TOP_NARROW : TOP_WIDE;
  const bottomStrip = Math.min(
    narrow ? BOTTOM_NARROW : BOTTOM_WIDE,
    Math.max(52, Math.round(height * 0.34))
  );
  const axisY = topStrip + (height - topStrip - bottomStrip) / 2;
  const half = Math.max(20, (height - topStrip - bottomStrip) / 2 - 8);

  // Pixel → slot, so a 2.6px-wide column still has a hit target the full
  // height of the plate. Contract rule 8's 24px is met by the column, not the
  // mark.
  const lut = new Int32Array(Math.max(1, Math.ceil(width)));
  let slot = 0;
  for (let px = 0; px < lut.length; px++) {
    while (slot < slots - 1 && px > (xs[slot]! + xs[slot + 1]!) / 2) slot++;
    lut[px] = slot;
  }

  return { xs, lut, axisY, half, step, left, right: width - EDGE, topStrip, bottomStrip };
}

function arcHeight(span: number, maxSpan: number, half: number): number {
  if (span <= 0) return Math.min(ARC_MIN, half);
  const t = Math.min(1, span / maxSpan);
  return Math.min(half, ARC_MIN + (half - ARC_MIN) * Math.pow(t, ARC_EXP));
}

// ─── Painting ───────────────────────────────────────────────────────────────

type Lens = 'all' | 'crossing' | 'ambivalent';

function passes(lens: Lens, arc: Arc): boolean {
  if (lens === 'crossing') return arc.crossing;
  if (lens === 'ambivalent') return arc.ambivalent;
  return true;
}

function traceArc(ctx: CanvasRenderingContext2D, arc: Arc, geo: Geometry, maxSpan: number): void {
  const xa = geo.xs[arc.a]!;
  const xb = geo.xs[arc.b]!;
  const h = arcHeight(arc.span, maxSpan, geo.half);
  ctx.moveTo(xa, geo.axisY);
  ctx.quadraticCurveTo((xa + xb) / 2, geo.axisY + (arc.up ? -2 : 2) * h, xb, geo.axisY);
}

const KINDS: readonly LinkKind[] = ['agrees', 'contradicts'];
const STEPS: readonly (0 | 1 | 2)[] = [0, 1, 2];

/**
 * Stroke a set of arcs, bucketed by the six token colours so three thousand
 * curves cost six stroke calls. Weakest step first, so the strong links finish
 * on top. Every arc is drawn at its full token colour — no alpha is spent on
 * density, which is what keeps a single link above the 3:1 mark floor.
 */
function strokeArcs(
  ctx: CanvasRenderingContext2D,
  arcs: readonly Arc[],
  geo: Geometry,
  maxSpan: number,
  lineWidth: number
): void {
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  for (const step of STEPS) {
    for (const kind of KINDS) {
      ctx.beginPath();
      let drew = false;
      for (const arc of arcs) {
        if (arc.step !== step || arc.kind !== kind) continue;
        traceArc(ctx, arc, geo, maxSpan);
        drew = true;
      }
      if (!drew) continue;
      ctx.strokeStyle = linkColor({ kind, step });
      ctx.stroke();
    }
  }
}

/** The axis, then every arc the current lens keeps. */
function paintBase(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  geo: Geometry,
  lens: Lens,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);

  // One bar per community; the memories that join nothing drawn as separated
  // marks in the memory colour — the one place a memory at rest appears, and
  // the honest shape of "there is no link here to draw".
  for (const block of layout.blocks) {
    const from = geo.xs[block.from]! - geo.step / 2;
    const to = geo.xs[block.to]! + geo.step / 2;
    if (block.isolated) {
      ctx.fillStyle = PLATE_COLORS.memory;
      for (let slot = block.from; slot <= block.to; slot++) {
        ctx.fillRect(geo.xs[slot]! - 0.5, geo.axisY - 1, 1, 2);
      }
    } else {
      ctx.fillStyle = PLATE_COLORS.rule;
      ctx.fillRect(from, geo.axisY - 1, Math.max(1, to - from), 2);
    }
  }

  // Within-community arcs first, crossings on top. A lobe saturates — that is
  // what its density looks like — and a crossing entering it would otherwise
  // be buried under the very hedge it is trying to be distinguished from.
  const visible = layout.arcs.filter((arc) => passes(lens, arc));
  strokeArcs(ctx, visible.filter((arc) => !arc.crossing), geo, layout.maxSpan, 1);
  strokeArcs(ctx, visible.filter((arc) => arc.crossing), geo, layout.maxSpan, 1);
}

/** The focus layer. Context is dimmed by a scrim ABOVE the base, the focused
 *  memory's own links are restated at full colour, and its neighbours are
 *  marked on the axis so "what connects to what" is answerable by eye. */
function paintFocus(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  geo: Geometry,
  lens: Lens,
  focusIndex: number,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);
  if (focusIndex < 0) return;

  ctx.globalAlpha = SCRIM;
  ctx.fillStyle = PLATE_COLORS.plate;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  const slot = layout.slotOf[focusIndex]!;
  const x = geo.xs[slot]!;

  ctx.strokeStyle = PLATE_COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, geo.topStrip);
  ctx.lineTo(x, height - geo.bottomStrip);
  ctx.stroke();

  const mine = layout.arcsOf[focusIndex]!
    .map((i) => layout.arcs[i]!)
    .filter((arc) => passes(lens, arc));
  strokeArcs(ctx, mine, geo, layout.maxSpan, 1.75);

  ctx.fillStyle = PLATE_COLORS.memory;
  for (const arc of mine) {
    const other = arc.a === slot ? arc.b : arc.a;
    ctx.beginPath();
    ctx.arc(geo.xs[other]!, geo.axisY, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = PLATE_COLORS.memoryLive;
  ctx.beginPath();
  ctx.arc(x, geo.axisY, 3.4, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Local stylesheet ───────────────────────────────────────────────────────

/** Scoped to this demo's own class prefix, rendered inside its own subtree, so
 *  it cannot reach another demo. Inline styles cannot express :hover, and the
 *  design owes its controls a real hover state. */
const CSS = `
.lbl-root { position: absolute; inset: 0; overflow: hidden; cursor: crosshair; }
.lbl-root:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.lbl-canvas { position: absolute; top: 0; left: 0; }
.lbl-layer { position: absolute; inset: 0; pointer-events: none; }

.lbl-lens { position: absolute; display: flex; flex-wrap: wrap; gap: 1px;
  background: var(--rule); pointer-events: auto; }
.lbl-lens button { display: flex; align-items: baseline; gap: 7px; padding: 3px 10px 4px;
  background: var(--plate); color: var(--ink-3); cursor: pointer;
  transition: color var(--dur) var(--ease); }
.lbl-lens button:hover { color: var(--ink-2); }
.lbl-lens button[aria-pressed='true'] { background: var(--rule); color: var(--ink); }
.lbl-lens-n { font-variant-numeric: tabular-nums; font-size: var(--t-label); color: inherit; }

.lbl-key { position: absolute; display: flex; align-items: stretch; gap: 7px;
  max-width: 114px; }
.lbl-key-bar { width: 3px; min-height: 13px; flex: 0 0 auto; }
.lbl-key-n { font-variant-numeric: tabular-nums; color: var(--ink-2);
  font-size: var(--t-figure); font-weight: 500; line-height: 1.2; }
.lbl-isolates { position: absolute; white-space: nowrap; }

.lbl-foot { position: absolute; left: 24px; right: 24px; bottom: 12px; display: flex;
  align-items: flex-end; justify-content: space-between; gap: var(--gap-section); }
.lbl-foot p { margin: 0; }
.lbl-note { flex: 1 1 auto; min-width: 0; }
.lbl-prose { max-width: 76ch; }
.lbl-denom { margin-top: 5px; }
.lbl-read { flex: 0 1 auto; max-width: 380px; text-align: right; }
.lbl-read-label { font-family: var(--font-note); font-weight: 300; font-size: var(--t-claim);
  line-height: 1.34; color: var(--ink); overflow: hidden; display: -webkit-box;
  -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.lbl-read-row { display: flex; align-items: center; justify-content: flex-end;
  flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; }
.lbl-read-pair { display: flex; align-items: center; gap: 5px; }
.lbl-hint { color: var(--ink-3); }

@media (max-width: 780px) {
  .lbl-foot { flex-direction: column; align-items: flex-start; gap: var(--gap-block); }
  .lbl-read { text-align: left; max-width: none; }
  .lbl-key { max-width: none; }
  .lbl-read-row { justify-content: flex-start; }
}
`;
// ─── Small parts ────────────────────────────────────────────────────────────

/** A 3px bar in a link identity's own token. The only decoration in the demo,
 *  and it is doing a job: it is the legend. */
function Swatch({ kind, height }: { kind: LinkKind; height?: number }) {
  return (
    <span
      className="lbl-key-bar"
      style={height ? { background: `var(--${kind})`, height, minHeight: height } : { background: `var(--${kind})` }}
      aria-hidden
    />
  );
}

/** Names one half-plane in the margin, at the height the axis divides them, so
 *  the plate teaches its own colours without spending a block on a legend. */
function HalfPlaneKey({
  kind,
  count,
  style,
}: {
  kind: LinkKind;
  count: number;
  style: React.CSSProperties;
}) {
  return (
    <div className="lbl-key" style={style}>
      <Swatch kind={kind} />
      <span>
        <span className="obs-label" style={{ display: 'block' }}>
          {kind === 'agrees' ? 'Agrees, above' : 'Contradicts, below'}
        </span>
        <span className="lbl-key-n">{nf.format(count)}</span>
      </span>
    </div>
  );
}

function Tally({ kind, value, word }: { kind: LinkKind; value: number; word: string }) {
  return (
    <span className="lbl-read-pair">
      <Swatch kind={kind} height={11} />
      <span className="obs-figure">{value}</span>
      <span className="obs-label">{word}</span>
    </span>
  );
}

// ─── Readout ────────────────────────────────────────────────────────────────

/**
 * What one memory is and what it joins. Type and retention appear here as
 * WORDS, which is the whole of their treatment: 96% of links join two
 * memories of the same type and 564 of 651 memories sit in one retention
 * band, so neither would survive being put on a visual channel — and contract
 * rule 5 forbids retention on colour in any case.
 */
function Readout({
  node,
  communitySize,
  bothWays,
}: {
  node: ObsNode;
  communitySize: number;
  bothWays: number;
}) {
  return (
    <>
      <p className="lbl-read-label">{node.label}</p>
      <div className="lbl-read-row">
        <span className="obs-label">
          {node.type} ·{' '}
          {node.degree === 0
            ? 'joins nothing at all'
            : `one of ${nf.format(communitySize)} in its community`}{' '}
          · {RETENTION_LABEL[node.retentionBand]} at {Math.round(node.retention * 100)}%
        </span>
      </div>
      {node.degree > 0 ? (
        <div className="lbl-read-row">
          <Tally kind="agrees" value={node.agreeDegree} word="agree" />
          <Tally kind="contradicts" value={node.contradictDegree} word="contradict" />
          {bothWays > 0 ? (
            <span className="obs-label">
              {bothWays} {bothWays === 1 ? 'neighbour does' : 'neighbours do'} both
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

const LENSES: readonly { id: Lens; name: string }[] = [
  { id: 'all', name: 'All links' },
  { id: 'crossing', name: 'Crossing communities' },
  { id: 'ambivalent', name: 'Both ways' },
];

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const layout = useMemo(() => buildLayout(data), [data]);
  const narrow = width < NARROW;
  const geo = useMemo(
    () => geometryFor(layout, width, height, narrow),
    [layout, width, height, narrow]
  );

  const [lens, setLens] = useState<Lens>('all');
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const focusRef = useRef<HTMLCanvasElement | null>(null);

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return data.nodes.findIndex((node) => node.id === selectedId);
  }, [data, selectedId]);

  const focusSlot =
    hoverSlot ?? (selectedIndex >= 0 ? (layout.slotOf[selectedIndex] ?? null) : null);
  const focusIndex = focusSlot === null ? -1 : (layout.order[focusSlot] ?? -1);
  const focusNode = focusIndex >= 0 ? (data.nodes[focusIndex] ?? null) : null;

  const dpr = typeof devicePixelRatio === 'number' ? Math.min(2, devicePixelRatio) : 1;

  // Resizing a canvas reallocates its backing store, so only do it when the
  // box actually changed — the focus layer repaints on every pointer move.
  const context = useCallback(
    (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
      if (!canvas) return null;
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    },
    [width, height, dpr]
  );

  useEffect(() => {
    const ctx = context(baseRef.current);
    if (ctx) paintBase(ctx, layout, geo, lens, width, height);
  }, [context, layout, geo, lens, width, height]);

  useEffect(() => {
    const ctx = context(focusRef.current);
    if (ctx) paintFocus(ctx, layout, geo, lens, focusIndex, width, height);
  }, [context, layout, geo, lens, focusIndex, width, height]);

  const slotAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect): number | null => {
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (y < geo.topStrip || y > height - geo.bottomStrip) return null;
      if (x < geo.left - geo.step || x > geo.right + geo.step) return null;
      const px = Math.max(0, Math.min(geo.lut.length - 1, Math.round(x)));
      return geo.lut[px] ?? null;
    },
    [geo, height]
  );

  const onMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHoverSlot(slotAt(event.clientX, event.clientY, rect));
    },
    [slotAt]
  );

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const slot = slotAt(event.clientX, event.clientY, rect);
      const index = slot === null ? -1 : (layout.order[slot] ?? -1);
      const node = index >= 0 ? data.nodes[index] : undefined;
      onSelect(!node || node.id === selectedId ? null : node.id);
    },
    [slotAt, layout, data, selectedId, onSelect]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const slots = layout.order.length;
      const at = focusSlot ?? 0;
      const stride = event.shiftKey ? 10 : 1;
      let next: number | null = null;
      if (event.key === 'ArrowRight') next = Math.min(slots - 1, at + stride);
      else if (event.key === 'ArrowLeft') next = Math.max(0, at - stride);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = slots - 1;
      else if (event.key === 'Enter' || event.key === ' ') {
        const node = focusIndex >= 0 ? data.nodes[focusIndex] : undefined;
        if (node) {
          event.preventDefault();
          onSelect(node.id === selectedId ? null : node.id);
        }
        return;
      } else if (event.key === 'Escape') {
        setHoverSlot(null);
        onSelect(null);
        return;
      } else return;
      event.preventDefault();
      setHoverSlot(next);
    },
    [layout, focusSlot, focusIndex, data, selectedId, onSelect]
  );

  const drawn = layout.counts[lens];

  return (
    <div
      className="lbl-root"
      tabIndex={0}
      role="group"
      aria-label={`Arc diagram. ${nf.format(data.stats.memories)} memories ordered by their link structure into ${layout.communities} communities, with ${nf.format(layout.counts.all)} links drawn as arcs — agrees above the axis, contradicts below. Use the left and right arrow keys to move along the axis.`}
      onPointerMove={onMove}
      onPointerLeave={() => setHoverSlot(null)}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <style>{CSS}</style>
      <canvas ref={baseRef} className="lbl-canvas" style={{ width, height }} aria-hidden />
      <canvas ref={focusRef} className="lbl-canvas" style={{ width, height }} aria-hidden />

      <div className="lbl-layer">
        <div
          className="lbl-lens"
          role="group"
          aria-label="Which links are drawn"
          style={narrow ? { top: 40, left: EDGE } : { top: 8, right: EDGE }}
        >
          {LENSES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === lens}
              onClick={(event) => {
                event.stopPropagation();
                setLens(option.id);
              }}
            >
              <span className="obs-label" style={{ color: 'inherit' }}>
                {option.name}
              </span>
              <span className="lbl-lens-n">
                {option.id === 'ambivalent'
                  ? `${nf.format(layout.ambivalentPairs)} pairs`
                  : nf.format(layout.counts[option.id])}
              </span>
            </button>
          ))}
        </div>

        <HalfPlaneKey
          kind="agrees"
          count={data.stats.agrees}
          style={narrow ? { left: EDGE, top: 6 } : { left: EDGE, bottom: height - geo.axisY + 9 }}
        />
        <HalfPlaneKey
          kind="contradicts"
          count={data.stats.contradicts}
          style={narrow ? { left: EDGE + 152, top: 6 } : { left: EDGE, top: geo.axisY + 9 }}
        />

        {/* The memories that join nothing hold their own stretch at the right
            of the axis. It is empty above and below because there is genuinely
            nothing there to draw. */}
        {!narrow && data.stats.isolated > 0 ? (
          <div
            className="lbl-isolates obs-label"
            style={{ right: EDGE, top: geo.axisY - 24, textAlign: 'right' }}
          >
            {nf.format(data.stats.isolated)} with no link
          </div>
        ) : null}

        <footer className="lbl-foot">
          <div className="lbl-note">
            <p className="obs-note lbl-prose">
              Position is the link structure and nothing else: {layout.communities} communities found
              in the graph itself, ordered so that what connects sits close, {layout.withinPercent}%
              of links staying inside one. Distance here is not similarity — the embedding is unused
              — and arc height is span along the axis, compressed so neighbours stay visible.
            </p>
            <p className="obs-label lbl-denom">
              {nf.format(drawn)} of {nf.format(data.stats.linksDrawn)} renderable links drawn ·{' '}
              {nf.format(data.stats.linksToArchived)} more of the {nf.format(data.stats.linksStored)}{' '}
              stored point at archived memories and can be drawn by no one ·{' '}
              {nf.format(data.stats.isolated)} of {nf.format(data.stats.memories)} memories have no
              link at all
            </p>
          </div>

          <div
            className="lbl-read"
            aria-live="polite"
            style={{
              opacity: focusNode ? 1 : 0.72,
              transform: focusNode ? 'translateY(0)' : 'translateY(3px)',
              transition: reducedMotion
                ? 'none'
                : 'opacity var(--dur) var(--ease), transform var(--dur) var(--ease)',
            }}
          >
            {focusNode ? (
              <Readout
                node={focusNode}
                communitySize={layout.communitySize[layout.communityOf[focusIndex]!] ?? 0}
                bothWays={layout.ambivalentNeighbours[focusIndex] ?? 0}
              />
            ) : narrow ? null : (
              <p className="obs-label lbl-hint">
                Point anywhere along the axis, or press the left and right arrow keys, to follow one
                memory&rsquo;s links. {nf.format(layout.ambivalentPairs)} pairs of memories both
                agree with and contradict each other; the third lens keeps only those.
              </p>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export const laidOutByLink: DemoModule = {
  id: 'by-link',
  name: 'Ordered by link',
  dimension: '2D',
  claim:
    'Laid out from the links alone, this store is not one cloud but dozens of tight communities that keep nine of every ten links inside themselves — so the connections that were ever genuinely invisible are the few hundred crossing between them, and those are the ones this puts in plain sight.',
  Plate,
};
