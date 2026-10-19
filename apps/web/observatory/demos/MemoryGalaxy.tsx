/**
 * SLOT: Memory Galaxy (3D). "A galaxy whose shape is the link graph."
 *
 * ─── The warning this slot was written under ───────────────────────────────
 *
 * The app once shipped a view called Galaxy and the owner had it deleted:
 * it arranged memories on a spiral whose position encoded nothing.
 * So every spatial channel here is a measurement, and each is
 * named on the plate:
 *
 *   angle      which link community a memory belongs to (Louvain on the
 *              strength-weighted link graph, computed live from `data`).
 *              Each community in the giant component is one ARM; its angular
 *              sector is proportional to its member count; arms are ordered
 *              by size clockwise from the top.
 *   radius     how many links a memory has. Hubs sit at the core, single-link
 *              memories on the rim. The five faint orbit rings are the axis:
 *              they sit at the store's own degree quantiles and are labelled.
 *   height     age against the median memory. Newer rises above the disc,
 *              older sinks below it. On this store that is two shelves,
 *              because the store was written in two bursts.
 *   knots      the connected components that are NOT joined to the giant
 *              one. They stand off on an outer ring, ordered by size, and are
 *              dense globular knots because inside each the same rule holds:
 *              distance from the knot's centre is fewer links.
 *   outer rim  the memories with no link at all. They belong to nothing.
 *   dot size   how often a memory has been recalled. Most never — most tiny.
 *   hue        link kind — blue agrees, orange contradicts.
 *   luminance  link strength, three ordinal steps within each hue, and each
 *   + width    step also gets its own line width so the ramp survives bloom.
 *
 * The spiral wind is one monotone function of radius applied identically to
 * every arm, so angle-at-radius still maps one-to-one onto community. It is
 * the galaxy's shape, and it cannot say anything false.
 *
 * The PCA projection is not used. Position is computed from the links alone.
 *
 * ─── What the reference images showed, and what is refused ────────────────
 *
 * The reference prints 12,428 memories in 317 clusters with names like
 * "Technology". None of that exists. Every figure on this plate comes from
 * `data`; every cluster is named by the label its members most often carry,
 * with the count that carries it, or by its busiest member when no label
 * repeats. There is no "LIVE" pill because nothing streams — the pill prints
 * the modularity of the partition the arms are drawn from. Contradictions
 * are not thinned to make the orange sparse: they are half the links. They
 * read sparse because they are weak — median 0.57 — and therefore paint on
 * the darkest step and the thinnest width. That is the data, not a filter.
 *
 * ─── Glow ──────────────────────────────────────────────────────────────────
 *
 * Links and dots are additive, and a bloom pass is on. Measured (see the
 * report): with additive compositing on `--plate` every one of the six link
 * colours still clears the 3:1 mark floor as a single strand (3.16–6.29:1),
 * and overlap only brightens within the hue (two strong-blue strands sum to
 * a lighter blue, three to a near-white blue; orange stays orange). The bloom threshold sits
 * at linear luminance 0.26 with 0.02 smoothing: the strong step (0.28–0.30)
 * blooms, the mid (0.19) and weak (0.12) steps do not, so the ramp is
 * strictly ordinal after the glow. Width is the second, glow-proof channel.
 *
 * No autorotation, ever. Under `reducedMotion` the view switch snaps and the
 * labels do not fade in. Nothing ticks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  linkColorInt,
  type DemoModule,
  type DemoProps,
  type ObsData,
  type ObsLink,
  type ObsNode,
} from './contract';

// ─── The encoding, as constants ─────────────────────────────────────────────

/** Radii in world units. The disc holds the giant component; knots ride the
 *  satellite ring; unlinked memories sit on the outermost rim. */
const R_CORE = 3;
const R_DISC = 40;
const R_SATELLITE = 47;
const R_ALONE = 55;
const FIT_RADIUS = 60;

/** Spiral sweep from core to rim, radians, identical for every arm. */
const WIND = 2.6;
/** How much of its sector an arm fills; the rest is the gap to its neighbour. */
const SECTOR_FILL = 0.72;
/** Radial jitter as a fraction of the gap between consecutive degree radii —
 *  it only pulls apart memories with the same link count. */
const RADIAL_JITTER = 0.3;
/** Height per √(days from the median age). */
const AGE_K = 1.25;
/** Knots are flattened a little so they read as part of the disc's plane. */
const KNOT_Y_SQUASH = 0.6;

/** Groups smaller than this get a callout only while focused. */
const CALLOUT_MIN = 8;
const CALLOUT_MIN_NARROW = 40;

/** Line widths in CSS pixels, one per strength step — the glow-proof ramp. */
const STEP_WIDTH: readonly [number, number, number] = [1.0, 1.45, 1.95];
const FOCUS_WIDTH = 2.6;
/** What the field drops to while one memory is focused. */
const CONTEXT_OPACITY = 0.22;
const GUIDE_OPACITY = 0.55;
/** Segments per within-arm link, which follows its arm's spiral. */
const ARM_SEGMENTS = 6;

/** Dot radius in world units, by recall count. */
const DOT_MIN = 0.42;
const DOT_MAX = 2.4;
const PICK_RADIUS = 1.4;

const CAM_FOV = 38;
const BLOOM = { threshold: 0.26, smoothing: 0.02, intensity: 0.85, radius: 0.55 };
const VIEW_SECONDS = 0.7;

interface View {
  id: string;
  name: string;
  note: string;
  elevation: number;
  azimuth: number;
}

const VIEWS: readonly View[] = [
  { id: 'disc', name: 'Disc', note: 'the spiral, tilted', elevation: 0.92, azimuth: -0.42 },
  { id: 'plan', name: 'Plan', note: 'straight down: arms and rings', elevation: 1.5, azimuth: -0.42 },
  { id: 'edge', name: 'Edge-on', note: 'from the side: age as height', elevation: 0.12, azimuth: -0.42 },
];

const nf = new Intl.NumberFormat('en-US');

// ─── Deterministic hash (murmur finaliser over FNV-1a) ──────────────────────

function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

function hash01(id: string, salt: string): number {
  let h = 0x811c9dc5;
  const s = salt + ':' + id;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h) / 4294967296;
}

// ─── Louvain, weighted by link strength, deterministic ──────────────────────

interface WeightedEdge {
  s: number;
  t: number;
  w: number;
}

export interface Partition {
  membership: Int32Array;
  modularity: number;
  /** Communities with at least one linked member. */
  count: number;
}

