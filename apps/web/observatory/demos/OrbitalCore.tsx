/**
 * SLOT 13 of 15 — three dimensions.  "Orbital Memory Core."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * A brilliant core at the centre — NOW — and every memory falling away from
 * it on the store's own decay curve. Distance from the core is AGE, and
 * nothing else. Retention on this harness is 2^(−age / 7), a pure function of
 * age, so putting it on radius adds no information age does not already carry;
 * the honest thing is to say so on screen rather than pretend the two are
 * different channels. What radius buys is the one reading this store needs:
 * a memory near the rim is about to be archived, and a knot of memories near
 * the rim is a whole subject about to be archived.
 *
 *   • radius   = age, banded then ranked (see The 564, below).
 *   • angle    = which CLUSTER the memory belongs to. Louvain on the link
 *                graph finds ~27 communities on this store; each is a sector,
 *                sectors are ordered by the cluster's bearing in the PCA
 *                projection so neighbours in meaning are neighbours in angle,
 *                and a sector's width is the cluster's size. Isolated
 *                memories get a sector of their own, named as such.
 *   • tilt     = a cluster's orbit plane leans out of the ecliptic by the
 *                cluster's contradiction share: a cluster whose links all
 *                agree rides flat, one that argues with itself inclines, up to
 *                32° at 100%. It is a redundant reading of the orange links
 *                inside it, chosen because the reference wants tilted orbits
 *                and tilt should mean something rather than nothing.
 *   • rings    = solid: the four retention bands the contract defines, each
 *                named with its real count and its real age range. Dotted:
 *                one ring per week, i.e. one more halving of retention. Fine,
 *                tilted: each named cluster's own orbit at its median radius.
 *
 * ─── The 564 ───────────────────────────────────────────────────────────────
 *
 * Measured at the time of writing: 564 of 653 memories sit at threshold, and
 * 363 of them were written inside one five-day stretch in July. Any radius
 * that is a VALUE of age piles the store into one ring: linear, square-root
 * and log mappings all put 54–57% of the memories into a single twentieth of
 * the radius, and 1 − retention puts 86% into the outer twentieth. The switch
 * at the bottom left keeps two of those mappings so the collapse can be
 * watched rather than asserted.
 *
 * The default is RANK. Each band gets an annulus whose width grows with the
 * square root of its count (so the 10 holding memories still get a ring wide
 * enough to name), and inside its annulus a band's memories are placed in age
 * order at equal spacing. Nothing collapses, band order is exact, and the
 * dotted week rings — placed where each week's boundary falls in the ranking
 * — turn the age histogram into ring SPACING: two week rings far apart are a
 * week of heavy writing, a stack of them close together is months of silence.
 *
 * What it costs, stated on screen: radius orders age, it does not measure it.
 * Two memories one ring apart can be an hour or a month apart. And the five
 * big July clusters, written within two days of each other, are stretched
 * across the same third of the outer band and read as fans rather than knots
 * — the price of not drawing 363 memories on one ring. The inner bands are
 * also wider than their share of the store; the count on each ring is the
 * correction.
 *
 * ─── What the reference implied and this slot refused ─────────────────────
 *
 * The reference images print 12,428 memories, 317 clusters, 1,892 connections
 * and name bands like working memory. None of that exists here. Every figure
 * on this plate is derived from `data` at render: 653 memories, 3,103 of 8,496
 * links, four bands with the contract's names and live counts, ~27 clusters
 * from the link graph. There is no topic taxonomy, so a cluster is named by
 * the label of its busiest memory and the plate says so. The reference's
 * one-warm-to-seven-cool ratio is not honoured because it is not true: links
 * split 1,564 / 1,539. Blue dominates anyway, because agreements run strong
 * (median 0.93, the brightest step) and contradictions run weak (0.57, the
 * darkest), and that is the store's own doing. The LIVE pill means read from
 * the running store, not streaming, and the read time is printed beside it.
 *
 * ─── Glow, and what it must not destroy ────────────────────────────────────
 *
 * Every link is drawn twice from one batched instanced geometry. The crisp
 * pass is a 1.4-device-pixel ribbon, NORMAL-blended at full opacity, so the
 * centre of every filament is exactly its token colour and the three strength
 * steps keep their measured contrasts (3.06–6.18:1). The halo pass is the
 * same hue at α 0.16 over a soft 8-pixel width, ADDITIVE, so it can lift the
 * ground and stack where filaments overlap, but never changes a filament's
 * hue and never reaches its centre alone. Measured in linear light: it takes
 * three to four coincident halos to lift a weak step to the mid step's luminance, and
 * that only happens inside a knot where no individual step is readable
 * anyway. Bloom's luminance threshold is 0.5; the brightest link token is
 * 0.296 (agrees-strong) and 0.282 (contradicts-strong), so no single link
 * blooms — only the core, the focused memory (ink, 0.852) and the densest
 * stacks do. Kind survives because bloom preserves hue; strength survives
 * because it is read on the crisp pass, which bloom does not touch.
 *
 * No tone mapping (the token layer was measured on raw sRGB). No colour on
 * retention: it is radius and a word. No colour on density: it is how many
 * halos stack. No autorotation, no ticking; the one motion is the slide
 * between radius mappings, which `reducedMotion` replaces with the settled
 * state at once.
 *
 * ─── Where this could be wrong ─────────────────────────────────────────────
 *
 * Louvain is deterministic here but not canonical: a different resolution or
 * node order gives a different 27. Sector ORDER follows a PCA bearing that
 * keeps 38% of the variance, so "neighbours in angle" is a weak claim. And
 * the fans: if the owner wants the July clusters to read as knots, the radius
 * has to be a value of age, and then the 564 pile up. Both are on the switch.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  linkColorInt,
  type DemoModule,
  type DemoProps,
  type ObsData,
  type RetentionBand,
} from './contract';

// ─── The encoding, as constants ─────────────────────────────────────────────

const TAU = Math.PI * 2;
const DAY_MS = 86_400_000;

/** World radius of the outermost orbit. Every radius below is a fraction of it. */
const R_MAX = 100;
/** The hole the core sits in. A memory written this second would sit on its rim. */
const R_HOLE = 0.1;
/** How far a cluster's orbit plane leans at a 100% contradiction share. */
const TILT_MAX = (32 / 180) * Math.PI;
/** Kept clear at the front meridian so the band rings can be named there. */
const LABEL_GAP = (18 / 180) * Math.PI;
/** Between neighbouring sectors, and the share of a sector kept clear at each edge. */
const SECTOR_GAP = (0.9 / 180) * Math.PI;
const SECTOR_INSET = 0.07;
/** A cluster with at least this many memories is named and gets its own orbit ring. */
const NAMED_MIN = 8;
/** A week ring gets a numeral when at least this many memories fall inside it. */
const WEEK_LABEL_MIN = 25;

const BANDS: readonly RetentionBand[] = ['vivid', 'holding', 'fading', 'threshold'];

/** Memory dot size in CSS pixels at the initial framing, from degree. Most are tiny. */
const DOT_BASE = 1.6;
const DOT_PER_LOG_DEGREE = 1.15;
const DOT_FOCUS_SCALE = 1.8;
const CORE_SIZE = 20;
/** Ribbon half-widths in CSS pixels. */
const CRISP_HALF = 0.7;
const HALO_HALF = 4;
const RING_HALF = 0.5;
const HALO_ALPHA = 0.16;
const DOT_HALO_GROW = 3.4;
/** Linear luminance. Brightest link token is 0.296; ink is 0.852. See the header. */
const BLOOM_THRESHOLD = 0.5;
/** Raycast radius for a dot, in world units (1.4% of the outer orbit). */
const PICK_RADIUS = 1.4;
const MORPH_MS = 720;

const CAM_FOV = 38;
/** From the front, 38° above the ecliptic. The front meridian is +z. */
const CAM_DIR = new THREE.Vector3(0.1, 0.62, 0.78).normalize();

type ViewId = 'rank' | 'age' | 'retention';
const VIEWS: readonly { id: ViewId; name: string }[] = [
  { id: 'rank', name: 'Age, ranked' },
  { id: 'age', name: 'Age, to scale' },
  { id: 'retention', name: 'Retention, as stored' },
];

/** The light cuts of Archivo. index.html loads 400–700; the masthead wants 300.
 *  Added at runtime, once, and the page degrades to 400 if the request is blocked. */

const nf = new Intl.NumberFormat('en-US');

// ─── Communities ────────────────────────────────────────────────────────────

interface WEdge {
  s: number;
  t: number;
  w: number;
}

