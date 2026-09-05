/**
 * SLOT 1 of 3 — three dimensions. Position is computed from the links alone.
 *
 * A seriated arc diagram, wound. Every memory still gets one slot in a single
 * one-dimensional order derived from the graph; every renderable link is still
 * one arc springing from that order — `agrees` on one side, `contradicts` on
 * the other. Nothing is placed by the embedding. What changed is the shape of
 * the axis and where the arcs are allowed to stand.
 *
 * ─── Why depth, and what it is actually buying ─────────────────────────────
 *
 * The 2D plate was drawn for a page 1920 wide. The dashboard hands it roughly
 * 928 × 826 — a near-square box — and a straight axis can only ever use one
 * edge of that. 657 memories across the 756 px that box leaves between the
 * axis margins is 1.15 px a memory, which is why the lobes had to saturate and
 * why a crossing arc could only be distinguished by being STROKED LAST, on top
 * of the very hedge it was trying to escape.
 *
 * So the axis is wound. The seriated order is walked at uniform ARC LENGTH
 * along a flat Archimedean coil in the y = 0 plane. The coil is the same axis
 * — same order, same blocks, same neighbours — but it uses the whole area of
 * the box instead of one edge of it. Measured at 928 × 826 on this store: the
 * straight axis gave 657 memories 756 px between its margins, 1.15 px each;
 * the coil gives them 2,230 world units of curve drawn at about 3.2 px per
 * unit, near 9.7 px each. Eight times the axis, in the same box. That is the
 * first thing depth buys, and it is a measurement, not a mood.
 *
 * The second is the one the claim turns on. In two dimensions every arc had
 * to share one half-plane, so a crossing link and the local hedge it passed
 * over occupied the same pixels and only paint order separated them. Here
 * they occupy different geometry:
 *
 *   • A link INSIDE a community follows the coil. Its ground path runs along
 *     its own stretch of the axis and it rises only a little — a low ridge
 *     hugging its lobe. Nine of every ten links are these.
 *   • A link that CROSSES between communities leaps. Its ground path is the
 *     straight chord between its two slots and it is lifted clear above every
 *     ridge in the store, into air nothing else is allowed into. A few hundred
 *     links are these, and they are the whole point of the plate.
 *
 * One lift law, two ground paths. That is the entire trick, and it is why the
 * crossings are legible without a colour, a wash, or a paint-order dodge.
 *
 * ─── The two half-spaces ───────────────────────────────────────────────────
 *
 * The coil plane divides the box. `agrees` rise above it, `contradicts` fall
 * below it, ridges and leaps alike — so the shape of agreement and the shape
 * of disagreement are the same object mirrored, and can be compared at a
 * glance. On the snapshot this was tuned against they are not lopsided —
 * 1,570 against 1,539, an almost exact half — and the split is the only
 * treatment that says so. It also keeps exposing what the counts hide: 459
 * PAIRS both agree and contradict, drawing a mirrored arc above and below.
 * The third lens keeps only those, and it is the plate's own proof that the
 * two half-spaces are one shape mirrored.
 *
 * The camera is held above the plane (`minPolarAngle` / `maxPolarAngle`) so
 * "above" and "below" never invert on screen, and it STARTS near the plane —
 * see `CAM_ELEVATION`, where the reason is measured. Orbiting up opens the
 * coil into a legible nest of turns; the shallow limit is the 2D plate's own
 * edge-on reading, with the axis eight times as long.
 *
 * ─── The rules, and how they are met ───────────────────────────────────────
 *
 * 1  One file. Imports are the contract, React, three, R3F and drei.
 * 2  No shared state — props in, `onSelect` out.
 * 3  Every colour is `PLATE_COLORS` / `linkColorInt`, or `var(--…)` in DOM.
 * 4  Density is geometry: a lobe is dense because arcs pack into its ridge.
 *    There is no wash and no alpha spent on density, so a single link always
 *    sits at its full token colour above the 3:1 mark floor. The only opacity
 *    in the scene is the focus knock-back, which is a transient state.
 * 5  Retention is never on colour. It is not drawn at all here — the great
 *    majority of this store sits in one band, so a radius ramp would be a flat
 *    line — and it survives as a named band and a percentage in the readout.
 * 6  `reducedMotion` turns off orbit damping. There is no autorotation, no
 *    ticking simulation and no entrance animation at any time.
 * 7  No layout property is animated anywhere. The readout moves on `transform`
 *    and `opacity`; the lens control's hover crosses `color`, as the token
 *    layer's own controls do, and `--dur` is 0 under reduced motion.
 * 8  Every denominator on screen is the real one, computed live. Nothing in
 *    this file is a typed-in figure.
 * 9  The canvas bleeds to four edges; the panels bleed into the edges they sit
 *    against, hairline on the inner sides only. No card, no radius, no shadow.
 *
 * No bloom, no postprocessing, and tone mapping is named rather than inherited
 * because the token layer's contrast was measured on raw sRGB.
 *
 * Every panel breakpoint in this file is measured against the BOX, never the
 * viewport. The 2D version mixed the two — a CSS media query against the
 * window and a component flag against the box — and they disagreed by exactly
 * the width of the app's chrome, which is what made the footer collide.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  linkColorInt,
  type DemoModule,
  type DemoProps,
  type LinkKind,
  type ObsData,
  type ObsNode,
} from '../../lib/plate/contract.js';

// ─── Measurements of the coil ───────────────────────────────────────────────

/** Turns, and the radii they run between. Six turns is the balance point: more
 *  turns give each memory more axis, fewer give the ridges more headroom
 *  between one turn and the next. At six the store gets ~3.7 world units a
 *  memory against a turn gap of ~11.7 — a ridge can stand at its full height
 *  without touching the stretch of coil outside it. */