function localMoving(count: number, edges: readonly WeightedEdge[]): { community: Int32Array; moved: boolean } {
  const adjacency: [number, number][][] = Array.from({ length: count }, () => []);
  const k = new Float64Array(count);
  let m2 = 0;
  for (const e of edges) {
    if (e.s === e.t) {
      k[e.s] = (k[e.s] ?? 0) + 2 * e.w;
      m2 += 2 * e.w;
      continue;
    }
    adjacency[e.s]!.push([e.t, e.w]);
    adjacency[e.t]!.push([e.s, e.w]);
    k[e.s] = (k[e.s] ?? 0) + e.w;
    k[e.t] = (k[e.t] ?? 0) + e.w;
    m2 += 2 * e.w;
  }
  const community = new Int32Array(count);
  for (let v = 0; v < count; v++) community[v] = v;
  if (m2 === 0) return { community, moved: false };

  const total = Float64Array.from(k);
  let movedAny = false;
  let moved = true;
  for (let pass = 0; moved && pass < 40; pass++) {
    moved = false;
    for (let v = 0; v < count; v++) {
      const current = community[v]!;
      const weights = new Map<number, number>();
      for (const [u, w] of adjacency[v]!) {
        const c = community[u]!;
        weights.set(c, (weights.get(c) ?? 0) + w);
      }
      total[current] = (total[current] ?? 0) - k[v]!;
      let best = current;
      let bestGain = (weights.get(current) ?? 0) - (total[current]! * k[v]!) / m2;
      for (const [c, w] of weights) {
        if (c === current) continue;
        const gain = w - (total[c]! * k[v]!) / m2;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          best = c;
        }
      }
      total[best] = (total[best] ?? 0) + k[v]!;
      if (best !== current) {
        community[v] = best;
        moved = true;
        movedAny = true;
      }
    }
  }
  return { community, moved: movedAny };
}

function modularity(n: number, edges: readonly WeightedEdge[], membership: Int32Array): number {
  const k = new Float64Array(n);
  let m2 = 0;
  for (const e of edges) {
    k[e.s] = (k[e.s] ?? 0) + e.w;
    k[e.t] = (k[e.t] ?? 0) + e.w;
    m2 += 2 * e.w;
  }
  if (m2 === 0) return 0;
  const inside = new Map<number, number>();
  const total = new Map<number, number>();
  for (const e of edges) {
    const a = membership[e.s]!;
    if (a === membership[e.t]) inside.set(a, (inside.get(a) ?? 0) + e.w);
  }
  for (let i = 0; i < n; i++) total.set(membership[i]!, (total.get(membership[i]!) ?? 0) + k[i]!);
  let q = 0;
  for (const [c, tot] of total) q += (2 * (inside.get(c) ?? 0)) / m2 - (tot / m2) ** 2;
  return q;
}

export function louvain(n: number, links: readonly ObsLink[]): Partition {
  const original: WeightedEdge[] = links
    .filter((l) => l.source !== l.target)
    .map((l) => ({ s: l.source, t: l.target, w: l.strength }));
  const membership = new Int32Array(n);
  for (let i = 0; i < n; i++) membership[i] = i;

  let edges = original;
  let count = n;
  for (let level = 0; level < 12; level++) {
    const { community, moved } = localMoving(count, edges);
    const remap = new Map<number, number>();
    const renumbered = new Int32Array(count);
    for (let v = 0; v < count; v++) {
      const c = community[v]!;
      let id = remap.get(c);
      if (id === undefined) {
        id = remap.size;
        remap.set(c, id);
      }
      renumbered[v] = id;
    }
    for (let i = 0; i < n; i++) membership[i] = renumbered[membership[i]!]!;
    if (!moved || remap.size === count) break;

    const aggregated = new Map<string, WeightedEdge>();
    for (const e of edges) {
      const a = renumbered[e.s]!;
      const b = renumbered[e.t]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const row = aggregated.get(key);
      if (row) row.w += e.w;
      else aggregated.set(key, { s: Math.min(a, b), t: Math.max(a, b), w: e.w });
    }
    edges = [...aggregated.values()];
    count = remap.size;
  }

  const linked = new Set<number>();
  for (const e of original) {
    linked.add(membership[e.s]!);
    linked.add(membership[e.t]!);
  }
  return { membership, modularity: modularity(n, original, membership), count: linked.size };
}

// ─── Layout ─────────────────────────────────────────────────────────────────

export interface GalaxyGroup {
  kind: 'arm' | 'knot';
  members: number[];
  /** The label most members carry, cleaned; the busiest member's when none repeats. */
  name: string;
  /** How many members carry `name`; 0 when it is the busiest member's label. */
  nameCount: number;
  /** Links with both ends inside the group, and how many of them contradict. */
  links: number;
  contradicts: number;
  anchor: [number, number, number];
  /** Arms only: the centre of the angular sector. */
  sectorCentre: number;
}

export interface Ring {
  degree: number;
  radius: number;
  note: string;
}

export interface GalaxyLayout {
  positions: Float32Array;
  sizes: Float32Array;
  /** Group index per memory, −1 for an unlinked one. */
  group: Int32Array;
  /** Disc radius and angular jitter per memory, for routing within-arm links. */
  polarR: Float32Array;
  polarJ: Float32Array;
  groups: GalaxyGroup[];
  arms: number;
  knots: number;
  alone: number;
  communities: number;
  modularity: number;
  rings: Ring[];
  medianAge: number;
  maxDegree: number;
}

