/**
 * SLOT: Living Memory Matrix (3D).  "A lit city, seen from above at an angle."
 *
 * ─── The form ──────────────────────────────────────────────────────────────
 *
 * A ruled ground plane in strong perspective, receding to a horizon. Every
 * memory is one square cell on that lattice; the cell's HEIGHT is its link
 * count, so where connection gathers the plane rises and, under the additive
 * halos, brightens. Long arcs leap between distant regions. Up to four inset
 * windows float over the sky, each a magnified copy of one district, joined to its
 * place on the plane by a leader line ending in an open ring. A vertical scale
 * on the right names the depth bands.
 *
 * ─── What a cell's position encodes, and why this ground ───────────────────
 *
 * DEPTH IS AGE. The plane is cut into the server's four retention bands,
 * nearest first: vivid (≤ 7 d), holding (≤ 14 d), fading (≤ 30 d), and the
 * archive threshold beyond. Within a band, nearer is newer. Perspective puts
 * its emphasis exactly where the store's own decay curve does — the handful
 * of living memories are large and readable at the front; the 87 % already at
 * threshold recede into a dense, small, glowing mass at the horizon. That is
 * the honest picture of a store with a 7-day half-life, and the insets exist
 * because that mass cannot be read at its own scale.
 *
 * WIDTH IS DISTRICT. Left to right, the plane is a row of strips, one per link
 * community — Louvain on the drawn links alone (27 communities on this store,
 * modularity 0.79), run live in this file. Strips stand side by side when they
 * share links (barycentre seriation), and the isolated memories get the first
 * strip on the left, labelled with their count. The gap between two strips is
 * NOT a distance; the switcher's note says so on screen.
 *
 * Why not the projection? It was measured and rejected as the resting ground:
 * PCA keeps 38 % of the embedding variance and linked memories sit 7.06 apart
 * against 41 for a random pair, so districts pile onto each other. It is kept
 * as the second view — "Projection" bins PC1 into columns and states its own
 * weakness in its note. The third view sorts by memory type, which shows that
 * type explains almost nothing (79 % semantic, 96 % of links same-type).
 *
 * Log-age rows were tried and fail on THIS store: 404 of 653 memories were
 * stored between 46 and 50 days ago and 142 more at ~165 d, so a log scale
 * puts two thirds of the store in a single row. Bands are the server's own
 * cut, and rows within a band are packing order by age.
 *
 * ─── Arcs, and what stays as height ────────────────────────────────────────
 *
 * A link is drawn as an arc when its two memories sit in different strips or
 * different bands — 326 of 3,103 on this store. The other 2,777 join two cells
 * of one district and one band; they are what those cells' heights count, and
 * they appear as arcs when their memory is hovered or picked. Both counts and
 * the denominators are printed in the top-right figures.
 *
 * The finding this ground makes visible: the leaps ACROSS TIME are agreements
 * (87 agree / 12 contradict) and the leaps ACROSS DISTRICTS are contradictions
 * (79 / 157). Blue arcs run front-to-back, orange arcs run side-to-side.
 *
 * ─── Honesty: what the reference implied and this file refuses ─────────────
 *
 * The reference images print 12,428 memories, 317 clusters, 1,892 connections
 * and captions like "Work & Projects — 248 memories". None of that exists.
 * There is no topic taxonomy in the store, so no inset is captioned with one:
 * each window is named by the label of its district's most-linked memory, in
 * quotation marks, and a line above the insets says so. Every figure on the
 * plate is computed from `data` at render time. The reference's warm:cool
 * ratio of about 1:7 is not reproduced either — the arcs of this store are 52 %
 * contradictions and are drawn that way.
 *
 * ─── Glow, and how kind and strength survive it ────────────────────────────
 *
 * Glow is geometry, not a post-process. Each arc is drawn twice: a 6 px
 * additive halo at α 0.14, and a 1.5 px opaque core in normal blending drawn
 * AFTER the halos (renderOrder). So every core pixel is an unmodified token:
 * kind stays ΔE 28 apart (OKLab ×100) and the three steps stay 7.6–8.6 ΔL
 * apart, exactly as validated in tokens.css. The halos lift the surround, not
 * the core; measured on the model in the report, one crossing halo takes the
 * weak step's edge contrast from 3.17 to 2.4:1 and a three-link bundle to ~1:1
 * — inside a bundle the individual weak cores are not separable, which is the
 * aggregated reading a bundle is for. Hovering or picking a memory dims the
 * resting arcs (core α 0.26, halo α 0.03) so its own links are read against a
 * nearly bare plate. Cells glow through additive point sprites in `--memory`
 * (α 0.34, sized by degree) over boxes whose faces are shaded from one token
 * — top full, sides darker — so a block reads as lit volume, not a flat slab;
 * the GLOW toggle removes every halo for a plain comparison.
 * Tone mapping is off so no ratio moves.
 *
 * ─── Held rules ────────────────────────────────────────────────────────────
 *
 * No colour literals. Density is height, size and accumulation — never a wash.
 * Retention is a band position and a word, never a colour. Nothing animates
 * on its own: no autorotation, no entrance, no ticking; the reduced-motion path
 * and the normal path render the same settled frame, only OrbitControls'
 * inertia is gated. Only transform and opacity ever transition. The figure
 * bleeds; the inset windows are the form.
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
  type RetentionBand,
} from '../../lib/plate/contract.js';

// ─── The encoding, as constants ─────────────────────────────────────────────

/** Lattice pitch. Rows are deeper than columns are wide so the plane recedes. */
const DX = 1;
const DZ = 1.7;
/** A cell's footprint, as a fraction of the column pitch. Square in plan. */
const CELL = 0.62;
/** Height = H_BASE + H_PER · degree^H_POW. An isolated memory is a low slab. */
const H_BASE = 0.12;
const H_PER = 0.16;
const H_POW = 0.8;
/** Strip width = max(1, round(√size / divisor)). The divisor only sets the
 *  plane's aspect for each view — 28 strips need narrow ones, 3 need wide. */
const STRIP_DIVISOR: Record<View, number> = { district: 1.6, meaning: 1.25, type: 0.95 };
const PC1_BINS = 12;
const BAND_ORDER: readonly RetentionBand[] = ['vivid', 'holding', 'fading', 'threshold'];
const BAND_FLOOR: Record<RetentionBand, number> = { vivid: 0.5, holding: 0.25, fading: 0.05, threshold: 0 };

const ARC_SEGMENTS = 18;
const ARC_LIFT = 0.26;
const ARC_LIFT_MIN = 0.9;
const ARC_LIFT_MAX = 9;
const CORE_PX = 1.5;
const HALO_PX = 6;
const HALO_ALPHA = 0.14;
const HALO_ALPHA_DIM = 0.03;
const CORE_ALPHA_DIM = 0.26;
const CELL_HALO_ALPHA = 0.34;
const CELL_HALO_MIN = 1.5;
const CELL_HALO_MAX = 5;
/** One fixed light on one token: the top face is lifted, the sides fall away. */
const FACE_TOP = 1.22;
const FACE_FRONT = 0.62;
const FACE_SIDE = 0.46;
const FACE_BACK = 0.32;
const FOCUS_HALO_SIZE = 5.5;
const FOCUS_HALO_ALPHA = 0.55;

const CAM_FOV = 38;
const CAM_ELEVATION = (32 * Math.PI) / 180;
const CAM_TARGET_Z = -0.3;
/** The near edge of the plane spans at most this fraction of the box width
 *  and sits at most this far down the box — a small bleed on either axis,
 *  and every band and strip on screen at rest, whichever bound binds. */
const CAM_NEAR_WIDTH = 1.12;
const CAM_NEAR_Y = 1.06;

const INSET_W = 210;
const INSET_H = 154;
const INSET_GAP = 18;
const INSET_TOP = 100;
const INSET_LEFT = 252;
const INSET_RIGHT_CLEAR = 132;
const INSET_MAP_H = INSET_H - 48;
const NAME_CHARS = 30;
const CALLOUT_DX = 26;
const CALLOUT_DY = -46;
const CALLOUT_W = 240;
const CALLOUT_H = 34;
const RING_R = 5;

const nf = new Intl.NumberFormat('en-US');
const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0);

// ─── Views ──────────────────────────────────────────────────────────────────

type View = 'district' | 'meaning' | 'type';

const VIEWS: readonly { id: View; name: string; caps: string; widthWord: string }[] = [
  { id: 'district', name: 'Link communities', caps: 'From the links alone', widthWord: 'district' },
  { id: 'meaning', name: 'Projection', caps: 'PC1, binned', widthWord: 'meaning' },
  { id: 'type', name: 'Memory type', caps: 'Three strips', widthWord: 'type' },
];