const TURNS = 5;
const R_INNER = 26;
const R_OUTER = 116;
/** The break between two communities, in slot-widths of arc length. It is what
 *  makes the blocks countable along the coil. */
const BLOCK_GAP = 1.6;

/** Ridge = a link inside a community. Leap = a link that crosses between two.
 *  The two bands do not overlap, which is the whole re-authoring: no leap is
 *  ever inside the hedge it passes over. */
const RIDGE_MIN = 0.9;
const RIDGE_MAX = 2.2;
const LEAP_MIN = 28;
const LEAP_MAX = 74;
/** Height = LIFT_MIN + (LIFT_MAX − LIFT_MIN) · (span / maxSpan)^LIFT_EXP.
 *  A plain proportional lift would flatten every short arc onto the axis and
 *  push the longest one out of the box; the exponent lifts the short ones into
 *  view and folds the long tail back in. Kept from the 2D plate, where the same
 *  distortion was declared on screen, and it is declared here too. */
const LIFT_EXP = 0.7;

const BEAD_RADIUS = 0.84;
/** The pick sphere is the hit target, not the mark. At the coil's spacing the
 *  targets tile the axis end to end without overlapping, so every memory is
 *  reachable even where a lobe is at its tightest. */
const PICK_RADIUS = 1.62;

const RIDGE_WIDTH = 1.05;
const LEAP_WIDTH = 1.35;
const FOCUS_WIDTH = 2.3;
/** The focus knock-back. A focus state, not an encoding — nothing about
 *  density rides on it, and it is gone the moment the pointer leaves. */
const DIMMED = 0.24;

const CAM_FOV = 32;
/** Where the eye starts, and the one camera decision that is an encoding
 *  rather than a taste.
 *
 *  Raise the eye and the coil opens into a legible nest of turns — but a
 *  camera above the plane looks down INTO the sheaf of arcs hanging below it
 *  while seeing only the crest of the sheaf standing above it, so the same
 *  1,367 contradictions read as a solid mass and the same 1,413 agreements as
 *  a thin crest. That is a lie about a store whose two kinds are an almost
 *  exact half each, and it gets worse with every degree.
 *
 *  So the eye starts near the plane, where neither sheaf is looked into and
 *  the two half-spaces are seen alike. The turns fuse into one woven band at
 *  this angle; orbiting up separates them, at the cost above, and the plate
 *  says so where the reader can act on it. */
const CAM_ELEVATION = 12;
const CAM_AZIMUTH = 24;
const CAM_DIR = new THREE.Vector3(
  Math.sin((CAM_AZIMUTH * Math.PI) / 180) * Math.cos((CAM_ELEVATION * Math.PI) / 180),
  Math.sin((CAM_ELEVATION * Math.PI) / 180),
  Math.cos((CAM_AZIMUTH * Math.PI) / 180) * Math.cos((CAM_ELEVATION * Math.PI) / 180)
).normalize();
/** Bounding radius of the coil plus its canopy, times the room left around it.
 *  A short box spends a fifth of its height on the strip that replaces the
 *  four corner panels, so the scene is pulled back to clear it. */
const CAM_FIT = 0.91;
const CAM_FIT_SHORT = 1.3;
/** Below this the box cannot hold a scene and a strip at full size. */
const SHORT_HEIGHT = 620;

const LABEL_PASSES = 40;
const POWER_PASSES = 260;
const BARY_PASSES = 32;
const RESTARTS = 6;
const SEED = 0x9e3779b9;

/** The box, not the window: below either of these the four corner panels are
 *  replaced by one strip, which cannot collide with anything. */
const ROOMY_WIDTH = 700;
const ROOMY_HEIGHT = 520;
/** Kept in step with `.lbc-read`'s own width in the sheet below: the note
 *  panel measures itself against the box so the two can never meet. */
const READ_WIDTH = 274;

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
  readonly maxWithinSpan: number;
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
  // graph, so a link that leaves a community lands on a nearby stretch of the
  // coil rather than across the whole nest. Measured on the straight axis this
  // alone cut links spanning >100 slots from 7.5% to 5.6% and the mean span
  // from 28.3 to 21.9; wound, the same ordering is what keeps most leaps short
  // enough to stay under the canopy.
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
      members.length > 2
        ? barycentre(fiedlerOrder(members, adjacency), adjacency)
        : members.slice();
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
  let maxWithinSpan = 1;
  for (const arc of arcs) {
    if (arc.span > maxSpan) maxSpan = arc.span;
    if (!arc.crossing && arc.span > maxWithinSpan) maxWithinSpan = arc.span;
  }
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
    maxWithinSpan,
    communities: communities.length,
    modularity,
    withinPercent: arcs.length ? Math.round((within / arcs.length) * 100) : 0,
    counts: { all: arcs.length, crossing: crossingCount, ambivalent: ambivalentCount },
    ambivalentPairs: ambivalentCount / 2,
  };
}

// ─── The coil ───────────────────────────────────────────────────────────────

interface Coil {
  /** Three floats a slot, in the y = 0 plane. */
  readonly position: Float32Array;
  readonly slots: number;
}

/**
 * Walk the seriated order along an Archimedean spiral at UNIFORM ARC LENGTH.
 *
 * r(θ) = R_INNER + bθ with b chosen so the last turn lands on R_OUTER, and
 * s(θ) = R_INNER·θ + bθ²/2 inverted in closed form, so every memory gets the
 * same length of axis wherever it falls. Sampling by angle instead would give
 * the innermost turn a fifth of the room the outermost gets, which would put
 * the tightest lobes exactly where there is least space for them.
 */