function cleanLabel(label: string): string {
  return label
    .replace(/[#*_`[\]>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

function ageDays(node: ObsNode, halfLife: number): number {
  return -halfLife * Math.log2(Math.max(node.retention, 1e-12));
}

function height(age: number, median: number): number {
  const d = median - age;
  return AGE_K * Math.sign(d) * Math.sqrt(Math.abs(d));
}

/** Disc radius for a link count: hubs at the core, rim at one link. */
function discRadius(degree: number, maxDegree: number): number {
  const span = Math.log(1 + Math.max(maxDegree, 1));
  return R_CORE + (R_DISC - R_CORE) * (1 - Math.log(1 + degree) / span);
}

function wind(r: number): number {
  const t = Math.min(1, Math.max(0, (r - R_CORE) / (R_DISC - R_CORE)));
  return WIND * Math.pow(t, 0.9);
}

/** The angle of an arm's spine at radius `r`. */
function armTheta(sectorCentre: number, r: number): number {
  return sectorCentre + wind(r);
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
}

function nameGroup(data: ObsData, members: readonly number[]): { name: string; nameCount: number } {
  const counts = new Map<string, number>();
  let busiest = members[0]!;
  for (const i of members) {
    const node = data.nodes[i]!;
    const label = cleanLabel(node.label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (node.degree > data.nodes[busiest]!.degree) busiest = i;
  }
  let best = '';
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  // A repeated label names the group only when it carries a real share of it.
  if (bestCount >= Math.max(3, Math.ceil(members.length * 0.1))) return { name: best, nameCount: bestCount };
  return { name: cleanLabel(data.nodes[busiest]!.label), nameCount: 0 };
}

function internalLinks(data: ObsData, groupOf: Int32Array, groups: GalaxyGroup[]): void {
  for (const l of data.links) {
    const g = groupOf[l.source]!;
    if (g < 0 || g !== groupOf[l.target]) continue;
    const group = groups[g]!;
    group.links++;
    if (l.kind === 'contradicts') group.contradicts++;
  }
}

export function layoutGalaxy(data: ObsData): GalaxyLayout {
  const n = data.nodes.length;
  const positions = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const group = new Int32Array(n).fill(-1);
  const polarR = new Float32Array(n);
  const polarJ = new Float32Array(n);

  const partition = louvain(n, data.links);
  const halfLife = data.stats.halfLifeDays || 7;
  const ages = data.nodes.map((node) => ageDays(node, halfLife));
  const medianAge = quantile([...ages].sort((a, b) => a - b), 0.5);
  const maxDegree = Math.max(1, ...data.nodes.map((node) => node.degree));
  const maxAccess = Math.max(1, ...data.nodes.map((node) => node.accessCount));

  for (let i = 0; i < n; i++) {
    const node = data.nodes[i]!;
    sizes[i] = DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(Math.max(0, node.accessCount) / maxAccess);
  }

  // The giant component is the disc; only if it is a real component.
  const giant = data.stats.largestComponent >= 2 ? 0 : -1;

  const armMembers = new Map<number, number[]>();
  const knotMembers = new Map<number, number[]>();
  let alone = 0;
  for (let i = 0; i < n; i++) {
    const node = data.nodes[i]!;
    if (node.degree === 0) {
      alone++;
      continue;
    }
    const bucket = node.component === giant ? armMembers : knotMembers;
    const key = node.component === giant ? partition.membership[i]! : node.component;
    const list = bucket.get(key);
    if (list) list.push(i);
    else bucket.set(key, [i]);
  }

  const bySize = (a: number[], b: number[]) => b.length - a.length;
  const armLists = [...armMembers.values()].sort(bySize);
  const knotLists = [...knotMembers.values()].sort(bySize);
  const groups: GalaxyGroup[] = [];

  // Arms: sectors proportional to size, clockwise from the top.
  const giantSize = armLists.reduce((sum, list) => sum + list.length, 0);
  let sectorStart = -Math.PI / 2;
  for (const members of armLists) {
    const width = (2 * Math.PI * members.length) / Math.max(1, giantSize);
    const centre = sectorStart + width / 2;
    const g = groups.length;
    const radii: number[] = [];
    for (const i of members) {
      const node = data.nodes[i]!;
      const gap = (R_DISC - R_CORE) / (Math.log(1 + maxDegree) * (1 + node.degree));
      const r = Math.max(
        0.6,
        discRadius(node.degree, maxDegree) + (hash01(node.id, 'r') - 0.5) * 2 * RADIAL_JITTER * gap
      );
      const j = (hash01(node.id, 'a') - 0.5) * width * SECTOR_FILL;
      const theta = armTheta(centre, r) + j;
      positions[i * 3] = r * Math.cos(theta);
      positions[i * 3 + 1] = height(ages[i]!, medianAge);
      positions[i * 3 + 2] = r * Math.sin(theta);
      polarR[i] = r;
      polarJ[i] = j;
      group[i] = g;
      radii.push(r);
    }
    const anchorR = quantile(radii.sort((a, b) => a - b), 0.5);
    const anchorTheta = armTheta(centre, anchorR);
    groups.push({
      kind: 'arm',
      members,
      ...nameGroup(data, members),
      links: 0,
      contradicts: 0,
      anchor: [anchorR * Math.cos(anchorTheta), 0, anchorR * Math.sin(anchorTheta)],
      sectorCentre: centre,
    });
    sectorStart += width;
  }

  // Knots: the other components, on the satellite ring, ordered by size.
  knotLists.forEach((members, k) => {
    const phi = -Math.PI / 2 + (2 * Math.PI * k) / knotLists.length;
    const cx = R_SATELLITE * Math.cos(phi);
    const cz = R_SATELLITE * Math.sin(phi);
    const rho = 1.2 + 0.9 * Math.sqrt(members.length);
    const maxDeg = Math.max(1, ...members.map((i) => data.nodes[i]!.degree));
    const g = groups.length;
    for (const i of members) {
      const node = data.nodes[i]!;
      const rr = rho * (1 - Math.log(1 + node.degree) / Math.log(2 + maxDeg)) + hash01(node.id, 'k') * 0.4;
      const polar = Math.acos(1 - 2 * hash01(node.id, 'u'));
      const az = 2 * Math.PI * hash01(node.id, 'v');
      positions[i * 3] = cx + rr * Math.sin(polar) * Math.cos(az);
      positions[i * 3 + 1] = height(ages[i]!, medianAge) + rr * KNOT_Y_SQUASH * Math.cos(polar);
      positions[i * 3 + 2] = cz + rr * Math.sin(polar) * Math.sin(az);
      group[i] = g;
    }
    groups.push({
      kind: 'knot',
      members,
      ...nameGroup(data, members),
      links: 0,
      contradicts: 0,
      anchor: [cx, 0, cz],
      sectorCentre: phi,
    });
  });

  // Alone: the outermost rim, angle by hash, height still by age.
  for (let i = 0; i < n; i++) {
    const node = data.nodes[i]!;
    if (node.degree !== 0) continue;
    const r = R_ALONE + (hash01(node.id, 'r') - 0.5) * 3;
    const theta = 2 * Math.PI * hash01(node.id, 'a');
    positions[i * 3] = r * Math.cos(theta);
    positions[i * 3 + 1] = height(ages[i]!, medianAge);
    positions[i * 3 + 2] = r * Math.sin(theta);
  }

  internalLinks(data, group, groups);

  // The orbit rings: the store's own degree quantiles, so the radius axis
  // is printed rather than implied.
  const degrees = data.nodes
    .map((node) => node.degree)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const candidates: [number, string][] = [
    [1, 'one link'],
    [quantile(degrees, 0.25), 'a quarter have fewer'],
    [quantile(degrees, 0.5), 'median'],
    [quantile(degrees, 0.75), 'three quarters have fewer'],
    [quantile(degrees, 0.9), 'nine in ten have fewer'],
  ];
  const rings: Ring[] = [];
  const seen = new Set<number>();
  for (const [degree, note] of candidates) {
    if (degree < 1 || seen.has(degree)) continue;
    seen.add(degree);
    rings.push({ degree, radius: discRadius(degree, maxDegree), note });
  }

  return {
    positions,
    sizes,
    group,
    polarR,
    polarJ,
    groups,
    arms: armLists.length,
    knots: knotLists.length,
    alone,
    communities: partition.count,
    modularity: partition.modularity,
    rings,
    medianAge,
    maxDegree,
  };
}

// ─── Link geometry ──────────────────────────────────────────────────────────

interface LineBuffers {
  positions: Float32Array;
  colors: Float32Array;
}

/** A within-arm link follows its arm's spiral between its two ends; every
 *  other link is the straight chord — which is what makes the 8% that leave
 *  their community visibly cut across. */
function buildLinks(
  data: ObsData,
  layout: GalaxyLayout,
  indices: readonly number[],
  ramp: THREE.Color[][]
): LineBuffers {
  let segments = 0;
  for (const li of indices) {
    const l = data.links[li]!;
    const g = layout.group[l.source]!;
    segments += g >= 0 && g === layout.group[l.target] && layout.groups[g]!.kind === 'arm' ? ARM_SEGMENTS : 1;
  }
  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  const p = layout.positions;
  let o = 0;
  const put = (x: number, y: number, z: number, c: THREE.Color) => {
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    colors[o] = c.r;
    colors[o + 1] = c.g;
    colors[o + 2] = c.b;
    o += 3;
  };
  for (const li of indices) {
    const l = data.links[li]!;
    const c = ramp[l.kind === 'agrees' ? 0 : 1]![l.step]!;
    const a = l.source;
    const b = l.target;
    const g = layout.group[a]!;
    const arm = g >= 0 && g === layout.group[b] ? layout.groups[g]! : null;
    if (arm && arm.kind === 'arm') {
      const rA = layout.polarR[a]!;
      const rB = layout.polarR[b]!;
      const jA = layout.polarJ[a]!;
      const jB = layout.polarJ[b]!;
      const yA = p[a * 3 + 1]!;
      const yB = p[b * 3 + 1]!;
      let px = p[a * 3]!;
      let py = yA;
      let pz = p[a * 3 + 2]!;
      for (let s = 1; s <= ARM_SEGMENTS; s++) {
        const t = s / ARM_SEGMENTS;
        let x: number;
        let y: number;
        let z: number;
        if (s === ARM_SEGMENTS) {
          x = p[b * 3]!;
          y = yB;
          z = p[b * 3 + 2]!;
        } else {
          const r = rA + (rB - rA) * t;
          const theta = armTheta(arm.sectorCentre, r) + jA + (jB - jA) * t;
          x = r * Math.cos(theta);
          y = yA + (yB - yA) * t;
          z = r * Math.sin(theta);
        }
        put(px, py, pz, c);
        put(x, y, z, c);
        px = x;
        py = y;
        pz = z;
      }
    } else {
      put(p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!, c);
      put(p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]!, c);
    }
  }
  return { positions, colors };
}

function makeLineObject(buffers: LineBuffers, width: number, opacity: number, dashed = false): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(buffers.positions);
  geometry.setColors(buffers.colors);
  const material = new LineMaterial({
    vertexColors: true,
    worldUnits: false,
    linewidth: width,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    alphaToCoverage: false,
    fog: false,
    dashed,
    dashSize: 1.2,
    gapSize: 1.6,
  });
  const object = new LineSegments2(geometry, material);
  if (dashed) object.computeLineDistances();
  object.frustumCulled = false;
  return object;
}

/** Circles in the disc plane: the degree rings solid, the two category rings dashed. */
function buildRings(radii: readonly number[], color: THREE.Color): LineBuffers {
  const steps = 96;
  const positions = new Float32Array(radii.length * steps * 6);
  const colors = new Float32Array(radii.length * steps * 6);
  let o = 0;
  for (const r of radii) {
    for (let s = 0; s < steps; s++) {
      const t0 = (2 * Math.PI * s) / steps;
      const t1 = (2 * Math.PI * (s + 1)) / steps;
      positions.set([r * Math.cos(t0), 0, r * Math.sin(t0), r * Math.cos(t1), 0, r * Math.sin(t1)], o);
      colors.set([color.r, color.g, color.b, color.r, color.g, color.b], o);
      o += 6;
    }
  }
  return { positions, colors };
}

// ─── Scene pieces ───────────────────────────────────────────────────────────

function useDisposable<T extends THREE.Object3D>(object: T): T {
  useEffect(
    () => () => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });
    },
    [object]
  );
  return object;
}

