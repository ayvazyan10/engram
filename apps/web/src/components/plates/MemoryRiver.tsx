/**
 * SLOT — Memory River (3D). "The time axis, folded into reaches."
 *
 * ─── The argument, unchanged ───────────────────────────────────────────────
 *
 * Time is the one axis this store genuinely has. 1,701 of 3,109 renderable
 * links join two memories written inside 24 hours of each other and only 183
 * reach further apart than the store's 7-day half-life. So this is not a web
 * spread over five months; it is a handful of dense sittings, each wired
 * tightly inside itself, with a few long threads between them — and one
 * five-day flood of reflections in July that holds most of the contradictions.
 *
 * ─── Why this was re-cut into 3D ───────────────────────────────────────────
 *
 * The 2D version drew the whole axis across one strip of canvas. In the
 * dashboard's box that strip is about 690 px for 817 axis units — 0.84 px a
 * unit — so the July flood collapsed into an unreadable mass and the chrome
 * blocks fought each other for what was left. Depth is spent on exactly that
 * problem, in two places:
 *
 *   THE AXIS IS FOLDED. Time still runs left to right, but it wraps onto a
 *   small number of REACHES stacked in depth, oldest at the back, newest in
 *   front — the way a long line of text wraps onto a column of lines, except
 *   the lines lie one behind the other, and the lines are flush left and
 *   ragged right because the fold is not free to fall wherever it likes.
 *
 *   A FOLD ONLY FALLS IN A SILENCE. The break is always the first day of
 *   writing after two or more silent days, so no sitting is ever cut in half.
 *   That rule was measured, not preferred: fold at a silence and about 60
 *   links reach across the fold, which reads as threads; fold inside the July
 *   sitting and the cheapest cut strands 303 links and the dearest 991, which
 *   reads as a sheet of colour hung between two terraces. On this store the
 *   rule yields three reaches of 300, 366 and 152 axis units. The widest of
 *   them sets the scale, so a unit gets about 1.6 px in the dashboard's
 *   928-px box against the flat version's 0.84, and 18 July — 92 memories in
 *   one day — is about 145 px of terrace rather than 77.
 *
 *   SOURCES MOVED OFF THE VERTICAL. In 2D the fifteen sources were stacked
 *   bands competing with the river's own thickness for height. Here they are
 *   LANES ACROSS each reach — a depth offset — so a source is a rail running
 *   from its first memory to its last, and the vertical is left entirely to
 *   the links.
 *
 * ─── What the geometry means, exactly ──────────────────────────────────────
 *
 *   Along a reach   Order of writing. Every memory advances the axis by one
 *        unit; a calendar day with no writing advances it by 1.5. A day is
 *        therefore as wide as what was written in it, and a silence is narrow
 *        but never dropped. The day ticks under each reach's front edge are
 *        the proof: a sitting spreads them apart, a silence packs them.
 *
 *   Across a reach   `node.source` — the client that wrote the memory. Lanes
 *        are ordered by first writing, nearest lane first, and a lane is drawn
 *        only between that source's first and last memory, so its rail length
 *        is its span. The field is on the API payload but not on `ObsNode`, so
 *        it is read through a guard and anything unusable becomes
 *        "unrecorded".
 *
 *   Height   Two things, in order. A memory sits a little above its lane by
 *        its rank along the projection's first axis WITHIN that source — the
 *        one use of the embedding here, an order and never a distance, so two
 *        memories that mean similar things sit at similar heights and the link
 *        between them runs level. Above that, an arc rises with the DAYS
 *        between its two ends, on a log scale against the whole span, plus a
 *        small bow for how far it reaches. Days and not writing-order: the
 *        July sitting takes 44% of the axis because that is how much was
 *        written in it, and its 2,548 internal links are hours apart, so they
 *        stay flat over their own terrace instead of rearing up as if they
 *        crossed the record. What does rear up is the 183 that cross a
 *        half-life. "A few dense sittings joined by a handful of long threads"
 *        is that silhouette, read directly.
 *
 *   A bead   One memory, radius from degree, the busiest twentieth drawn half
 *        again as large. Hue never touches a bead, and the two lifts off
 *        `--memory` each mean one thing and only one: `--ink-2` is a memory
 *        linked to whatever the pointer is on, `--memory-live` is that memory
 *        itself, or a memory in a lane the reader has lit.
 *
 *   An arc   Hue is kind, lightness step is strength — `linkColorInt` and
 *        nothing else. Drawn twice: an additive 4.4 px halo, then a 1.45 px
 *        opaque core after it, so every core pixel is the unmodified token and
 *        the ΔE 28 between kinds and the 0.076/0.086 ΔL between steps survive
 *        any depth of haze. That is the same construction, and the same
 *        measurement, as the other two 3D plates on this surface.
 *
 * ─── The compressed axis, declared ─────────────────────────────────────────
 *
 * Perspective draws the far reach smaller than the near one. Every reach holds
 * the SAME world length per axis unit — the encoding is uniform in the scene,
 * and only the camera shrinks it — but a reader who cannot tell a compressed
 * axis from a real gap has been misled, so the rail prints the measured ratio
 * of near to far and updates it live as the view is orbited. The camera is
 * framed at a 32° field and the terraces are spread to fill the box, which
 * puts that ratio near 2:3 — not the 10:1 a linear time axis running to a
 * horizon would produce. Each reach also prints its own dates, its memory
 * count and the length of the silence it opens after, so a fold can never be
 * mistaken for a gap in the record or a gap for a fold.
 *
 * ─── What this plate still refuses ─────────────────────────────────────────
 *
 *   • Colour on time, on memory type, or on retention. Two hues exist and both
 *     mean link kind. Type is a filter and a word; retention is a word.
 *   • Density as a wash. Density is the axis measure, the bead count along a
 *     lane and the accumulation of arcs — geometry, every time.
 *   • An entrance animation. The 2D version swept the river in over 1300 ms,
 *     which replayed every time the chooser came back to it. Nothing here
 *     animates unless the viewer asks; `reducedMotion` additionally drops
 *     orbit inertia, and the two paths render the same settled frame.
 *
 *   • Chrome scattered over the drawing. The 2D version placed five blocks by
 *     absolute coordinate and they collided the moment the box shrank: the
 *     type filter landed on the source list and the denominator line landed on
 *     the date axis, and its headline figures did not render at all below 840
 *     px of box. Everything the plate has to say is now one flow column down
 *     the right edge, which cannot collide with itself at any size; the scene
 *     takes the rest of the box, and the only thing that varies with height is
 *     how many sources the list can hold, which the list says out loud.
 *   • A topic taxonomy, or any figure not derived from `data` at render time.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
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
  type MemoryType,
  type ObsData,
  type ObsLink,
  type ObsNode,
} from '../../lib/plate/contract.js';

// ─── The encoding, as constants ─────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Axis units a calendar day with no writing advances by; a memory is 1. */
const SILENT_DAY_UNITS = 1.5;
const UNRECORDED = 'unrecorded';

/** World length of the widest reach. Everything else is scaled against it. */
const WRAP_W = 100;
/** A silence of this many calendar days or more may carry a fold. */
const SILENCE_DAYS = 2;
/** Share of a reach's depth pitch given to its lanes; the rest is clear air. */
const LANE_FRACTION = 0.72;
/** The ground's depth is fitted to the scene box, inside these bounds, so the
 *  terraces fill the frame and the lane pitch is as generous as the box allows. */
const DEPTH_MIN = 52;
const DEPTH_MAX = 340;
/** How hard the terraces are spread to fill the box. Measured against the
 *  drawing's own bounding box in the screenshots: below about 1.2 the plate
 *  leaves a fifth of the frame empty, above about 1.4 the far reach is drawn
 *  under 60% of the near and the fold starts to read as a cliff. */
const DEPTH_FILL = 1.25;

/**
 * Arc apex = ARC_MIN + ARC_RISE · lift, where lift is how far apart in TIME
 * the two ends were written, on a log scale against the whole span: 0 for the
 * same instant, 0.41 at the 7-day half-life, 1 at the full 168 days. Time and
 * not order, deliberately — the July sitting takes 44% of the axis because
 * that is how much was written in it, and its internal links are hours apart,
 * so they belong flat on their own terrace rather than rearing up as if they
 * crossed the record. A link that hops a fold gets a floor on its lift so it
 * still reads as a hop.
 */
const ARC_MIN = 0.5;
const ARC_RISE = 4.4;
const FOLD_LIFT = 0.17;
/** On top of the lift, a chord bows with how far it reaches along the axis, so
 *  the 2,548 links inside the July sitting nest instead of collapsing into one
 *  opaque sheet. Reach is not time and does not pretend to be: it moves an arc
 *  by at most a third of what a full-span lift does. */
const SPAN_BOW = 2.4;
/** Height a lane's memories are spread over, by rank along the projection's
 *  first axis. The only use of the embedding here, and a within-lane ORDER,
 *  never a distance: memories that mean similar things sit at similar heights,
 *  so a link between two of them runs level. */
const MEANING_BAND = 3;
const BEAD_MIN = 0.26;
const BEAD_PER = 0.15;
/** The pointer's target is this much larger than the bead it stands for. */
const PICK_GROW = 2.3;
const PICK_MIN = 0.62;
const HUB_QUANTILE = 0.95;

const TICK_LEN = 1.4;
const MONTH_TICK_LEN = 2.9;

const HALO_PX = 4.4;
const HALO_ALPHA = 0.07;
const HALO_ALPHA_DIM = 0.03;
const CORE_PX = 1.45;
const CORE_ALPHA_DIM = 0.24;