const TYPE_NAME: Record<MemoryType, string> = {
  semantic: 'Semantic',
  episodic: 'Episodic',
  procedural: 'Procedural',
};

// ─── Communities: Louvain on the drawn links, run live ──────────────────────

interface WeightedEdge {
  s: number;
  t: number;
  w: number;
}

/** Weighted, undirected Louvain with a fixed node order, so the result is the
 *  same on every load of the same store. */
function louvain(n: number, edges: WeightedEdge[]): Int32Array {
  const membership = new Int32Array(n);
  for (let i = 0; i < n; i++) membership[i] = i;
  let curN = n;
  let curEdges = edges;
  for (let level = 0; level < 12; level++) {
    const adj: [number, number][][] = Array.from({ length: curN }, () => []);
    const k = new Float64Array(curN);
    let m2 = 0;
    for (const e of curEdges) {
      if (e.s === e.t) {
        k[e.s] = k[e.s]! + e.w * 2;
        m2 += e.w * 2;
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
    for (let i = 0; i < curN; i++) node2com[i] = i;
    const comTot = Float64Array.from(k);
    let improvedAny = false;
    for (let pass = 0; pass < 40; pass++) {
      let improved = false;
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
      if (!improved) break;
    }
    const remap = new Map<number, number>();
    const renumbered = new Int32Array(curN);
    for (let v = 0; v < curN; v++) {
      const c = node2com[v]!;
      let r = remap.get(c);
      if (r === undefined) {
        r = remap.size;
        remap.set(c, r);
      }
      renumbered[v] = r;
    }
    for (let i = 0; i < n; i++) membership[i] = renumbered[membership[i]!]!;
    const nextN = remap.size;
    if (!improvedAny || nextN === curN) break;
    const agg = new Map<number, number>();
    for (const e of curEdges) {
      const a = renumbered[e.s]!;
      const b = renumbered[e.t]!;
      const key = Math.min(a, b) * nextN + Math.max(a, b);
      agg.set(key, (agg.get(key) ?? 0) + e.w);
    }
    curEdges = [...agg].map(([key, w]) => ({ s: Math.floor(key / nextN), t: key % nextN, w }));
    curN = nextN;
  }
  return membership;
}

function modularity(n: number, edges: WeightedEdge[], memb: Int32Array): number {
  const k = new Float64Array(n);
  let m2 = 0;
  let communities = 0;
  for (let i = 0; i < n; i++) communities = Math.max(communities, memb[i]! + 1);
  const inW = new Float64Array(communities);
  const tot = new Float64Array(communities);
  for (const e of edges) {
    k[e.s] = k[e.s]! + e.w;
    k[e.t] = k[e.t]! + e.w;
    m2 += 2 * e.w;
    if (memb[e.s] === memb[e.t]) inW[memb[e.s]!] = inW[memb[e.s]!]! + e.w;
  }
  if (m2 === 0) return 0;
  for (let i = 0; i < n; i++) tot[memb[i]!] = tot[memb[i]!]! + k[i]!;
  let q = 0;
  for (let c = 0; c < communities; c++) q += (2 * inW[c]!) / m2 - (tot[c]! / m2) ** 2;
  return q;
}

/** Barycentre seriation: order the strips so those that share links stand
 *  side by side. Strips with no cross-link keep their size-rank position. */
function seriate(count: number, pairs: Map<number, number>): number[] {
  let order = Array.from({ length: count }, (_, i) => i);
  const pos = new Float64Array(count);
  for (let sweep = 0; sweep < 60; sweep++) {
    order.forEach((c, i) => {
      pos[c] = i;
    });
    const bary = new Float64Array(count);
    const wsum = new Float64Array(count);
    for (const [key, w] of pairs) {
      const a = Math.floor(key / count);
      const b = key % count;
      bary[a] = bary[a]! + w * pos[b]!;
      wsum[a] = wsum[a]! + w;
      bary[b] = bary[b]! + w * pos[a]!;
      wsum[b] = wsum[b]! + w;
    }
    const at = (c: number) => (wsum[c] ? bary[c]! / wsum[c]! : pos[c]!);
    const next = order.slice().sort((a, b) => at(a) - at(b) || pos[a]! - pos[b]!);
    if (next.every((c, i) => c === order[i])) break;
    order = next;
  }
  return order;
}

interface Communities {
  /** Community rank per node, largest first; -1 for the isolated. */
  of: Int32Array;
  count: number;
  order: number[];
  modularity: number;
}

function findCommunities(data: ObsData): Communities {
  const n = data.nodes.length;
  const edges: WeightedEdge[] = data.links
    .filter((l) => l.source !== l.target)
    .map((l) => ({ s: l.source, t: l.target, w: l.strength }));
  const raw = louvain(n, edges);
  const sizes = new Map<number, number>();
  data.nodes.forEach((node, i) => {
    if (node.degree > 0) sizes.set(raw[i]!, (sizes.get(raw[i]!) ?? 0) + 1);
  });
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const rank = new Map(ranked.map(([c], i) => [c, i]));
  const of = new Int32Array(n).fill(-1);
  data.nodes.forEach((node, i) => {
    if (node.degree > 0) of[i] = rank.get(raw[i]!) ?? -1;
  });
  const count = ranked.length;
  const between = new Map<number, number>();
  for (const l of data.links) {
    const a = of[l.source]!;
    const b = of[l.target]!;
    if (a < 0 || b < 0 || a === b) continue;
    const key = Math.min(a, b) * count + Math.max(a, b);
    between.set(key, (between.get(key) ?? 0) + 1);
  }
  // Seriation only places communities that share a link with another; the
  // rest flank that block on both sides, smallest outermost, so the figure
  // stays centred instead of stacking every small community to the right.
  const linked = new Set<number>();
  for (const key of between.keys()) {
    linked.add(Math.floor(key / count));
    linked.add(key % count);
  }
  const seriated = seriate(count, between).filter((c) => linked.has(c));
  const loose = Array.from({ length: count }, (_, c) => c).filter((c) => !linked.has(c));
  const left = loose.filter((_, i) => i % 2 === 1).reverse();
  const right = loose.filter((_, i) => i % 2 === 0);
  const order = [...left, ...seriated, ...right];
  return { of, count, order, modularity: modularity(n, edges, raw) };
}

// ─── The ground ─────────────────────────────────────────────────────────────

interface StripSpec {
  key: string;
  /** A true name, or null to name the strip by its most-linked memory. */
  name: string | null;
  members: number[];
  isolated: boolean;
}

interface Strip extends StripSpec {
  name: string;
  /** True when the name is a memory's label rather than a category. */
  quoted: boolean;
  width: number;
  col0: number;
  hub: number;
  inside: number;
  insideContra: number;
  out: number;
  minRow: number;
  maxRow: number;
}

interface BandRows {
  band: RetentionBand;
  row0: number;
  rows: number;
  count: number;
}

interface Ground {
  view: View;
  strips: Strip[];
  cols: number;
  rows: number;
  width: number;
  depth: number;
  stripOf: Int32Array;
  colOf: Int32Array;
  rowOf: Int32Array;
  x: Float32Array;
  z: Float32Array;
  h: Float32Array;
  bands: BandRows[];
  arcs: number[];
  arcAgree: number;
  arcContra: number;
  lateral: number;
  temporal: number;
  lateralContra: number;
  temporalContra: number;
  /** Links that join two cells of one strip and one band — the heights. */
  standing: number;
  note: string;
  widthWord: string;
  stripWord: string;
  isolatedStrip: number;
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/[#*_`>[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:;,\-–—\s]+$/, '');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function groupsFor(data: ObsData, view: View, communities: Communities): StripSpec[] {
  const { nodes } = data;
  if (view === 'district') {
    const buckets: number[][] = Array.from({ length: communities.count }, () => []);
    const isolated: number[] = [];
    nodes.forEach((_, i) => {
      const c = communities.of[i]!;
      if (c < 0) isolated.push(i);
      else buckets[c]!.push(i);
    });
    const specs: StripSpec[] = communities.order.map((c) => ({
      key: `c${c}`,
      name: null,
      members: buckets[c]!,
      isolated: false,
    }));
    if (isolated.length) specs.unshift({ key: 'isolated', name: 'No link', members: isolated, isolated: true });
    return specs;
  }
  if (view === 'meaning') {
    const bins: number[][] = Array.from({ length: PC1_BINS }, () => []);
    const half = data.halfExtent || 1;
    nodes.forEach((node, i) => {
      const t = (node.x + half) / (2 * half);
      bins[Math.min(PC1_BINS - 1, Math.max(0, Math.floor(t * PC1_BINS)))]!.push(i);
    });
    return bins
      .map((members, b) => ({ key: `pc${b}`, name: null, members, isolated: false }))
      .filter((s) => s.members.length > 0);
  }
  const byType: Record<MemoryType, number[]> = { semantic: [], episodic: [], procedural: [] };
  nodes.forEach((node, i) => byType[node.type].push(i));
  return (Object.keys(byType) as MemoryType[])
    .map((type) => ({ key: type, name: TYPE_NAME[type], members: byType[type], isolated: false }))
    .filter((s) => s.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length);
}

function meanSpans(data: ObsData): { linked: number; random: number } {
  const { nodes, links } = data;
  const linked = links.length ? links.reduce((acc, l) => acc + l.span, 0) / links.length : 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < nodes.length; i += 3) {
    for (let j = i + 1; j < nodes.length; j += 3) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      sum += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      count++;
    }
  }
  return { linked, random: count ? sum / count : 0 };
}

function groundNote(data: ObsData, view: View, communities: Communities, stripCount: number): string {
  const { stats, nodes, links } = data;
  if (view === 'district') {
    return (
      `${nf.format(communities.count)} communities found from the drawn links alone, modularity ` +
      `${communities.modularity.toFixed(2)}. Strips that share links stand side by side; the gap ` +
      `between two strips is not a distance.`
    );
  }
  if (view === 'meaning') {
    const spans = meanSpans(data);
    return (
      `PC1 of the projection, in ${nf.format(stripCount)} columns. The three components keep ` +
      `${Math.round(stats.explainedVariance * 100)}% of the embedding variance, and linked memories ` +
      `sit ${spans.linked.toFixed(1)} apart against ${spans.random.toFixed(1)} for a random pair, ` +
      `so districts pile onto each other here.`
    );
  }
  const same = links.reduce(
    (acc, l) => acc + (nodes[l.source]!.type === nodes[l.target]!.type ? 1 : 0),
    0
  );
  return (
    `${nf.format(stats.byType.semantic)} of ${nf.format(nodes.length)} memories are semantic and ` +
    `${pct(same, links.length)}% of links join two of the same type. Type sorts the plane and ` +
    `explains little of it.`
  );
}

function buildGround(data: ObsData, view: View, communities: Communities): Ground {
  const { nodes, links } = data;
  const n = nodes.length;
  const specs = groupsFor(data, view, communities);
  const stripOf = new Int32Array(n).fill(-1);
  specs.forEach((s, si) =>
    s.members.forEach((i) => {
      stripOf[i] = si;
    })
  );
  const divisor = STRIP_DIVISOR[view];
  const widths = specs.map((s) => Math.max(1, Math.round(Math.sqrt(s.members.length) / divisor)));

  const bands: BandRows[] = [];
  let row = 0;
  for (const band of BAND_ORDER) {
    let rows = 1;
    let count = 0;
    specs.forEach((s, si) => {
      const c = s.members.reduce((acc, i) => acc + (nodes[i]!.retentionBand === band ? 1 : 0), 0);
      count += c;
      rows = Math.max(rows, Math.ceil(c / widths[si]!));
    });
    bands.push({ band, row0: row, rows, count });
    row += rows + 1;
  }
  const rows = row - 1;

  const col0s: number[] = [];
  let col = 0;
  widths.forEach((w) => {
    col0s.push(col);
    col += w + 1;
  });
  const cols = col - 1;
  const width = cols * DX;
  const depth = rows * DZ;

  const colOf = new Int32Array(n);
  const rowOf = new Int32Array(n);
  specs.forEach((s, si) => {
    const w = widths[si]!;
    for (const b of bands) {
      const inBand = s.members
        .filter((i) => nodes[i]!.retentionBand === b.band)
        .sort((p, q) => nodes[q]!.retention - nodes[p]!.retention);
      inBand.forEach((i, k) => {
        colOf[i] = col0s[si]! + (k % w);
        rowOf[i] = b.row0 + Math.floor(k / w);
      });
    }
  });
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (colOf[i]! + 0.5 - cols / 2) * DX;
    z[i] = depth / 2 - (rowOf[i]! + 0.5) * DZ;
    h[i] = H_BASE + H_PER * Math.pow(nodes[i]!.degree, H_POW);
  }

  const arcs: number[] = [];
  let arcAgree = 0;
  let arcContra = 0;
  let lateral = 0;
  let temporal = 0;
  let lateralContra = 0;
  let temporalContra = 0;
  const inside = new Int32Array(specs.length);
  const insideContra = new Int32Array(specs.length);
  const out = new Int32Array(specs.length);
  links.forEach((l, li) => {
    const a = stripOf[l.source]!;
    const b = stripOf[l.target]!;
    const lat = a !== b;
    const tem = nodes[l.source]!.retentionBand !== nodes[l.target]!.retentionBand;
    const contra = l.kind === 'contradicts';
    if (lat) {
      out[a] = out[a]! + 1;
      out[b] = out[b]! + 1;
    } else {
      inside[a] = inside[a]! + 1;
      if (contra) insideContra[a] = insideContra[a]! + 1;
    }
    if (!lat && !tem) return;
    arcs.push(li);
    if (contra) arcContra++;
    else arcAgree++;
    if (lat) {
      lateral++;
      if (contra) lateralContra++;
    } else {
      temporal++;
      if (contra) temporalContra++;
    }
  });

  const strips: Strip[] = specs.map((s, si) => {
    let hub = s.members[0] ?? -1;
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = 0;
    for (const i of s.members) {
      if (hub < 0 || nodes[i]!.degree > nodes[hub]!.degree) hub = i;
      minRow = Math.min(minRow, rowOf[i]!);
      maxRow = Math.max(maxRow, rowOf[i]!);
    }
    const quoted = s.name === null;
    const name = s.name ?? (hub >= 0 ? truncate(cleanLabel(nodes[hub]!.label), NAME_CHARS) : s.key);
    return {
      ...s,
      name,
      quoted,
      width: widths[si]!,
      col0: col0s[si]!,
      hub,
      inside: inside[si]!,
      insideContra: insideContra[si]!,
      out: out[si]!,
      minRow: Number.isFinite(minRow) ? minRow : 0,
      maxRow,
    };
  });

  const viewMeta = VIEWS.find((v) => v.id === view)!;
  return {
    view,
    strips,
    cols,
    rows,
    width,
    depth,
    stripOf,
    colOf,
    rowOf,
    x,
    z,
    h,
    bands,
    arcs,
    arcAgree,
    arcContra,
    lateral,
    temporal,
    lateralContra,
    temporalContra,
    standing: links.length - arcs.length,
    note: groundNote(data, view, communities, specs.length),
    widthWord: viewMeta.widthWord,
    stripWord: view === 'district' ? 'district' : view === 'meaning' ? 'column' : 'type',
    isolatedStrip: strips.findIndex((s) => s.isolated),
  };
}