function useLineResolution(objects: readonly LineSegments2[]): void {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    for (const object of objects) object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [objects, size.width, size.height, invalidate]);
}

interface FieldProps {
  data: ObsData;
  layout: GalaxyLayout;
  ramp: THREE.Color[][];
  dimmed: boolean;
  visible: boolean;
}

/** The whole link field: three objects, one per strength step, so width is
 *  a channel of its own. */
function LinkField({ data, layout, ramp, dimmed, visible }: FieldProps) {
  const invalidate = useThree((s) => s.invalidate);
  const objects = useMemo(() => {
    const byStep: number[][] = [[], [], []];
    data.links.forEach((l, i) => byStep[l.step]!.push(i));
    return byStep.map((indices, step) =>
      makeLineObject(buildLinks(data, layout, indices, ramp), STEP_WIDTH[step as 0 | 1 | 2], 1)
    );
  }, [data, layout, ramp]);
  const holder = useMemo(() => {
    const g = new THREE.Group();
    objects.forEach((o) => g.add(o));
    return g;
  }, [objects]);
  useDisposable(holder);
  useLineResolution(objects);

  useEffect(() => {
    for (const object of objects) {
      object.material.opacity = dimmed ? CONTEXT_OPACITY : 1;
      object.material.needsUpdate = true;
    }
    holder.visible = visible;
    invalidate();
  }, [objects, holder, dimmed, visible, invalidate]);

  return <primitive object={holder} />;
}

/** The focused memory's links, drawn on top at full brightness. */
function FocusLinks(props: { data: ObsData; layout: GalaxyLayout; ramp: THREE.Color[][]; indices: readonly number[] }) {
  const { data, layout, ramp, indices } = props;
  const object = useMemo(
    () => makeLineObject(buildLinks(data, layout, indices, ramp), FOCUS_WIDTH, 1),
    [data, layout, indices, ramp]
  );
  useDisposable(object);
  const list = useMemo(() => [object], [object]);
  useLineResolution(list);
  if (indices.length === 0) return null;
  return <primitive object={object} />;
}

/** The orbit guides: degree rings solid, satellite and rim rings dashed. */
function OrbitGuides({ layout, visible }: { layout: GalaxyLayout; visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const objects = useMemo(() => {
    const ink = new THREE.Color(PLATE_COLORS.ink3);
    return [
      makeLineObject(buildRings(layout.rings.map((r) => r.radius), ink), 1, GUIDE_OPACITY),
      makeLineObject(buildRings([R_SATELLITE, R_ALONE], ink), 1, GUIDE_OPACITY * 0.8, true),
    ];
  }, [layout]);
  const holder = useMemo(() => {
    const g = new THREE.Group();
    objects.forEach((o) => g.add(o));
    return g;
  }, [objects]);
  useDisposable(holder);
  useLineResolution(objects);
  useEffect(() => {
    holder.visible = visible;
    invalidate();
  }, [holder, visible, invalidate]);
  return <primitive object={holder} />;
}

const DOT_VERTEX = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const DOT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float a = 1.0 - r;
    a = a * a;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

interface DotsProps {
  data: ObsData;
  layout: GalaxyLayout;
  focusIndex: number | null;
  neighbours: ReadonlySet<number>;
  visible: boolean;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

/** The memories: soft additive sprites sized by recall count. */
function Dots({ data, layout, focusIndex, neighbours, visible, onHover, onPick }: DotsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const object = useMemo(() => {
    const count = data.nodes.length;
    const colors = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(Float32Array.from(layout.sizes), 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }, [data, layout]);
  useDisposable(object);

  useEffect(() => {
    const material = object.material as THREE.ShaderMaterial;
    material.uniforms.uScale!.value = (size.height * dpr) / (2 * Math.tan((CAM_FOV / 2) * (Math.PI / 180)));
    object.visible = visible;
    invalidate();
  }, [object, size.height, dpr, visible, invalidate]);

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    const live = new THREE.Color(PLATE_COLORS.memoryLive);
    const near = new THREE.Color(PLATE_COLORS.ink);
    const colour = object.geometry.getAttribute('color') as THREE.BufferAttribute;
    const sized = object.geometry.getAttribute('size') as THREE.BufferAttribute;
    for (let i = 0; i < data.nodes.length; i++) {
      const c = i === focusIndex ? live : neighbours.has(i) ? near : rest;
      colour.setXYZ(i, c.r, c.g, c.b);
      sized.setX(i, layout.sizes[i]! * (i === focusIndex ? 2.2 : 1));
    }
    colour.needsUpdate = true;
    sized.needsUpdate = true;
    invalidate();
  }, [object, data, layout, focusIndex, neighbours, invalidate]);

  return (
    <primitive
      object={object}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (typeof event.index === 'number') onHover(event.index);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (typeof event.index === 'number') onPick(event.index);
      }}
    />
  );
}