const CAM_FOV = 32;
const CAM_ELEVATION = (42 * Math.PI) / 180;
/** How much of the box the drawing is allowed to reach, in NDC. */
const FRAME_X = 0.95;
const FRAME_TOP = 0.95;
const FRAME_BOTTOM = 0.87;

const nf = new Intl.NumberFormat('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Days are UTC days throughout, so every label is built from UTC fields. */
const monthName = (ms: number): string => MONTHS[new Date(ms).getUTCMonth()] ?? '';
const dayMonth = (ms: number): string => `${new Date(ms).getUTCDate()} ${monthName(ms)}`;
const fullDate = (ms: number): string => `${dayMonth(ms)} ${new Date(ms).getUTCFullYear()}`;

type ViewId = 'all' | 'far' | 'cross' | 'contradicts';
type TypeFilter = MemoryType | 'all';

const VIEWS: readonly { id: ViewId; name: string }[] = [
  { id: 'all', name: 'All links' },
  { id: 'far', name: 'Across a half-life' },
  { id: 'cross', name: 'Between sources' },
  { id: 'contradicts', name: 'Contradicts' },
];

const TYPES: readonly { id: TypeFilter; name: string }[] = [
  { id: 'all', name: 'Every type' },
  { id: 'semantic', name: 'Semantic' },
  { id: 'episodic', name: 'Episodic' },
  { id: 'procedural', name: 'Procedural' },
];

// ─── Boundary ───────────────────────────────────────────────────────────────

/** `source` is on the API payload but not on the contract's type. Read it
 *  through a guard; anything that is not a usable string is "unrecorded". */
function sourceOf(node: ObsNode): string {
  const raw = (node as ObsNode & { source?: unknown }).source;
  if (typeof raw !== 'string') return UNRECORDED;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : UNRECORDED;
}

const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ─── Reading: the axis ──────────────────────────────────────────────────────

interface Axis {
  firstDay: number;
  lastDay: number;
  today: number;
  /** Axis unit at the start of day `firstDay + k`, with one extra for the end. */
  dayStart: Float64Array;
  dayCount: Int32Array;
  total: number;
  daysWithWriting: number;
  silentDays: number;
  spanDays: number;
  undated: number;
  unitOf: Float64Array;
}

function parseTimes(nodes: readonly ObsNode[], now: number): { times: Float64Array; undated: number } {
  const times = new Float64Array(nodes.length);
  let undated = 0;
  nodes.forEach((node, i) => {
    const t = Date.parse(node.createdAt);
    if (Number.isFinite(t)) times[i] = Math.min(t, now);
    else {
      times[i] = now;
      undated++;
    }
  });
  return { times, undated };
}

function buildAxis(times: Float64Array, undated: number, now: number): Axis {
  const order = Array.from(times.keys()).sort((a, b) => times[a]! - times[b]! || a - b);
  const today = dayOf(now);
  const firstDay = order.length ? dayOf(times[order[0]!]!) : today;
  const lastDay = Math.max(today, order.length ? dayOf(times[order[order.length - 1]!]!) : today);
  const days = lastDay - firstDay + 1;

  const dayCount = new Int32Array(days);
  for (const t of times) {
    const k = dayOf(t) - firstDay;
    if (k >= 0 && k < days) dayCount[k] = (dayCount[k] ?? 0) + 1;
  }

  const dayStart = new Float64Array(days + 1);
  let u = 0;
  for (let k = 0; k < days; k++) {
    dayStart[k] = u;
    const m = dayCount[k] ?? 0;
    u += m > 0 ? m : SILENT_DAY_UNITS;
  }
  dayStart[days] = u;

  const unitOf = new Float64Array(times.length);
  const seen = new Int32Array(days);
  for (const i of order) {
    const k = dayOf(times[i]!) - firstDay;
    const j = seen[k] ?? 0;
    seen[k] = j + 1;
    unitOf[i] = (dayStart[k] ?? 0) + j + 0.5;
  }

  let written = 0;
  for (let k = 0; k < days; k++) if ((dayCount[k] ?? 0) > 0) written++;

  return {
    firstDay,
    lastDay,
    today,
    dayStart,
    dayCount,
    total: Math.max(u, 1),
    daysWithWriting: written,
    silentDays: days - written,
    spanDays: days,
    undated,
    unitOf,
  };
}

// ─── Reading: the fold ──────────────────────────────────────────────────────

interface Reach {
  index: number;
  /** Day indices relative to `axis.firstDay`; `day1` is exclusive. */
  day0: number;
  day1: number;
  u0: number;
  u1: number;
  /** Calendar days of silence immediately before this reach began. */
  silence: number;
  memories: number;
}

/** Days that may carry a fold: the first day of writing after a silence of
 *  `SILENCE_DAYS` or more, plus the two ends of the record. */
function foldPoints(axis: Axis): number[] {
  const out = [0];
  for (let k = 1; k < axis.spanDays; k++) {
    if ((axis.dayCount[k] ?? 0) === 0) continue;
    let silent = 0;
    for (let j = k - 1; j >= 0 && (axis.dayCount[j] ?? 0) === 0; j--) silent++;
    if (silent >= SILENCE_DAYS) out.push(k);
  }
  out.push(axis.spanDays);
  return out;
}

function silenceBefore(axis: Axis, day: number): number {
  let silent = 0;
  for (let j = day - 1; j >= 0 && (axis.dayCount[j] ?? 0) === 0; j--) silent++;
  return silent;
}

/**
 * Wrap the axis, greedily, exactly as a paragraph is broken into lines — but
 * the only legal break is a silence in the record, so no sitting is ever cut
 * in half. That constraint is not tidiness, it is measured: folding at a
 * silence leaves about 60 links reaching across the fold, while the cheapest
 * fold inside the July sitting would strand 303 and the dearest 991, and a
 * few hundred arcs leaping between two terraces stop reading as threads and
 * start reading as a sheet. A stretch with no silence in it is unbreakable
 * and takes a reach of its own however long it is, so the reaches come out
 * ragged on the right, and the widest one sets the scale for all of them.
 */
function foldAxis(axis: Axis, wrapUnits: number): Reach[] {
  const points = foldPoints(axis);
  const cuts = [0];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const here = points[i]!;
    const prev = points[i - 1]!;
    if ((axis.dayStart[here] ?? 0) - (axis.dayStart[start] ?? 0) > wrapUnits && prev > start) {
      cuts.push(prev);
      start = prev;
      i--;
    }
  }
  cuts.push(axis.spanDays);
  const reaches: Reach[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const day0 = cuts[i]!;
    const day1 = cuts[i + 1]!;
    let memories = 0;
    for (let d = day0; d < day1; d++) memories += axis.dayCount[d] ?? 0;
    reaches.push({
      index: i,
      day0,
      day1,
      u0: axis.dayStart[day0] ?? 0,
      u1: axis.dayStart[day1] ?? axis.total,
      silence: day0 === 0 ? 0 : silenceBefore(axis, day0),
      memories,
    });
  }
  return reaches;
}

/** The longest stretch with no legal fold in it. Nothing can be narrower. */
function unbreakable(axis: Axis): number {
  const points = foldPoints(axis);
  let longest = 1;
  for (let i = 1; i < points.length; i++) {
    longest = Math.max(longest, (axis.dayStart[points[i]!] ?? 0) - (axis.dayStart[points[i - 1]!] ?? 0));
  }
  return longest;
}

/** Reaches the box would like, before the record has its say. A narrow scene
 *  wants more, shorter reaches, exactly as a narrow measure wants more lines. */
function wantedReaches(sceneWidth: number, sceneHeight: number): number {
  const aspect = sceneWidth / Math.max(1, sceneHeight);
  return aspect >= 1.35 ? 3 : aspect >= 1.05 ? 4 : 5;
}

// ─── Reading: sources ───────────────────────────────────────────────────────

interface RiverSource {
  index: number;
  name: string;
  members: readonly number[];
  count: number;
  firstMs: number;
  lastMs: number;
  agrees: number;
  contradicts: number;
}

function collectSources(data: ObsData, times: Float64Array): RiverSource[] {
  const nameOf = data.nodes.map(sourceOf);
  const byName = new Map<string, number[]>();
  nameOf.forEach((name, i) => {
    const list = byName.get(name);
    if (list) list.push(i);
    else byName.set(name, [i]);
  });
  const within = new Map<string, { agrees: number; contradicts: number }>();
  for (const link of data.links) {
    const a = nameOf[link.source]!;
    if (a !== nameOf[link.target]) continue;
    const tally = within.get(a) ?? { agrees: 0, contradicts: 0 };
    within.set(a, {
      agrees: tally.agrees + (link.kind === 'agrees' ? 1 : 0),
      contradicts: tally.contradicts + (link.kind === 'contradicts' ? 1 : 0),
    });
  }
  return [...byName.entries()]
    .map(([name, members]) => {
      let firstMs = Infinity;
      let lastMs = -Infinity;
      for (const i of members) {
        const t = times[i]!;
        if (t < firstMs) firstMs = t;
        if (t > lastMs) lastMs = t;
      }
      const tally = within.get(name) ?? { agrees: 0, contradicts: 0 };
      return { name, members, count: members.length, firstMs, lastMs, ...tally };
    })
    .sort((a, b) => a.firstMs - b.firstMs || a.name.localeCompare(b.name))
    .map((s, index) => ({ ...s, index }));
}

// ─── Reading: the whole plate ───────────────────────────────────────────────

interface Beads {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  radius: Float32Array;
  lane: Int16Array;
  reach: Int16Array;
  hub: Uint8Array;
}

interface Thread {
  index: number;
  link: ObsLink;
  older: number;
  newer: number;
  /** Distance along the axis, in units — how far the arc reaches. */
  span: number;
  /** Distance in calendar days — how high it rises. */
  days: number;
  /** Reaches the arc hops over. */
  folds: number;
  far: boolean;
  cross: boolean;
}