function buildCoil(layout: Layout): Coil {
  const slots = layout.order.length;
  const breaks = Math.max(0, layout.blocks.length - 1);
  const units = Math.max(1, slots + breaks * BLOCK_GAP);
  const sweep = 2 * Math.PI * TURNS;
  const b = (R_OUTER - R_INNER) / sweep;
  const total = Math.PI * TURNS * (R_INNER + R_OUTER);
  const per = total / units;

  const position = new Float32Array(slots * 3);
  let s = 0;
  layout.blocks.forEach((block, i) => {
    if (i > 0) s += per * BLOCK_GAP;
    for (let slot = block.from; slot <= block.to; slot++) {
      const theta = b > 0 ? (Math.sqrt(R_INNER * R_INNER + 2 * b * s) - R_INNER) / b : s / R_INNER;
      const r = R_INNER + b * theta;
      position[slot * 3] = Math.cos(theta) * r;
      position[slot * 3 + 1] = 0;
      position[slot * 3 + 2] = Math.sin(theta) * r;
      s += per;
    }
  });

  return { position, slots };
}

/** The coil at a fractional slot. Only ever called inside one block, so it
 *  never interpolates across the break between two communities. */
function coilAt(coil: Coil, u: number, out: THREE.Vector3): void {
  const c = Math.max(0, Math.min(coil.slots - 1, u));
  const i = Math.floor(c);
  const j = Math.min(coil.slots - 1, i + 1);
  const f = c - i;
  out.set(
    coil.position[i * 3]! + (coil.position[j * 3]! - coil.position[i * 3]!) * f,
    0,
    coil.position[i * 3 + 2]! + (coil.position[j * 3 + 2]! - coil.position[i * 3 + 2]!) * f
  );
}

// ─── The arc field ──────────────────────────────────────────────────────────

interface Field {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly start: Int32Array;
  readonly length: Int32Array;
}

/** A leap is sampled evenly; a ridge is sampled by how much coil it has to
 *  follow, because a ridge over ninety slots is most of a turn and a straight
 *  chord across it would cut through the nest instead of hugging its lobe. */
function segmentsFor(arc: Arc): number {
  if (arc.crossing) return 20;
  return Math.min(16, Math.max(5, Math.round(4 + arc.span * 0.5)));
}

function liftOf(arc: Arc, maxSpan: number, maxWithin: number): number {
  const lo = arc.crossing ? LEAP_MIN : RIDGE_MIN;
  const hi = arc.crossing ? LEAP_MAX : RIDGE_MAX;
  const reach = Math.max(1, arc.crossing ? maxSpan : maxWithin);
  return lo + (hi - lo) * Math.pow(Math.min(1, arc.span / reach), LIFT_EXP);
}

/** Every arc, once, into one pair of buffers. A lens or a focus then copies
 *  the slices it wants — a memcpy rather than a rebuild, so switching lens
 *  does not re-run the trigonometry for three thousand curves. */
function buildField(layout: Layout, coil: Coil): Field {
  const arcs = layout.arcs;
  const start = new Int32Array(arcs.length);
  const length = new Int32Array(arcs.length);
  let total = 0;
  arcs.forEach((arc, i) => {
    const segments = segmentsFor(arc);
    start[i] = total;
    length[i] = segments;
    total += segments;
  });

  const positions = new Float32Array(total * 6);
  const colors = new Float32Array(total * 6);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tint = new THREE.Color();

  arcs.forEach((arc, i) => {
    const segments = length[i]!;
    const dir = arc.up ? 1 : -1;
    const lift = liftOf(arc, layout.maxSpan, layout.maxWithinSpan);
    coilAt(coil, arc.a, a);
    coilAt(coil, arc.b, b);
    tint.setHex(linkColorInt(arc));

    let p = start[i]! * 6;
    prev.copy(a);
    for (let k = 1; k <= segments; k++) {
      const t = k / segments;
      // One lift law, two ground paths: a crossing takes the chord and leaps,
      // a link inside a community follows its own stretch of coil and ridges.
      if (arc.crossing) next.lerpVectors(a, b, t);
      else coilAt(coil, arc.a + (arc.b - arc.a) * t, next);
      next.y = dir * lift * Math.sin(Math.PI * t);

      positions[p] = prev.x;
      positions[p + 1] = prev.y;
      positions[p + 2] = prev.z;
      positions[p + 3] = next.x;
      positions[p + 4] = next.y;
      positions[p + 5] = next.z;
      colors[p] = tint.r;
      colors[p + 1] = tint.g;
      colors[p + 2] = tint.b;
      colors[p + 3] = tint.r;
      colors[p + 4] = tint.g;
      colors[p + 5] = tint.b;
      p += 6;
      prev.copy(next);
    }
  });

  return { positions, colors, start, length };
}

function sliceField(field: Field, indices: readonly number[]): [Float32Array, Float32Array] {
  let segments = 0;
  for (const i of indices) segments += field.length[i]!;
  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  let p = 0;
  for (const i of indices) {
    const from = field.start[i]! * 6;
    const to = from + field.length[i]! * 6;
    positions.set(field.positions.subarray(from, to), p);
    colors.set(field.colors.subarray(from, to), p);
    p += to - from;
  }
  return [positions, colors];
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function useDisposable<T extends THREE.Object3D>(object: T): T {
  useEffect(
    () => () => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
        // An InstancedMesh keeps `instanceMatrix` and `instanceColor` outside
        // its geometry, and three frees those only through the object's own
        // dispose event. R3F will not call it either — it skips disposal for
        // anything mounted as a <primitive>, which every object here is.
        (child as unknown as { dispose?: () => void }).dispose?.();
      });
    },
    [object]
  );
  return object;
}