// ─── Camera ─────────────────────────────────────────────────────────────────

function fitDistance(radius: number, width: number, height: number): number {
  const half = Math.tan(((CAM_FOV / 2) * Math.PI) / 180);
  const aspect = height > 0 ? width / height : 1;
  return radius / (half * Math.min(1, aspect));
}

function viewDirection(view: View): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(view.elevation) * Math.sin(view.azimuth),
    Math.sin(view.elevation),
    Math.cos(view.elevation) * Math.cos(view.azimuth)
  );
}

interface RigProps {
  view: View;
  distance: number;
  reducedMotion: boolean;
}

/** Moves the camera to a view preset. A short eased move, or a snap under
 *  reduced motion. Never autorotates. */
function CameraRig({ view, distance, reducedMotion }: RigProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const motion = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const to = viewDirection(view).multiplyScalar(distance);
    if (reducedMotion) {
      camera.position.copy(to);
      camera.lookAt(0, 0, 0);
      controls?.update();
      invalidate();
      return;
    }
    motion.current = { from: camera.position.clone(), to, t: 0 };
    invalidate();
  }, [view, distance, reducedMotion, camera, controls, invalidate]);

  useFrame((_, delta) => {
    const m = motion.current;
    if (!m) return;
    m.t = Math.min(1, m.t + delta / VIEW_SECONDS);
    const e = 1 - Math.pow(1 - m.t, 3);
    const fromDir = m.from.clone().normalize();
    const toDir = m.to.clone().normalize();
    const dir = fromDir.lerp(toDir, e).normalize();
    const len = m.from.length() + (m.to.length() - m.from.length()) * e;
    camera.position.copy(dir.multiplyScalar(len));
    camera.lookAt(0, 0, 0);
    controls?.update();
    if (m.t >= 1) motion.current = null;
    invalidate();
  });

  return null;
}

/** Projects world anchors to CSS pixels after every rendered frame. */
function Projector(props: { anchors: Float32Array; onProject: (screen: Float32Array) => void }) {
  const { anchors, onProject } = props;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const last = useRef<Float32Array | null>(null);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const count = anchors.length / 3;
    const out = new Float32Array(count * 3);
    camera.updateMatrixWorld();
    for (let i = 0; i < count; i++) {
      v.set(anchors[i * 3]!, anchors[i * 3 + 1]!, anchors[i * 3 + 2]!).project(camera);
      out[i * 3] = ((v.x + 1) / 2) * size.width;
      out[i * 3 + 1] = ((1 - v.y) / 2) * size.height;
      out[i * 3 + 2] = v.z < 1 ? 1 : 0;
    }
    const prev = last.current;
    let same = prev !== null && prev.length === out.length;
    if (same && prev) {
      for (let i = 0; i < out.length; i++) {
        if (Math.abs(prev[i]! - out[i]!) > 0.25) {
          same = false;
          break;
        }
      }
    }
    if (same) return;
    last.current = out;
    onProject(out);
  });

  return null;
}

// ─── The scene ──────────────────────────────────────────────────────────────

interface Layers {
  memories: boolean;
  links: boolean;
  orbits: boolean;
  labels: boolean;
}

interface SceneProps {
  data: ObsData;
  layout: GalaxyLayout;
  focusIndex: number | null;
  focusLinks: readonly number[];
  neighbours: ReadonlySet<number>;
  layers: Layers;
  view: View;
  distance: number;
  reducedMotion: boolean;
  anchors: Float32Array;
  onProject: (screen: Float32Array) => void;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function Scene(props: SceneProps) {
  const { data, layout, focusIndex, focusLinks, neighbours, layers, view, distance, reducedMotion } = props;
  const { anchors, onProject, onHover, onPick } = props;
  const raycaster = useThree((s) => s.raycaster);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    raycaster.params.Points = { threshold: PICK_RADIUS };
  }, [raycaster]);

  const ramp = useMemo<THREE.Color[][]>(() => {
    const steps: (0 | 1 | 2)[] = [0, 1, 2];
    const of = (kind: ObsLink['kind']) => steps.map((step) => new THREE.Color(linkColorInt({ kind, step })));
    return [of('agrees'), of('contradicts')];
  }, []);

  useEffect(() => {
    invalidate();
  }, [invalidate, focusIndex]);

  return (
    <>
      <color attach="background" args={[PLATE_COLORS.plate]} />
      <OrbitGuides layout={layout} visible={layers.orbits} />
      <LinkField data={data} layout={layout} ramp={ramp} dimmed={focusIndex !== null} visible={layers.links} />
      <FocusLinks data={data} layout={layout} ramp={ramp} indices={focusLinks} />
      <Dots
        data={data}
        layout={layout}
        focusIndex={focusIndex}
        neighbours={neighbours}
        visible={layers.memories}
        onHover={onHover}
        onPick={onPick}
      />
      <CameraRig view={view} distance={distance} reducedMotion={reducedMotion} />
      <Projector anchors={anchors} onProject={onProject} />
      <OrbitControls
        makeDefault
        autoRotate={false}
        enableDamping={!reducedMotion}
        dampingFactor={0.12}
        enablePan
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        minDistance={FIT_RADIUS * 0.35}
        maxDistance={FIT_RADIUS * 6}
        minPolarAngle={0.04}
        maxPolarAngle={Math.PI - 0.04}
      />
      <EffectComposer multisampling={4}>
        <Bloom
          mipmapBlur
          luminanceThreshold={BLOOM.threshold}
          luminanceSmoothing={BLOOM.smoothing}
          intensity={BLOOM.intensity}
          radius={BLOOM.radius}
        />
      </EffectComposer>
    </>
  );
}

// ─── Overlay ────────────────────────────────────────────────────────────────

interface Callout {
  key: string;
  x: number;
  y: number;
  side: 'left' | 'right';
  anchorX: number;
  anchorY: number;
  name: string;
  caps: string;
  caps2?: string;
  dim: boolean;
  wide: boolean;
}

const LEADER = 74;
const CALLOUT_GAP = 34;
/** Callouts stay out of the bands the corner chrome occupies. */
const CALLOUT_TOP = 96;
const CALLOUT_BOTTOM = 96;
const RING_LABEL_GAP = 14;