interface DayTick {
  /** World x and z of the tick's foot. */
  x: number;
  z: number;
  /** Longer, for the first of a month and the first day of a reach. */
  month: boolean;
}

interface Flood {
  source: number;
  name: string;
  count: number;
  links: number;
  contradictShare: number;
  when: string;
  world: THREE.Vector3;
}

interface Reading {
  axis: Axis;
  times: Float64Array;
  sources: readonly RiverSource[];
  reaches: readonly Reach[];
  beads: Beads;
  threads: readonly Thread[];
  ticks: readonly DayTick[];
  flood: Flood | null;
  /** World extent of everything on the ground, plus the tallest arc. */
  width: number;
  depth: number;
  head: number;
  /** Depth one reach's lanes take, and the pitch from one reach to the next. */
  laneSpan: number;
  reachPitch: number;
  unitPx: number;
  idIndex: Map<string, number>;
  within24h: number;
  farLinks: number;
  laneName: readonly string[];
}

function hubThreshold(nodes: readonly ObsNode[]): number {
  const degrees = nodes
    .map((n) => n.degree)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (!degrees.length) return Infinity;
  return Math.max(2, degrees[Math.min(degrees.length - 1, Math.floor(degrees.length * HUB_QUANTILE))]!);
}

function buildReading(data: ObsData, wanted: number, aspect: number, now: number): Reading {
  const { times, undated } = parseTimes(data.nodes, now);
  const axis = buildAxis(times, undated, now);
  const sources = collectSources(data, times);
  const fold = foldAxis(axis, Math.max(unbreakable(axis), axis.total / Math.max(1, wanted)));

  const maxUnits = fold.reduce((m, r) => Math.max(m, r.u1 - r.u0), 1);
  const unitWorld = WRAP_W / maxUnits;
  // The ground's depth is fitted to the box rather than fixed, so three
  // reaches fill a tall scene instead of hugging the horizon and the lanes get
  // whatever separation is going. Depth is spent, not spared.
  const depth = clamp(
    (WRAP_W / Math.max(0.3, aspect) / Math.sin(CAM_ELEVATION)) * DEPTH_FILL,
    DEPTH_MIN,
    DEPTH_MAX
  );
  const reachPitch = depth / (fold.length - 1 + LANE_FRACTION);
  const laneSpan = reachPitch * LANE_FRACTION;
  const lanePitch = laneSpan / Math.max(1, sources.length - 1);
  const reachZ = (k: number): number => (k - (fold.length - 1) / 2) * reachPitch;
  const laneZ = (l: number): number => ((sources.length - 1) / 2 - l) * lanePitch;

  const reachOf = new Int16Array(data.nodes.length);
  const laneOf = new Int16Array(data.nodes.length);
  for (const s of sources) for (const i of s.members) laneOf[i] = s.index;

  const n = data.nodes.length;
  const beads: Beads = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    radius: new Float32Array(n),
    lane: laneOf,
    reach: reachOf,
    hub: new Uint8Array(n),
  };
  const hubAt = hubThreshold(data.nodes);
  const reachFor = (u: number): Reach => {
    for (const r of fold) if (u < r.u1) return r;
    return fold[fold.length - 1]!;
  };
  for (let i = 0; i < n; i++) {
    const u = axis.unitOf[i]!;
    const r = reachFor(u);
    const degree = data.nodes[i]!.degree;
    const radius = BEAD_MIN + BEAD_PER * Math.sqrt(degree);
    reachOf[i] = r.index;
    beads.x[i] = -WRAP_W / 2 + (u - r.u0) * unitWorld;
    beads.z[i] = reachZ(r.index) + laneZ(laneOf[i]!);
    beads.radius[i] = radius;
    beads.hub[i] = degree >= hubAt ? 1 : 0;
  }
  for (const s of sources) {
    const byMeaning = [...s.members].sort((a, b) => data.nodes[a]!.x - data.nodes[b]!.x || a - b);
    byMeaning.forEach((i, k) => {
      const rank = byMeaning.length > 1 ? k / (byMeaning.length - 1) : 0.5;
      beads.y[i] = beads.radius[i]! + MEANING_BAND * rank;
    });
  }

  const horizon = data.stats.halfLifeDays * DAY_MS;
  const nameOf = data.nodes.map(sourceOf);
  const threads: Thread[] = data.links.map((link, index) => {
    const flip = times[link.source]! > times[link.target]!;
    const older = flip ? link.target : link.source;
    const newer = flip ? link.source : link.target;
    return {
      index,
      link,
      older,
      newer,
      span: Math.abs(axis.unitOf[newer]! - axis.unitOf[older]!),
      days: Math.abs(times[newer]! - times[older]!) / DAY_MS,
      folds: Math.abs(reachOf[newer]! - reachOf[older]!),
      far: Math.abs(times[newer]! - times[older]!) > horizon,
      cross: nameOf[older] !== nameOf[newer],
    };
  });

  const ticks: DayTick[] = [];
  for (const r of fold) {
    for (let d = r.day0; d < r.day1; d++) {
      const ms = (axis.firstDay + d) * DAY_MS;
      ticks.push({
        x: -WRAP_W / 2 + ((axis.dayStart[d] ?? 0) - r.u0) * unitWorld,
        z: reachZ(r.index) + laneSpan / 2 + lanePitch * 0.6,
        month: new Date(ms).getUTCDate() === 1 || d === r.day0,
      });
    }
  }

  let within24h = 0;
  for (const l of data.links) if (Math.abs(times[l.source]! - times[l.target]!) < DAY_MS) within24h++;

  const idIndex = new Map<string, number>();
  data.nodes.forEach((node, i) => idIndex.set(node.id, i));

  return {
    axis,
    times,
    sources,
    reaches: fold,
    beads,
    threads,
    ticks,
    flood: buildFlood(sources, beads),
    width: WRAP_W,
    depth: (fold.length - 1) * reachPitch + laneSpan,
    head: ARC_MIN + ARC_RISE + SPAN_BOW * 0.6 + MEANING_BAND,
    laneSpan,
    reachPitch,
    unitPx: unitWorld,
    idIndex,
    within24h,
    farLinks: threads.filter((t) => t.far).length,
    laneName: sources.map((s) => s.name),
  };
}

/** The one sitting the claim is about: the source holding the most links
 *  entirely inside itself. Found, never named in advance. */
function buildFlood(sources: readonly RiverSource[], beads: Beads): Flood | null {
  let best: RiverSource | null = null;
  for (const s of sources) if (!best || s.agrees + s.contradicts > best.agrees + best.contradicts) best = s;
  if (!best || best.agrees + best.contradicts === 0) return null;
  const links = best.agrees + best.contradicts;
  let x = 0;
  let z = 0;
  for (const i of best.members) {
    x += beads.x[i]!;
    z += beads.z[i]!;
  }
  const sameDay = dayOf(best.firstMs) === dayOf(best.lastMs);
  return {
    source: best.index,
    name: best.name,
    count: best.count,
    links,
    contradictShare: best.contradicts / links,
    when: sameDay ? dayMonth(best.firstMs) : `${dayMonth(best.firstMs)} to ${dayMonth(best.lastMs)}`,
    world: new THREE.Vector3(x / best.count, MEANING_BAND + ARC_MIN + SPAN_BOW, z / best.count),
  };
}

// ─── Reading: what is drawn ─────────────────────────────────────────────────

interface Visible {
  nodes: Uint8Array;
  links: Uint8Array;
  indices: number[];
  nodeCount: number;
  /** Links passing the type filter alone — the denominator of the view. */
  typeLinks: number;
  agrees: number;
  contradicts: number;
}

function viewPass(t: Thread, view: ViewId): boolean {
  if (view === 'far') return t.far;
  if (view === 'cross') return t.cross;
  if (view === 'contradicts') return t.link.kind === 'contradicts';
  return true;
}

function computeVisible(data: ObsData, reading: Reading, view: ViewId, type: TypeFilter): Visible {
  const nodes = new Uint8Array(data.nodes.length);
  let nodeCount = 0;
  data.nodes.forEach((node, i) => {
    if (type === 'all' || node.type === type) {
      nodes[i] = 1;
      nodeCount++;
    }
  });
  const links = new Uint8Array(reading.threads.length);
  const indices: number[] = [];
  let typeLinks = 0;
  let agrees = 0;
  let contradicts = 0;
  for (const t of reading.threads) {
    if (!nodes[t.older] || !nodes[t.newer]) continue;
    typeLinks++;
    if (!viewPass(t, view)) continue;
    links[t.index] = 1;
    indices.push(t.index);
    if (t.link.kind === 'agrees') agrees++;
    else contradicts++;
  }
  return { nodes, links, indices, nodeCount, typeLinks, agrees, contradicts };
}

// ─── Scene: arc geometry ────────────────────────────────────────────────────