/** Age in days at which retention crosses a band floor: 2^(-d/h) = r. */
function daysAtFloor(floor: number, halfLifeDays: number): number {
  return floor > 0 ? -Math.log2(floor) * halfLifeDays : Number.POSITIVE_INFINITY;
}

// ─── Arc geometry ───────────────────────────────────────────────────────────

interface Buffers {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

const EMPTY_BUFFERS: Buffers = { positions: new Float32Array(0), colors: new Float32Array(0), count: 0 };

function arcBuffers(ground: Ground, links: ObsLink[], indices: number[]): Buffers {
  if (indices.length === 0) return EMPTY_BUFFERS;
  const segments = indices.length * ARC_SEGMENTS;
  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  const colour = new THREE.Color();
  let p = 0;
  for (const li of indices) {
    const l = links[li]!;
    const ax = ground.x[l.source]!;
    const ay = ground.h[l.source]!;
    const az = ground.z[l.source]!;
    const bx = ground.x[l.target]!;
    const by = ground.h[l.target]!;
    const bz = ground.z[l.target]!;
    const span = Math.hypot(bx - ax, bz - az);
    const lift = Math.min(ARC_LIFT_MAX, Math.max(ARC_LIFT_MIN, ARC_LIFT * span));
    const cx = (ax + bx) / 2;
    const cy = Math.max(ay, by) + lift;
    const cz = (az + bz) / 2;
    colour.setHex(linkColorInt(l));
    let px = ax;
    let py = ay;
    let pz = az;
    for (let s = 1; s <= ARC_SEGMENTS; s++) {
      const t = s / ARC_SEGMENTS;
      const u = 1 - t;
      const qx = u * u * ax + 2 * u * t * cx + t * t * bx;
      const qy = u * u * ay + 2 * u * t * cy + t * t * by;
      const qz = u * u * az + 2 * u * t * cz + t * t * bz;
      const o = p * 6;
      positions[o] = px;
      positions[o + 1] = py;
      positions[o + 2] = pz;
      positions[o + 3] = qx;
      positions[o + 4] = qy;
      positions[o + 5] = qz;
      colors[o] = colour.r;
      colors[o + 1] = colour.g;
      colors[o + 2] = colour.b;
      colors[o + 3] = colour.r;
      colors[o + 4] = colour.g;
      colors[o + 5] = colour.b;
      px = qx;
      py = qy;
      pz = qz;
      p++;
    }
  }
  return { positions, colors, count: segments };
}

function segmentsGeometry(points: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

interface Fit {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
}

/** Elevation 32°, target 0.3 × depth behind the centre, and the distance
 *  solved by bisection so that the plane's near edge spans no more than
 *  1.12 × the box width AND lies no lower than 1.06 × its height — whichever
 *  bound binds. A wide plane (the district view) is bounded by width; a tall
 *  narrow one (the type view) by height. Measured over a sweep this is the
 *  strongest perspective (a near cell ≈ 1.6 × a far one at 16:9) that keeps
 *  every strip and band inside the frame at rest. */
function cameraFit(ground: Ground, aspect: number): Fit {
  const target = new THREE.Vector3(0, 0, CAM_TARGET_Z * ground.depth);
  const probe = new THREE.PerspectiveCamera(CAM_FOV, Math.max(0.2, aspect), 0.5, 4000);
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const measure = (distance: number): { nearWidth: number; nearY: number } => {
    probe.position.set(
      0,
      distance * Math.sin(CAM_ELEVATION),
      target.z + distance * Math.cos(CAM_ELEVATION)
    );
    probe.lookAt(target);
    probe.updateMatrixWorld();
    probe.updateProjectionMatrix();
    left.set(-ground.width / 2, 0, ground.depth / 2).project(probe);
    right.set(ground.width / 2, 0, ground.depth / 2).project(probe);
    return { nearWidth: (right.x - left.x) / 2, nearY: (1 - left.y) / 2 };
  };
  // Both measures fall as the camera backs away, so each bound is a bisection
  // and the binding one is the larger distance.
  const solve = (over: (m: { nearWidth: number; nearY: number }) => boolean): number => {
    let lo = ground.depth * 0.5;
    let hi = ground.depth * 8;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (over(measure(mid))) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const distance = Math.max(
    solve((m) => m.nearWidth > CAM_NEAR_WIDTH),
    solve((m) => m.nearY > CAM_NEAR_Y)
  );
  const position = new THREE.Vector3(
    0,
    distance * Math.sin(CAM_ELEVATION),
    target.z + distance * Math.cos(CAM_ELEVATION)
  );
  return { position, target, distance };
}

// ─── Scene: the ruled plane ─────────────────────────────────────────────────

function GridLines({ ground }: { ground: Ground }) {
  const built = useMemo(() => {
    const { cols, rows, width, depth } = ground;
    const pts: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const gx = (c - cols / 2) * DX;
      pts.push(gx, 0, -depth / 2, gx, 0, depth / 2);
    }
    for (let r = 0; r <= rows; r++) {
      const gz = depth / 2 - r * DZ;
      pts.push(-width / 2, 0, gz, width / 2, 0, gz);
    }
    const gridMaterial = new THREE.LineBasicMaterial({ color: PLATE_COLORS.rule });
    const grid = new THREE.LineSegments(segmentsGeometry(pts), gridMaterial);
    grid.frustumCulled = false;

    // Band boundaries run through the centre of each gap row, a shade above
    // the hairlines and a little past the plane's edge so the scale can be
    // read against them.
    const bandPts: number[] = [];
    for (const b of ground.bands.slice(1)) {
      const gz = depth / 2 - (b.row0 - 0.5) * DZ;
      bandPts.push(-width / 2 - DX, 0.01, gz, width / 2 + DX, 0.01, gz);
    }
    const bandMaterial = new THREE.LineBasicMaterial({
      color: PLATE_COLORS.ink3,
      transparent: true,
      opacity: 0.55,
    });
    const bandLines = new THREE.LineSegments(segmentsGeometry(bandPts), bandMaterial);
    bandLines.frustumCulled = false;
    return { grid, gridMaterial, bandLines, bandMaterial };
  }, [ground]);

  useEffect(
    () => () => {
      built.grid.geometry.dispose();
      built.gridMaterial.dispose();
      built.bandLines.geometry.dispose();
      built.bandMaterial.dispose();
    },
    [built]
  );

  return (
    <>
      <primitive object={built.grid} />
      <primitive object={built.bandLines} />
    </>
  );
}

// ─── Scene: the cells ───────────────────────────────────────────────────────

/** A soft additive disc, sized in world units. Colour is a uniform — the
 *  token — and the falloff is arithmetic, so no texture and no literal. */
const HALO_VERTEX = `
attribute float size;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(256.0, size * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const HALO_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a *= a;
  gl_FragColor = vec4(uColor, a * uOpacity);
  #include <colorspace_fragment>
}`;

function haloMaterial(colour: string, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colour) },
      uOpacity: { value: opacity },
      uScale: { value: 1 },
    },
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