function groupCaps(group: GalaxyGroup): string {
  const share = group.links ? Math.round((100 * group.contradicts) / group.links) : 0;
  const what = group.kind === 'arm' ? 'arm' : 'knot';
  const named = group.nameCount ? ` · ${group.nameCount} of ${group.members.length} so titled` : '';
  return `${what} · ${nf.format(group.members.length)} memories · ${share}% contradict${named}`;
}

function spread(callouts: Callout[], boxHeight: number): Callout[] {
  const place = (side: 'left' | 'right') => {
    const list = callouts.filter((c) => c.side === side).sort((a, b) => a.y - b.y);
    let previous = -Infinity;
    return list.map((c) => {
      const y = Math.min(boxHeight - CALLOUT_BOTTOM, Math.max(CALLOUT_TOP, Math.max(c.y, previous + CALLOUT_GAP)));
      previous = y;
      return { ...c, y };
    });
  };
  return [...place('left'), ...place('right')];
}

interface OverlayProps {
  data: ObsData;
  layout: GalaxyLayout;
  screen: Float32Array | null;
  anchorCount: number;
  focusIndex: number | null;
  focusGroup: number;
  width: number;
  height: number;
  roomy: boolean;
  visible: boolean;
}

/** Callouts, ring labels and the focused memory's readout, all leadered to
 *  the figure. Positioned by transform only. */
function Overlay(props: OverlayProps) {
  const { data, layout, screen, anchorCount, focusIndex, focusGroup, width, height, roomy, visible } = props;
  if (!screen || screen.length < anchorCount * 3) return null;
  const cx = screen[0]!;
  const cy = screen[1]!;
  const minSize = roomy ? CALLOUT_MIN : CALLOUT_MIN_NARROW;

  const raw: Callout[] = [];
  layout.groups.forEach((group, g) => {
    if (group.members.length < minSize && g !== focusGroup) return;
    const i = 1 + g;
    if (!screen[i * 3 + 2]) return;
    const ax = screen[i * 3]!;
    const ay = screen[i * 3 + 1]!;
    let dx = ax - cx;
    let dy = ay - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    if (Math.abs(dx) < 0.35) dx = dx < 0 ? -0.35 : 0.35;
    raw.push({
      key: `g${g}`,
      x: ax + dx * LEADER,
      y: ay + dy * LEADER,
      side: dx < 0 ? 'left' : 'right',
      anchorX: ax,
      anchorY: ay,
      name: clip(group.name, 34),
      caps: groupCaps(group),
      dim: focusIndex !== null && g !== focusGroup,
      wide: false,
    });
  });

  const focusNode = focusIndex === null ? null : data.nodes[focusIndex]!;
  if (focusNode) {
    const i = anchorCount - 1;
    if (screen[i * 3 + 2]) {
      const ax = screen[i * 3]!;
      const ay = screen[i * 3 + 1]!;
      const side: 'left' | 'right' = ax < width / 2 ? 'right' : 'left';
      const g = layout.group[focusIndex!]!;
      const where = g >= 0 ? `${layout.groups[g]!.kind} ${clip(layout.groups[g]!.name, 26)}` : 'no link';
      const age = Math.round(ageDays(focusNode, data.stats.halfLifeDays || 7));
      raw.push({
        key: 'focus',
        x: ax + (side === 'right' ? 26 : -26),
        y: ay - 22,
        side,
        anchorX: ax,
        anchorY: ay,
        name: clip(cleanLabel(focusNode.label), 64),
        caps: `${focusNode.type} · ${focusNode.degree} links · ${focusNode.agreeDegree} agree · ${focusNode.contradictDegree} contradict`,
        caps2: `${where} · ${age} d old · ${RETENTION_LABEL[focusNode.retentionBand]} · recalled ${nf.format(focusNode.accessCount)}×`,
        dim: false,
        wide: true,
      });
    }
  }

  const callouts = spread(raw, height);
  const ringLabels: { key: string; x: number; y: number; text: string }[] = [];
  const ringBase = 1 + layout.groups.length;
  const ringNotes = [
    ...layout.rings.map((r) => `${r.degree} ${r.degree === 1 ? 'link' : 'links'} · ${r.note}`),
    `satellites · ${nf.format(layout.knots)} knots not joined to the core`,
    `alone · ${nf.format(layout.alone)} with no link`,
  ];
  ringNotes.forEach((text, k) => {
    const i = ringBase + k;
    if (!screen[i * 3 + 2]) return;
    ringLabels.push({ key: `r${k}`, x: screen[i * 3]!, y: screen[i * 3 + 1]!, text });
  });
  ringLabels.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ringLabels.length; k++) {
    const prev = ringLabels[k - 1]!;
    const cur = ringLabels[k]!;
    if (cur.y < prev.y + RING_LABEL_GAP) ringLabels[k] = { ...cur, y: prev.y + RING_LABEL_GAP };
  }

  return (
    <div className={'mg-overlay' + (visible ? '' : ' mg-overlay-hidden')} aria-hidden={!visible}>
      <svg className="mg-leaders" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
        {callouts.map((c) => {
          const endX = c.side === 'right' ? c.x - 6 : c.x + 6;
          const dx = endX - c.anchorX;
          const dy = c.y - c.anchorY;
          const len = Math.hypot(dx, dy) || 1;
          const sx = c.anchorX + (dx / len) * 6;
          const sy = c.anchorY + (dy / len) * 6;
          return (
            <g key={c.key} className={c.dim ? 'mg-leader mg-dim' : 'mg-leader'}>
              <circle cx={c.anchorX} cy={c.anchorY} r={c.key === 'focus' ? 6 : 4.5} />
              <line x1={sx} y1={sy} x2={endX} y2={c.y} />
            </g>
          );
        })}
      </svg>
      {ringLabels.map((r) => (
        <span
          key={r.key}
          className="mg-ring-label mg-caps"
          style={{ transform: `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px) translate(6px, -50%)` }}
        >
          {r.text}
        </span>
      ))}
      {callouts.map((c) => (
        <div
          key={c.key}
          className={
            'mg-callout' +
            (c.side === 'left' ? ' mg-callout-left' : '') +
            (c.dim ? ' mg-dim' : '') +
            (c.wide ? ' mg-callout-wide' : '')
          }
          style={{
            transform: `translate(${(c.side === 'left' ? c.x - (c.wide ? 320 : 230) : c.x).toFixed(1)}px, ${c.y.toFixed(1)}px) translateY(-50%)`,
          }}
        >
          <div className="mg-callout-name">{c.name}</div>
          <div className="mg-caps">{c.caps}</div>
          {c.caps2 ? <div className="mg-caps">{c.caps2}</div> : null}
        </div>
      ))}
    </div>
  );
}

// ─── Chrome ─────────────────────────────────────────────────────────────────

interface ChromeProps {
  data: ObsData;
  layout: GalaxyLayout;
  layers: Layers;
  onLayer: (key: keyof Layers) => void;
  view: View;
  onView: (view: View) => void;
  roomy: boolean;
}

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="mg-figure">
      <div className="mg-figure-value">{value}</div>
      <div className="mg-caps">{label}</div>
      {note ? <div className="mg-caps mg-figure-note">{note}</div> : null}
    </div>
  );
}