/** Louvain, weighted by link strength, nodes visited in index order so the
 *  result is the same on every load of the same store. */
function louvain(count: number, edges: readonly WEdge[]): Int32Array {
  let curN = count;
  let curEdges: WEdge[] = edges.map((e) => ({ s: e.s, t: e.t, w: e.w }));
  const membership = new Int32Array(count);
  for (let i = 0; i < count; i++) membership[i] = i;

  for (let level = 0; level < 12; level++) {
    const adj: [number, number][][] = Array.from({ length: curN }, () => []);
    const k = new Float64Array(curN);
    let m2 = 0;
    for (const e of curEdges) {
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

    const node2com = new Int32Array(curN);
    for (let v = 0; v < curN; v++) node2com[v] = v;
    const comTot = Float64Array.from(k);
    let improvedAny = false;
    let improved = true;
    for (let pass = 0; improved && pass < 40; pass++) {
      improved = false;
      for (let v = 0; v < curN; v++) {
        const cv = node2com[v]!;
        const kv = k[v]!;
        const weights = new Map<number, number>();
        for (const [u, w] of adj[v]!) {
          const cu = node2com[u]!;
          weights.set(cu, (weights.get(cu) ?? 0) + w);
        }
        comTot[cv] = comTot[cv]! - kv;
        let best = cv;
        let bestGain = (weights.get(cv) ?? 0) - (comTot[cv]! * kv) / m2;
        for (const [c, w] of weights) {
          if (c === cv) continue;
          const gain = w - (comTot[c]! * kv) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        comTot[best] = comTot[best]! + kv;
        if (best !== cv) {
          node2com[v] = best;
          improved = true;
          improvedAny = true;
        }
      }
    }

    const remap = new Map<number, number>();
    const renumbered = new Int32Array(curN);
    for (let v = 0; v < curN; v++) {
      const c = node2com[v]!;
      let id = remap.get(c);
      if (id === undefined) {
        id = remap.size;
        remap.set(c, id);
      }
      renumbered[v] = id;
    }
    for (let i = 0; i < count; i++) membership[i] = renumbered[membership[i]!]!;
    const size = remap.size;
    if (!improvedAny || size === curN) break;

    const agg = new Map<number, number>();
    for (const e of curEdges) {
      const a = renumbered[e.s]!;
      const b = renumbered[e.t]!;
      const key = a < b ? a * size + b : b * size + a;
      agg.set(key, (agg.get(key) ?? 0) + e.w);
    }
    curEdges = [...agg].map(([key, w]) => ({ s: Math.floor(key / size), t: key % size, w }));
    curN = size;
  }
  return membership;
}

// ─── The reading ────────────────────────────────────────────────────────────

interface Cluster {
  /** Rank by size, 0 = largest. The unlinked group is last and marked. */
  id: number;
  unlinked: boolean;
  members: number[];
  /** Links with both ends inside. */
  links: number[];
  contradictShare: number;
  bearing: number;
  hub: number;
  name: string;
  from: number;
  to: number;
  tilt: number;
  named: boolean;
}

interface WeekRing {
  week: number;
  radius: number;
  count: number;
}

interface ViewLayout {
  radius: Float32Array;
  positions: Float32Array;
  bandRing: Record<RetentionBand, number>;
  weekRings: WeekRing[];
  orbitRadius: Float32Array;
  knots: Float32Array;
}

interface Reading {
  clusters: Cluster[];
  clusterOf: Int32Array;
  ages: Float64Array;
  views: Record<ViewId, ViewLayout>;
  bandAges: Record<RetentionBand, { min: number; max: number }>;
  linksOf: number[][];
  busiestWindow: { count: number; from: number; to: number };
  cross: { links: number; contradicts: number };
  named: number;
  readAt: Date;
  /** Share of the radius the threshold band occupies in the retention view. */
  thresholdOuterShare: number;
}

function cleanLabel(raw: string): string {
  const text = raw
    .replace(/^[\s#*[\]_>`-]+/, '')
    .replace(/[\s:*[\]_`-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 30) return text || 'Untitled memory';
  return `${text.slice(0, 29).trimEnd()}…`;
}

function placeAt(r: number, theta: number, cluster: Cluster, out: Float32Array, at: number): void {
  const bis = (cluster.from + cluster.to) / 2;
  const u = r * Math.cos(theta - bis);
  const w = r * Math.sin(theta - bis);
  const lift = u * Math.sin(cluster.tilt);
  const flat = u * Math.cos(cluster.tilt);
  out[at] = (flat * Math.cos(bis) - w * Math.sin(bis)) * R_MAX;
  out[at + 1] = lift * R_MAX;
  out[at + 2] = (flat * Math.sin(bis) + w * Math.cos(bis)) * R_MAX;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function buildClusters(data: ObsData): { clusters: Cluster[]; clusterOf: Int32Array } {
  const { nodes, links } = data;
  const memb = louvain(
    nodes.length,
    links.map((l) => ({ s: l.source, t: l.target, w: l.strength }))
  );
  const groups = new Map<number, number[]>();
  const unlinked: number[] = [];
  nodes.forEach((n, i) => {
    if (n.degree === 0) {
      unlinked.push(i);
      return;
    }
    const c = memb[i]!;
    const list = groups.get(c);
    if (list) list.push(i);
    else groups.set(c, [i]);
  });

  const raw = [...groups.values()].sort((a, b) => b.length - a.length);
  if (unlinked.length) raw.push(unlinked);
  const clusterOf = new Int32Array(nodes.length).fill(-1);
  raw.forEach((members, id) => members.forEach((i) => (clusterOf[i] = id)));

  const clusters: Cluster[] = raw.map((members, id) => {
    const isUnlinked = members === unlinked;
    let cx = 0;
    let cy = 0;
    let hub = members[0]!;
    for (const i of members) {
      const n = nodes[i]!;
      cx += n.x;
      cy += n.y;
      if (n.degree > nodes[hub]!.degree) hub = i;
    }
    return {
      id,
      unlinked: isUnlinked,
      members,
      links: [],
      contradictShare: 0,
      bearing: Math.atan2(cy / members.length, cx / members.length),
      hub,
      name: isUnlinked ? 'No links' : cleanLabel(nodes[hub]!.label),
      from: 0,
      to: 0,
      tilt: 0,
      named: !isUnlinked && members.length >= NAMED_MIN,
    };
  });

  links.forEach((l, k) => {
    const a = clusterOf[l.source]!;
    if (a !== -1 && a === clusterOf[l.target]!) clusters[a]!.links.push(k);
  });
  for (const c of clusters) {
    if (c.unlinked || c.links.length === 0) continue;
    const contra = c.links.filter((k) => links[k]!.kind === 'contradicts').length;
    c.contradictShare = contra / c.links.length;
    c.tilt = c.contradictShare * TILT_MAX;
  }

  // Sectors: the unlinked group first, then clusters by bearing. Order is the
  // only thing bearing sets; width is size.
  const ordered = [
    ...clusters.filter((c) => c.unlinked),
    ...clusters.filter((c) => !c.unlinked).sort((a, b) => a.bearing - b.bearing),
  ];
  const weightOf = (c: Cluster) => c.members.length + 2;
  const total = ordered.reduce((sum, c) => sum + weightOf(c), 0);
  const available = TAU - LABEL_GAP - SECTOR_GAP * ordered.length;
  let cursor = Math.PI / 2 + LABEL_GAP / 2;
  for (const c of ordered) {
    const span = (available * weightOf(c)) / total;
    c.from = cursor;
    c.to = cursor + span;
    cursor = c.to + SECTOR_GAP;
  }
  return { clusters, clusterOf };
}

function buildAngles(data: ObsData, clusters: Cluster[]): Float32Array {
  const angle = new Float32Array(data.nodes.length);
  for (const c of clusters) {
    const span = c.to - c.from;
    const lo = c.from + span * SECTOR_INSET;
    const hi = c.to - span * SECTOR_INSET;
    const byBearing = [...c.members].sort(
      (a, b) => Math.atan2(data.nodes[a]!.y, data.nodes[a]!.x) - Math.atan2(data.nodes[b]!.y, data.nodes[b]!.x)
    );
    byBearing.forEach((i, j) => {
      angle[i] = lo + ((j + 0.5) / byBearing.length) * (hi - lo);
    });
  }
  return angle;
}

interface BandTable {
  /** Members of each band, sorted by age ascending. */
  members: Record<RetentionBand, number[]>;
  /** The rank view's annulus for each band. */
  annulus: Record<RetentionBand, [number, number]>;
}

function buildBandTable(data: ObsData, ages: Float64Array): BandTable {
  const members = { vivid: [], holding: [], fading: [], threshold: [] } as Record<RetentionBand, number[]>;
  data.nodes.forEach((n, i) => members[n.retentionBand].push(i));
  for (const b of BANDS) members[b].sort((a, c) => ages[a]! - ages[c]!);
  const widths = BANDS.map((b) => Math.sqrt(members[b].length));
  const sum = widths.reduce((a, b) => a + b, 0) || 1;
  const annulus = {} as Record<RetentionBand, [number, number]>;
  let lo = R_HOLE;
  BANDS.forEach((b, i) => {
    const hi = lo + ((1 - R_HOLE) * widths[i]!) / sum;
    annulus[b] = [lo, hi];
    lo = hi;
  });
  return { members, annulus };
}

/** Where an age lands in a view. The rank view interpolates through its band
 *  table; a boundary that falls in the gap between two bands sits on the ring. */
function radiusOfAge(view: ViewId, age: number, table: BandTable, ages: Float64Array, maxAge: number, halfLife: number): number {
  if (view === 'age') return Math.min(1, R_HOLE + (1 - R_HOLE) * (maxAge > 0 ? age / maxAge : 0));
  if (view === 'retention') return R_HOLE + (1 - R_HOLE) * (1 - Math.pow(2, -age / halfLife));
  let last = R_HOLE;
  for (const b of BANDS) {
    const list = table.members[b];
    const [lo, hi] = table.annulus[b];
    if (list.length === 0) continue;
    if (age < ages[list[0]!]!) return last;
    if (age <= ages[list[list.length - 1]!]!) {
      let below = 0;
      while (below < list.length && ages[list[below]!]! < age) below++;
      return lo + ((hi - lo) * below) / list.length;
    }
    last = hi;
  }
  return last;
}

function buildView(
  view: ViewId,
  data: ObsData,
  ages: Float64Array,
  maxAge: number,
  table: BandTable,
  clusters: Cluster[],
  clusterOf: Int32Array,
  angle: Float32Array
): ViewLayout {
  const n = data.nodes.length;
  const half = data.stats.halfLifeDays;
  const radius = new Float32Array(n);
  if (view === 'rank') {
    for (const b of BANDS) {
      const list = table.members[b];
      const [lo, hi] = table.annulus[b];
      list.forEach((i, r) => {
        radius[i] = lo + ((r + 0.5) / list.length) * (hi - lo);
      });
    }
  } else {
    for (let i = 0; i < n; i++) radius[i] = radiusOfAge(view, ages[i]!, table, ages, maxAge, half);
  }

  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    placeAt(radius[i]!, angle[i]!, clusters[clusterOf[i]!]!, positions, i * 3);
  }

  const bandRing = {} as Record<RetentionBand, number>;
  let previous = R_HOLE;
  BANDS.forEach((b, k) => {
    const list = table.members[b];
    if (list.length === 0) {
      bandRing[b] = previous;
      return;
    }
    if (view === 'rank') {
      bandRing[b] = table.annulus[b][1];
    } else {
      const outer = radius[list[list.length - 1]!]!;
      const next = BANDS.slice(k + 1)
        .map((nb) => table.members[nb][0])
        .find((i) => i !== undefined);
      bandRing[b] = next === undefined ? 1 : (outer + radius[next]!) / 2;
    }
    previous = bandRing[b];
  });
  bandRing.threshold = Math.max(bandRing.threshold, 1);

  const weekRings: WeekRing[] = [];
  const weeks = Math.ceil(maxAge / half);
  for (let w = 1; w <= weeks; w++) {
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (ages[i]! > (w - 1) * half && ages[i]! <= w * half) count++;
    }
    if (count === 0) continue;
    weekRings.push({ week: w, radius: radiusOfAge(view, w * half, table, ages, maxAge, half), count });
  }

  const orbitRadius = new Float32Array(clusters.length);
  const knots = new Float32Array(clusters.length * 3);
  clusters.forEach((c, k) => {
    const sorted = c.members.map((i) => radius[i]!).sort((a, b) => a - b);
    orbitRadius[k] = median(sorted);
    placeAt(orbitRadius[k]!, (c.from + c.to) / 2, c, knots, k * 3);
  });

  return { radius, positions, bandRing, weekRings, orbitRadius, knots };
}

function buildReading(data: ObsData): Reading {
  const { nodes, links, stats } = data;
  const half = stats.halfLifeDays;
  const ages = new Float64Array(nodes.length);
  let maxAge = 0;
  let freshest = 0;
  nodes.forEach((n, i) => {
    const age = -half * Math.log2(Math.max(n.retention, 1e-12));
    ages[i] = age;
    if (age > maxAge) maxAge = age;
    if (n.retention > nodes[freshest]!.retention) freshest = i;
  });
  const readAt = new Date(Date.parse(nodes[freshest]?.createdAt ?? '') + ages[freshest]! * DAY_MS);

  const { clusters, clusterOf } = buildClusters(data);
  const angle = buildAngles(data, clusters);
  const table = buildBandTable(data, ages);
  const build = (v: ViewId) => buildView(v, data, ages, maxAge, table, clusters, clusterOf, angle);
  const views: Record<ViewId, ViewLayout> = {
    rank: build('rank'),
    age: build('age'),
    retention: build('retention'),
  };

  const bandAges = {} as Record<RetentionBand, { min: number; max: number }>;
  for (const b of BANDS) {
    const list = table.members[b];
    bandAges[b] = list.length
      ? { min: ages[list[0]!]!, max: ages[list[list.length - 1]!]! }
      : { min: 0, max: 0 };
  }

  const linksOf: number[][] = nodes.map(() => []);
  let crossLinks = 0;
  let crossContradicts = 0;
  links.forEach((l, k) => {
    linksOf[l.source]!.push(k);
    linksOf[l.target]!.push(k);
    if (clusterOf[l.source] !== clusterOf[l.target]) {
      crossLinks++;
      if (l.kind === 'contradicts') crossContradicts++;
    }
  });

  const sorted = Array.from(ages).sort((a, b) => a - b);
  const busiestWindow = { count: 0, from: 0, to: 0 };
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (j < sorted.length && sorted[j]! - sorted[i]! <= half) j++;
    if (j - i > busiestWindow.count) {
      busiestWindow.count = j - i;
      busiestWindow.from = sorted[i]!;
      busiestWindow.to = sorted[j - 1]!;
    }
  }

  const thresholdOuterShare = (1 - R_HOLE) * Math.pow(2, -bandAges.threshold.min / half);

  return {
    clusters,
    clusterOf,
    ages,
    views,
    bandAges,
    linksOf,
    busiestWindow,
    cross: { links: crossLinks, contradicts: crossContradicts },
    named: clusters.filter((c) => c.named).length,
    readAt: Number.isFinite(readAt.getTime()) ? readAt : new Date(),
    thresholdOuterShare,
  };
}

// ─── Focus ──────────────────────────────────────────────────────────────────

interface Focus {
  node: number | null;
  cluster: number | null;
  band: RetentionBand | null;
}

interface Lit {
  nodes: Float32Array;
  links: Float32Array;
}

const DIM_NODE = 0.16;
const DIM_LINK = 0.05;
const HALF_LINK = 0.4;

function buildLit(data: ObsData, reading: Reading, focus: Focus): Lit {
  const n = data.nodes.length;
  const nodes = new Float32Array(n).fill(1);
  const links = new Float32Array(data.links.length).fill(1);
  if (focus.node !== null) {
    nodes.fill(DIM_NODE);
    links.fill(DIM_LINK);
    nodes[focus.node] = 1;
    for (const k of reading.linksOf[focus.node]!) {
      const l = data.links[k]!;
      links[k] = 1;
      nodes[l.source] = 1;
      nodes[l.target] = 1;
    }
    return { nodes, links };
  }
  if (focus.cluster !== null) {
    nodes.fill(DIM_NODE);
    for (const i of reading.clusters[focus.cluster]!.members) nodes[i] = 1;
    data.links.forEach((l, k) => {
      const inside = (nodes[l.source] === 1 ? 1 : 0) + (nodes[l.target] === 1 ? 1 : 0);
      links[k] = inside === 2 ? 1 : inside === 1 ? HALF_LINK : DIM_LINK;
    });
    return { nodes, links };
  }
  if (focus.band !== null) {
    data.nodes.forEach((node, i) => {
      nodes[i] = node.retentionBand === focus.band ? 1 : DIM_NODE;
    });
    data.links.forEach((l, k) => {
      const inside = (nodes[l.source] === 1 ? 1 : 0) + (nodes[l.target] === 1 ? 1 : 0);
      links[k] = inside === 2 ? 1 : inside === 1 ? HALF_LINK : DIM_LINK;
    });
  }
  return { nodes, links };
}

// ─── Shaders ────────────────────────────────────────────────────────────────

const DOT_VERTEX = /* glsl */ `
  attribute vec3 posA;
  attribute vec3 posB;
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float t;
  uniform float pxScale;
  uniform float grow;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec3 p = mix(posA, posB, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * grow * pxScale / max(1.0, -mv.z), 1.0, 256.0);
    vAlpha = alpha;
    vTint = tint;
  }
`;

const DOT_CORE_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.62, 1.0, d);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vTint, a * vAlpha);
  }
`;

const DOT_HALO_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = exp(-d * d * 5.0) * 0.45;
    gl_FragColor = vec4(vTint, a * vAlpha);
  }
`;

const LINK_VERTEX = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 startA;
  attribute vec3 endA;
  attribute vec3 startB;
  attribute vec3 endB;
  attribute vec3 tint;
  attribute float alpha;
  uniform float t;
  uniform vec2 resolution;
  uniform float halfWidth;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vAcross;
  void main() {
    vec3 s = mix(startA, startB, t);
    vec3 e = mix(endA, endB, t);
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 cs = mvp * vec4(s, 1.0);
    vec4 ce = mvp * vec4(e, 1.0);
    vec2 ss = cs.xy / max(cs.w, 0.0001) * resolution;
    vec2 se = ce.xy / max(ce.w, 0.0001) * resolution;
    vec2 dir = se - ss;
    float len = length(dir);
    dir = len > 0.0001 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 clip = corner.x < 0.5 ? cs : ce;
    clip.xy += nrm * corner.y * halfWidth * 2.0 / resolution * clip.w;
    gl_Position = clip;
    vTint = tint;
    vAlpha = alpha;
    vAcross = corner.y;
  }
`;

const LINK_FRAGMENT = /* glsl */ `
  uniform float soft;
  uniform float opacity;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vAcross;
  void main() {
    float x = abs(vAcross);
    float a = soft > 0.5 ? exp(-x * x * 3.2) : 1.0 - smoothstep(0.55, 1.0, x);
    gl_FragColor = vec4(vTint, a * vAlpha * opacity);
  }
`;

function linearTint(hex: string | number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ─── Geometry ───────────────────────────────────────────────────────────────

function dotSize(degree: number): number {
  return DOT_BASE + DOT_PER_LOG_DEGREE * Math.log2(1 + degree);
}

function buildDotGeometry(data: ObsData, layout: ViewLayout): THREE.BufferGeometry {
  const n = data.nodes.length;
  const size = new Float32Array(n);
  const tint = new Float32Array(n * 3);
  const rest = linearTint(PLATE_COLORS.memory);
  data.nodes.forEach((node, i) => {
    size[i] = dotSize(node.degree);
    tint.set(rest, i * 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(layout.positions), 3));
  geometry.setAttribute('posA', new THREE.BufferAttribute(Float32Array.from(layout.positions), 3));
  geometry.setAttribute('posB', new THREE.BufferAttribute(Float32Array.from(layout.positions), 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_MAX * 1.2);
  return geometry;
}

function buildCoreGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const zero = new Float32Array(3);
  geometry.setAttribute('position', new THREE.BufferAttribute(zero, 3));
  geometry.setAttribute('posA', new THREE.BufferAttribute(Float32Array.from(zero), 3));
  geometry.setAttribute('posB', new THREE.BufferAttribute(Float32Array.from(zero), 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(Float32Array.of(CORE_SIZE), 1));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(Float32Array.of(1), 1));
  geometry.setAttribute('tint', new THREE.BufferAttribute(Float32Array.from(linearTint(PLATE_COLORS.memoryLive)), 3));
  return geometry;
}

interface Segments {
  start: Float32Array;
  end: Float32Array;
}

/** One batched instanced geometry of screen-space ribbons. Each ribbon carries
 *  two endpoint pairs, A and B, and the shader mixes between them by `t`. */
function buildRibbonGeometry(segments: Segments, tint: Float32Array, alpha: Float32Array): THREE.InstancedBufferGeometry {
  const count = alpha.length;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute('corner', new THREE.BufferAttribute(Float32Array.of(0, -1, 0, 1, 1, -1, 1, 1), 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.setAttribute('startA', new THREE.InstancedBufferAttribute(Float32Array.from(segments.start), 3));
  geometry.setAttribute('endA', new THREE.InstancedBufferAttribute(Float32Array.from(segments.end), 3));
  geometry.setAttribute('startB', new THREE.InstancedBufferAttribute(Float32Array.from(segments.start), 3));
  geometry.setAttribute('endB', new THREE.InstancedBufferAttribute(Float32Array.from(segments.end), 3));
  geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
  geometry.setAttribute('alpha', new THREE.InstancedBufferAttribute(alpha, 1));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_MAX * 1.2);
  return geometry;
}

function linkSegments(data: ObsData, layout: ViewLayout): Segments {
  const m = data.links.length;
  const start = new Float32Array(m * 3);
  const end = new Float32Array(m * 3);
  data.links.forEach((l, k) => {
    for (let c = 0; c < 3; c++) {
      start[k * 3 + c] = layout.positions[l.source * 3 + c]!;
      end[k * 3 + c] = layout.positions[l.target * 3 + c]!;
    }
  });
  return { start, end };
}

function linkTints(data: ObsData): Float32Array {
  const tint = new Float32Array(data.links.length * 3);
  data.links.forEach((l, k) => tint.set(linearTint(linkColorInt(l)), k * 3));
  return tint;
}

/** A ring, as ribbon segments. Solid when `on` is 1; dotted otherwise, with
 *  `on` of every slot lit. The composition of rings is the same in every view,
 *  which is what lets them slide with the memories. */
interface RingSpec {
  kind: 'band' | 'week' | 'orbit';
  owner: number;
  slots: number;
  on: number;
  cluster: Cluster | null;
  radius: (view: ViewId) => number;
}

const FLAT: Cluster = {
  id: -1, unlinked: false, members: [], links: [], contradictShare: 0, bearing: 0, hub: 0,
  name: '', from: 0, to: 0, tilt: 0, named: false,
};
const RING_ALPHA = { band: 0.5, week: 0.28, orbit: 0.2, lit: 0.85 } as const;

function ringSpecs(reading: Reading): RingSpec[] {
  const specs: RingSpec[] = [];
  BANDS.forEach((b, k) => {
    specs.push({ kind: 'band', owner: k, slots: 240, on: 1, cluster: null, radius: (v) => reading.views[v].bandRing[b] });
  });
  for (const w of reading.views.rank.weekRings) {
    specs.push({
      kind: 'week',
      owner: w.week,
      slots: 200,
      on: 0.42,
      cluster: null,
      radius: (v) => reading.views[v].weekRings.find((x) => x.week === w.week)?.radius ?? 0,
    });
  }
  for (const c of reading.clusters) {
    if (!c.named) continue;
    specs.push({ kind: 'orbit', owner: c.id, slots: 260, on: 0.5, cluster: c, radius: (v) => reading.views[v].orbitRadius[c.id]! });
  }
  return specs;
}

function ringSegments(specs: readonly RingSpec[], view: ViewId): Segments {
  const count = specs.reduce((sum, s) => sum + s.slots, 0);
  const start = new Float32Array(count * 3);
  const end = new Float32Array(count * 3);
  let at = 0;
  for (const spec of specs) {
    const r = spec.radius(view);
    const shape = spec.cluster ?? FLAT;
    for (let j = 0; j < spec.slots; j++) {
      placeAt(r, (j / spec.slots) * TAU, shape, start, at);
      placeAt(r, ((j + spec.on) / spec.slots) * TAU, shape, end, at);
      at += 3;
    }
  }
  return { start, end };
}

function ringAlpha(specs: readonly RingSpec[], focus: Focus): Float32Array {
  const count = specs.reduce((sum, s) => sum + s.slots, 0);
  const alpha = new Float32Array(count);
  let at = 0;
  for (const spec of specs) {
    const lit =
      (spec.kind === 'band' && focus.band === BANDS[spec.owner]) ||
      (spec.kind === 'orbit' && focus.cluster === spec.owner);
    alpha.fill(lit ? RING_ALPHA.lit : RING_ALPHA[spec.kind], at, at + spec.slots);
    at += spec.slots;
  }
  return alpha;
}

function dotMaterial(halo: boolean, pxScale: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DOT_VERTEX,
    fragmentShader: halo ? DOT_HALO_FRAGMENT : DOT_CORE_FRAGMENT,
    uniforms: { t: { value: 1 }, pxScale: { value: pxScale }, grow: { value: halo ? DOT_HALO_GROW : 1 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: halo ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

type Ribbon = 'crisp' | 'halo' | 'ring';
const RIBBON_HALF: Record<Ribbon, number> = { crisp: CRISP_HALF, halo: HALO_HALF, ring: RING_HALF };

function ribbonMaterial(kind: Ribbon, resolution: THREE.Vector2, dpr: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: LINK_VERTEX,
    fragmentShader: LINK_FRAGMENT,
    uniforms: {
      t: { value: 1 },
      resolution: { value: resolution },
      halfWidth: { value: RIBBON_HALF[kind] * dpr },
      soft: { value: kind === 'halo' ? 1 : 0 },
      opacity: { value: kind === 'halo' ? HALO_ALPHA : 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: kind === 'halo' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

// ─── Motion between views ───────────────────────────────────────────────────

interface MorphState {
  t: number;
  from: ViewId;
  to: ViewId;
  started: boolean;
  raf: number;
}
type MorphRef = RefObject<MorphState>;

function lerpInto(a: Float32Array, b: Float32Array, t: number): void {
  for (let i = 0; i < a.length; i++) a[i] = a[i]! + (b[i]! - a[i]!) * t;
}

function attribute(geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute {
  return geometry.getAttribute(name) as THREE.BufferAttribute;
}

/** A ← where things are now (A mixed towards B by t), B ← the new target. */
function retarget(geometry: THREE.BufferGeometry, pairs: [string, string, Float32Array][], t: number, started: boolean): void {
  for (const [a, b, target] of pairs) {
    const from = attribute(geometry, a);
    const to = attribute(geometry, b);
    if (started) lerpInto(from.array as Float32Array, to.array as Float32Array, t);
    (to.array as Float32Array).set(target);
    from.needsUpdate = true;
    to.needsUpdate = true;
  }
}

function easeOutExpo(x: number): number {
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

function lerp3(a: ArrayLike<number>, b: ArrayLike<number>, t: number): [number, number, number] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}

/** A group that rides the same slide as the geometry, so a label stays on its
 *  memory, its knot or its ring while the radius mapping changes under it. */
function Follow({ morph, at, children }: { morph: MorphRef; at: (view: ViewId) => ArrayLike<number>; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const { t, from, to } = morph.current;
    const p = lerp3(at(from), at(to), t);
    group.position.set(p[0], p[1], p[2]);
    group.updateMatrixWorld();
  }, -1);
  return <group ref={ref}>{children}</group>;
}

// ─── Scene ──────────────────────────────────────────────────────────────────

interface SceneProps {
  data: ObsData;
  reading: Reading;
  view: ViewId;
  reducedMotion: boolean;
  lit: Lit;
  focus: Focus;
  distance: number;
  morph: MorphRef;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function useDisposable(objects: readonly (THREE.BufferGeometry | THREE.Material)[]): void {
  useEffect(() => () => objects.forEach((o) => o.dispose()), [objects]);
}

function Scene(props: SceneProps) {
  const { data, reading, view, reducedMotion, lit, focus, distance, morph, onHover, onPick } = props;
  const invalidate = useThree((s) => s.invalidate);
  const raycaster = useThree((s) => s.raycaster);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  useEffect(() => {
    raycaster.params.Points = { threshold: PICK_RADIUS };
  }, [raycaster]);

  // Built once per store. Views only rewrite the A/B endpoint attributes.
  const specs = useMemo(() => ringSpecs(reading), [reading]);
  const geometries = useMemo(() => {
    const initial = reading.views.rank;
    const ringCount = specs.reduce((sum, s) => sum + s.slots, 0);
    const inkTint = new Float32Array(ringCount * 3);
    const ink = linearTint(PLATE_COLORS.ink3);
    for (let i = 0; i < ringCount; i++) inkTint.set(ink, i * 3);
    return {
      dots: buildDotGeometry(data, initial),
      core: buildCoreGeometry(),
      links: buildRibbonGeometry(linkSegments(data, initial), linkTints(data), new Float32Array(data.links.length).fill(1)),
      rings: buildRibbonGeometry(ringSegments(specs, 'rank'), inkTint, ringAlpha(specs, { node: null, cluster: null, band: null })),
    };
  }, [data, reading, specs]);

  // Materials are built once; the screen-space uniforms are kept current below.
  const initialFrame = useRef({ size, dpr, distance });
  const materials = useMemo(() => {
    const { size: s0, dpr: d0, distance: dist0 } = initialFrame.current;
    const res = new THREE.Vector2(s0.width * d0, s0.height * d0);
    return {
      dotCore: dotMaterial(false, d0 * dist0),
      dotHalo: dotMaterial(true, d0 * dist0),
      linkCrisp: ribbonMaterial('crisp', res, d0),
      linkHalo: ribbonMaterial('halo', res.clone(), d0),
      ring: ribbonMaterial('ring', res.clone(), d0),
    };
  }, []);
  const disposables = useMemo(
    () => [...Object.values(geometries), ...Object.values(materials)],
    [geometries, materials]
  );
  useDisposable(disposables);

  const objects = useMemo(() => {
    const rings = new THREE.Mesh(geometries.rings, materials.ring);
    const linkHalos = new THREE.Mesh(geometries.links, materials.linkHalo);
    const links = new THREE.Mesh(geometries.links, materials.linkCrisp);
    const dotHalos = new THREE.Points(geometries.dots, materials.dotHalo);
    const dots = new THREE.Points(geometries.dots, materials.dotCore);
    const coreHalo = new THREE.Points(geometries.core, materials.dotHalo);
    const core = new THREE.Points(geometries.core, materials.dotCore);
    const ordered = [rings, linkHalos, links, dotHalos, dots, coreHalo, core];
    ordered.forEach((o, i) => {
      o.renderOrder = i;
      o.frustumCulled = false;
    });
    return { rings, linkHalos, links, dotHalos, dots, coreHalo, core };
  }, [geometries, materials]);

  // Screen-space uniforms.
  useEffect(() => {
    for (const m of [materials.linkCrisp, materials.linkHalo, materials.ring]) {
      (m.uniforms.resolution!.value as THREE.Vector2).set(size.width * dpr, size.height * dpr);
    }
    materials.linkCrisp.uniforms.halfWidth!.value = CRISP_HALF * dpr;
    materials.linkHalo.uniforms.halfWidth!.value = HALO_HALF * dpr;
    materials.ring.uniforms.halfWidth!.value = RING_HALF * dpr;
    materials.dotCore.uniforms.pxScale!.value = dpr * distance;
    materials.dotHalo.uniforms.pxScale!.value = dpr * distance;
    invalidate();
  }, [materials, size, dpr, distance, invalidate]);

  // A rebuilt geometry carries rank positions in both A and B: start over.
  useEffect(() => {
    morph.current.started = false;
  }, [geometries, morph]);

  // The slide between radius mappings. Under reduced motion t is 1 at once.
  useEffect(() => {
    const state = morph.current;
    if (state.started && state.to === view) return;
    const layout = reading.views[view];
    const links = linkSegments(data, layout);
    const rings = ringSegments(specs, view);
    retarget(geometries.dots, [['posA', 'posB', layout.positions]], state.t, state.started);
    retarget(geometries.links, [['startA', 'startB', links.start], ['endA', 'endB', links.end]], state.t, state.started);
    retarget(geometries.rings, [['startA', 'startB', rings.start], ['endA', 'endB', rings.end]], state.t, state.started);
    const settled = attribute(geometries.dots, 'position');
    (settled.array as Float32Array).set(layout.positions);
    settled.needsUpdate = true;

    const setT = (t: number) => {
      state.t = t;
      for (const m of Object.values(materials)) m.uniforms.t!.value = t;
      invalidate();
    };
    cancelAnimationFrame(state.raf);
    const first = !state.started;
    state.from = first ? view : state.to;
    state.to = view;
    state.started = true;
    if (reducedMotion || first) {
      setT(1);
      return;
    }
    const began = performance.now();
    const tick = (now: number) => {
      const x = Math.min(1, (now - began) / MORPH_MS);
      setT(easeOutExpo(x));
      if (x < 1) state.raf = requestAnimationFrame(tick);
    };
    setT(0);
    state.raf = requestAnimationFrame(tick);
  }, [view, reading, data, specs, geometries, materials, reducedMotion, morph, invalidate]);
  useEffect(() => {
    const state = morph.current;
    return () => cancelAnimationFrame(state.raf);
  }, [morph]);

  // Focus: per-dot, per-link and per-ring alpha; the focused dot in ink, larger.
  useEffect(() => {
    const dotAlpha = attribute(geometries.dots, 'alpha');
    (dotAlpha.array as Float32Array).set(lit.nodes);
    dotAlpha.needsUpdate = true;
    const linkAlpha = attribute(geometries.links, 'alpha');
    (linkAlpha.array as Float32Array).set(lit.links);
    linkAlpha.needsUpdate = true;
    const rings = attribute(geometries.rings, 'alpha');
    (rings.array as Float32Array).set(ringAlpha(specs, focus));
    rings.needsUpdate = true;
    invalidate();
  }, [lit, focus, specs, geometries, invalidate]);

  useEffect(() => {
    const tint = attribute(geometries.dots, 'tint');
    const sizes = attribute(geometries.dots, 'size');
    const rest = linearTint(PLATE_COLORS.memory);
    const live = linearTint(PLATE_COLORS.memoryLive);
    data.nodes.forEach((node, i) => {
      const focused = i === focus.node;
      (tint.array as Float32Array).set(focused ? live : rest, i * 3);
      sizes.setX(i, dotSize(node.degree) * (focused ? DOT_FOCUS_SCALE : 1));
    });
    tint.needsUpdate = true;
    sizes.needsUpdate = true;
    invalidate();
  }, [focus.node, data, geometries, invalidate]);

  const hover = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      if (typeof event.index === 'number') onHover(event.index);
    },
    [onHover]
  );
  const leave = useCallback(() => onHover(null), [onHover]);
  const pick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      if (typeof event.index === 'number') onPick(event.index);
    },
    [onPick]
  );

  return (
    <>
      <primitive object={objects.rings} />
      <primitive object={objects.linkHalos} />
      <primitive object={objects.links} />
      <primitive object={objects.dotHalos} />
      <primitive object={objects.dots} onPointerMove={hover} onPointerOut={leave} onClick={pick} />
      <primitive object={objects.coreHalo} />
      <primitive object={objects.core} />
    </>
  );
}

// ─── Callouts ───────────────────────────────────────────────────────────────

const Z_LABEL: [number, number] = [3, 2];
/** Minimum screen distance between two band labels on the front meridian. */
const LABEL_PITCH = 15;

function projectToScreen(v: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }): [number, number] {
  const p = v.clone().project(camera);
  return [((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height];
}

/** Band labels sit on their rings. When a view squeezes rings together (the
 *  retention view puts four of them in the outer tenth) each label is pushed
 *  down just far enough to clear the one above, in ring order. */
function ladderPosition(
  el: THREE.Object3D,
  camera: THREE.Camera,
  size: { width: number; height: number },
  ringsAbove: () => readonly number[]
): [number, number] {
  const own = projectToScreen(new THREE.Vector3().setFromMatrixPosition(el.matrixWorld), camera, size);
  let floor = -Infinity;
  for (const r of ringsAbove()) {
    const y = projectToScreen(new THREE.Vector3(0, 0, r), camera, size)[1];
    floor = Math.max(y, floor + LABEL_PITCH);
  }
  return [own[0], Math.max(own[1], floor + LABEL_PITCH)];
}

function ageWord(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h old`;
  return `${Math.round(days)} d old`;
}

function bandLine(reading: Reading, band: RetentionBand, count: number): string {
  const { min, max } = reading.bandAges[band];
  const range = count === 0 ? 'none' : `${Math.round(min)}–${Math.round(max)} d`;
  return `${RETENTION_LABEL[band]} · ${nf.format(count)} · ${range}`;
}

function bandRingAt(reading: Reading, morph: MorphRef, band: RetentionBand): number {
  const { t, from, to } = morph.current;
  const a = reading.views[from].bandRing[band];
  const b = reading.views[to].bandRing[band];
  return (a + (b - a) * t) * R_MAX;
}

function BandLabels({ data, reading, focus, morph }: { data: ObsData; reading: Reading; focus: Focus; morph: MorphRef }) {
  const stack = BANDS.filter((b) => data.stats.retention[b] > 0);
  const weeks = reading.views.rank.weekRings.filter((w) => w.count >= WEEK_LABEL_MIN);
  const weekAngle = Math.PI / 2 + LABEL_GAP / 2 - 0.012;
  return (
    <>
      <Html position={[0, 0, 0]} center zIndexRange={Z_LABEL} pointerEvents="none">
        <div className="orb-call orb-core">
          <span className="orb-call-text">
            <span className="orb-core-name">Now</span>
            <span className="orb-cap">retention 1 · everything falls from here</span>
          </span>
        </div>
      </Html>
      {stack.map((b, k) => {
        const above = stack.slice(0, k);
        return (
          <Follow key={b} morph={morph} at={(v) => [0, 0, reading.views[v].bandRing[b] * R_MAX]}>
            <Html
              center
              zIndexRange={Z_LABEL}
              pointerEvents="none"
              calculatePosition={(el, camera, size) =>
                ladderPosition(el, camera, size, () => above.map((prev) => bandRingAt(reading, morph, prev)))
              }
            >
              <div className={`orb-call orb-band${focus.band === b ? ' lit' : ''}`}>
                <span className="orb-call-tick" />
                <span className="orb-call-text orb-cap">{bandLine(reading, b, data.stats.retention[b])}</span>
              </div>
            </Html>
          </Follow>
        );
      })}
      {weeks.map((w) => (
        <Follow
          key={w.week}
          morph={morph}
          at={(v) => {
            const r = (reading.views[v].weekRings.find((x) => x.week === w.week)?.radius ?? 0) * R_MAX;
            return [r * Math.cos(weekAngle), 0, r * Math.sin(weekAngle)];
          }}
        >
          <Html center zIndexRange={Z_LABEL} pointerEvents="none">
            <span className="orb-week orb-cap">
              wk {w.week} · {w.count}
            </span>
          </Html>
        </Follow>
      ))}
    </>
  );
}

function ClusterLabels({
  data,
  reading,
  focus,
  roomy,
  morph,
  onPick,
}: {
  data: ObsData;
  reading: Reading;
  focus: Focus;
  roomy: boolean;
  morph: MorphRef;
  onPick: (cluster: number) => void;
}) {
  const shown = reading.clusters.filter((c) => c.named || c.unlinked).filter((c, k) => roomy || k < 6 || c.unlinked);
  return (
    <>
      {shown.map((c, k) => {
        const isLit = focus.cluster === c.id;
        const flip = Math.cos((c.from + c.to) / 2) < 0;
        const down = k % 2 === 1;
        const line = c.unlinked
          ? `${nf.format(c.members.length)} of ${nf.format(data.stats.memories)} · no links`
          : `${nf.format(c.members.length)} memories · ${Math.round(c.contradictShare * 100)}% contradict`;
        return (
          <Follow key={c.id} morph={morph} at={(v) => reading.views[v].knots.subarray(c.id * 3, c.id * 3 + 3)}>
            <Html center zIndexRange={Z_LABEL} pointerEvents="none">
              <div className={`orb-call${flip ? ' flip' : ''}${down ? ' down' : ''}${isLit ? ' lit' : ''}`}>
                <span className="orb-call-ring" />
                <span className="orb-call-lead" />
                <button type="button" className="orb-call-text" onClick={() => onPick(c.id)}>
                  <span className="orb-call-name">{c.name}</span>
                  <span className="orb-cap">{line}</span>
                </button>
              </div>
            </Html>
          </Follow>
        );
      })}
    </>
  );
}

function MemoryCallout({ data, reading, index, pinned, morph }: { data: ObsData; reading: Reading; index: number; pinned: boolean; morph: MorphRef }) {
  const node = data.nodes[index]!;
  const cluster = reading.clusters[reading.clusterOf[index]!]!;
  const line =
    `${node.type} · ${RETENTION_LABEL[node.retentionBand]} · ${ageWord(reading.ages[index]!)} · ` +
    `${nf.format(node.agreeDegree)} agree, ${nf.format(node.contradictDegree)} contradict`;
  return (
    <Follow morph={morph} at={(v) => reading.views[v].positions.subarray(index * 3, index * 3 + 3)}>
      <Html center zIndexRange={[5, 4]} pointerEvents="none">
        <div className={`orb-call orb-mem${pinned ? ' lit' : ''}`}>
          <span className="orb-call-ring" />
          <span className="orb-call-lead" />
          <span className="orb-call-text">
            <span className="orb-call-name">{cleanLabel(node.label)}</span>
            <span className="orb-cap">{line}</span>
            <span className="orb-cap orb-quiet">{cluster.unlinked ? 'in no cluster' : `in “${cluster.name}”`}</span>
          </span>
        </div>
      </Html>
    </Follow>
  );
}

// ─── Chrome ─────────────────────────────────────────────────────────────────

function Masthead({
  data,
  reading,
  focus,
  onBand,
}: {
  data: ObsData;
  reading: Reading;
  focus: Focus;
  onBand: (band: RetentionBand) => void;
}) {
  return (
    <div className="orb-mast">
      <h2 className="orb-title">Orbital memory core</h2>
      <p className="orb-cap orb-sub">
        {nf.format(data.stats.memories)} memories by distance from now
      </p>
      <span className="orb-under" aria-hidden />
      <nav className="orb-nav" aria-label="Retention bands">
        {BANDS.map((b) => (
          <button
            key={b}
            type="button"
            className="orb-cap orb-nav-item"
            aria-pressed={focus.band === b}
            onClick={() => onBand(b)}
          >
            {bandLine(reading, b, data.stats.retention[b])}
          </button>
        ))}
      </nav>
    </div>
  );
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function Figures({ data, reading, roomy }: { data: ObsData; reading: Reading; roomy: boolean }) {
  const { stats } = data;
  const crossPct = reading.cross.links ? Math.round((100 * reading.cross.contradicts) / reading.cross.links) : 0;
  return (
    <div className="orb-figs">
      <div className="orb-fig-row">
        <div className="orb-fig">
          <div className="orb-fig-n">{nf.format(stats.memories)}</div>
          <div className="orb-cap orb-fig-l">memories</div>
          {roomy ? <div className="orb-fig-note">{nf.format(stats.isolated)} with no link</div> : null}
        </div>
        <div className="orb-fig">
          <div className="orb-fig-n">{nf.format(stats.linksDrawn)}</div>
          <div className="orb-cap orb-fig-l">links drawn</div>
          {roomy ? (
            <div className="orb-fig-note">
              of {nf.format(stats.linksStored)} stored · {nf.format(stats.linksToArchived)} onto archived
            </div>
          ) : null}
        </div>
        <div className="orb-fig">
          <div className="orb-fig-n">{nf.format(reading.clusters.filter((c) => !c.unlinked).length)}</div>
          <div className="orb-cap orb-fig-l">clusters</div>
          {roomy ? (
            <div className="orb-fig-note">
              {reading.named} named by their busiest memory · {nf.format(reading.cross.links)} links cross between, {crossPct}% contradict
            </div>
          ) : null}
        </div>
        <span className="orb-pill orb-cap">
          <span className="orb-live" aria-hidden />
          live
        </span>
      </div>
      <p className="orb-cap orb-read">
        read from the store at {timeFormat.format(reading.readAt)} · {stats.halfLifeDays}-day half-life
      </p>
    </div>
  );
}

function costLine(view: ViewId, data: ObsData, reading: Reading): string {
  const { stats } = data;
  if (view === 'rank') {
    return (
      `Each band is a ring whose width grows with the square root of its count; inside it, memories sit in age order at equal spacing. ` +
      `Spacing is count, not time — the dotted week rings show where the weeks really fall.`
    );
  }
  if (view === 'age') {
    const w = reading.busiestWindow;
    return (
      `Days since written, to scale. ${nf.format(w.count)} memories written in one ${stats.halfLifeDays}-day stretch, ` +
      `${Math.round(w.from)}–${Math.round(w.to)} days ago, share one belt.`
    );
  }
  return (
    `1 − retention, as the store computes it. ${nf.format(stats.retention.threshold)} memories land in the outer ` +
    `${Math.max(1, Math.round(reading.thresholdOuterShare * 100))}% of the radius — the collapse the other two views exist to avoid.`
  );
}

function ViewSwitch({
  view,
  data,
  reading,
  roomy,
  onView,
}: {
  view: ViewId;
  data: ObsData;
  reading: Reading;
  roomy: boolean;
  onView: (v: ViewId) => void;
}) {
  return (
    <div className="orb-switch" role="group" aria-label="Radius">
      <span className="orb-cap orb-switch-head">radius</span>
      {VIEWS.map((v) => (
        <div key={v.id} className="orb-opt-block">
          <button type="button" className="orb-opt" aria-pressed={view === v.id} onClick={() => onView(v.id)}>
            <span className="orb-radio" aria-hidden />
            <span>{v.name}</span>
          </button>
          {view === v.id && roomy ? <p className="orb-cost">{costLine(v.id, data, reading)}</p> : null}
        </div>
      ))}
    </div>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function fitDistance(radius: number, width: number, height: number): number {
  const half = Math.tan(((CAM_FOV / 2) * Math.PI) / 180);
  const aspect = height > 0 ? width / height : 1;
  return radius / (half * Math.min(1, aspect));
}

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const [webgl] = useState(hasWebGL);
  const reading = useMemo(() => buildReading(data), [data]);
  const [view, setView] = useState<ViewId>('rank');
  const [hovered, setHovered] = useState<number | null>(null);
  const [focusCluster, setFocusCluster] = useState<number | null>(null);
  const [focusBand, setFocusBand] = useState<RetentionBand | null>(null);
  const morph = useRef<MorphState>({ t: 1, from: 'rank', to: 'rank', started: false, raf: 0 });

  const indexOf = useMemo(() => new Map(data.nodes.map((n, i) => [n.id, i])), [data]);
  const selectedIndex = selectedId === null ? null : (indexOf.get(selectedId) ?? null);
  const focusNode = selectedIndex ?? hovered;
  const focus = useMemo<Focus>(
    () => ({ node: focusNode, cluster: focusCluster, band: focusBand }),
    [focusNode, focusCluster, focusBand]
  );
  const lit = useMemo(() => buildLit(data, reading, focus), [data, reading, focus]);

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      onSelect(node.id === selectedId ? null : node.id);
    },
    [data, onSelect, selectedId]
  );
  const pickCluster = useCallback(
    (cluster: number) => {
      onSelect(null);
      setFocusBand(null);
      setFocusCluster((current) => (current === cluster ? null : cluster));
    },
    [onSelect]
  );
  const pickBand = useCallback(
    (band: RetentionBand) => {
      onSelect(null);
      setFocusCluster(null);
      setFocusBand((current) => (current === band ? null : band));
    },
    [onSelect]
  );
  const clear = useCallback(() => {
    onSelect(null);
    setFocusCluster(null);
    setFocusBand(null);
  }, [onSelect]);
  // R3F reports a click that hits no geometry as a miss even when it landed on
  // a callout portaled over the canvas; those clicks belong to the callout.
  const missed = useCallback(
    (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.orb-call')) return;
      clear();
    },
    [clear]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [clear]);

  // Framed once from the first measured box and then held, so a resize never
  // re-frames the scene under a viewer who is orbiting it.
  const framing = useRef<{ distance: number; position: [number, number, number] } | null>(null);
  if (!framing.current) {
    const d = fitDistance(R_MAX * 1.12, width, height);
    framing.current = { distance: d, position: [CAM_DIR.x * d, CAM_DIR.y * d, CAM_DIR.z * d] };
  }
  const { distance, position } = framing.current;

  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const leave = () => setHovered(null);
    box.addEventListener('pointerleave', leave);
    return () => box.removeEventListener('pointerleave', leave);
  }, []);

  const roomy = width >= 820 && height >= 540;
  const summary =
    `${nf.format(data.stats.memories)} memories on concentric orbits around now, distance being age on a ` +
    `${data.stats.halfLifeDays}-day half-life: ${nf.format(data.stats.retention.vivid)} vivid, ` +
    `${nf.format(data.stats.retention.holding)} holding, ${nf.format(data.stats.retention.fading)} fading, ` +
    `${nf.format(data.stats.retention.threshold)} at threshold; ${nf.format(data.stats.linksDrawn)} of ` +
    `${nf.format(data.stats.linksStored)} links drawn between ${reading.clusters.filter((c) => !c.unlinked).length} clusters.`;

  return (
    <div className={`orb-box${hovered !== null ? ' is-hovering' : ''}`} ref={boxRef} style={{ width, height }}>
      <style href="observatory-orbital" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl ? (
        <div className="orb-canvas" role="img" aria-label={summary}>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{
              antialias: true,
              // The token layer's contrasts were measured on raw sRGB; ACES would move every one.
              toneMapping: THREE.NoToneMapping,
              powerPreference: 'high-performance',
            }}
            camera={{ fov: CAM_FOV, near: 1, far: R_MAX * 40, position }}
            onPointerMissed={missed}
          >
            {/* An opaque plate inside the buffer, so additive glow composes against the
                ground the luminances were measured on rather than against transparency. */}
            <color attach="background" args={[PLATE_COLORS.plate]} />
            <Scene
              data={data}
              reading={reading}
              view={view}
              reducedMotion={reducedMotion}
              lit={lit}
              focus={focus}
              distance={distance}
              morph={morph}
              onHover={setHovered}
              onPick={pick}
            />
            <BandLabels data={data} reading={reading} focus={focus} morph={morph} />
            <ClusterLabels data={data} reading={reading} focus={focus} roomy={roomy} morph={morph} onPick={pickCluster} />
            {focusNode !== null ? (
              <MemoryCallout data={data} reading={reading} index={focusNode} pinned={selectedIndex !== null} morph={morph} />
            ) : null}
            <EffectComposer multisampling={4}>
              <Bloom
                luminanceThreshold={BLOOM_THRESHOLD}
                luminanceSmoothing={0.05}
                intensity={0.9}
                radius={0.55}
                mipmapBlur
              />
            </EffectComposer>
            <OrbitControls
              target={[0, 0, 0]}
              enablePan={false}
              enableDamping={false}
              minDistance={distance * 0.45}
              maxDistance={distance * 2.2}
              minPolarAngle={0.2}
              maxPolarAngle={1.5}
            />
          </Canvas>
        </div>
      ) : (
        <p className="orb-nogl obs-note">
          This reading is drawn with WebGL, and this browser did not give the page a context. The measurements
          still hold: {summary}
        </p>
      )}

      <Masthead data={data} reading={reading} focus={focus} onBand={pickBand} />
      <Figures data={data} reading={reading} roomy={roomy} />
      <ViewSwitch view={view} data={data} reading={reading} roomy={roomy} onView={setView} />
      {width >= 700 ? (
        <p className="orb-cap orb-tag">
          distance is age · blue agrees · orange contradicts · brighter is stronger
        </p>
      ) : null}
    </div>
  );
}

/**
 * Scoped to this demo's own box. The canvas bleeds to all four edges; the
 * chrome sits in the four corners on the plate itself, with no sheet under it
 * (rule 9). Everything that moves here moves on transform or opacity (rule 7).
 */
const SHEET_CSS = `
.orb-box { position: absolute; inset: 0; overflow: hidden; }
.orb-canvas { position: absolute; inset: 0; }
.orb-box.is-hovering .orb-canvas canvas { cursor: pointer; }
.orb-nogl { position: absolute; inset: 0; margin: 0; padding: 28px 20px; max-width: 56ch; }

.orb-cap {
  font-size: var(--t-label); font-weight: 400; line-height: 1.35;
  text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink-3);
}
.orb-quiet { opacity: 0.72; }

/* ─── masthead, top left ─── */
.orb-mast { position: absolute; left: 22px; top: 18px; z-index: 5; pointer-events: none; max-width: 46%; }
.orb-title {
  margin: 0; font-size: var(--t-mast); font-weight: 300; line-height: 1.05;
  letter-spacing: -0.012em; color: var(--ink);
}
.orb-sub { margin: 7px 0 0; }
.orb-under { display: block; width: 28px; height: 1px; background: var(--agrees); margin: 11px 0 16px; }
.orb-nav { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; pointer-events: auto; }
.orb-nav-item {
  text-align: left; opacity: 0.8;
  transition: color var(--dur) var(--ease), opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.orb-nav-item:hover { color: var(--ink-2); opacity: 1; }
.orb-nav-item[aria-pressed='true'] { color: var(--ink); opacity: 1; transform: translateX(4px); }

/* ─── figures, top right ─── */
.orb-figs { position: absolute; right: 22px; top: 18px; z-index: 5; pointer-events: none; text-align: right; max-width: 52%; }
.orb-fig-row { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: flex-start; row-gap: 12px; }
.orb-fig { padding: 0 16px; border-left: 1px solid var(--rule); text-align: left; min-width: 0; }
.orb-fig:first-child { border-left: none; }
.orb-fig-n {
  font-size: 26px; font-weight: 300; line-height: 1; color: var(--ink);
  font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
}
.orb-fig-l { margin-top: 6px; }
.orb-fig-note { margin-top: 3px; font-size: var(--t-label); line-height: 1.3; color: var(--ink-3); font-stretch: 85%; max-width: 22ch; }
.orb-pill {
  display: inline-flex; align-items: center; gap: 6px; margin-left: 18px; margin-top: 4px;
  padding: 3px 9px 3px 7px; border: 1px solid var(--rule); border-radius: 999px; color: var(--ink-2);
}
.orb-live { width: 5px; height: 5px; border-radius: 50%; background: var(--agrees); }
.orb-read { margin: 12px 0 0; }

/* ─── the switch, bottom left ─── */
.orb-switch { position: absolute; left: 22px; bottom: 20px; z-index: 5; display: flex; flex-direction: column; gap: 8px; max-width: 300px; }
.orb-switch-head { margin-bottom: 2px; }
.orb-opt-block { display: flex; flex-direction: column; gap: 3px; }
.orb-opt {
  display: flex; align-items: center; gap: 9px; color: var(--ink-3); font-size: var(--t-body); text-align: left;
  transition: color var(--dur) var(--ease);
}
.orb-opt:hover { color: var(--ink-2); }
.orb-radio { width: 9px; height: 9px; border-radius: 50%; border: 1px solid currentColor; flex: 0 0 auto; }
.orb-opt[aria-pressed='true'] { color: var(--ink); }
.orb-opt[aria-pressed='true'] .orb-radio { background: currentColor; box-shadow: inset 0 0 0 2px var(--plate); }
.orb-cost { margin: 0 0 4px 18px; font-size: var(--t-label); line-height: 1.45; color: var(--ink-3); max-width: 36ch; }

/* ─── tagline, bottom right ─── */
.orb-tag { position: absolute; right: 22px; bottom: 22px; z-index: 5; margin: 0; text-align: right; max-width: 40ch; pointer-events: none; }

/* ─── callouts, in the scene ─── */
.orb-call { position: relative; width: 0; height: 0; pointer-events: none; }
.orb-call-ring {
  position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 50%;
  border: 1px solid var(--ink-3); box-sizing: border-box;
  transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.orb-call-lead {
  position: absolute; left: 0; top: 0; width: 36px; height: 1px; background: var(--ink-3); opacity: 0.7;
  transform-origin: 0 0; transform: rotate(-42deg);
}
.orb-call-text {
  position: absolute; left: 30px; top: -42px; white-space: nowrap; display: flex; flex-direction: column; gap: 2px;
  text-align: left; pointer-events: auto;
}
.orb-call-name { display: block; font-size: var(--t-body); line-height: 1.25; color: var(--ink-2); font-weight: 400; }
.orb-call.flip .orb-call-lead { transform: rotate(-138deg); }
.orb-call.flip .orb-call-text { left: auto; right: 30px; text-align: right; align-items: flex-end; }
.orb-call.down .orb-call-lead { transform: rotate(42deg); }
.orb-call.down .orb-call-text { top: 12px; }
.orb-call.flip.down .orb-call-lead { transform: rotate(138deg); }
.orb-call.lit .orb-call-name, .orb-call.lit .orb-cap { color: var(--ink); }
.orb-call.lit .orb-call-ring { border-color: var(--ink); transform: scale(1.35); }
button.orb-call-text { cursor: pointer; }
button.orb-call-text:hover .orb-call-name { color: var(--ink); }

.orb-core .orb-call-text { left: 14px; top: -20px; }
.orb-core-name { display: block; font-size: var(--t-claim); font-weight: 300; line-height: 1.1; color: var(--ink); letter-spacing: -0.01em; }

.orb-band .orb-call-tick { position: absolute; left: -3px; top: 0; width: 6px; height: 1px; background: var(--ink-3); }
.orb-band .orb-call-text { left: 9px; top: -7px; }
.orb-band.lit .orb-call-text { color: var(--ink); }

.orb-week { position: absolute; right: 6px; top: -7px; white-space: nowrap; letter-spacing: 0.1em; opacity: 0.75; }

.orb-mem .orb-call-name { color: var(--ink); }
`;

export const orbitalCore: DemoModule = {
  id: 'orbital',
  name: 'Orbital Memory Core',
  dimension: '3D',
  claim:
    'Distance from the core is age and nothing else: on a 7-day half-life, radius says how close a memory is to being archived — if the 564 already at threshold can be spread without lying about them.',
  Plate,
};