interface CellsProps {
  ground: Ground;
  data: ObsData;
  active: number | null;
  focus: number | null;
  neighbours: ReadonlySet<number>;
  glow: boolean;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function Cells({ ground, data, active, focus, neighbours, glow, onHover, onPick }: CellsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const n = data.nodes.length;

  const built = useMemo(() => {
    const geometry = new THREE.BoxGeometry(CELL * DX, 1, CELL * DX);
    geometry.translate(0, 0.5, 0);
    // A fixed light on one token: the top face at 1.22 × `--memory` (still
    // far under `--memory-live`, which stays the one live cell), the face
    // turned toward the camera at 0.62, the sides at 0.46, back and underside
    // at 0.32. Lighting, not a second colour, and the same for every cell —
    // density stays in height and halo.
    const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const shade = new Float32Array(normals.count * 3);
    for (let v = 0; v < normals.count; v++) {
      const ny = normals.getY(v);
      const nz = normals.getZ(v);
      const k =
        ny > 0.5 ? FACE_TOP : nz > 0.5 ? FACE_FRONT : ny < -0.5 || nz < -0.5 ? FACE_BACK : FACE_SIDE;
      shade[v * 3] = k;
      shade[v * 3 + 1] = k;
      shade[v * 3 + 2] = k;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    // Identity multiplier: the instance colour, shaded per face, IS the colour.
    material.color.setScalar(1);
    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const rest = new THREE.Color(PLATE_COLORS.memory);
    const maxDegree = Math.max(1, data.stats.degree.max);
    const haloPositions = new Float32Array(n * 3);
    const haloSizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      matrix.makeScale(1, ground.h[i]!, 1);
      matrix.setPosition(ground.x[i]!, 0, ground.z[i]!);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, rest);
      haloPositions[i * 3] = ground.x[i]!;
      haloPositions[i * 3 + 1] = ground.h[i]!;
      haloPositions[i * 3 + 2] = ground.z[i]!;
      haloSizes[i] =
        CELL_HALO_MIN +
        (CELL_HALO_MAX - CELL_HALO_MIN) * Math.sqrt(data.nodes[i]!.degree / maxDegree);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3));
    haloGeometry.setAttribute('size', new THREE.BufferAttribute(haloSizes, 1));
    const haloMat = haloMaterial(PLATE_COLORS.memory, CELL_HALO_ALPHA);
    const halo = new THREE.Points(haloGeometry, haloMat);
    halo.renderOrder = 4;
    halo.frustumCulled = false;

    const focusGeometry = new THREE.BufferGeometry();
    focusGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    focusGeometry.setAttribute(
      'size',
      new THREE.BufferAttribute(new Float32Array([FOCUS_HALO_SIZE]), 1)
    );
    const focusMat = haloMaterial(PLATE_COLORS.memoryLive, FOCUS_HALO_ALPHA);
    const focusHalo = new THREE.Points(focusGeometry, focusMat);
    focusHalo.renderOrder = 5;
    focusHalo.frustumCulled = false;

    return { mesh, geometry, material, halo, haloGeometry, haloMat, focusHalo, focusGeometry, focusMat };
  }, [ground, data, n]);

  // Colour is the reading state and nothing else: rest, neighbour, live.
  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    const near = new THREE.Color(PLATE_COLORS.ink2);
    const live = new THREE.Color(PLATE_COLORS.memoryLive);
    for (let i = 0; i < n; i++) {
      built.mesh.setColorAt(
        i,
        i === active || i === focus ? live : neighbours.has(i) ? near : rest
      );
    }
    if (built.mesh.instanceColor) built.mesh.instanceColor.needsUpdate = true;
    const lit = active ?? focus;
    if (lit !== null) {
      const attr = built.focusGeometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, ground.x[lit]!, ground.h[lit]!, ground.z[lit]!);
      attr.needsUpdate = true;
    }
    invalidate();
  }, [built, ground, n, active, focus, neighbours, invalidate]);

  // Sprite size is world units; the vertex shader needs pixels per unit at z = 1.
  useEffect(() => {
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : CAM_FOV;
    const scale = (size.height * dpr) / (2 * Math.tan((fov * Math.PI) / 360));
    built.haloMat.uniforms.uScale!.value = scale;
    built.focusMat.uniforms.uScale!.value = scale;
    invalidate();
  }, [built, size.height, dpr, camera, invalidate]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.haloGeometry.dispose();
      built.haloMat.dispose();
      built.focusGeometry.dispose();
      built.focusMat.dispose();
    },
    [built]
  );

  const lit = active ?? focus;
  return (
    <>
      <primitive
        object={built.mesh}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          if (event.instanceId !== undefined) onHover(event.instanceId);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          if (event.instanceId === undefined) return;
          event.stopPropagation();
          onPick(event.instanceId);
        }}
      />
      <primitive object={built.halo} visible={glow} />
      <primitive object={built.focusHalo} visible={glow && lit !== null} />
    </>
  );
}