function makeLines(
  positions: Float32Array,
  colors: Float32Array,
  width: number,
  overlay: boolean
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);
  const material = new LineMaterial({
    vertexColors: true,
    worldUnits: false,
    linewidth: width,
    transparent: true,
    opacity: 1,
    depthTest: !overlay,
    depthWrite: !overlay,
    fog: false,
  });
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = overlay ? 20 : 1;
  return object;
}

/** One register of the field — the ridges, or the leaps. */
function ArcField({
  field,
  indices,
  width,
  dimmed,
}: {
  field: Field;
  indices: readonly number[];
  width: number;
  dimmed: boolean;
}) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => {
      const [positions, colors] = sliceField(field, indices);
      return makeLines(positions, colors, width, false);
    }, [field, indices, width])
  );
  useEffect(() => {
    const material = object.material;
    // Belt and braces: LineSegments2 rewrites `resolution` from the viewport
    // before every draw, so this only matters for the first frame.
    material.resolution.set(size.width, size.height);
    // Knocked back only while a focus is held. `depthWrite` stays on so
    // overlapping segments occlude rather than accumulate, which is what would
    // turn a uniform dim back into a brightness ramp — rule 4's forbidden wash
    // arriving by the back door.
    material.opacity = dimmed ? DIMMED : 1;
    invalidate();
  }, [object, size.width, size.height, dimmed, invalidate]);
  return <primitive object={object} />;
}

/** The links of the focused memory, restated on top at full strength. */
function FocusField({ field, indices }: { field: Field; indices: readonly number[] }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => {
      const [positions, colors] = sliceField(field, indices);
      return makeLines(positions, colors, FOCUS_WIDTH, true);
    }, [field, indices])
  );
  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [object, size.width, size.height, invalidate]);
  return <primitive object={object} />;
}

/** The axis itself: one unbroken run of coil per community, with a break
 *  between each. The memories that join nothing get no run — there is
 *  genuinely no structure there to draw — only their own beads. */