interface Buffers {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

const EMPTY_BUFFERS: Buffers = { positions: new Float32Array(0), colors: new Float32Array(0), count: 0 };

function segmentsFor(thread: Thread, total: number): number {
  const share = thread.span / Math.max(1, total);
  return share > 0.06 || thread.folds > 0 ? 18 : share > 0.012 ? 10 : 6;
}

/** How far above its own chord an arc bows: the log of the days between its
 *  ends against the whole span, floored for every fold it hops, plus a small
 *  term for how far it reaches. */
function arcApex(thread: Thread, spanDays: number, total: number): number {
  const time = Math.log1p(thread.days) / Math.log1p(Math.max(1, spanDays));
  const lift = Math.max(time, thread.folds > 0 ? FOLD_LIFT * Math.sqrt(thread.folds) : 0);
  return ARC_MIN + ARC_RISE * lift + SPAN_BOW * (thread.span / Math.max(1, total));
}

function bezier(out: THREE.Vector3, a: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3, b: THREE.Vector3, t: number): void {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  out.set(
    a.x * w0 + c1.x * w1 + c2.x * w2 + b.x * w3,
    a.y * w0 + c1.y * w1 + c2.y * w2 + b.y * w3,
    a.z * w0 + c1.z * w1 + c2.z * w2 + b.z * w3
  );
}

/** One arc a link, older end to newer end, apex rising with the span in axis
 *  units. Colour is `linkColorInt` and nothing else. */
function threadBuffers(reading: Reading, indices: readonly number[]): Buffers {
  if (indices.length === 0) return EMPTY_BUFFERS;
  const { beads, threads, axis } = reading;
  let total = 0;
  for (const i of indices) total += segmentsFor(threads[i]!, axis.total);
  const positions = new Float32Array(total * 6);
  const colors = new Float32Array(total * 6);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tint = new THREE.Color();
  let p = 0;
  for (const i of indices) {
    const t = threads[i]!;
    const segments = segmentsFor(t, axis.total);
    a.set(beads.x[t.older]!, beads.y[t.older]!, beads.z[t.older]!);
    b.set(beads.x[t.newer]!, beads.y[t.newer]!, beads.z[t.newer]!);
    const apex = arcApex(t, axis.spanDays, axis.total);
    c1.copy(a).lerp(b, 0.25);
    c1.y += apex;
    c2.copy(a).lerp(b, 0.75);
    c2.y += apex;
    tint.setHex(linkColorInt(t.link));
    prev.copy(a);
    for (let k = 1; k <= segments; k++) {
      bezier(next, a, c1, c2, b, k / segments);
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
  }
  return { positions, colors, count: total };
}

// ─── Scene: disposal ────────────────────────────────────────────────────────

/**
 * Free everything React Three Fiber will not. R3F skips disposal for anything
 * mounted as a `<primitive>` — which every object in this file is — and an
 * InstancedMesh keeps `instanceMatrix` and `instanceColor` outside its
 * geometry, reachable only through the object's own `dispose`. The chooser
 * mounts and unmounts five plates against a browser context pool that caps
 * near 8–16, so a leak here turns into a black plate a few clicks later.
 */
function useDisposable<T extends THREE.Object3D>(object: T): T {
  useEffect(
    () => () => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
        (child as unknown as { dispose?: () => void }).dispose?.();
      });
    },
    [object]
  );
  return object;
}

function segmentsGeometry(points: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

// ─── Scene: the terraces ────────────────────────────────────────────────────

/** The ruled ground: one front edge and one back edge a reach, the lane rails
 *  where their source was alive, and a tick under every calendar day. */
function Terraces({ reading, lit }: { reading: Reading; lit: number | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const { reaches, sources, beads, ticks } = reading;

  const built = useMemo(() => {
    const edge: number[] = [];
    const staff: number[] = [];
    const rail: number[] = [];
    const tick: number[] = [];
    const half = WRAP_W / 2;
    const pitch = reading.laneSpan / Math.max(1, sources.length - 1);
    const zOf = (reach: number, lane: number): number =>
      (reach - (reaches.length - 1) / 2) * reading.reachPitch + ((sources.length - 1) / 2 - lane) * pitch;
    const rightOf = (r: Reach): number => -half + (r.u1 - r.u0) * reading.unitPx;

    // The front edge of a reach is its ruler; the fifteen faint lane lines
    // behind it are the staff a lane is counted against; the bright stretch on
    // a lane is where that source was actually writing.
    for (const r of reaches) {
      const right = rightOf(r);
      const zFront = zOf(r.index, 0) + pitch * 0.6;
      const zBack = zOf(r.index, sources.length - 1) - pitch * 0.6;
      edge.push(-half, 0, zFront, right, 0, zFront);
      edge.push(right, 0, zFront, right, 0, zBack);
      for (let lane = 0; lane < sources.length; lane++) {
        const z = zOf(r.index, lane);
        staff.push(-half, 0, z, right, 0, z);
      }
    }

    for (const s of sources) {
      const lo = new Map<number, number>();
      const hi = new Map<number, number>();
      for (const i of s.members) {
        const k = beads.reach[i]!;
        lo.set(k, Math.min(lo.get(k) ?? Infinity, beads.x[i]!));
        hi.set(k, Math.max(hi.get(k) ?? -Infinity, beads.x[i]!));
      }
      const touched = [...lo.keys()].sort((a, b) => a - b);
      const from = touched[0];
      const to = touched[touched.length - 1];
      if (from === undefined || to === undefined) continue;
      for (const r of reaches) {
        if (r.index < from || r.index > to) continue;
        const a = r.index === from ? (lo.get(from) ?? -half) : -half;
        const b = r.index === to ? (hi.get(to) ?? rightOf(r)) : rightOf(r);
        if (b <= a) continue;
        const z = zOf(r.index, s.index);
        rail.push(a, 0.01, z, b, 0.01, z);
      }
    }

    for (const t of ticks) {
      const len = t.month ? MONTH_TICK_LEN : TICK_LEN;
      tick.push(t.x, 0, t.z, t.x, 0, t.z + len);
    }

    const edgeMaterial = new THREE.LineBasicMaterial({ color: PLATE_COLORS.rule });
    const staffMaterial = new THREE.LineBasicMaterial({
      color: PLATE_COLORS.rule,
      transparent: true,
      opacity: 0.62,
    });
    const railMaterial = new THREE.LineBasicMaterial({
      color: PLATE_COLORS.memory,
      transparent: true,
      opacity: 0.62,
    });
    const tickMaterial = new THREE.LineBasicMaterial({
      color: PLATE_COLORS.ink3,
      transparent: true,
      opacity: 0.62,
    });
    const group = new THREE.Group();
    const parts = [
      new THREE.LineSegments(segmentsGeometry(staff), staffMaterial),
      new THREE.LineSegments(segmentsGeometry(edge), edgeMaterial),
      new THREE.LineSegments(segmentsGeometry(rail), railMaterial),
      new THREE.LineSegments(segmentsGeometry(tick), tickMaterial),
    ];
    for (const o of parts) {
      o.frustumCulled = false;
      group.add(o);
    }
    return { group };
  }, [reaches, sources, beads, ticks, reading.unitPx, reading.laneSpan, reading.reachPitch]);

  useDisposable(built.group);

  const litRail = useMemo(() => {
    if (lit === null) return null;
    const source = sources[lit];
    if (!source) return null;
    const half = WRAP_W / 2;
    const pts: number[] = [];
    for (const r of reaches) {
      const z0 = (r.index - (reaches.length - 1) / 2) * reading.reachPitch;
      const right = -half + (r.u1 - r.u0) * reading.unitPx;
      const z = z0 + ((sources.length - 1) / 2 - lit) * (reading.laneSpan / Math.max(1, sources.length - 1));
      let lo = Infinity;
      let hi = -Infinity;
      for (const i of source.members) {
        if (beads.reach[i] !== r.index) continue;
        lo = Math.min(lo, beads.x[i]!);
        hi = Math.max(hi, beads.x[i]!);
      }
      if (!Number.isFinite(lo)) continue;
      pts.push(Math.min(lo, -half + 0.2), 0.02, z, Math.max(hi, right - 0.2), 0.02, z);
    }
    if (!pts.length) return null;
    const material = new THREE.LineBasicMaterial({ color: PLATE_COLORS.ink });
    const lines = new THREE.LineSegments(segmentsGeometry(pts), material);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    return lines;
  }, [lit, sources, reaches, beads, reading.unitPx, reading.laneSpan, reading.reachPitch]);

  useEffect(() => {
    invalidate();
  }, [litRail, invalidate]);

  useEffect(
    () => () => {
      if (!litRail) return;
      litRail.geometry.dispose();
      (litRail.material as THREE.Material).dispose();
    },
    [litRail]
  );

  return (
    <>
      <primitive object={built.group} />
      {litRail ? <primitive object={litRail} /> : null}
    </>
  );
}

// ─── Scene: the beads ───────────────────────────────────────────────────────

interface BeadFieldProps {
  reading: Reading;
  visible: Visible;
  live: number | null;
  neighbours: ReadonlySet<number>;
  litSource: number | null;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function BeadField({ reading, visible, live, neighbours, litSource, onHover, onPick }: BeadFieldProps) {
  const invalidate = useThree((s) => s.invalidate);
  const count = reading.beads.radius.length;

  const built = useMemo(() => {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshBasicMaterial({ toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    // A second, larger set of the same spheres, drawn to no buffer at all. An
    // ordinary bead is under 3 px across on the smallest box this plate has to
    // work in, which is the right size to READ 657 of them and a hopeless size
    // to HIT one, so the pointer is given a target it can land on and the
    // drawing keeps its own scale.
    const pickMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    const picker = new THREE.InstancedMesh(geometry, pickMaterial, count);
    picker.frustumCulled = false;
    picker.renderOrder = 1;
    return { mesh, picker, geometry, material, pickMaterial };
  }, [count]);

  // Two instanced meshes over one geometry: R3F disposes neither, and the
  // instance buffers are reachable only through each mesh's own `dispose`.
  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.pickMaterial.dispose();
      built.mesh.dispose();
      built.picker.dispose();
    },
    [built]
  );

  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const { beads } = reading;
    const { mesh, picker } = built;
    for (let i = 0; i < count; i++) {
      const on = visible.nodes[i] === 1;
      const grow = i === live ? 2.1 : beads.hub[i] ? 1.45 : 1;
      const radius = on ? beads.radius[i]! * grow : 0;
      matrix.makeScale(radius, radius, radius);
      matrix.setPosition(beads.x[i]!, beads.y[i]!, beads.z[i]!);
      mesh.setMatrixAt(i, matrix);
      const hit = on ? Math.max(beads.radius[i]! * PICK_GROW, PICK_MIN) : 0;
      matrix.makeScale(hit, hit, hit);
      matrix.setPosition(beads.x[i]!, beads.y[i]!, beads.z[i]!);
      picker.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    picker.instanceMatrix.needsUpdate = true;
    // An InstancedMesh caches the bounding sphere its raycast tests against,
    // and it computes that sphere the first time it is asked — which, for an
    // instanced mesh whose matrices are written from an effect, is before any
    // of them are in place. Without this the sphere stays at the origin at
    // radius 1 and every pick silently misses. It also goes stale whenever a
    // filter moves an instance, so it is recomputed here and not once.
    mesh.computeBoundingSphere();
    picker.computeBoundingSphere();
    invalidate();
  }, [built, reading, visible, live, count, invalidate]);

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    const near = new THREE.Color(PLATE_COLORS.ink2);
    const bright = new THREE.Color(PLATE_COLORS.memoryLive);
    const { beads } = reading;
    const { mesh } = built;
    for (let i = 0; i < count; i++) {
      const inSource = litSource !== null && beads.lane[i] === litSource;
      mesh.setColorAt(i, i === live || inSource ? bright : neighbours.has(i) ? near : rest);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [built, reading, live, neighbours, litSource, count, invalidate]);

  return (
    <>
      <primitive object={built.mesh} />
      <primitive
        object={built.picker}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          if (event.instanceId === undefined) return;
          if (visible.nodes[event.instanceId] !== 1) return;
          event.stopPropagation();
          onHover(event.instanceId);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          if (event.instanceId === undefined) return;
          if (visible.nodes[event.instanceId] !== 1) return;
          event.stopPropagation();
          onPick(event.instanceId);
        }}
      />
    </>
  );
}