// ─── Scene: arcs, drawn twice ───────────────────────────────────────────────

interface ArcPairProps {
  buffers: Buffers;
  coreAlpha: number;
  haloAlpha: number;
  glow: boolean;
}

/** The halo is additive and drawn first; the core is opaque, normal-blended
 *  and drawn after it, so a core pixel is always the unmodified token. */
function ArcPair({ buffers, coreAlpha, haloAlpha, glow }: ArcPairProps) {
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
      opacity: HALO_ALPHA,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreMat = new LineMaterial({
      vertexColors: true,
      worldUnits: false,
      linewidth: CORE_PX,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });
    const halo = new LineSegments2(geometry, haloMat);
    halo.renderOrder = 6;
    halo.frustumCulled = false;
    const core = new LineSegments2(geometry, coreMat);
    core.renderOrder = 10;
    core.frustumCulled = false;
    return { geometry, haloMat, coreMat, halo, core };
  }, [buffers]);

  useEffect(() => {
    if (!built) return;
    built.haloMat.opacity = haloAlpha;
    built.coreMat.opacity = coreAlpha;
    built.haloMat.resolution.set(size.width, size.height);
    built.coreMat.resolution.set(size.width, size.height);
    invalidate();
  }, [built, coreAlpha, haloAlpha, size.width, size.height, invalidate]);

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
      <primitive object={built.halo} visible={glow} />
      <primitive object={built.core} />
    </>
  );
}

// ─── Scene: the region a window magnifies ───────────────────────────────────

function RegionBoxes({ ground, strips }: { ground: Ground; strips: readonly number[] }) {
  const built = useMemo(() => {
    const pts: number[] = [];
    const y = 0.02;
    for (const si of strips) {
      const s = ground.strips[si];
      if (!s) continue;
      const x0 = (s.col0 - ground.cols / 2) * DX - 0.14;
      const x1 = (s.col0 + s.width - ground.cols / 2) * DX + 0.14;
      const z0 = ground.depth / 2 - s.minRow * DZ + 0.14;
      const z1 = ground.depth / 2 - (s.maxRow + 1) * DZ - 0.14;
      pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const material = new THREE.LineBasicMaterial({
      color: PLATE_COLORS.ink2,
      transparent: true,
      opacity: 0.85,
    });
    const lines = new THREE.LineSegments(segmentsGeometry(pts), material);
    lines.frustumCulled = false;
    return { lines, material };
  }, [ground, strips]);

  useEffect(
    () => () => {
      built.lines.geometry.dispose();
      built.material.dispose();
    },
    [built]
  );

  return <primitive object={built.lines} />;
}

// ─── Scene: projecting plane points onto the DOM ────────────────────────────

type AnchorKind = 'inset' | 'tick' | 'label' | 'callout';

interface Anchor {
  key: string;
  kind: AnchorKind;
  world: THREE.Vector3;
  /** For an inset: the screen point the leader leaves from. */
  from?: readonly [number, number];
}

type Registry = Map<string, Element>;

const px = (v: number) => v.toFixed(1);

function placeAnchor(
  anchor: Anchor,
  registry: Registry,
  sx: number,
  sy: number,
  behind: boolean,
  boxWidth: number
): void {
  const visibility = behind ? 'hidden' : 'visible';
  if (anchor.kind === 'inset') {
    const ring = registry.get(`${anchor.key}:ring`);
    const line = registry.get(`${anchor.key}:line`);
    if (ring) {
      ring.setAttribute('cx', px(sx));
      ring.setAttribute('cy', px(sy));
      ring.setAttribute('visibility', visibility);
    }
    if (line && anchor.from) {
      const [fx, fy] = anchor.from;
      const dx = sx - fx;
      const dy = sy - fy;
      const len = Math.hypot(dx, dy) || 1;
      line.setAttribute('x1', px(fx));
      line.setAttribute('y1', px(fy));
      line.setAttribute('x2', px(sx - (dx / len) * RING_R));
      line.setAttribute('y2', px(sy - (dy / len) * RING_R));
      line.setAttribute('visibility', visibility);
    }
    return;
  }
  if (anchor.kind === 'tick') {
    const g = registry.get(`${anchor.key}:tick`);
    if (g) {
      g.setAttribute('transform', `translate(0 ${px(sy)})`);
      g.setAttribute('visibility', visibility);
    }
    return;
  }
  if (anchor.kind === 'label') {
    const el = registry.get(`${anchor.key}:label`);
    if (el instanceof HTMLElement) {
      el.style.transform = `translate3d(${px(sx)}px, ${px(sy)}px, 0) translate(-50%, -100%)`;
      el.style.visibility = visibility;
    }
    return;
  }
  const box = registry.get(`${anchor.key}:box`);
  const ring = registry.get(`${anchor.key}:ring`);
  const line = registry.get(`${anchor.key}:line`);
  const flip = sx + CALLOUT_DX + CALLOUT_W > boxWidth;
  const bx = flip ? sx - CALLOUT_DX : sx + CALLOUT_DX;
  const by = sy + CALLOUT_DY;
  if (box instanceof HTMLElement) {
    box.style.transform = `translate3d(${px(bx)}px, ${px(by)}px, 0)${flip ? ' translate(-100%, 0)' : ''}`;
    box.style.visibility = visibility;
  }
  if (ring) {
    ring.setAttribute('cx', px(sx));
    ring.setAttribute('cy', px(sy));
    ring.setAttribute('visibility', visibility);
  }
  if (line) {
    const tx = bx;
    const ty = by + CALLOUT_H;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    line.setAttribute('x1', px(sx + (dx / len) * RING_R));
    line.setAttribute('y1', px(sy + (dy / len) * RING_R));
    line.setAttribute('x2', px(tx));
    line.setAttribute('y2', px(ty));
    line.setAttribute('visibility', visibility);
  }
}

/** Writes screen positions straight into the overlay's elements on every
 *  rendered frame — no React state per frame, and only `transform` moves. */
function Projector({ anchors, registry }: { anchors: readonly Anchor[]; registry: RefObject<Registry> }) {
  const invalidate = useThree((s) => s.invalidate);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    invalidate();
  }, [anchors, invalidate]);
  useFrame(({ camera, size }) => {
    const reg = registry.current;
    for (const anchor of anchors) {
      scratch.copy(anchor.world).project(camera);
      const behind = scratch.z > 1;
      const sx = ((scratch.x + 1) / 2) * size.width;
      const sy = ((1 - scratch.y) / 2) * size.height;
      placeAnchor(anchor, reg, sx, sy, behind, size.width);
    }
  });
  return null;
}