function Chrome({ data, layout, layers, onLayer, view, onView, roomy }: ChromeProps) {
  const { stats } = data;
  const layerKeys: (keyof Layers)[] = ['memories', 'links', 'orbits', 'labels'];
  return (
    <>
      <header className="mg-title">
        <h2 className="mg-title-name">Memory Galaxy</h2>
        <div className="mg-caps mg-title-sub">link communities as arms · link count as distance</div>
        <i className="mg-title-rule" aria-hidden />
        {roomy ? (
          <div className="mg-layers" role="group" aria-label="Layers">
            {layerKeys.map((key) => (
              <button
                key={key}
                type="button"
                className={'mg-caps mg-layer' + (layers[key] ? ' mg-layer-on' : '')}
                aria-pressed={layers[key]}
                onClick={() => onLayer(key)}
              >
                {key}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mg-figures">
        <Figure value={nf.format(stats.memories)} label="memories" note={roomy ? `${nf.format(stats.isolated)} with no link` : undefined} />
        <Figure value={nf.format(stats.linksDrawn)} label="links drawn" note={roomy ? `of ${nf.format(stats.linksStored)} stored` : undefined} />
        {roomy ? (
          <Figure value={nf.format(layout.communities)} label="communities" note={`${layout.arms} arms · ${layout.knots} knots`} />
        ) : null}
        {roomy ? (
          <Figure value={nf.format(stats.contradicts)} label="contradict" note={`${nf.format(stats.agrees)} agree`} />
        ) : null}
        <div className="mg-pill mg-caps">
          <i aria-hidden />
          modularity {layout.modularity.toFixed(3)}
        </div>
      </div>

      <div className="mg-views" role="radiogroup" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === view.id}
            className={'mg-view' + (v.id === view.id ? ' mg-view-on' : '')}
            onClick={() => onView(v)}
          >
            <i className="mg-view-dot" aria-hidden />
            <span className="mg-view-name">{v.name}</span>
            {roomy ? <span className="mg-caps mg-view-note">{v.note}</span> : null}
          </button>
        ))}
      </div>

      <div className="mg-tag">
        {roomy ? (
          <div className="mg-key">
            <div className="mg-key-row">
              <span className="mg-swatches" aria-hidden>
                <i style={{ background: 'var(--agrees-weak)', height: 2 }} />
                <i style={{ background: 'var(--agrees-mid)', height: 3 }} />
                <i style={{ background: 'var(--agrees-strong)', height: 4 }} />
              </span>
              <span className="mg-caps">agrees · weak to strong</span>
            </div>
            <div className="mg-key-row">
              <span className="mg-swatches" aria-hidden>
                <i style={{ background: 'var(--contradicts-weak)', height: 2 }} />
                <i style={{ background: 'var(--contradicts-mid)', height: 3 }} />
                <i style={{ background: 'var(--contradicts-strong)', height: 4 }} />
              </span>
              <span className="mg-caps">contradicts · weak to strong</span>
            </div>
          </div>
        ) : null}
        <div className="mg-caps mg-tagline">
          distance from the core is link count · height is age · dot is recalls
        </div>
      </div>
    </>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function hasWebGL(): boolean {
  if (typeof document === 'undefined' || typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const [webgl] = useState(hasWebGL);
  const [hovered, setHovered] = useState<number | null>(null);
  const [view, setView] = useState<View>(VIEWS[0]!);
  const [layers, setLayers] = useState<Layers>({ memories: true, links: true, orbits: true, labels: true });
  const [screen, setScreen] = useState<Float32Array | null>(null);
  const layout = useMemo(() => layoutGalaxy(data), [data]);
  const roomy = width >= 900 && height >= 560;

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    data.nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [data]);

  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? null) : null;
  const focusIndex = selectedIndex ?? hovered;
  const focusGroup = focusIndex === null ? -1 : layout.group[focusIndex]!;

  const { focusLinks, neighbours } = useMemo(() => {
    if (focusIndex === null) return { focusLinks: [] as number[], neighbours: new Set<number>() };
    const links: number[] = [];
    const near = new Set<number>();
    data.links.forEach((link, i) => {
      if (link.source === focusIndex) {
        links.push(i);
        near.add(link.target);
      } else if (link.target === focusIndex) {
        links.push(i);
        near.add(link.source);
      }
    });
    return { focusLinks: links, neighbours: near };
  }, [data, focusIndex]);

  // Anchors: the origin, every group, every ring label, and the focused memory.
  const baseAnchors = useMemo(() => {
    const ringAngle = Math.PI / 2;
    const list: number[] = [0, 0, 0];
    for (const group of layout.groups) list.push(...group.anchor);
    for (const radius of [...layout.rings.map((r) => r.radius), R_SATELLITE, R_ALONE]) {
      list.push(radius * Math.cos(ringAngle), 0, radius * Math.sin(ringAngle));
    }
    return list;
  }, [layout]);
  const anchors = useMemo(() => {
    if (focusIndex === null) return Float32Array.from(baseAnchors);
    const p = layout.positions;
    return Float32Array.from([...baseAnchors, p[focusIndex * 3]!, p[focusIndex * 3 + 1]!, p[focusIndex * 3 + 2]!]);
  }, [baseAnchors, layout, focusIndex]);

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      onSelect(node.id === selectedId ? null : node.id);
    },
    [data, onSelect, selectedId]
  );
  const clear = useCallback(() => onSelect(null), [onSelect]);
  const toggleLayer = useCallback((key: keyof Layers) => setLayers((prev) => ({ ...prev, [key]: !prev[key] })), []);

  // Framed once from the first measured box and then held, as the siblings
  // do: reframing under an orbiting viewer is worse than a crop.
  const framing = useRef<{ distance: number; position: [number, number, number] } | null>(null);
  if (!framing.current) {
    const distance = fitDistance(FIT_RADIUS, width, height);
    const dir = viewDirection(VIEWS[0]!).multiplyScalar(distance);
    framing.current = { distance, position: [dir.x, dir.y, dir.z] };
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

  const summary =
    `${nf.format(data.stats.memories)} memories laid out from their links alone: ` +
    `${layout.arms} spiral arms, one per link community of the largest connected component, ` +
    `${layout.knots} satellite knots for the components not joined to it, and ${layout.alone} unlinked memories on the rim. ` +
    `Distance from the core is link count, height is age, ${nf.format(data.stats.linksDrawn)} of ${nf.format(data.stats.linksStored)} stored links drawn.`;

  return (
    <div className={'mg-box' + (reducedMotion ? ' mg-still' : '')} ref={boxRef} style={{ width, height }}>
      <style href="observatory-galaxy" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl ? (
        <div className="mg-canvas" role="img" aria-label={summary}>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{ antialias: false, toneMapping: THREE.NoToneMapping, powerPreference: 'high-performance' }}
            camera={{ fov: CAM_FOV, near: 1, far: FIT_RADIUS * 20, position }}
            onPointerMissed={clear}
          >
            <Scene
              data={data}
              layout={layout}
              focusIndex={focusIndex}
              focusLinks={focusLinks}
              neighbours={neighbours}
              layers={layers}
              view={view}
              distance={distance}
              reducedMotion={reducedMotion}
              anchors={anchors}
              onProject={setScreen}
              onHover={setHovered}
              onPick={pick}
            />
          </Canvas>
        </div>
      ) : (
        <p className="mg-nogl obs-note">
          This galaxy is drawn with WebGL, and this browser did not give the page a context. What it
          would show: {summary}
        </p>
      )}

      {webgl ? (
        <Overlay
          data={data}
          layout={layout}
          screen={screen}
          anchorCount={anchors.length / 3}
          focusIndex={focusIndex}
          focusGroup={focusGroup}
          width={width}
          height={height}
          roomy={roomy}
          visible={layers.labels}
        />
      ) : null}

      <Chrome data={data} layout={layout} layers={layers} onLayer={toggleLayer} view={view} onView={setView} roomy={roomy} />
    </div>
  );
}