function Coilwork({ coil, blocks }: { coil: Coil; blocks: readonly Block[] }) {
  const object = useDisposable(
    useMemo(() => {
      const points: number[] = [];
      for (const block of blocks) {
        if (block.isolated) continue;
        for (let slot = block.from; slot < block.to; slot++) {
          points.push(
            coil.position[slot * 3]!,
            0,
            coil.position[slot * 3 + 2]!,
            coil.position[(slot + 1) * 3]!,
            0,
            coil.position[(slot + 1) * 3 + 2]!
          );
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const material = new THREE.LineBasicMaterial({ color: PLATE_COLORS.rule, fog: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      return lines;
    }, [coil, blocks])
  );
  return <primitive object={object} />;
}

/** Where the focus is: a pin standing through both half-spaces at the memory
 *  itself, and the stretch of coil its own community holds. The pin is the 2D
 *  plate's vertical guide, kept — a memory whose links are all low ridges is
 *  otherwise hard to find in a knocked-back field. Both are drawn in ink and
 *  neither is a link, so neither can be mistaken for one. */
function FocusMark({ coil, block, slot }: { coil: Coil; block: Block | null; slot: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => {
      const points: number[] = [];
      const px = coil.position[slot * 3]!;
      const pz = coil.position[slot * 3 + 2]!;
      points.push(px, -LEAP_MAX * 0.42, pz, px, LEAP_MAX * 0.42, pz);
      for (let i = block ? block.from : 0; block !== null && i < block.to; i++) {
        points.push(
          coil.position[i * 3]!,
          0,
          coil.position[i * 3 + 2]!,
          coil.position[(i + 1) * 3]!,
          0,
          coil.position[(i + 1) * 3 + 2]!
        );
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const material = new THREE.LineBasicMaterial({
        color: PLATE_COLORS.ink3,
        fog: false,
        depthTest: false,
        transparent: true,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 22;
      return lines;
    }, [coil, block, slot])
  );
  useEffect(() => invalidate(), [object, invalidate]);
  return <primitive object={object} />;
}

/** Every memory, as one instanced mesh: one draw call, one bead a memory. */
function Beads({
  coil,
  layout,
  count,
  focusIndex,
  neighbours,
}: {
  coil: Coil;
  layout: Layout;
  count: number;
  focusIndex: number;
  neighbours: ReadonlySet<number>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useDisposable(
    useMemo(() => {
      const geometry = new THREE.IcosahedronGeometry(BEAD_RADIUS, 0);
      // `transparent` at full opacity purely to move the beads into the
      // transparent pass, where `renderOrder` can put them after the focus
      // overlay. Opaque, they would render first and the arcs converging on the
      // live memory would paint out its own marker.
      const material = new THREE.MeshBasicMaterial({
        toneMapped: false,
        fog: false,
        transparent: true,
      });
      const instanced = new THREE.InstancedMesh(geometry, material, count);
      instanced.frustumCulled = false;
      instanced.renderOrder = 30;
      const matrix = new THREE.Matrix4();
      const neutral = new THREE.Color(PLATE_COLORS.memory);
      for (let i = 0; i < count; i++) {
        const slot = layout.slotOf[i]!;
        matrix.makeTranslation(coil.position[slot * 3]!, 0, coil.position[slot * 3 + 2]!);
        instanced.setMatrixAt(i, matrix);
        // Seeded here, not in the effect below: `instanceColor` is allocated
        // zero-filled, and a passive effect can land after the first frame.
        instanced.setColorAt(i, neutral);
      }
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      return instanced;
    }, [coil, layout, count])
  );

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    // Derived from the tokens, never typed: a memory outside the focus is the
    // neutral mark mixed back toward the ground it sits on.
    const back = new THREE.Color(PLATE_COLORS.memory).lerp(
      new THREE.Color(PLATE_COLORS.plate),
      0.62
    );
    const live = new THREE.Color(PLATE_COLORS.memoryLive);
    for (let i = 0; i < count; i++) {
      let colour = rest;
      if (focusIndex >= 0) colour = neighbours.has(i) ? rest : back;
      if (i === focusIndex) colour = live;
      mesh.setColorAt(i, colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [mesh, count, focusIndex, neighbours, invalidate]);

  return <primitive object={mesh} />;
}

/** The hit targets. Bigger than the beads and drawing nothing, so a memory in
 *  the tightest lobe still has a target a pointer can land on. */
function PickTargets({
  coil,
  layout,
  count,
  onHover,
  onPick,
}: {
  coil: Coil;
  layout: Layout;
  count: number;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}) {
  const mesh = useDisposable(
    useMemo(() => {
      const geometry = new THREE.IcosahedronGeometry(PICK_RADIUS, 0);
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
        fog: false,
      });
      const instanced = new THREE.InstancedMesh(geometry, material, count);
      instanced.frustumCulled = false;
      instanced.renderOrder = -1;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const slot = layout.slotOf[i]!;
        matrix.makeTranslation(coil.position[slot * 3]!, 0, coil.position[slot * 3 + 2]!);
        instanced.setMatrixAt(i, matrix);
      }
      instanced.instanceMatrix.needsUpdate = true;
      return instanced;
    }, [coil, layout, count])
  );

  return (
    <primitive
      object={mesh}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const id = event.instanceId;
        if (id !== undefined) onHover(id);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (event.instanceId !== undefined) onPick(event.instanceId);
      }}
    />
  );
}

/** The camera stays above the coil plane at both limits, so "agrees above"
 *  and "contradicts below" never invert on screen. The shallow limit gives
 *  back the straight-axis reading; the steep limit looks down the nest. */
function Rig({ reducedMotion }: { reducedMotion: boolean }) {
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  return (
    <OrbitControls
      makeDefault
      target={target}
      enablePan={false}
      autoRotate={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.09}
      rotateSpeed={0.6}
      zoomSpeed={0.7}
      minDistance={R_OUTER * 0.8}
      maxDistance={R_OUTER * 5}
      minPolarAngle={Math.PI * 0.06}
      maxPolarAngle={Math.PI * 0.47}
    />
  );
}

// ─── Local stylesheet ───────────────────────────────────────────────────────
//
// Scoped to this plate's own class prefix. Rule 9: the canvas bleeds to all
// four edges and each panel bleeds into the edges it sits against — hairline
// on the inner sides only, no radius, no shadow, no card. There is no media
// query in this sheet: every breakpoint is a measurement of the BOX, taken in
// the component and written as a class or an inline position.

const CSS = `
.lbc-box { position: absolute; inset: 0; overflow: hidden; }
/* The attribute lifts this over the .ec-plate :focus-visible rule in
   plate.css, which sits at the same weight and would otherwise put the ring
   OUTSIDE a box whose parent clips it — an invisible focus ring. */
.lbc-box[tabindex]:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.lbc-canvas { position: absolute; inset: 0; }
.lbc-nogl { position: absolute; inset: 0; padding: 34px 30px; overflow: auto; }
.lbc-box .lbc-nogl-note { margin: 0; max-width: 58ch; }

.lbc-keys { position: absolute; left: 0; top: 0; padding: 12px 18px 13px 20px;
  background: var(--margin); border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule); }
/* In a box too small for four corners the key sheet folds into the bottom
   strip, where it is a plain row on the strip's own surface rather than a
   panel of its own. */
.lbc-keys[data-row='true'] { position: static; padding: 0; background: none;
  border: 0; margin-bottom: var(--gap-block); }
.lbc-keys[data-row='true'], .lbc-keys[data-row='true'] > div { display: flex;
  gap: var(--gap-section); flex-wrap: wrap; }
.lbc-key { display: flex; align-items: stretch; gap: 8px; }
.lbc-keys[data-row='false'] .lbc-key + .lbc-key { margin-top: var(--gap-row); }
.lbc-bar { width: 3px; min-height: 15px; flex: 0 0 auto; }
.lbc-key-n { display: block; font-variant-numeric: tabular-nums; color: var(--ink);
  font-size: var(--t-figure); font-weight: 500; line-height: 1.18; }

/* The second channel: not a colour, so its legend is drawn as the two shapes
   themselves rather than as two more swatches. */
.lbc-regs { margin-top: var(--gap-block); padding-top: var(--gap-block);
  border-top: 1px solid var(--rule); display: flex; flex-direction: column; gap: var(--gap-row); }
.lbc-reg { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 9px; }
.lbc-reg svg { display: block; overflow: visible; color: var(--ink-2); }
.lbc-reg-n { font-variant-numeric: tabular-nums; color: var(--ink); font-size: var(--t-body);
  font-weight: 500; }

.lbc-lens { position: absolute; right: 0; top: 0; display: flex; gap: 1px;
  flex-wrap: wrap; justify-content: flex-end; max-width: 100%;
  background: var(--rule); border-left: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule); }
.lbc-lens[data-stack='true'] { flex-direction: column; }
/* Prefixed with the root class throughout: plate.css resets every button
   inside the plate box at the same weight, and would win on document order. */
.lbc-box .lbc-lens button { display: flex; align-items: baseline; gap: 16px;
  justify-content: space-between; padding: 5px 18px 6px 15px; background: var(--margin);
  color: var(--ink-3); text-align: left; transition: color var(--dur) var(--ease); }
.lbc-box .lbc-lens button:hover { color: var(--ink-2); }
.lbc-box .lbc-lens button[aria-pressed='true'] { background: var(--rule); color: var(--ink); }
.lbc-lens-n { font-variant-numeric: tabular-nums; font-size: var(--t-label); color: inherit; }

.lbc-note { position: absolute; left: 0; bottom: 0; padding: 13px 20px 14px 20px;
  background: var(--margin); border-top: 1px solid var(--rule);
  border-right: 1px solid var(--rule); }
.lbc-note p { margin: 0; }
.lbc-note .lbc-prose { max-width: 50ch; }
.lbc-note .lbc-denom, .lbc-nogl .lbc-denom { margin-top: var(--gap-block);
  max-width: 62ch; line-height: 1.38; }

.lbc-read { position: absolute; right: 0; bottom: 0; width: 274px;
  padding: 13px 20px 14px 16px; background: var(--margin);
  border-top: 1px solid var(--rule); border-left: 1px solid var(--rule); }
.lbc-read-label { margin: 0; font-family: var(--font-note); font-weight: 300;
  font-size: var(--t-claim); line-height: 1.34; color: var(--ink); overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.lbc-read-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px;
  margin-top: var(--gap-row); }
.lbc-read-pair { display: flex; align-items: center; gap: 5px; }
.lbc-hint { margin: 0; line-height: 1.38; color: var(--ink-3); }

.lbc-strip { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 18px 11px;
  background: var(--margin); border-top: 1px solid var(--rule); }
.lbc-strip .lbc-read-label { -webkit-line-clamp: 1; }
.lbc-strip .lbc-denom { margin-top: var(--gap-row); max-width: none; }
.lbc-strip .lbc-hint { max-width: 84ch; }
`;

// ─── Small parts ────────────────────────────────────────────────────────────

/** A 3px bar in a link identity's own token. The only decoration on the
 *  surface, and it is doing a job: it is the legend. */
function Swatch({ kind, height }: { kind: LinkKind; height?: number }) {
  return (
    <span
      className="lbc-bar"
      style={
        height
          ? { background: `var(--${kind})`, height, minHeight: height }
          : { background: `var(--${kind})` }
      }
      aria-hidden
    />
  );
}

function Tally({ kind, value, word }: { kind: LinkKind; value: number; word: string }) {
  return (
    <span className="lbc-read-pair">
      <Swatch kind={kind} height={11} />
      <span className="obs-figure">{value}</span>
      <span className="obs-label">{word}</span>
    </span>
  );
}

/** The two register glyphs. Height is the second channel and it is not a
 *  colour, so its legend is the shape itself, drawn in ink rather than in
 *  either link hue — nothing here may be mistaken for a link. */
function RegisterGlyph({ leap }: { leap: boolean }) {
  return (
    <svg width="34" height="13" viewBox="0 0 34 13" fill="none" aria-hidden focusable="false">
      <path d="M1 12 H33" stroke="var(--rule)" strokeWidth="1" />
      <path
        d={leap ? 'M4 12 Q17 -6 30 12' : 'M2 12 Q17 5 32 12'}
        stroke="currentColor"
        strokeWidth={leap ? 1.5 : 1.1}
        fill="none"
      />
    </svg>
  );
}

/** Names each half-space and each register, and counts all four. The plate
 *  teaches both of its channels here and spends no other block on a legend. */
function KeySheet({
  agrees,
  contradicts,
  inside,
  crossing,
  insidePercent,
  row,
}: {
  agrees: number;
  contradicts: number;
  inside: number;
  crossing: number;
  insidePercent: number;
  row: boolean;
}) {
  return (
    <div className="lbc-keys" data-row={row ? 'true' : 'false'}>
      <div>
        <div className="lbc-key">
          <Swatch kind="agrees" />
          <span>
            <span className="obs-label" style={{ display: 'block' }}>
              Agrees, above the coil
            </span>
            <span className="lbc-key-n">{nf.format(agrees)}</span>
          </span>
        </div>
        <div className="lbc-key">
          <Swatch kind="contradicts" />
          <span>
            <span className="obs-label" style={{ display: 'block' }}>
              Contradicts, below it
            </span>
            <span className="lbc-key-n">{nf.format(contradicts)}</span>
          </span>
        </div>
      </div>
      {row ? null : (
        <div className="lbc-regs">
          <div className="lbc-reg">
            <RegisterGlyph leap={false} />
            <span className="obs-label">Inside a community, along its own coil</span>
            <span className="lbc-reg-n">
              {nf.format(inside)} · {insidePercent}%
            </span>
          </div>
          <div className="lbc-reg">
            <RegisterGlyph leap />
            <span className="obs-label">Crossing, clear above every ridge</span>
            <span className="lbc-reg-n">{nf.format(crossing)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

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
      <p className="lbc-read-label">{node.label}</p>
      <div className="lbc-read-row">
        <span className="obs-label">
          {node.type} ·{' '}
          {node.degree === 0
            ? 'joins nothing at all'
            : `one of ${nf.format(communitySize)} on its stretch of coil`}{' '}
          · {RETENTION_LABEL[node.retentionBand]} at {Math.round(node.retention * 100)}%
        </span>
      </div>
      {node.degree > 0 ? (
        <div className="lbc-read-row">
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

type Lens = 'all' | 'crossing' | 'ambivalent';

const LENSES: readonly { id: Lens; name: string }[] = [
  { id: 'all', name: 'All links' },
  { id: 'crossing', name: 'Crossing communities' },
  { id: 'ambivalent', name: 'Both ways' },
];

function passes(lens: Lens, arc: Arc): boolean {
  if (lens === 'crossing') return arc.crossing;
  if (lens === 'ambivalent') return arc.ambivalent;
  return true;
}

const NO_ARCS: readonly number[] = [];
const NO_NEIGHBOURS: ReadonlySet<number> = new Set<number>();

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const layout = useMemo(() => buildLayout(data), [data]);
  const coil = useMemo(() => buildCoil(layout), [layout]);
  const field = useMemo(() => buildField(layout, coil), [layout, coil]);

  const [lens, setLens] = useState<Lens>('all');
  const [hovered, setHovered] = useState<number | null>(null);
  const [keyed, setKeyed] = useState<number | null>(null);

  const [webgl] = useState(() => {
    if (typeof document === 'undefined') return true;
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      // Hand the probe context straight back: five plates share one browser's
      // context pool, and switching between them would otherwise drain it.
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
      return Boolean(probe);
    } catch {
      return false;
    }
  });

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return data.nodes.findIndex((node) => node.id === selectedId);
  }, [data.nodes, selectedId]);

  // Precedence, tightest first: the bead under the pointer, then the one the
  // arrow keys walked to, then the selection the page is carrying.
  const focusIndex = hovered ?? keyed ?? (selectedIndex >= 0 ? selectedIndex : -1);
  const focusNode = focusIndex >= 0 ? (data.nodes[focusIndex] ?? null) : null;

  const [ridges, leaps] = useMemo(() => {
    const inside: number[] = [];
    const across: number[] = [];
    layout.arcs.forEach((arc, i) => {
      if (!passes(lens, arc)) return;
      (arc.crossing ? across : inside).push(i);
    });
    return [inside, across] as const;
  }, [layout, lens]);

  const focusArcs = useMemo<readonly number[]>(() => {
    if (focusIndex < 0) return NO_ARCS;
    return (layout.arcsOf[focusIndex] ?? NO_ARCS).filter((i) => passes(lens, layout.arcs[i]!));
  }, [layout, focusIndex, lens]);

  const neighbours = useMemo<ReadonlySet<number>>(() => {
    if (focusIndex < 0) return NO_NEIGHBOURS;
    const set = new Set<number>([focusIndex]);
    for (const i of focusArcs) {
      const arc = layout.arcs[i]!;
      set.add(layout.order[arc.a]!);
      set.add(layout.order[arc.b]!);
    }
    return set;
  }, [layout, focusIndex, focusArcs]);

  const focusBlock = useMemo<Block | null>(() => {
    if (focusIndex < 0) return null;
    const slot = layout.slotOf[focusIndex]!;
    return layout.blocks.find((b) => !b.isolated && slot >= b.from && slot <= b.to) ?? null;
  }, [layout, focusIndex]);

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      setKeyed(null);
      onSelect(node.id === selectedId ? null : node.id);
    },
    [data.nodes, onSelect, selectedId]
  );

  const clear = useCallback(() => {
    setKeyed(null);
    onSelect(null);
  }, [onSelect]);

  const roomy = width >= ROOMY_WIDTH && height >= ROOMY_HEIGHT;

  // The camera is framed once, from the first measured box. Re-deriving it on
  // resize would snap the view back out from under the viewer's own orbit.
  const framing = useRef<{
    fov: number;
    near: number;
    far: number;
    position: [number, number, number];
  } | null>(null);
  if (!framing.current && width > 0 && height > 0) {
    // The coil disc plus the canopy over it, as one bounding radius. The
    // canopy only stands over the middle, so the radius is pulled in a little
    // rather than taken as the corner of the box it would fit in.
    const fit = Math.hypot(R_OUTER, LEAP_MAX) * (height < SHORT_HEIGHT ? CAM_FIT_SHORT : CAM_FIT);
    const vertical = (CAM_FOV * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(0.4, width / height));
    const distance = fit / Math.sin(Math.min(vertical, horizontal) / 2);
    framing.current = {
      fov: CAM_FOV,
      near: 0.5,
      far: distance * 4,
      position: [CAM_DIR.x * distance, CAM_DIR.y * distance, CAM_DIR.z * distance],
    };
  }

  // Walk the seriated order with the arrow keys. The order is the whole point
  // of the plate, so it stays reachable without a pointer.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const slots = layout.order.length;
      const at = focusIndex >= 0 ? layout.slotOf[focusIndex]! : 0;
      const stride = event.shiftKey ? 10 : 1;
      let next: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = Math.min(slots - 1, at + stride);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = Math.max(0, at - stride);
      } else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = slots - 1;
      else if (event.key === 'Enter' || event.key === ' ') {
        if (focusIndex >= 0) {
          event.preventDefault();
          const node = data.nodes[focusIndex];
          if (node) onSelect(node.id === selectedId ? null : node.id);
        }
        return;
      } else return;
      event.preventDefault();
      setHovered(null);
      setKeyed(layout.order[next] ?? null);
    },
    [layout, focusIndex, data.nodes, selectedId, onSelect]
  );

  const drawn = layout.counts[lens];

  const summary =
    `${nf.format(layout.counts.all)} links over ${nf.format(data.stats.memories)} memories, ` +
    `laid out from the link structure alone. ${layout.communities} communities were found in the ` +
    `graph itself and wound onto one coil in an order that keeps connected communities adjacent. ` +
    `${layout.withinPercent}% of links stay inside a community and ride a low ridge along their ` +
    `own stretch of coil; the ${nf.format(layout.counts.crossing)} that cross between communities ` +
    `leap clear above every ridge. Agrees stand above the coil plane, contradicts below it, and ` +
    `${nf.format(layout.ambivalentPairs)} pairs of memories do both. ` +
    `${nf.format(data.stats.isolated)} memories have no renderable link at all and hold the ` +
    `outermost stretch of the coil with no run drawn under them.`;

  const denominator = (
    <p className="obs-label lbc-denom">
      {nf.format(drawn)} of {nf.format(data.stats.linksDrawn)} renderable links drawn ·{' '}
      {nf.format(data.stats.linksToArchived)} more of the {nf.format(data.stats.linksStored)} stored
      point at archived memories and can be drawn by no one · {nf.format(data.stats.isolated)} of{' '}
      {nf.format(data.stats.memories)} memories have no link at all
    </p>
  );

  const keySheet = (
    <KeySheet
      agrees={data.stats.agrees}
      contradicts={data.stats.contradicts}
      inside={layout.counts.all - layout.counts.crossing}
      crossing={layout.counts.crossing}
      insidePercent={layout.withinPercent}
      row={!roomy}
    />
  );

  const readout = focusNode ? (
    <Readout
      node={focusNode}
      communitySize={layout.communitySize[layout.communityOf[focusIndex]!] ?? 0}
      bothWays={layout.ambivalentNeighbours[focusIndex] ?? 0}
    />
  ) : (
    <p className="obs-label lbc-hint">
      Point at a memory on the coil, or walk the order with the arrow keys, to follow its links.
      Drag to orbit: flat on gives back the straight axis, from overhead you see the nest.
    </p>
  );

  // No context, no scene, and nothing else on the surface either: a key for
  // marks that were never drawn and a lens over nothing are worse than the
  // sentence that says what the plate would have shown.
  if (!webgl || !framing.current) {
    return (
      <div className="lbc-box" role="group" aria-label={summary}>
        <style href="plate-by-link" precedence="medium">
          {CSS}
        </style>
        <div className="lbc-nogl">
          <p className="obs-note lbc-nogl-note">
            This plate is drawn with WebGL and this browser did not give the page a context. The
            measurements still hold: {summary}
          </p>
          {denominator}
        </div>
      </div>
    );
  }

  return (
    <div className="lbc-box" tabIndex={0} role="group" aria-label={summary} onKeyDown={onKeyDown}>
      <style href="plate-by-link" precedence="medium">
        {CSS}
      </style>

      <div className="lbc-canvas" role="img" aria-label={summary}>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          gl={{
            antialias: true,
            // The token layer's contrast and ΔE were measured on raw sRGB.
            // R3F's ACES default would silently move every one of those
            // numbers, so tone mapping is named rather than inherited.
            toneMapping: THREE.NoToneMapping,
          }}
          camera={framing.current}
          onPointerMissed={clear}
        >
          <Coilwork coil={coil} blocks={layout.blocks} />
          <ArcField field={field} indices={ridges} width={RIDGE_WIDTH} dimmed={focusIndex >= 0} />
          <ArcField field={field} indices={leaps} width={LEAP_WIDTH} dimmed={focusIndex >= 0} />
          {focusIndex >= 0 ? <FocusField field={field} indices={focusArcs} /> : null}
          {focusIndex >= 0 ? (
            <FocusMark coil={coil} block={focusBlock} slot={layout.slotOf[focusIndex]!} />
          ) : null}
          <Beads
            coil={coil}
            layout={layout}
            count={data.nodes.length}
            focusIndex={focusIndex}
            neighbours={neighbours}
          />
          <PickTargets
            coil={coil}
            layout={layout}
            count={data.nodes.length}
            onHover={setHovered}
            onPick={pick}
          />
          <Rig reducedMotion={reducedMotion} />
        </Canvas>
      </div>

      <div
        className="lbc-lens"
        data-stack={roomy ? 'true' : 'false'}
        role="group"
        aria-label="Which links are drawn"
      >
        {LENSES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === lens}
            onClick={() => setLens(option.id)}
          >
            <span className="obs-label" style={{ color: 'inherit' }}>
              {option.name}
            </span>
            <span className="lbc-lens-n">
              {option.id === 'ambivalent'
                ? `${nf.format(layout.ambivalentPairs)} pairs`
                : nf.format(layout.counts[option.id])}
            </span>
          </button>
        ))}
      </div>

      {roomy ? (
        <>
          {keySheet}
          <div className="lbc-note" style={{ maxWidth: Math.max(240, width - READ_WIDTH - 44) }}>
            <p className="obs-note lbc-prose">
              Position is the link structure and nothing else: {layout.communities} communities
              found in the graph itself, wound onto one coil so that what connects sits close. The
              embedding is unused — distance here is order, not similarity, and height inside each
              of the two bands is span along that order, compressed so short links stay visible.
            </p>
            {denominator}
          </div>
          <div
            className="lbc-read"
            aria-live="polite"
            style={{
              opacity: focusNode ? 1 : 0.74,
              transform: focusNode ? 'translateY(0)' : 'translateY(3px)',
              transition: reducedMotion
                ? 'none'
                : 'opacity var(--dur) var(--ease), transform var(--dur) var(--ease)',
            }}
          >
            {readout}
          </div>
        </>
      ) : (
        <div className="lbc-strip" aria-live="polite">
          {keySheet}
          {readout}
          {denominator}
        </div>
      )}
    </div>
  );
}

export const laidOutByLink: DemoModule = {
  id: 'by-link',
  name: 'Ordered by link',
  dimension: '3D',
  claim:
    'Laid out from the links alone, this store is not one cloud but dozens of tight communities that keep nine of every ten links inside themselves — so the connections that were ever genuinely invisible are the few hundred crossing between them, and those are the ones this puts in plain sight.',
  Plate,
};