// ─── Scene: the camera ──────────────────────────────────────────────────────

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
      autoRotate={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      minDistance={fit.distance * 0.5}
      maxDistance={fit.distance * 1.8}
      minPolarAngle={Math.PI * 0.2}
      maxPolarAngle={Math.PI * 0.44}
      minAzimuthAngle={-0.75}
      maxAzimuthAngle={0.75}
    />
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────

interface Layers {
  cells: boolean;
  arcs: boolean;
  insets: boolean;
  glow: boolean;
}

interface SceneProps {
  ground: Ground;
  data: ObsData;
  fit: Fit;
  reducedMotion: boolean;
  layers: Layers;
  active: number | null;
  focus: number | null;
  neighbours: ReadonlySet<number>;
  restBuffers: Buffers;
  focusBuffers: Buffers;
  insetStrips: readonly number[];
  anchors: readonly Anchor[];
  registry: RefObject<Registry>;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function Scene({
  ground,
  data,
  fit,
  reducedMotion,
  layers,
  active,
  focus,
  neighbours,
  restBuffers,
  focusBuffers,
  insetStrips,
  anchors,
  registry,
  onHover,
  onPick,
}: SceneProps) {
  const dimmed = active !== null || focus !== null;
  return (
    <>
      <Rig fit={fit} reducedMotion={reducedMotion} />
      <GridLines ground={ground} />
      {layers.cells ? (
        <Cells
          ground={ground}
          data={data}
          active={active}
          focus={focus}
          neighbours={neighbours}
          glow={layers.glow}
          onHover={onHover}
          onPick={onPick}
        />
      ) : null}
      {layers.arcs ? (
        <ArcPair
          buffers={restBuffers}
          coreAlpha={dimmed ? CORE_ALPHA_DIM : 1}
          haloAlpha={dimmed ? HALO_ALPHA_DIM : HALO_ALPHA}
          glow={layers.glow}
        />
      ) : null}
      <ArcPair buffers={focusBuffers} coreAlpha={1} haloAlpha={HALO_ALPHA * 1.5} glow={layers.glow} />
      {layers.insets && insetStrips.length ? <RegionBoxes ground={ground} strips={insetStrips} /> : null}
      <Projector anchors={anchors} registry={registry} />
    </>
  );
}

// ─── Overlay: the chrome ────────────────────────────────────────────────────

const LAYER_ORDER: readonly (keyof Layers)[] = ['cells', 'arcs', 'insets', 'glow'];
const LAYER_NAME: Record<keyof Layers, string> = {
  cells: 'Cells',
  arcs: 'Arcs',
  insets: 'Insets',
  glow: 'Glow',
};
const STEP_NAME = ['weak', 'mid', 'strong'] as const;

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="mm-fig">
      <div className="mm-fig-n">{value}</div>
      <div className="mm-caps">{label}</div>
      {note ? <div className="mm-fig-note">{note}</div> : null}
    </div>
  );
}

interface ChromeProps {
  data: ObsData;
  ground: Ground;
  communities: Communities;
  layers: Layers;
  onLayer: (layer: keyof Layers) => void;
}

function Chrome({ data, ground, communities, layers, onLayer }: ChromeProps) {
  const { stats } = data;
  const stripCount = ground.strips.filter((s) => !s.isolated).length;
  const stripNote =
    ground.view === 'district'
      ? `modularity ${communities.modularity.toFixed(2)}`
      : ground.view === 'meaning'
        ? `of ${PC1_BINS} bins on PC1`
        : 'of 3 in the store';
  return (
    <>
      <div className="mm-title">
        <h2>Living memory matrix</h2>
        <div className="mm-caps mm-title-sub">
          {nf.format(stripCount)} {ground.stripWord}s on {ground.bands.length} depth bands
        </div>
        <div className="mm-title-rule" aria-hidden="true" />
      </div>
      <nav className="mm-nav" aria-label="Layers">
        {LAYER_ORDER.map((layer) => (
          <button
            key={layer}
            type="button"
            className="mm-caps mm-nav-item"
            aria-pressed={layers[layer]}
            onClick={() => onLayer(layer)}
          >
            {LAYER_NAME[layer]}
          </button>
        ))}
      </nav>
      <div className="mm-figures">
        <Figure
          value={nf.format(stats.memories)}
          label="memories"
          note={`${nf.format(stats.isolated)} with no link`}
        />
        <Figure
          value={nf.format(stats.linksDrawn)}
          label="links drawn"
          note={`of ${nf.format(stats.linksStored)} stored`}
        />
        <Figure value={nf.format(stripCount)} label={`${ground.stripWord}s`} note={stripNote} />
        <Figure
          value={nf.format(ground.arcs.length)}
          label="arcs"
          note={`${nf.format(ground.standing)} more stand as height`}
        />
      </div>
    </>
  );
}

// ─── Overlay: an inset window ───────────────────────────────────────────────