// ─── Scene: the arcs ────────────────────────────────────────────────────────

/** The halo is additive and drawn first; the core is opaque and drawn after
 *  it, so a core pixel is always the unmodified token colour. */
function ThreadField({ buffers, coreAlpha, haloAlpha }: { buffers: Buffers; coreAlpha: number; haloAlpha: number }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const built = useMemo(() => {
    if (buffers.count === 0) return null;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(buffers.positions);
    geometry.setColors(buffers.colors);
    const haloMat = new LineMaterial({
      vertexColors: true,
      worldUnits: false,
      linewidth: HALO_PX,
      transparent: true,
      opacity: haloAlpha,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreMat = new LineMaterial({
      vertexColors: true,
      worldUnits: false,
      linewidth: CORE_PX,
      transparent: true,
      opacity: coreAlpha,
      depthWrite: true,
    });
    const halo = new LineSegments2(geometry, haloMat);
    halo.renderOrder = 6;
    halo.frustumCulled = false;
    const core = new LineSegments2(geometry, coreMat);
    core.renderOrder = 10;
    core.frustumCulled = false;
    return { geometry, haloMat, coreMat, halo, core };
    // Alphas are uniforms, written by the effect below; rebuilding the whole
    // buffer when one changes would throw away the geometry for a number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffers]);

  useEffect(() => {
    if (!built) return;
    built.haloMat.opacity = haloAlpha;
    built.coreMat.opacity = coreAlpha;
    built.haloMat.resolution.set(size.width, size.height);
    built.coreMat.resolution.set(size.width, size.height);
    invalidate();
  }, [built, haloAlpha, coreAlpha, size.width, size.height, invalidate]);

  useEffect(
    () => () => {
      if (!built) return;
      built.geometry.dispose();
      built.haloMat.dispose();
      built.coreMat.dispose();
    },
    [built]
  );

  if (!built) return null;
  return (
    <>
      <primitive object={built.halo} />
      <primitive object={built.core} />
    </>
  );
}

// ─── Scene: the camera ──────────────────────────────────────────────────────

interface Fit {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
}

/**
 * Frame the scene: the point the camera aims at, and the smallest distance
 * that holds the whole drawing inside the box.
 *
 * Bounding the drawing rather than choosing a distance by eye is what keeps
 * the plate framed when the box changes shape under it. Two things the obvious
 * version got wrong and this one does not. The hull is measured REACH BY
 * REACH: the reaches are flush left and ragged right, so a rectangle around
 * the widest of them reserves a corner of empty frame for every short one. And
 * the aim point is SOLVED, not assumed: aiming at the middle of the ground
 * leaves the picture hanging off the bottom of the box with a quarter of the
 * frame empty above it, because only the nearest ruler ever reaches an edge.
 */
function cameraFit(reading: Reading, aspect: number): Fit {
  const probe = new THREE.PerspectiveCamera(CAM_FOV, Math.max(0.25, aspect), 0.5, 8000);
  const left = -reading.width / 2;
  const corners: THREE.Vector3[] = [];
  for (const r of reading.reaches) {
    const mid = (r.index - (reading.reaches.length - 1) / 2) * reading.reachPitch;
    // The near edge is pushed out past the day ticks; the bottom of the frame
    // is held tighter than the top because the reach captions hang below the
    // nearest ruler and are not part of the ground.
    const front = mid + reading.laneSpan / 2 + MONTH_TICK_LEN * 2;
    const back = mid - reading.laneSpan / 2;
    const right = left + (r.u1 - r.u0) * reading.unitPx;
    for (const x of [left, right]) {
      corners.push(new THREE.Vector3(x, 0, front));
      corners.push(new THREE.Vector3(x, 0, back));
      corners.push(new THREE.Vector3(x, reading.head * 0.8, mid));
    }
  }

  const scratch = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const bounds = (distance: number, aimY: number): { x: number; lo: number; hi: number } => {
    aim.set(0, aimY, 0);
    probe.position.set(0, aimY + distance * Math.sin(CAM_ELEVATION), distance * Math.cos(CAM_ELEVATION));
    probe.lookAt(aim);
    probe.updateMatrixWorld();
    probe.updateProjectionMatrix();
    let x = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of corners) {
      scratch.copy(c).project(probe);
      x = Math.max(x, Math.abs(scratch.x));
      lo = Math.min(lo, scratch.y);
      hi = Math.max(hi, scratch.y);
    }
    return { x, lo, hi };
  };
  const fits = (distance: number, aimY: number): boolean => {
    const b = bounds(distance, aimY);
    return b.x <= FRAME_X && b.hi <= FRAME_TOP && b.lo >= -FRAME_BOTTOM;
  };
  const solve = (aimY: number): number => {
    let lo = Math.max(reading.width, reading.depth) * 0.2;
    let hi = Math.max(reading.width, reading.depth) * 10;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, aimY)) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  // Newton on one variable: shift the aim until the drawing's own vertical
  // midpoint sits in the middle of the band the frame allows.
  const wanted = (FRAME_TOP - FRAME_BOTTOM) / 2;
  let aimY = reading.head * 0.3;
  let distance = solve(aimY);
  for (let pass = 0; pass < 6; pass++) {
    const here = bounds(distance, aimY);
    const centre = (here.lo + here.hi) / 2;
    if (Math.abs(centre - wanted) < 0.008) break;
    const nudged = bounds(distance, aimY + 1);
    const slope = (nudged.lo + nudged.hi) / 2 - centre;
    if (Math.abs(slope) < 1e-6) break;
    aimY += (wanted - centre) / slope;
    distance = solve(aimY);
  }

  const target = new THREE.Vector3(0, aimY, 0);
  return {
    position: new THREE.Vector3(
      0,
      aimY + distance * Math.sin(CAM_ELEVATION),
      distance * Math.cos(CAM_ELEVATION)
    ),
    target,
    distance,
  };
}

function Rig({ fit, reducedMotion }: { fit: Fit; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    camera.position.copy(fit.position);
    camera.lookAt(fit.target);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, fit, invalidate]);
  return (
    <OrbitControls
      makeDefault
      target={fit.target}
      enablePan={false}
      enableZoom={false}
      autoRotate={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      rotateSpeed={0.42}
      minPolarAngle={Math.PI * 0.16}
      maxPolarAngle={Math.PI * 0.46}
      minAzimuthAngle={-0.42}
      maxAzimuthAngle={0.42}
    />
  );
}

// ─── Scene: writing world points onto the overlay ───────────────────────────

interface Anchor {
  key: string;
  world: THREE.Vector3;
}

type Registry = Map<string, HTMLElement | null>;

/**
 * Screen positions are written straight into the overlay's elements on every
 * rendered frame — no React state per frame, and only `transform` and
 * `opacity` ever move. The near-to-far ratio is measured the same way, from
 * two equal world segments at the two end reaches, so the figure the rail
 * prints is the compression actually on screen rather than a nominal one.
 */
function Projector({
  anchors,
  registry,
  nearZ,
  farZ,
  labelWidth,
}: {
  anchors: readonly Anchor[];
  registry: RefObject<Registry>;
  nearZ: number;
  farZ: number;
  labelWidth: number;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const probeA = useMemo(() => new THREE.Vector3(), []);
  const probeB = useMemo(() => new THREE.Vector3(), []);
  const shown = useRef(-1);

  useEffect(() => {
    invalidate();
  }, [anchors, invalidate]);

  useFrame(({ camera, size }) => {
    const reg = registry.current;
    for (const anchor of anchors) {
      const element = reg.get(anchor.key);
      if (!element) continue;
      scratch.copy(anchor.world).project(camera);
      const behind = scratch.z > 1;
      let x = ((scratch.x + 1) / 2) * size.width;
      const y = clamp(((1 - scratch.y) / 2) * size.height, 2, size.height - 2);
      if (element.dataset.wide === '1') {
        // A block of text anchored near an edge would run off the scene, so it
        // turns and reads back toward the middle, and its anchor is held far
        // enough in that the turn is always enough.
        const room = labelWidth + 24;
        const flip = x + room > size.width;
        element.classList.toggle('is-flipped', flip);
        x = flip ? clamp(x, room, size.width - 8) : clamp(x, 8, size.width - room);
      } else {
        x = clamp(x, 2, size.width - 2);
      }
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      element.style.opacity = behind ? '0' : '1';
    }
    const measure = (z: number): number => {
      probeA.set(-5, 0, z).project(camera);
      probeB.set(5, 0, z).project(camera);
      return Math.abs(probeB.x - probeA.x);
    };
    const far = measure(farZ);
    const near = measure(nearZ);
    const ratio = near > 0 ? Math.round((far / near) * 100) : 100;
    if (ratio !== shown.current) {
      shown.current = ratio;
      const element = reg.get('ratio');
      if (element) element.textContent = `${ratio}%`;
    }
  });
  return null;
}

// ─── Overlay: the rail ──────────────────────────────────────────────────────

/**
 * Every piece of chrome lives in ONE column down the right edge. The 2D
 * version scattered five absolutely-positioned blocks over the drawing and
 * they collided the moment the box shrank — the type filter landed on the
 * source list, the denominator line landed on the date axis. A single flow
 * column cannot do that at any size: blocks stack, the scene is given the rest
 * of the box, and the only thing that varies with height is how much of the
 * source list fits, which the list says out loud.
 */
interface RailPlan {
  width: number;
  rowHeight: number;
  showSpans: boolean;
  showNote: boolean;
  /** A short box closes the rhythm up and lets the source index go first. */
  tight: boolean;
}

function railPlan(width: number, height: number): RailPlan {
  const railWidth = width >= 1000 ? 250 : width >= 720 ? 228 : Math.max(186, Math.round(width * 0.34));
  return {
    width: railWidth,
    rowHeight: height >= 860 ? 16 : height >= 700 ? 13.4 : 12.6,
    showSpans: railWidth >= 210,
    showNote: height >= 430,
    tight: height < 660,
  };
}

function Figures({ data, reading }: { data: ObsData; reading: Reading }) {
  const { stats } = data;
  const drawn = data.links.length;
  return (
    <dl className="mr-figs">
      <div>
        <dt className="obs-label">Links drawn</dt>
        <dd className="obs-figure">
          {nf.format(drawn)} of {nf.format(stats.linksStored)}
        </dd>
      </div>
      <div>
        <dt className="obs-label">Sources</dt>
        <dd className="obs-figure">{reading.sources.length}</dd>
      </div>
      <div>
        <dt className="obs-label">Days with writing</dt>
        <dd className="obs-figure">
          {reading.axis.daysWithWriting} of {reading.axis.spanDays}
        </dd>
      </div>
      <div>
        <dt className="obs-label">Silent days</dt>
        <dd className="obs-figure">{reading.axis.silentDays}, drawn narrow</dd>
      </div>
      <div>
        <dt className="obs-label">Reaches</dt>
        <dd className="obs-figure">{reading.reaches.length}, oldest at the back</dd>
      </div>
      <div>
        <dt className="obs-label">Inside 24 hours</dt>
        <dd className="obs-figure">{pct(reading.within24h, drawn)}% of links</dd>
      </div>
      <div>
        <dt className="obs-label">Over {stats.halfLifeDays} days apart</dt>
        <dd className="obs-figure">{nf.format(reading.farLinks)} links</dd>
      </div>
    </dl>
  );
}

interface SourceListProps {
  reading: Reading;
  plan: RailPlan;
  lit: number | null;
  pinned: number | null;
  onHover: (index: number | null) => void;
  onPin: (index: number | null) => void;
}

function SourceList({ reading, plan, lit, pinned, onHover, onPin }: SourceListProps) {
  const { sources, axis } = reading;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [perColumn, setPerColumn] = useState(sources.length);

  // The list is the one block that gives way when the box is short: it takes
  // whatever the fixed blocks leave, sets itself in two columns when one will
  // not hold every source, and says how many it is showing rather than
  // silently clipping — rule 8 applies to a truncated list as much as to a
  // truncated link set. Measuring the flex-sized box cannot loop, because its
  // height is set by the column, never by its own content.
  useEffect(() => {
    const element = boxRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPerColumn(Math.max(0, Math.floor(element.clientHeight / plan.rowHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [plan.rowHeight]);

  const columns = perColumn >= sources.length || plan.width < 196 ? 1 : 2;
  const fits = perColumn * columns;
  const shown = useMemo(() => {
    // Under two rows the index is dropped rather than shown as a stub: every
    // source is a lane in the scene and the count is in the figures above, so
    // the head goes on saying what the lanes are.
    if (fits < 2) return [];
    if (fits >= sources.length) return sources;
    const keep = new Set(
      [...sources]
        .sort((a, b) => b.count - a.count)
        .slice(0, fits)
        .map((s) => s.index)
    );
    return sources.filter((s) => keep.has(s.index));
  }, [sources, fits]);
  const spanFrom = axis.firstDay * DAY_MS;
  const spanMs = Math.max(1, (axis.lastDay + 1) * DAY_MS - spanFrom);

  return (
    <section className="mr-block mr-block-grow">
      <h3 className="obs-label mr-head">
        {shown.length === sources.length
          ? `${sources.length} sources, nearest lane first`
          : shown.length === 0
            ? `${sources.length} sources as lanes, nearest first`
            : `${shown.length} largest of ${sources.length} sources`}
      </h3>
      <div className="mr-rows-box" ref={boxRef}>
      <ul className={`mr-rows${columns > 1 ? ' is-split' : ''}`} style={{ columnCount: columns }}>
        {shown.map((s) => (
          <li key={s.name} style={{ height: plan.rowHeight }}>
            <button
              type="button"
              className={`mr-row${lit === s.index ? ' is-lit' : ''}`}
              aria-pressed={pinned === s.index}
              onPointerEnter={() => onHover(s.index)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(s.index)}
              onBlur={() => onHover(null)}
              onClick={() => onPin(pinned === s.index ? null : s.index)}
              title={`${s.name}: ${nf.format(s.count)} memories, ${fullDate(s.firstMs)} to ${fullDate(s.lastMs)}`}
            >
              <span className="mr-row-name">{s.name}</span>
              {plan.showSpans && columns === 1 ? (
                <span className="mr-span" aria-hidden>
                  <i
                    style={{
                      left: `${clamp(((s.firstMs - spanFrom) / spanMs) * 100, 0, 100)}%`,
                      width: `${clamp(((s.lastMs - s.firstMs) / spanMs) * 100, 1.5, 100)}%`,
                    }}
                  />
                </span>
              ) : null}
              <span className="mr-row-n">{nf.format(s.count)}</span>
            </button>
          </li>
        ))}
      </ul>
      </div>
    </section>
  );
}

function viewNote(view: ViewId, visible: Visible, data: ObsData, type: TypeFilter): string {
  const of = `of ${nf.format(visible.typeLinks)}${type === 'all' ? '' : ` between ${type} memories`}`;
  const drawn = visible.indices.length;
  const split = `${nf.format(visible.agrees)} agree, ${nf.format(visible.contradicts)} contradict`;
  switch (view) {
    case 'far':
      return `${nf.format(drawn)} ${of} join memories written more than ${data.stats.halfLifeDays} days apart; ${split}.`;
    case 'cross':
      return `${nf.format(drawn)} ${of} join two different sources; ${split}.`;
    case 'contradicts':
      return `${nf.format(drawn)} ${of} contradict.`;
    default:
      return type === 'all'
        ? `${split}. An arc rises with the days between its two ends.`
        : `${nf.format(drawn)} ${of} drawn; ${split}.`;
  }
}

// ─── Plate ──────────────────────────────────────────────────────────────────

const NO_LINKS: readonly number[] = [];
const NO_NEIGHBOURS: ReadonlySet<number> = new Set<number>();

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const [now] = useState(() => Date.now());
  const [view, setView] = useState<ViewId>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [hover, setHover] = useState<number | null>(null);
  const [hoverSource, setHoverSource] = useState<number | null>(null);
  const [pinnedSource, setPinnedSource] = useState<number | null>(null);
  const registry = useRef<Registry>(new Map());

  const [webgl] = useState(() => {
    if (typeof document === 'undefined') return false;
    try {
      const probe = document.createElement('canvas');
      const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
      // Hand the probe context straight back: five plates share one browser's
      // context pool and the chooser mounts and unmounts them, so a probe kept
      // alive on every mount drains it and previously-fine plates go black.
      context?.getExtension('WEBGL_lose_context')?.loseContext();
      return context !== null;
    } catch {
      return false;
    }
  });

  const rail = useMemo(() => railPlan(width, height), [width, height]);
  const sceneWidth = Math.max(120, width - rail.width);
  const sceneHeight = Math.max(120, height);
  const wanted = wantedReaches(sceneWidth, sceneHeight);
  const aspect = sceneWidth / sceneHeight;

  const reading = useMemo(() => buildReading(data, wanted, aspect, now), [data, wanted, aspect, now]);
  const visible = useMemo(() => computeVisible(data, reading, view, type), [data, reading, view, type]);
  const fit = useMemo(() => cameraFit(reading, aspect), [reading, aspect]);

  const selected = selectedId === null ? null : (reading.idIndex.get(selectedId) ?? null);
  const live = hover ?? (visible.nodes[selected ?? -1] === 1 ? selected : null);
  const litSource = hoverSource ?? pinnedSource;

  const neighbours = useMemo(() => {
    if (live === null) return NO_NEIGHBOURS;
    const set = new Set<number>();
    for (const t of reading.threads) {
      if (visible.links[t.index] !== 1) continue;
      if (t.older === live) set.add(t.newer);
      else if (t.newer === live) set.add(t.older);
    }
    return set;
  }, [live, reading.threads, visible.links]);

  const focusIndices = useMemo<readonly number[]>(() => {
    if (live !== null) {
      return reading.threads
        .filter((t) => visible.links[t.index] === 1 && (t.older === live || t.newer === live))
        .map((t) => t.index);
    }
    if (pinnedSource !== null) {
      return reading.threads
        .filter(
          (t) =>
            visible.links[t.index] === 1 &&
            (reading.beads.lane[t.older] === pinnedSource || reading.beads.lane[t.newer] === pinnedSource)
        )
        .map((t) => t.index);
    }
    return NO_LINKS;
  }, [live, pinnedSource, reading.threads, reading.beads.lane, visible.links]);

  const restBuffers = useMemo(() => threadBuffers(reading, visible.indices), [reading, visible.indices]);
  const focusBuffers = useMemo(() => threadBuffers(reading, focusIndices), [reading, focusIndices]);
  const dimmed = focusIndices.length > 0;

  const anchors = useMemo<Anchor[]>(() => {
    const out: Anchor[] = [];
    const half = WRAP_W / 2;
    const edgeZ = (index: number): number =>
      (index - (reading.reaches.length - 1) / 2) * reading.reachPitch +
      reading.laneSpan / 2 +
      MONTH_TICK_LEN * 1.7;
    for (const r of reading.reaches) {
      out.push({ key: `reach-${r.index}`, world: new THREE.Vector3(-half, 0, edgeZ(r.index)) });
    }
    const last = reading.reaches[reading.reaches.length - 1];
    if (last) {
      out.push({
        key: 'today',
        world: new THREE.Vector3(-half + (last.u1 - last.u0) * reading.unitPx, 0, edgeZ(last.index)),
      });
    }
    if (reading.flood) out.push({ key: 'flood', world: reading.flood.world });
    if (litSource !== null) {
      const source = reading.sources[litSource];
      if (source) {
        const i = source.members[Math.floor(source.members.length / 2)]!;
        out.push({
          key: 'lane',
          world: new THREE.Vector3(reading.beads.x[i]!, reading.beads.y[i]! + 1.2, reading.beads.z[i]!),
        });
      }
    }
    if (live !== null) {
      out.push({
        key: 'readout',
        world: new THREE.Vector3(
          reading.beads.x[live]!,
          reading.beads.y[live]! + 1.4,
          reading.beads.z[live]!
        ),
      });
    }
    return out;
  }, [reading, litSource, live]);

  const nearZ = ((reading.reaches.length - 1) / 2) * reading.reachPitch;
  /** How wide a block of projected text may be before it must wrap. */
  const labelWidth = clamp(sceneWidth - 44, 148, 296);
  const refFor = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      registry.current.set(key, element);
    },
    []
  );

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      onSelect(selectedId === node.id ? null : node.id);
    },
    [data.nodes, onSelect, selectedId]
  );
  const clear = useCallback(() => {
    setPinnedSource(null);
    onSelect(null);
  }, [onSelect]);

  const liveNode = live === null ? null : data.nodes[live]!;
  const { stats, links } = data;
  const firstMs = reading.axis.firstDay * DAY_MS;
  const lastMs = reading.axis.lastDay * DAY_MS;

  const summary =
    `${nf.format(stats.memories)} memories laid out by order of writing, ${fullDate(firstMs)} to ` +
    `${fullDate(lastMs)}, on ${reading.reaches.length} reaches stacked in depth with the oldest at ` +
    `the back and each read left to right. A day is as wide as what was written in it, so ` +
    `${reading.axis.daysWithWriting} of ${reading.axis.spanDays} days carry every mark and the ` +
    `${reading.axis.silentDays} silent days stay narrow. Each of ${reading.sources.length} sources is ` +
    `a lane across the reaches. ${nf.format(links.length)} of ${nf.format(stats.linksStored)} links ` +
    `arch above, rising with the distance in time they cross: ${pct(reading.within24h, links.length)}% ` +
    `join memories written inside 24 hours, and ${nf.format(reading.farLinks)} reach further apart ` +
    `than the ${stats.halfLifeDays}-day half-life.` +
    (reading.flood
      ? ` The largest sitting is ${reading.flood.name}, ${reading.flood.when}: ` +
        `${nf.format(reading.flood.count)} memories and ${nf.format(reading.flood.links)} links, ` +
        `${Math.round(reading.flood.contradictShare * 100)}% of them contradictions.`
      : '');

  return (
    <div className="mr-box" style={{ width, height }}>
      <style href="plate-memory-river" precedence="medium">
        {SHEET_CSS}
      </style>

      <div className="mr-scene" style={{ right: rail.width }}>
        {webgl ? (
          <>
            <div className="mr-canvas" role="img" aria-label={summary}>
              <Canvas
                frameloop="demand"
                dpr={[1, 2]}
                gl={{
                  antialias: true,
                  // Every contrast ratio and ΔE in the token layer was measured
                  // on raw sRGB; R3F's ACES default would move all of them.
                  toneMapping: THREE.NoToneMapping,
                }}
                camera={{
                  fov: CAM_FOV,
                  near: 0.5,
                  far: fit.distance * 4,
                  position: [fit.position.x, fit.position.y, fit.position.z],
                }}
                onPointerMissed={clear}
              >
                <Rig fit={fit} reducedMotion={reducedMotion} />
                <Terraces reading={reading} lit={litSource} />
                <ThreadField
                  buffers={restBuffers}
                  coreAlpha={dimmed ? CORE_ALPHA_DIM : 1}
                  haloAlpha={dimmed ? HALO_ALPHA_DIM : HALO_ALPHA}
                />
                <ThreadField buffers={focusBuffers} coreAlpha={1} haloAlpha={HALO_ALPHA * 1.6} />
                <BeadField
                  reading={reading}
                  visible={visible}
                  live={live}
                  neighbours={neighbours}
                  litSource={litSource}
                  onHover={setHover}
                  onPick={pick}
                />
                <Projector
                  anchors={anchors}
                  registry={registry}
                  nearZ={nearZ}
                  farZ={-nearZ}
                  labelWidth={labelWidth}
                />
              </Canvas>
            </div>

            <div className="mr-marks" aria-hidden>
              {reading.reaches.map((r) => (
                <div key={r.index} className="mr-anchor" ref={refFor(`reach-${r.index}`)}>
                  <span className="mr-reach obs-label">
                    <b>{r.index + 1}</b>
                    {dayMonth((reading.axis.firstDay + r.day0) * DAY_MS)} to{' '}
                    {dayMonth((reading.axis.firstDay + r.day1 - 1) * DAY_MS)}, {nf.format(r.memories)}{' '}
                    memories{r.silence ? `, after ${r.silence} silent days` : ''}
                  </span>
                </div>
              ))}
              <div className="mr-anchor" ref={refFor('today')}>
                <span className="mr-reach mr-today obs-label">
                  today, {dayMonth(reading.axis.today * DAY_MS)}
                </span>
              </div>
              {reading.flood ? (
                <div className="mr-anchor" data-wide="1" ref={refFor('flood')}>
                  <span className="mr-callout" style={{ maxWidth: labelWidth }}>
                    <span className="mr-callout-name">
                      {reading.flood.name}, {reading.flood.when}
                    </span>
                    <span className="mr-callout-caps obs-label">
                      {nf.format(reading.flood.count)} memories, {nf.format(reading.flood.links)} links,{' '}
                      {Math.round(reading.flood.contradictShare * 100)}% of them contradictions
                    </span>
                  </span>
                </div>
              ) : null}
              {litSource !== null && reading.sources[litSource] ? (
                <div className="mr-anchor" ref={refFor('lane')}>
                  <span className="mr-lane obs-label">{reading.sources[litSource]!.name}</span>
                </div>
              ) : null}
              {liveNode ? (
                <div className="mr-anchor" data-wide="1" ref={refFor('readout')}>
                  <span className="mr-readout" style={{ maxWidth: labelWidth }}>
                    <span className="mr-readout-name">{liveNode.label}</span>
                    <span className="mr-readout-meta">
                      {reading.laneName[reading.beads.lane[live!]!]},{' '}
                      {fullDate(reading.times[live!]!)}
                      <br />
                      {liveNode.type}, {nf.format(liveNode.degree)} links: {nf.format(liveNode.agreeDegree)}{' '}
                      agree, {nf.format(liveNode.contradictDegree)} contradict
                      <br />
                      {RETENTION_LABEL[liveNode.retentionBand]}
                      {selected === live ? ', selected' : ''}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <p className="mr-nogl obs-note">
            This reading is drawn with WebGL and this browser did not give the page a context. The
            measurements still hold: {summary}
          </p>
        )}
      </div>

      <aside
        className={`mr-rail${rail.width < 214 ? ' is-narrow' : ''}${rail.tight ? ' is-tight' : ''}`}
        style={{ width: rail.width }}
      >
        <header className="mr-title">
          <h2>Memory River</h2>
          <p className="obs-label mr-sub">
            {nf.format(stats.memories)} memories, {dayMonth(firstMs)} to {fullDate(lastMs)}
            {reading.axis.undated ? `, ${reading.axis.undated} undated drawn at today` : ''}
          </p>
        </header>

        <Figures data={data} reading={reading} />

        {rail.showNote ? (
          <p className="mr-note">
            Left to right. A day is as wide as what was written in it, and a fold falls only where
            the store went silent, so no sitting is cut.
            {webgl ? (
              <>
                {' '}
                The far reach is drawn at{' '}
                <span className="mr-ratio obs-figure" ref={refFor('ratio')}>
                  —
                </span>{' '}
                of the near.
              </>
            ) : null}
          </p>
        ) : null}

        <section className="mr-block">
          <h3 className="obs-label mr-head">Which links are drawn</h3>
          <div className="mr-choices" role="radiogroup" aria-label="Which links are drawn">
            {VIEWS.map((v) => {
              const count =
                v.id === 'all'
                  ? visible.typeLinks
                  : reading.threads.filter(
                      (t) => visible.nodes[t.older] && visible.nodes[t.newer] && viewPass(t, v.id)
                    ).length;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={view === v.id}
                  className="mr-choice"
                  onClick={() => setView(v.id)}
                >
                  <span className="mr-dot" aria-hidden />
                  <span className="mr-choice-name">{v.name}</span>
                  <span className="mr-row-n">{nf.format(count)}</span>
                </button>
              );
            })}
          </div>
          <p className="mr-foot">{viewNote(view, visible, data, type)}</p>
        </section>

        <section className="mr-block">
          <h3 className="obs-label mr-head">Memory type</h3>
          <div className="mr-types" role="radiogroup" aria-label="Memory type">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={type === t.id}
                className="mr-type"
                onClick={() => setType(t.id)}
              >
                {t.name}
                <span className="mr-row-n">
                  {t.id === 'all' ? nf.format(stats.memories) : nf.format(stats.byType[t.id])}
                </span>
              </button>
            ))}
          </div>
        </section>

        <SourceList
          reading={reading}
          plan={rail}
          lit={litSource}
          pinned={pinnedSource}
          onHover={setHoverSource}
          onPin={setPinnedSource}
        />
      </aside>
    </div>
  );
}