// ─── Sheet ──────────────────────────────────────────────────────────────────

/**
 * Chrome sits in the four corners over the bleed, on the plate itself — no
 * panel, no card. Register is carried by size and by a wide-tracked small
 * line beneath each name, which is this set's house style; the text stays in
 * sentence case in the DOM and is capitalised by CSS. Nothing animates a
 * layout property: callouts move by transform, and the only transition is a
 * label fade that reduced motion removes.
 */
const SHEET_CSS = `
.mg-box { position: absolute; inset: 0; overflow: hidden; font-family: var(--font-instrument); }
.mg-canvas { position: absolute; inset: 0; }
.mg-nogl { position: absolute; inset: 0; margin: 0; padding: 28px 20px; max-width: 56ch; }

.mg-caps {
  font-size: var(--t-label); font-weight: 500; font-stretch: 100%;
  letter-spacing: 0.17em; text-transform: uppercase; color: var(--ink-3);
  line-height: 1.35;
}

.mg-title { position: absolute; left: 24px; top: 20px; pointer-events: none; }
.mg-title-name {
  margin: 0; font-size: 34px; font-weight: 400; font-stretch: 104%;
  letter-spacing: -0.015em; line-height: 1.05; color: var(--ink);
}
.mg-title-sub { margin-top: 7px; }
.mg-title-rule { display: block; width: 32px; height: 1px; background: var(--agrees); margin: 12px 0 18px; }
.mg-layers { display: flex; flex-direction: column; gap: 7px; pointer-events: auto; }
.mg-layer {
  text-align: left; opacity: 0.42; letter-spacing: 0.22em;
  transition: opacity var(--dur) var(--ease), color var(--dur) var(--ease);
}
.mg-layer:hover { opacity: 0.8; }
.mg-layer-on { opacity: 1; color: var(--ink-2); }

.mg-figures {
  position: absolute; right: 24px; top: 22px;
  display: flex; align-items: stretch; gap: 0; pointer-events: none;
}
.mg-figure { padding: 0 18px; border-left: 1px solid var(--rule); }
.mg-figure:first-child { border-left: none; padding-left: 0; }
.mg-figure-value {
  font-size: 28px; font-weight: 400; font-stretch: 100%; line-height: 1.05;
  letter-spacing: -0.01em; color: var(--ink); font-variant-numeric: tabular-nums;
  margin-bottom: 5px;
}
.mg-figure-note { opacity: 0.7; letter-spacing: 0.1em; }
.mg-pill {
  align-self: flex-start; margin-left: 18px; padding: 5px 10px 5px 9px;
  border: 1px solid var(--rule); border-radius: 999px;
  display: inline-flex; align-items: center; gap: 7px; color: var(--ink-2);
  letter-spacing: 0.14em; white-space: nowrap;
}
.mg-pill i { display: block; width: 5px; height: 5px; border-radius: 50%; background: var(--agrees); }

.mg-views { position: absolute; left: 24px; bottom: 22px; display: flex; flex-direction: column; gap: 9px; }
.mg-view {
  display: flex; align-items: baseline; gap: 10px; text-align: left;
  color: var(--ink-3); transition: color var(--dur) var(--ease);
}
.mg-view:hover { color: var(--ink-2); }
.mg-view-on { color: var(--ink); }
.mg-view-dot {
  display: block; width: 8px; height: 8px; border-radius: 50%;
  border: 1px solid var(--ink-3); align-self: center; flex: 0 0 auto;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.mg-view-on .mg-view-dot { background: var(--ink); border-color: var(--ink); }
.mg-view-name { font-size: var(--t-body); font-weight: 500; min-width: 56px; }
.mg-view-note { letter-spacing: 0.1em; opacity: 0.75; }

.mg-tag { position: absolute; right: 24px; bottom: 22px; text-align: right; pointer-events: none; }
.mg-key { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; margin-bottom: 12px; }
.mg-key-row { display: flex; align-items: center; gap: 9px; }
.mg-swatches { display: inline-flex; align-items: flex-end; gap: 2px; }
.mg-swatches i { display: block; width: 14px; }
.mg-tagline { letter-spacing: 0.22em; }

.mg-overlay { position: absolute; inset: 0; pointer-events: none; transition: opacity var(--dur) var(--ease); }
.mg-overlay-hidden { opacity: 0; }
.mg-leaders { position: absolute; inset: 0; overflow: visible; }
.mg-leader circle { fill: none; stroke: var(--ink-2); stroke-width: 1; }
.mg-leader line { stroke: var(--ink-3); stroke-width: 1; }
.mg-leader { transition: opacity var(--dur) var(--ease); }
.mg-ring-label {
  position: absolute; left: 0; top: 0; white-space: nowrap;
  letter-spacing: 0.12em; opacity: 0.8; will-change: transform;
}
.mg-callout {
  position: absolute; left: 0; top: 0; width: 230px; padding-left: 10px;
  will-change: transform;
  animation: mg-in 520ms var(--ease) both;
  transition: opacity var(--dur) var(--ease);
}
.mg-callout-left { text-align: right; padding-left: 0; padding-right: 10px; }
.mg-callout-wide { width: 320px; }
.mg-callout-name {
  font-size: var(--t-body); font-weight: 500; color: var(--ink); line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;
}
.mg-callout-wide .mg-callout-name { white-space: normal; }
.mg-callout .mg-caps { letter-spacing: 0.12em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mg-dim { opacity: 0.32; }

@keyframes mg-in { from { opacity: 0; } to { opacity: 1; } }
.mg-still .mg-callout { animation: none; }
`;

export const memoryGalaxy: DemoModule = {
  id: 'galaxy',
  name: 'Memory Galaxy',
  dimension: '3D',
  claim:
    'A galaxy drawn from the links alone, ignoring the projection: each link community of the giant component is a spiral arm sized to its members, distance from the core is link count, height is age, and the components not joined to the core stand off as satellite knots — so the old Galaxy can be judged against one whose every position is a measurement.',
  Plate,
};