interface InsetProps {
  ground: Ground;
  data: ObsData;
  strip: number;
  left: number;
  top: number;
  lit: number | null;
  neighbours: ReadonlySet<number>;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function InsetWindow({ ground, data, strip, left, top, lit, neighbours, onHover, onPick }: InsetProps) {
  const s = ground.strips[strip]!;
  const rows = s.maxRow - s.minRow + 1;
  const maxDegree = Math.max(1, data.stats.degree.max);

  const insideLinks = useMemo(
    () =>
      data.links.filter((l) => ground.stripOf[l.source] === strip && ground.stripOf[l.target] === strip),
    [data.links, ground, strip]
  );
  const litLinks = useMemo(
    () => (lit === null ? [] : insideLinks.filter((l) => l.source === lit || l.target === lit)),
    [insideLinks, lit]
  );

  const cx = (i: number) => ground.colOf[i]! - s.col0 + 0.5;
  const cy = (i: number) => ground.rowOf[i]! + 0.5;
  const contraShare = pct(s.insideContra, s.inside);
  const caps = [
    `${nf.format(s.members.length)} memories`,
    `${nf.format(s.inside)} in`,
    `${nf.format(s.out)} out`,
  ];
  const capsTitle = `${nf.format(s.inside)} links join two memories of this ${ground.stripWord}; ${nf.format(s.out)} reach another.`;
  const summary =
    `${s.name}: ${nf.format(s.members.length)} memories, ${nf.format(s.inside)} links inside ` +
    `(${contraShare}% contradict), ${nf.format(s.out)} to other ${ground.stripWord}s.`;

  return (
    <section
      className="mm-inset"
      style={{ left, top, width: INSET_W, height: INSET_H }}
      aria-label={summary}
    >
      <h3 className="mm-inset-name" title={s.quoted ? `Most-linked memory: ${s.name}` : s.name}>
        {s.quoted ? `“${s.name}”` : s.name}
      </h3>
      <div className="mm-caps mm-inset-caps" title={capsTitle}>
        {caps.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <svg
        className="mm-inset-map"
        viewBox={`0 ${s.minRow} ${s.width} ${rows}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${nf.format(s.members.length)} cells, ${contraShare}% of the links inside contradict`}
      >
        {ground.bands.slice(1).map((b) => {
          const y = b.row0 - 0.5;
          if (y <= s.minRow || y >= s.maxRow + 1) return null;
          return <line key={b.band} className="mm-inset-band" x1={0} x2={s.width} y1={y} y2={y} />;
        })}
        <g>
          {insideLinks.map((l) => (
            <line
              key={l.id}
              className="mm-inset-link"
              x1={cx(l.source)}
              y1={cy(l.source)}
              x2={cx(l.target)}
              y2={cy(l.target)}
              stroke={`var(--${l.kind}-${STEP_NAME[l.step]})`}
            />
          ))}
        </g>
        <g>
          {litLinks.map((l) => (
            <line
              key={l.id}
              className="mm-inset-link-lit"
              x1={cx(l.source)}
              y1={cy(l.source)}
              x2={cx(l.target)}
              y2={cy(l.target)}
              stroke={`var(--${l.kind}-${STEP_NAME[l.step]})`}
            />
          ))}
        </g>
        <g>
          {s.members.map((i) => {
            const side = 0.34 + 0.5 * Math.sqrt(data.nodes[i]!.degree / maxDegree);
            const state = i === lit ? 'live' : neighbours.has(i) ? 'near' : undefined;
            return (
              <g key={i}>
                <rect
                  className="mm-inset-cell"
                  data-state={state}
                  x={cx(i) - side / 2}
                  y={cy(i) - side / 2}
                  width={side}
                  height={side}
                />
                <rect
                  className="mm-inset-hit"
                  x={cx(i) - 0.5}
                  y={cy(i) - 0.5}
                  width={1}
                  height={1}
                  onPointerEnter={() => onHover(i)}
                  onPointerLeave={() => onHover(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPick(i);
                  }}
                >
                  <title>{cleanLabel(data.nodes[i]!.label)}</title>
                </rect>
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
}

// ─── Overlay: the view switcher ─────────────────────────────────────────────

function Switcher({ view, note, onView }: { view: View; note: string; onView: (view: View) => void }) {
  return (
    <div className="mm-switch">
      <div role="radiogroup" aria-label="What width means" className="mm-radios">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            className="mm-radio"
            onClick={() => onView(v.id)}
          >
            <span className="mm-radio-dot" aria-hidden="true" />
            <span className="mm-radio-name">{v.name}</span>
            <span className="mm-caps">{v.caps}</span>
          </button>
        ))}
      </div>
      <p className="mm-note">{note}</p>
    </div>
  );
}

// ─── The plate ──────────────────────────────────────────────────────────────

interface Tick {
  key: string;
  z: number;
  band: string | null;
  count: number | null;
  days: string;
}

interface Placement {
  strip: number;
  left: number;
  top: number;
}

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const [view, setView] = useState<View>('district');
  const [layers, setLayers] = useState<Layers>({ cells: true, arcs: true, insets: true, glow: true });
  const [hover, setHover] = useState<number | null>(null);
  const [webgl] = useState(() => {
    if (typeof document === 'undefined') return false;
    try {
      const probe = document.createElement('canvas');
      const ok = probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null;
      // Hand the probe context straight back. Five plates share one browser's
      // context pool and the chooser mounts and unmounts them, so a probe kept
      // alive on every mount drains it and previously-fine plates go black.
      (probe.getContext('webgl2') ?? probe.getContext('webgl'))
        ?.getExtension('WEBGL_lose_context')
        ?.loseContext();
      return ok;
    } catch {
      return false;
    }
  });

  const communities = useMemo(() => findCommunities(data), [data]);
  const ground = useMemo(() => buildGround(data, view, communities), [data, view, communities]);
  const fit = useMemo(() => cameraFit(ground, width / Math.max(1, height)), [ground, width, height]);

  const focus = useMemo(() => {
    if (!selectedId) return null;
    const found = data.nodes.findIndex((n) => n.id === selectedId);
    return found >= 0 ? found : null;
  }, [data.nodes, selectedId]);
  const lit = hover ?? focus;

  const neighbours = useMemo(() => {
    const set = new Set<number>();
    if (lit === null) return set;
    for (const l of data.links) {
      if (l.source === lit) set.add(l.target);
      else if (l.target === lit) set.add(l.source);
    }
    return set;
  }, [data.links, lit]);

  const restBuffers = useMemo(() => arcBuffers(ground, data.links, ground.arcs), [ground, data.links]);
  const litLinks = useMemo(() => {
    if (lit === null) return [];
    const out: number[] = [];
    data.links.forEach((l, i) => {
      if (l.source === lit || l.target === lit) out.push(i);
    });
    return out;
  }, [data.links, lit]);
  const focusBuffers = useMemo(
    () => arcBuffers(ground, data.links, litLinks),
    [ground, data.links, litLinks]
  );

  // Insets: the largest strips that fit, and the picked memory's own strip if
  // it is not among them.
  const insetCount = useMemo(() => {
    const fitCount = Math.floor((width - INSET_LEFT - INSET_RIGHT_CLEAR + INSET_GAP) / (INSET_W + INSET_GAP));
    const byHeight = height < 520 ? 2 : 4;
    return Math.max(0, Math.min(4, fitCount, byHeight));
  }, [width, height]);
  const insetStrips = useMemo(() => {
    const ranked = ground.strips
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !s.isolated)
      .sort((a, b) => b.s.members.length - a.s.members.length)
      .map(({ i }) => i);
    let chosen = ranked.slice(0, insetCount);
    const focusStrip = focus !== null ? ground.stripOf[focus]! : -1;
    if (focusStrip >= 0 && chosen.length && !chosen.includes(focusStrip)) {
      chosen = [...chosen.slice(0, -1), focusStrip];
    }
    // Windows sit left to right in the order their districts lie on the
    // plane, so the leader lines never cross.
    return chosen.sort((a, b) => ground.strips[a]!.col0 - ground.strips[b]!.col0);
  }, [ground, insetCount, focus]);
  const placements = useMemo<Placement[]>(
    () =>
      insetStrips.map((strip, i) => ({
        strip,
        left: INSET_LEFT + i * (INSET_W + INSET_GAP),
        top: INSET_TOP,
      })),
    [insetStrips]
  );
  const showInsets = layers.insets && placements.length > 0;

  const oldestDays = useMemo(() => {
    let oldest = 0;
    for (const n of data.nodes) oldest = Math.max(oldest, -Math.log2(Math.max(n.retention, 1e-12)));
    return oldest * data.stats.halfLifeDays;
  }, [data]);

  const ticks = useMemo<Tick[]>(() => {
    const half = data.stats.halfLifeDays;
    const out: Tick[] = ground.bands.map((b, i) => {
      const next = ground.bands[i + 1];
      return {
        key: b.band,
        z: next ? ground.depth / 2 - (next.row0 - 0.5) * DZ : -ground.depth / 2,
        band: RETENTION_LABEL[b.band],
        count: b.count,
        days: next
          ? `${Math.round(daysAtFloor(BAND_FLOOR[b.band], half))} d`
          : `${Math.round(oldestDays)} d oldest`,
      };
    });
    out.push({ key: 'now', z: ground.depth / 2, band: null, count: null, days: 'now' });
    return out;
  }, [ground, data.stats.halfLifeDays, oldestDays]);

  // Elements the projector writes into, keyed; the callback refs are cached so
  // React does not re-attach them on every render.
  const registry = useRef<Registry>(new Map());
  const refCallbacks = useRef(new Map<string, (el: Element | null) => void>());
  const refFor = useCallback((key: string) => {
    let fn = refCallbacks.current.get(key);
    if (!fn) {
      fn = (el: Element | null) => {
        if (el) registry.current.set(key, el);
        else registry.current.delete(key);
      };
      refCallbacks.current.set(key, fn);
    }
    return fn;
  }, []);

  const anchors = useMemo<Anchor[]>(() => {
    const out: Anchor[] = [];
    const xr = ground.width / 2;
    if (showInsets) {
      placements.forEach((p, i) => {
        const s = ground.strips[p.strip]!;
        out.push({
          key: `inset${i}`,
          kind: 'inset',
          world: new THREE.Vector3(
            (s.col0 + s.width / 2 - ground.cols / 2) * DX,
            0,
            ground.depth / 2 - ((s.minRow + s.maxRow + 1) / 2) * DZ
          ),
          from: [p.left + INSET_W / 2, p.top + INSET_H],
        });
      });
    }
    for (const t of ticks) {
      out.push({ key: `tick-${t.key}`, kind: 'tick', world: new THREE.Vector3(xr, 0, t.z) });
    }
    if (lit !== null) {
      out.push({
        key: 'callout',
        kind: 'callout',
        world: new THREE.Vector3(ground.x[lit]!, ground.h[lit]!, ground.z[lit]!),
      });
    }
    const iso = ground.strips[ground.isolatedStrip];
    if (iso) {
      out.push({
        key: 'isolated',
        kind: 'label',
        world: new THREE.Vector3(
          (iso.col0 + iso.width / 2 - ground.cols / 2) * DX,
          0,
          ground.depth / 2 - ((iso.minRow + iso.maxRow + 1) / 2) * DZ
        ),
      });
    }
    return out;
  }, [ground, placements, showInsets, ticks, lit]);

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      onSelect(selectedId === node.id ? null : node.id);
    },
    [data.nodes, onSelect, selectedId]
  );
  const clear = useCallback(() => onSelect(null), [onSelect]);
  const toggleLayer = useCallback(
    (layer: keyof Layers) => setLayers((prev) => ({ ...prev, [layer]: !prev[layer] })),
    []
  );

  const litNode = lit !== null ? data.nodes[lit] : undefined;
  const isolatedStrip = ground.strips[ground.isolatedStrip];
  const insetsHead =
    ground.view === 'type'
      ? `All ${placements.length} types, sized by their links`
      : `${placements.length} largest ${ground.stripWord}s of ${nf.format(
          ground.strips.filter((s) => !s.isolated).length
        )}, each named by its most-linked memory. The store has no topics.`;
  const summary =
    `${nf.format(data.stats.memories)} memories as cells on a ruled plane: nearer is newer across ` +
    `${ground.bands.length} retention bands, each strip is one ${ground.stripWord}, and a cell's ` +
    `height is its link count. ${nf.format(ground.arcs.length)} of ${nf.format(data.links.length)} ` +
    `drawn links leap as arcs between strips or bands (${nf.format(ground.lateralContra)} of ` +
    `${nf.format(ground.lateral)} lateral leaps contradict, ${nf.format(ground.temporalContra)} of ` +
    `${nf.format(ground.temporal)} leaps across time). ${ground.note}`;