// ─── The sheet ──────────────────────────────────────────────────────────────
//
// Scoped to this plate's box. Rule 9: the scene bleeds to three edges and the
// rail bleeds to the other three — one hairline on the side they meet, no
// radius, no shadow, no card. Nothing here is set in capitals; register is
// carried by Archivo's width axis, which is the reason the family is loaded.

const SHEET_CSS = `
.mr-box { position: absolute; inset: 0; overflow: hidden; font-family: var(--font-instrument); color: var(--ink); }
.mr-scene { position: absolute; left: 0; top: 0; bottom: 0; }
.mr-canvas { position: absolute; inset: 0; }
p.mr-nogl { position: absolute; inset: 0; margin: 0; padding: 26px 22px; max-width: 54ch; overflow: auto; }
.mr-marks { position: absolute; inset: 0; pointer-events: none; }

.mr-anchor { position: absolute; left: 0; top: 0; will-change: transform; }
.mr-anchor span { text-shadow: 0 0 4px var(--plate), 0 0 9px var(--plate); }
.mr-reach {
  position: absolute; left: 0; top: 3px; white-space: nowrap;
  color: var(--ink-2); font-variant-numeric: tabular-nums;
}
.mr-reach b { display: inline-block; min-width: 11px; font-weight: 500; color: var(--ink); }
.mr-today { left: auto; right: 0; top: auto; bottom: 15px; color: var(--ink); }
.mr-lane {
  position: absolute; left: 0; bottom: 0; transform: translateX(-50%);
  white-space: nowrap; color: var(--ink); background: var(--plate); padding: 0 3px;
}

.mr-callout { position: absolute; left: 10px; bottom: 6px; display: block; width: max-content; }
.mr-callout::before {
  content: ''; position: absolute; left: -10px; bottom: -6px; width: 9px; height: 9px;
  border-left: 1px solid var(--ink-2); border-bottom: 1px solid var(--ink-2);
}
/* Near the right edge of the scene a block of text turns and reads leftward;
   the corner mark that ties it to its place turns with it. */
.is-flipped .mr-callout { left: auto; right: 10px; text-align: right; }
.is-flipped .mr-callout::before { left: auto; right: -10px; border-left: none; border-right: 1px solid var(--ink-2); }
.is-flipped .mr-readout { left: auto; right: 12px; }
.mr-callout-name { display: block; font-size: var(--t-body); line-height: 1.24; color: var(--ink); }
.mr-callout-caps { display: block; margin-top: 2px; line-height: 1.3; color: var(--ink-2); }

.mr-readout {
  position: absolute; left: 12px; bottom: 8px; display: block; width: max-content; padding: 8px 10px;
  background: var(--margin); border: 1px solid var(--rule);
}
.mr-readout-name {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: var(--t-body); line-height: 1.32; color: var(--ink); overflow-wrap: anywhere;
}
.mr-readout-meta { display: block; margin-top: 4px; font-size: var(--t-label); line-height: 1.4; color: var(--ink-2); }

.mr-rail {
  position: absolute; right: 0; top: 0; bottom: 0;
  display: flex; flex-direction: column; gap: 12px;
  padding: 15px 18px 15px 16px; overflow: hidden;
  background: var(--margin); border-left: 1px solid var(--rule);
}
.mr-title { flex: 0 0 auto; }
.mr-title h2 {
  margin: 0; font-family: var(--font-note); font-weight: 200; font-size: var(--t-mast);
  line-height: 1; letter-spacing: -0.005em; color: var(--ink);
}
.mr-rail.is-narrow h2 { font-size: 23px; }
.mr-rail.is-tight { gap: 8px; padding-top: 11px; padding-bottom: 11px; }
.mr-rail.is-tight h2 { font-size: 25px; }
.mr-rail.is-tight .mr-figs { gap: 1px; }
.mr-rail.is-tight .mr-foot { min-height: 0; }
.mr-sub { margin: 6px 0 0; line-height: 1.3; }

.mr-figs { flex: 0 0 auto; margin: 0; display: flex; flex-direction: column; gap: 3px; }
.mr-figs > div { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: baseline; }
.mr-figs dt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-figs dd { margin: 0; font-size: var(--t-body); white-space: nowrap; }

.mr-note {
  flex: 0 0 auto; margin: 0; font-family: var(--font-note); font-weight: 300;
  font-size: var(--t-body); line-height: 1.46; color: var(--ink-2);
}
.mr-ratio { font-family: var(--font-instrument); font-size: var(--t-body); color: var(--ink); }

.mr-block { flex: 0 0 auto; min-height: 0; }
/* The index is last in the column, so it is the only block a short box can
   take space from — and it keeps its heading, which carries the count. */
.mr-block-grow { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 21px; }
.mr-rows-box { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.mr-head { margin: 0 0 5px; font-weight: 500; }
.mr-rows { list-style: none; margin: 0; padding: 0; column-gap: 9px; }
.mr-rows.is-split .mr-row { gap: 5px; }
.mr-rows.is-split .mr-row-name { font-size: var(--t-label); }
.mr-rows li { display: block; line-height: 1.1; }
.mr-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px;
  align-items: center; width: 100%; height: 100%; text-align: left;
  color: var(--ink-2); transition: color var(--dur) var(--ease);
}
.mr-row:has(.mr-span) { grid-template-columns: minmax(0, 1fr) 52px auto; }
.mr-row-name { font-size: var(--t-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mr-row-n { font-size: var(--t-label); font-variant-numeric: tabular-nums; color: var(--ink-3); }
.mr-span { position: relative; display: block; height: 3px; background: var(--rule); }
.mr-span i { position: absolute; top: 0; bottom: 0; background: var(--ink-3); transition: background var(--dur) var(--ease); }
.mr-row:hover, .mr-row.is-lit { color: var(--ink); }
.mr-row:hover .mr-row-n, .mr-row.is-lit .mr-row-n { color: var(--ink-2); }
.mr-row:hover .mr-span i, .mr-row.is-lit .mr-span i { background: var(--ink); }
.mr-row[aria-pressed='true'] .mr-span i { background: var(--ink); }
.mr-row[aria-pressed='true'] .mr-row-name { text-decoration: underline; text-underline-offset: 3px; }

.mr-choices { display: flex; flex-direction: column; gap: 2px; }
.mr-choice {
  display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; gap: 8px; align-items: center;
  width: 100%; text-align: left; color: var(--ink-3); transition: color var(--dur) var(--ease);
}
.mr-choice-name { font-size: var(--t-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mr-choice:hover { color: var(--ink-2); }
.mr-choice[aria-checked='true'] { color: var(--ink); }
.mr-dot { position: relative; width: 9px; height: 9px; border: 1px solid currentColor; border-radius: 50%; }
.mr-choice[aria-checked='true'] .mr-dot::after { content: ''; position: absolute; inset: 2px; border-radius: 50%; background: currentColor; }
/* Three lines held open whatever the view says, so switching views cannot
   reflow the source list under the pointer. */
.mr-foot { margin: 8px 0 0; min-height: 4.1em; font-size: var(--t-label); line-height: 1.36; color: var(--ink-3); }

.mr-types { display: flex; flex-wrap: wrap; gap: 3px 12px; }
.mr-type {
  display: flex; gap: 5px; align-items: baseline; font-size: var(--t-body);
  color: var(--ink-3); transition: color var(--dur) var(--ease);
}
.mr-type:hover { color: var(--ink-2); }
.mr-type[aria-checked='true'] { color: var(--ink); }
`;

// ─── Module ─────────────────────────────────────────────────────────────────

export const memoryRiver: DemoModule = {
  id: 'river',
  name: 'Memory River',
  dimension: '3D',
  claim:
    'Time is the one axis this store genuinely has: laid out by order of writing, it becomes a few dense sittings joined by a handful of long threads, and one five-day flood of reflections holds almost every contradiction.',
  Plate,
};