  return (
    <div className="mm-box" style={{ width, height }} data-hover={hover !== null ? '1' : undefined}>
      <style href="plate-matrix" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl ? (
        <div className="mm-canvas" role="img" aria-label={summary}>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{
              antialias: true,
              // Every ratio in tokens.css was measured on raw sRGB; ACES
              // tone mapping would move all of them.
              toneMapping: THREE.NoToneMapping,
            }}
            camera={{
              fov: CAM_FOV,
              near: 0.5,
              far: 4000,
              position: [fit.position.x, fit.position.y, fit.position.z],
            }}
            onPointerMissed={clear}
          >
            <Scene
              ground={ground}
              data={data}
              fit={fit}
              reducedMotion={reducedMotion}
              layers={layers}
              active={hover}
              focus={focus}
              neighbours={neighbours}
              restBuffers={restBuffers}
              focusBuffers={focusBuffers}
              insetStrips={showInsets ? insetStrips : []}
              anchors={anchors}
              registry={registry}
              onHover={setHover}
              onPick={pick}
            />
          </Canvas>
        </div>
      ) : (
        <p className="mm-nogl obs-note">
          This reading is drawn with WebGL and this browser did not give the page a context. The
          measurement behind it still holds: {summary}
        </p>
      )}

      <svg className="mm-overlay" aria-hidden="true">
        {showInsets
          ? placements.map((p, i) => (
              <g key={p.strip}>
                <line ref={refFor(`inset${i}:line`)} className="mm-leader" visibility="hidden" />
                <circle ref={refFor(`inset${i}:ring`)} className="mm-ring" r={RING_R} visibility="hidden" />
              </g>
            ))
          : null}
        {ticks.map((t) => (
          <g key={t.key} ref={refFor(`tick-${t.key}:tick`)} visibility="hidden">
            <line className="mm-tick-line" x1={width - 30} x2={width - 22} y1={0} y2={0} />
            <text className="mm-scale-days" x={width - 36} y={-4} textAnchor="end">
              {t.days}
            </text>
            {t.band ? (
              <text className="mm-scale-band" x={width - 36} y={12} textAnchor="end">
                {t.band} <tspan className="mm-scale-count">{nf.format(t.count ?? 0)}</tspan>
              </text>
            ) : null}
          </g>
        ))}
        {lit !== null ? (
          <g>
            <line ref={refFor('callout:line')} className="mm-leader" visibility="hidden" />
            <circle
              ref={refFor('callout:ring')}
              className="mm-ring mm-ring-live"
              r={RING_R}
              visibility="hidden"
            />
          </g>
        ) : null}
      </svg>

      <Chrome data={data} ground={ground} communities={communities} layers={layers} onLayer={toggleLayer} />

      {showInsets ? (
        <>
          <div
            className="mm-caps mm-insets-head"
            style={{ left: INSET_LEFT, top: INSET_TOP - 18, maxWidth: width - INSET_LEFT - 24 }}
          >
            {insetsHead}
          </div>
          {placements.map((p) => (
            <InsetWindow
              key={ground.strips[p.strip]!.key}
              ground={ground}
              data={data}
              strip={p.strip}
              left={p.left}
              top={p.top}
              lit={lit}
              neighbours={neighbours}
              onHover={setHover}
              onPick={pick}
            />
          ))}
        </>
      ) : null}

      {litNode ? (
        <div ref={refFor('callout:box')} className="mm-callout">
          <div className="mm-callout-name">{truncate(cleanLabel(litNode.label), 44)}</div>
          <div className="mm-caps mm-callout-caps">
            <span>{litNode.type}</span>
            <span>{nf.format(litNode.degree)} links</span>
            <span>{nf.format(litNode.contradictDegree)} contradict</span>
            <span>{RETENTION_LABEL[litNode.retentionBand]}</span>
          </div>
        </div>
      ) : null}

      {isolatedStrip ? (
        <div ref={refFor('isolated:label')} className="mm-caps mm-float-label">
          {nf.format(isolatedStrip.members.length)} with no link
        </div>
      ) : null}

      <Switcher view={view} note={ground.note} onView={setView} />

      <div className="mm-caps mm-tagline">
        <span>Depth is age</span>
        <span>Width is {ground.widthWord}</span>
        <span>Height is links</span>
      </div>
    </div>
  );
}

// ─── Style ──────────────────────────────────────────────────────────────────

const SHEET_CSS = `
.mm-box { position: relative; overflow: hidden; background: var(--plate); color: var(--ink); font-family: var(--font-instrument); user-select: none; }
.mm-canvas { position: absolute; inset: 0; }
.mm-box[data-hover='1'] .mm-canvas { cursor: pointer; }
.mm-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.mm-leader { stroke: var(--ink-3); stroke-width: 1; fill: none; }
.mm-ring { fill: none; stroke: var(--ink-2); stroke-width: 1; }
.mm-ring-live { stroke: var(--memory-live); }
.mm-caps { font-size: 10px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3); line-height: 1.4; }
.mm-title { position: absolute; left: 24px; top: 20px; pointer-events: none; }
.mm-title h2 { margin: 0; font-family: var(--font-note); font-weight: 200; font-size: var(--t-mast); line-height: 1.1; letter-spacing: -0.01em; color: var(--ink); }
.mm-title-sub { margin-top: 6px; }
.mm-title-rule { width: 28px; height: 1px; background: var(--ink); margin-top: 10px; }
.mm-nav { position: absolute; left: 24px; top: 118px; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; }
.mm-nav-item { color: var(--ink-3); transition: color var(--dur) var(--ease); }
.mm-nav-item:hover { color: var(--ink-2); }
.mm-nav-item[aria-pressed='true'] { color: var(--ink); }
.mm-figures { position: absolute; right: 24px; top: 18px; display: flex; align-items: flex-start; pointer-events: none; }
.mm-fig { padding: 0 16px; border-left: 1px solid var(--rule); min-width: 0; }
.mm-fig:first-child { border-left: none; padding-left: 0; }
.mm-fig-n { font-size: var(--t-stat); font-weight: 400; line-height: 1.1; letter-spacing: -0.01em; color: var(--ink); font-variant-numeric: tabular-nums; }
.mm-fig-note { font-size: var(--t-label); color: var(--ink-3); margin-top: 2px; white-space: nowrap; }
.mm-insets-head { position: absolute; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-inset { position: absolute; border: 1px solid var(--rule); background: var(--plate); padding: 8px 10px 6px; display: flex; flex-direction: column; }
.mm-inset-name { margin: 0; font-size: var(--t-body); font-weight: 400; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
.mm-inset-caps { display: flex; gap: 9px; white-space: nowrap; overflow: hidden; margin-top: 1px; letter-spacing: 0.11em; }
.mm-inset-map { display: block; width: 100%; height: ${INSET_MAP_H}px; margin-top: 6px; overflow: visible; }
.mm-inset-band { stroke: var(--ink-3); stroke-width: 1; vector-effect: non-scaling-stroke; opacity: 0.6; }
.mm-inset-link { stroke-width: 1; vector-effect: non-scaling-stroke; opacity: 0.26; }
.mm-inset-link-lit { stroke-width: 1.5; vector-effect: non-scaling-stroke; opacity: 1; }
.mm-inset-cell { fill: var(--memory); }
.mm-inset-cell[data-state='near'] { fill: var(--ink-2); }
.mm-inset-cell[data-state='live'] { fill: var(--memory-live); }
.mm-inset-hit { fill: none; pointer-events: all; cursor: pointer; }
.mm-scale-band { fill: var(--ink-2); font-size: 11px; }
.mm-scale-count { fill: var(--ink); font-weight: 500; }
.mm-scale-days { fill: var(--ink-3); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }
.mm-tick-line { stroke: var(--ink-3); stroke-width: 1; }
.mm-callout { position: absolute; left: 0; top: 0; width: ${CALLOUT_W}px; pointer-events: none; visibility: hidden; }
.mm-callout-name { font-size: var(--t-body); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
.mm-callout-caps { display: flex; gap: 10px; white-space: nowrap; margin-top: 2px; color: var(--ink-2); }
.mm-float-label { position: absolute; left: 0; top: 0; pointer-events: none; visibility: hidden; white-space: nowrap; padding-bottom: 4px; }
.mm-switch { position: absolute; left: 24px; bottom: 22px; display: flex; flex-direction: column; align-items: flex-start; }
.mm-radios { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.mm-radio { display: flex; align-items: baseline; gap: 10px; color: var(--ink-3); transition: color var(--dur) var(--ease); }
.mm-radio:hover { color: var(--ink-2); }
.mm-radio[aria-checked='true'] { color: var(--ink); }
.mm-radio-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--ink-2); flex: 0 0 auto; align-self: center; transition: opacity var(--dur) var(--ease); }
.mm-radio[aria-checked='true'] .mm-radio-dot { background: var(--ink); border-color: var(--ink); }
.mm-radio-name { font-size: var(--t-body); }
.mm-note { margin: 8px 0 0; max-width: 44ch; font-size: var(--t-label); line-height: 1.45; color: var(--ink-3); }
.mm-tagline { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; gap: 22px; pointer-events: none; white-space: nowrap; }
.mm-nogl { position: absolute; left: 24px; top: 210px; margin: 0; max-width: 56ch; }
`;

// ─── Module ─────────────────────────────────────────────────────────────────

export const memoryMatrix: DemoModule = {
  id: 'matrix',
  name: 'Living Memory Matrix',
  dimension: '3D',
  claim:
    'A ruled plane in perspective can hold every memory at once — nearer is newer, each strip one link community, height the link count — and four magnified windows are what let the crowded horizon be read.',
  Plate,
};
