/**
 * SLOT 8 — Communities as columns (3D)
 *
 * ─── What the axes mean, and why ───────────────────────────────────────────
 *
 * The axes are LINK COMMUNITIES, found by Louvain on the drawn link graph
 * itself, and nothing else. Measured on this store: modularity 0.786 over 27
 * communities, sizes 89 / 88 / 82 / 82 / 52 / 41 / 35 / 32 / 28 / 23 / 17 and
 * then a tail of eights and twos. Eleven of them clear twelve members and get
 * a column each; the remaining sixteen fold into a twelfth column that says so.
 *
 * The three alternatives were rejected on measurement, not on taste:
 *   memory TYPE      — 79% of memories are semantic and 96% of links join two
 *                      of the same type. An axis that puts four fifths of the
 *                      store on one spoke encodes almost nothing.
 *   RETENTION band   — 564 of 652 sit in one band. Same failure, worse.
 *   DEGREE           — continuous, so it is a position along an axis, not a
 *                      choice of axis. It is used that way here: degree ranks
 *                      a memory INSIDE its column.
 * Community is the only candidate that both partitions the store and is
 * measured from the thing being drawn. It also cannot be read off any other
 * channel, which is the test that matters.
 *
 * ─── Why a column and not a ring position ──────────────────────────────────
 *
 * 92.4% of the drawn links (2,865 of 3,101) join two memories in the SAME
 * community. A flat chord diagram draws exactly those as degenerate stubs
 * hugging the rim — it buries the overwhelming majority of the data to show
 * the 7.6% that crosses. Standing each community up as a column gives that
 * majority a full second axis: the vane of arcs on the outside of a column IS
 * its internal wiring, and its shape is readable — a fan anchored at the base
 * means a star around one hub, an even ladder means a mesh.
 *
 * So the volume splits by construction and the split means something:
 *   OUTSIDE the ring   every within-community link, as a radial vane.
 *   INSIDE the ring    every crossing link, bundled through a shared waist
 *                      that dives deeper the further apart the two columns
 *                      sit on the ring.
 * The ring order is a greedy seriation of the column-to-column matrix, so
 * strongly wired columns stand next to each other and long-range traffic is
 * what plunges through the middle.
 *
 * ─── Nothing floats ────────────────────────────────────────────────────────
 *
 * A memory's angle is its community. Its height is its degree rank inside that
 * community, hubs on the floor, single-link fringe at the top — so every
 * column shares one baseline and hub-to-hub traffic runs low. Its radius is
 * fixed. There is no simulation, no randomness, and no embedding: this demo
 * ignores the PCA coordinates entirely, which is defensible because the
 * projection keeps 38% of the variance and puts connected memories a mean 7.08
 * apart against a random-pair 40.81 — it piles linked memories on top of each
 * other, which is the reason edges vanish in the rejected 3D views.
 *
 * ─── Rules of the boundary ─────────────────────────────────────────────────
 *
 * 3  No colour literal appears below. Hue is only ever link kind.
 * 4  Density is geometry: bundle waists thicken with count, vanes fill with
 *    internal wiring, ledger bars are lengths. There is no wash anywhere.
 * 5  Retention is bead RADIUS and a named band in the key, never colour.
 * 6  `reducedMotion` turns off orbit damping; nothing else moves at any time.
 * 7  Only `transform` and `opacity` are animated, and only on the tags.
 * 8  Every denominator on screen is the real one, computed live.
 * 9  The canvas bleeds to four edges; the sheets bleed into the edges they sit
 *    on. No card, no radius, no shadow.
 * No bloom, no postprocessing, and tone mapping is set explicitly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type ObsData,
  type RetentionBand,
} from './contract';

// ─── Measurements of the structure ──────────────────────────────────────────

/** A community needs this many members to earn its own column. */
const MIN_COLUMN = 12;
/** Hard cap before the remainder column, so the ring stays countable. */
const MAX_COLUMNS = 13;
/** Arc length between neighbouring columns; the ring radius follows from it. */
const COLUMN_ARC = 21;
/** World units between two beads on a column. Rank spacing is constant across
 *  columns, so a column's height IS its member count read as a bar. */
const PITCH = 0.72;
const BEAD_R = 0.2;
/** Rule 5: retention is radius. The band's word is in the key beside it. */
const BEAD_SCALE: Record<RetentionBand, number> = {
  threshold: 1,
  fading: 1.35,
  holding: 1.65,
  vivid: 1.95,
};
const VANE_MIN = 1.8;
const VANE_MAX = 17;
/** Where the unlinked memories lie, as a factor of the ring radius. */
const FLOOR_FACTOR = 1.62;
/** How hard a crossing chord is pulled onto its bundle's waist. */
const WAIST_PULL = 0.78;
/** Lateral separation between the two strands of a doubled pair. */
const SPLIT = 0.9;

const CAM_FOV = 32;
const CAM_DIR = new THREE.Vector3(0.62, 0.46, 1).normalize();

const nf = new Intl.NumberFormat('en-US');
const pct = (a: number, b: number): string => (b === 0 ? '0' : Math.round((100 * a) / b).toString());

// ─── Louvain ────────────────────────────────────────────────────────────────

interface Weighted {
  s: number;
  t: number;
  w: number;
}

/**
 * Modularity maximisation by the Louvain method, weighted by link strength and
 * blind to link KIND — a contradiction still binds two memories into the same
 * neighbourhood, and refusing to let it is what would make the picture lie.
 * Colour then reveals what the partition could not see: whether a community
 * argues with itself, and whether the links that cross it agree.
 *
 * Deterministic: nodes are visited in index order and ties keep the lower
 * community id, so the same store always gives the same columns.
 */
function louvain(size: number, edges: readonly Weighted[]): Int32Array {
  const membership = new Int32Array(size);
  for (let i = 0; i < size; i++) membership[i] = i;
  let count = size;
  let current: Weighted[] = edges.map((e) => ({ s: e.s, t: e.t, w: e.w }));

  for (let level = 0; level < 12; level++) {
    const adjacency: number[][] = Array.from({ length: count }, () => []);
    const strength = new Float64Array(count);
    let m2 = 0;
    for (const e of current) {
      if (e.s === e.t) {
        strength[e.s]! += e.w * 2;
        m2 += e.w * 2;
        continue;
      }
      adjacency[e.s]!.push(e.t, e.w);
      adjacency[e.t]!.push(e.s, e.w);
      strength[e.s]! += e.w;
      strength[e.t]! += e.w;
      m2 += 2 * e.w;
    }
    if (m2 === 0) break;

    const community = new Int32Array(count);
    for (let i = 0; i < count; i++) community[i] = i;
    const total = Float64Array.from(strength);
    let moved = false;

    for (let pass = 0; pass < 32; pass++) {
      let changed = false;
      for (let v = 0; v < count; v++) {
        const own = community[v]!;
        const near = new Map<number, number>();
        const list = adjacency[v]!;
        for (let k = 0; k < list.length; k += 2) {
          const c = community[list[k]!]!;
          near.set(c, (near.get(c) ?? 0) + list[k + 1]!);
        }
        total[own]! -= strength[v]!;
        let best = own;
        let bestGain = (near.get(own) ?? 0) - (total[own]! * strength[v]!) / m2;
        for (const [c, w] of near) {
          if (c === own) continue;
          const gain = w - (total[c]! * strength[v]!) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        total[best]! += strength[v]!;
        if (best !== own) {
          community[v] = best;
          changed = true;
          moved = true;
        }
      }
      if (!changed) break;
    }

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
    for (let i = 0; i < size; i++) membership[i] = renumbered[membership[i]!]!;
    if (!moved || remap.size === count) break;

    const merged = new Map<string, number>();
    for (const e of current) {
      const a = renumbered[e.s]!;
      const b = renumbered[e.t]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      merged.set(key, (merged.get(key) ?? 0) + e.w);
    }
    current = [];
    for (const [key, w] of merged) {
      const [a, b] = key.split(':');
      current.push({ s: Number(a), t: Number(b), w });
    }
    count = remap.size;
  }
  return membership;
}

/** Newman modularity of a partition, reported on screen so the split is not
 *  taken on trust. */
function modularityOf(size: number, edges: readonly Weighted[], membership: Int32Array): number {
  const strength = new Float64Array(size);
  let m2 = 0;
  for (const e of edges) {
    strength[e.s]! += e.w;
    strength[e.t]! += e.w;
    m2 += 2 * e.w;
  }
  if (m2 === 0) return 0;
  let communities = 0;
  for (let i = 0; i < size; i++) communities = Math.max(communities, membership[i]! + 1);
  const inside = new Float64Array(communities);
  const attached = new Float64Array(communities);
  for (const e of edges) if (membership[e.s] === membership[e.t]) inside[membership[e.s]!]! += e.w;
  for (let i = 0; i < size; i++) attached[membership[i]!]! += strength[i]!;
  let q = 0;
  for (let c = 0; c < communities; c++) {
    q += (2 * inside[c]!) / m2 - (attached[c]! / m2) ** 2;
  }
  return q;
}

// ─── The reading ────────────────────────────────────────────────────────────

interface Column {
  /** Position on the ring, after seriation. */
  slot: number;
  /** Louvain id, or -1 for the remainder column. */
  community: number;
  /** How many communities this column holds — 1, except the remainder. */
  communities: number;
  members: number[];
  angle: number;
  ux: number;
  uz: number;
  height: number;
  within: number;
  withinContradict: number;
  cross: number;
  crossContradict: number;
}

interface Reading {
  columns: Column[];
  /** Ring position per node; -1 when the memory has no renderable link. */
  columnOf: Int32Array;
  rankOf: Int32Array;
  position: Float32Array;
  scale: Float32Array;
  /** Link indices touching each node. */
  linksOfNode: number[][];
  /** Link indices whose two ends sit on the same column. */
  vaneOfColumn: number[][];
  /** Link indices leaving each column. */
  crossOfColumn: number[][];
  ringRadius: number;
  floorRadius: number;
  /** Memories with no renderable link — the floor ring exists only for them. */
  unlinked: number;
  tallest: number;
  linked: number;
  covered: number;
  remainderCommunities: number;
  within: number;
  withinContradict: number;
  crossing: number;
  crossContradict: number;
  bundles: number;
  doubled: number;
  modularity: number;
  communityCount: number;
  maxVane: number;
}

/** Signed angular difference, wrapped to (-π, π]. */
function wrap(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

function buildReading(data: ObsData): Reading {
  const { nodes, links } = data;
  const n = nodes.length;

  const weighted: Weighted[] = [];
  for (const l of links) if (l.source !== l.target) weighted.push({ s: l.source, t: l.target, w: l.strength });
  const membership = louvain(n, weighted);
  const modularity = modularityOf(n, weighted, membership);

  // Only communities that actually hold a linked memory count as communities;
  // an isolated memory is its own Louvain singleton and is not a community.
  const sizes = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (nodes[i]!.degree === 0) continue;
    const c = membership[i]!;
    sizes.set(c, (sizes.get(c) ?? 0) + 1);
  }
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const big = ranked.filter(([, s], i) => s >= MIN_COLUMN && i < MAX_COLUMNS);
  const rest = ranked.filter((entry) => !big.includes(entry));

  const columnOfCommunity = new Map<number, number>();
  big.forEach(([c], i) => columnOfCommunity.set(c, i));
  const remainderSlot = big.length;
  const hasRemainder = rest.length > 0;
  const columnCount = big.length + (hasRemainder ? 1 : 0);

  const columnOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (nodes[i]!.degree === 0) continue;
    columnOf[i] = columnOfCommunity.get(membership[i]!) ?? remainderSlot;
  }

  // Members of a column, hubs first. The remainder column groups its little
  // communities so each one's wiring stays a contiguous block on the shaft.
  const grouped: number[][] = Array.from({ length: columnCount }, () => []);
  for (let i = 0; i < n; i++) if (columnOf[i]! >= 0) grouped[columnOf[i]!]!.push(i);
  const restOrder = new Map<number, number>();
  rest.forEach(([c], i) => restOrder.set(c, i));
  for (let k = 0; k < columnCount; k++) {
    grouped[k]!.sort((a, b) => {
      if (k === remainderSlot && hasRemainder) {
        const ga = restOrder.get(membership[a]!) ?? 0;
        const gb = restOrder.get(membership[b]!) ?? 0;
        if (ga !== gb) return ga - gb;
      }
      return nodes[b]!.degree - nodes[a]!.degree || (nodes[a]!.id < nodes[b]!.id ? -1 : 1);
    });
  }

  // Column-to-column matrix, then a greedy seriation of it: start from the
  // heaviest pair and keep extending whichever end has the heaviest link to a
  // column not yet placed. Neighbours on the ring are therefore the columns
  // that actually talk to each other.
  const matrix = new Float64Array(columnCount * columnCount);
  for (const l of links) {
    const a = columnOf[l.source]!;
    const b = columnOf[l.target]!;
    if (a < 0 || b < 0 || a === b) continue;
    matrix[a * columnCount + b]! += 1;
    matrix[b * columnCount + a]! += 1;
  }
  const order = seriate(columnCount, matrix);

  // A store with no renderable link leaves no columns. The drum still needs a
  // radius, or the camera below is framed on a zero-size scene.
  const ringRadius = Math.max(COLUMN_ARC, (columnCount * COLUMN_ARC) / (2 * Math.PI));
  const columns: Column[] = order.map((source, slot) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * slot) / columnCount;
    const members = grouped[source]!;
    return {
      slot,
      community: source === remainderSlot && hasRemainder ? -1 : big[source]![0],
      communities: source === remainderSlot && hasRemainder ? rest.length : 1,
      members,
      angle,
      ux: Math.cos(angle),
      uz: Math.sin(angle),
      height: Math.max(0, members.length - 1) * PITCH,
      within: 0,
      withinContradict: 0,
      cross: 0,
      crossContradict: 0,
    };
  });
  // `columnOf` still holds pre-seriation ids; move it onto ring slots.
  const slotOf = new Int32Array(columnCount);
  order.forEach((source, slot) => {
    slotOf[source] = slot;
  });
  for (let i = 0; i < n; i++) if (columnOf[i]! >= 0) columnOf[i] = slotOf[columnOf[i]!]!;

  const rankOf = new Int32Array(n).fill(-1);
  const position = new Float32Array(n * 3);
  const scale = new Float32Array(n);
  for (const column of columns) {
    column.members.forEach((index, rank) => {
      rankOf[index] = rank;
      position[index * 3] = column.ux * ringRadius;
      position[index * 3 + 1] = rank * PITCH;
      position[index * 3 + 2] = column.uz * ringRadius;
    });
  }
  // The memories with nothing to connect to: pinned too, on a floor ring
  // outside the colonnade, so the denominator is drawn and not just stated.
  const floorRadius = ringRadius * FLOOR_FACTOR;
  const loose: number[] = [];
  for (let i = 0; i < n; i++) if (columnOf[i]! < 0) loose.push(i);
  loose.forEach((index, k) => {
    const angle = (2 * Math.PI * k) / Math.max(1, loose.length);
    position[index * 3] = Math.cos(angle) * floorRadius;
    position[index * 3 + 1] = 0;
    position[index * 3 + 2] = Math.sin(angle) * floorRadius;
  });
  for (let i = 0; i < n; i++) scale[i] = BEAD_R * BEAD_SCALE[nodes[i]!.retentionBand];

  const linksOfNode: number[][] = Array.from({ length: n }, () => []);
  const vaneOfColumn: number[][] = Array.from({ length: columnCount }, () => []);
  const crossOfColumn: number[][] = Array.from({ length: columnCount }, () => []);
  const bundleKeys = new Set<string>();
  let within = 0;
  let withinContradict = 0;
  let crossing = 0;
  let crossContradict = 0;
  links.forEach((l, i) => {
    linksOfNode[l.source]!.push(i);
    linksOfNode[l.target]!.push(i);
    const a = columnOf[l.source]!;
    const b = columnOf[l.target]!;
    if (a < 0 || b < 0) return;
    const contradicts = l.kind === 'contradicts';
    if (a === b) {
      vaneOfColumn[a]!.push(i);
      columns[a]!.within++;
      if (contradicts) columns[a]!.withinContradict++;
      within++;
      if (contradicts) withinContradict++;
    } else {
      crossOfColumn[a]!.push(i);
      crossOfColumn[b]!.push(i);
      columns[a]!.cross++;
      columns[b]!.cross++;
      if (contradicts) {
        columns[a]!.crossContradict++;
        columns[b]!.crossContradict++;
        crossContradict++;
      }
      crossing++;
      bundleKeys.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
  });

  const pairKind = new Map<string, { a: number; c: number }>();
  for (const l of links) {
    const key = l.source < l.target ? `${l.source}_${l.target}` : `${l.target}_${l.source}`;
    const entry = pairKind.get(key) ?? { a: 0, c: 0 };
    if (l.kind === 'contradicts') entry.c++;
    else entry.a++;
    pairKind.set(key, entry);
  }
  let doubled = 0;
  for (const entry of pairKind.values()) if (entry.a > 0 && entry.c > 0) doubled++;

  let linked = 0;
  for (let i = 0; i < n; i++) if (nodes[i]!.degree > 0) linked++;
  let covered = 0;
  for (const [, size] of big) covered += size;

  return {
    columns,
    columnOf,
    rankOf,
    position,
    scale,
    linksOfNode,
    vaneOfColumn,
    crossOfColumn,
    ringRadius,
    floorRadius,
    unlinked: loose.length,
    tallest: columns.reduce((m, c) => Math.max(m, c.height), 0),
    linked,
    covered,
    remainderCommunities: hasRemainder ? rest.length : 0,
    within,
    withinContradict,
    crossing,
    crossContradict,
    bundles: bundleKeys.size,
    doubled,
    modularity,
    communityCount: ranked.length,
    maxVane: columns.reduce((m, c) => Math.max(m, c.within), 0),
  };
}

/** Greedy chain seriation of a symmetric count matrix. */
function seriate(count: number, matrix: Float64Array): number[] {
  if (count <= 2) return Array.from({ length: count }, (_, i) => i);
  let bestA = 0;
  let bestB = 1;
  let bestW = -1;
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const w = matrix[a * count + b]!;
      if (w > bestW) {
        bestW = w;
        bestA = a;
        bestB = b;
      }
    }
  }
  const chain = [bestA, bestB];
  const placed = new Set(chain);
  while (chain.length < count) {
    let pick = -1;
    let pickWeight = -1;
    let atHead = false;
    for (const [end, head] of [
      [chain[0]!, true],
      [chain[chain.length - 1]!, false],
    ] as [number, boolean][]) {
      for (let c = 0; c < count; c++) {
        if (placed.has(c)) continue;
        const w = matrix[end * count + c]!;
        if (w > pickWeight) {
          pickWeight = w;
          pick = c;
          atHead = head;
        }
      }
    }
    if (pick < 0) break;
    if (atHead) chain.unshift(pick);
    else chain.push(pick);
    placed.add(pick);
  }
  for (let c = 0; c < count; c++) if (!placed.has(c)) chain.push(c);
  return chain;
}

// ─── Chord geometry ─────────────────────────────────────────────────────────

interface Chords {
  positions: Float32Array;
  colors: Float32Array;
  /** Where each link's segments start, and how many it has. */
  start: Int32Array;
  length: Int32Array;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Every link, as one merged buffer, in the two families the constraint
 * creates. Within-column links become a radial vane outside the ring;
 * crossing links are bundled through a per-pair waist inside it, dived deeper
 * the further apart their columns stand. Both are drawn as segment strips so
 * the whole field is a single instanced draw call.
 */
function buildChords(data: ObsData, reading: Reading): Chords {
  const { links } = data;
  const { columnOf, rankOf, position, columns, ringRadius } = reading;

  // The waist of a bundle sits on the bisector of its two columns, at the mean
  // height of everything in it, so a bundle reads as one rope whose thickness
  // is its count. That is the density channel — geometry, never a wash.
  const waists = new Map<string, THREE.Vector3>();
  const sums = new Map<string, { y: number; n: number }>();
  for (const l of links) {
    const a = columnOf[l.source]!;
    const b = columnOf[l.target]!;
    if (a < 0 || b < 0 || a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const entry = sums.get(key) ?? { y: 0, n: 0 };
    entry.y += position[l.source * 3 + 1]! + position[l.target * 3 + 1]!;
    entry.n += 2;
    sums.set(key, entry);
  }
  for (const [key, entry] of sums) {
    const [a, b] = key.split('-').map(Number) as [number, number];
    const ca = columns[a]!;
    const cb = columns[b]!;
    const delta = wrap(cb.angle - ca.angle);
    const mid = ca.angle + delta / 2;
    const separation = Math.abs(delta) / Math.PI;
    const radius = ringRadius * (1 - 0.72 * Math.pow(separation, 0.75));
    waists.set(key, new THREE.Vector3(Math.cos(mid) * radius, entry.y / entry.n, Math.sin(mid) * radius));
  }

  // Doubled pairs: 459 node pairs on this store carry both an agreement and a
  // contradiction. Their strands are pushed apart sideways in the middle and
  // meet again at the beads, so a doubled chord reads as two, not one.
  const slots = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const l of links) {
    const key = l.source < l.target ? `${l.source}_${l.target}` : `${l.target}_${l.source}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const segmentsOf = (link: (typeof links)[number]): number => {
    const a = columnOf[link.source]!;
    const b = columnOf[link.target]!;
    if (a < 0 || b < 0) return 0;
    if (a !== b) return 22;
    const span = Math.abs(rankOf[link.source]! - rankOf[link.target]!);
    return Math.min(18, Math.max(6, Math.round(5 + span * 0.45)));
  };

  let total = 0;
  const start = new Int32Array(links.length);
  const length = new Int32Array(links.length);
  links.forEach((l, i) => {
    const s = segmentsOf(l);
    start[i] = total;
    length[i] = s;
    total += s;
  });

  const positions = new Float32Array(total * 6);
  const colors = new Float32Array(total * 6);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tint = new THREE.Color();

  links.forEach((link, i) => {
    const segments = length[i]!;
    if (segments === 0) return;
    const ca = columnOf[link.source]!;
    const cb = columnOf[link.target]!;
    const key = link.source < link.target ? `${link.source}_${link.target}` : `${link.target}_${link.source}`;
    const slot = slots.get(key) ?? 0;
    slots.set(key, slot + 1);
    const offset = (slot - ((totals.get(key) ?? 1) - 1) / 2) * SPLIT;

    a.fromArray(position, link.source * 3);
    b.fromArray(position, link.target * 3);
    tint.setHex(linkColorInt(link));

    if (ca === cb) {
      // A vane arc: bow radially outward, further out the more ranks it spans.
      const column = columns[ca]!;
      const span = Math.abs(rankOf[link.source]! - rankOf[link.target]!);
      const reach = Math.max(1, column.members.length - 1);
      const bulge = VANE_MIN + (VANE_MAX - VANE_MIN) * Math.pow(span / reach, 0.62);
      lateral.set(-column.uz, 0, column.ux);
      c1.set(column.ux, 0, column.uz).multiplyScalar(bulge * 1.5).add(a);
      c2.set(column.ux, 0, column.uz).multiplyScalar(bulge * 1.5).add(b);
      c1.addScaledVector(lateral, offset);
      c2.addScaledVector(lateral, offset);
    } else {
      const waist = waists.get(ca < cb ? `${ca}-${cb}` : `${cb}-${ca}`)!;
      c1.copy(a).lerp(waist, WAIST_PULL);
      c2.copy(b).lerp(waist, WAIST_PULL);
      lateral.copy(b).sub(a).cross(UP);
      if (lateral.lengthSq() < 1e-6) lateral.set(1, 0, 0);
      lateral.normalize();
      c1.addScaledVector(lateral, offset);
      c2.addScaledVector(lateral, offset);
    }

    let p = start[i]! * 6;
    prev.copy(a);
    for (let k = 1; k <= segments; k++) {
      const t = k / segments;
      bezier(next, a, c1, c2, b, t);
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

function bezier(
  out: THREE.Vector3,
  a: THREE.Vector3,
  c1: THREE.Vector3,
  c2: THREE.Vector3,
  b: THREE.Vector3,
  t: number
): void {
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

// ─── Scene ──────────────────────────────────────────────────────────────────

type Focus = { kind: 'memory'; index: number } | { kind: 'column'; slot: number } | null;

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

function makeChordObject(
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

/** Every chord in the store: one object, one draw call. */
function ChordField({ chords, dimmed }: { chords: Chords; dimmed: boolean }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => makeChordObject(chords.positions, chords.colors, 1.05, false), [chords])
  );
  useEffect(() => {
    const material = object.material;
    // Belt and braces: LineSegments2 rewrites `resolution` from the viewport
    // before every draw, so this only matters for the first frame.
    material.resolution.set(size.width, size.height);
    // Knocked back only while a focus is held — a transient state, not the
    // reading state, and not rule 4's forbidden density wash. `depthWrite`
    // stays on so overlapping segments occlude rather than accumulate, which
    // is what would turn a uniform dim back into a brightness ramp.
    // `opacity` is a uniform; no `needsUpdate` is owed for it.
    material.opacity = dimmed ? 0.26 : 1;
    invalidate();
  }, [object, size.width, size.height, dimmed, invalidate]);
  return <primitive object={object} />;
}

/** The chords the focus selects, redrawn on top at full strength. */
function FocusField({ chords, indices }: { chords: Chords; indices: readonly number[] }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => {
      let segments = 0;
      for (const i of indices) segments += chords.length[i]!;
      const positions = new Float32Array(segments * 6);
      const colors = new Float32Array(segments * 6);
      let p = 0;
      for (const i of indices) {
        const from = chords.start[i]! * 6;
        const to = from + chords.length[i]! * 6;
        positions.set(chords.positions.subarray(from, to), p);
        colors.set(chords.colors.subarray(from, to), p);
        p = p + (to - from);
      }
      return makeChordObject(positions, colors, 2.1, true);
    }, [chords, indices])
  );
  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [object, size.width, size.height, invalidate]);
  return <primitive object={object} />;
}

/** The scaffold: the base ring, and one shaft per column. */
function Scaffold({ reading }: { reading: Reading }) {
  const object = useDisposable(
    useMemo(() => {
      const points: number[] = [];
      const steps = 160;
      for (let k = 0; k < steps; k++) {
        const t0 = (2 * Math.PI * k) / steps;
        const t1 = (2 * Math.PI * (k + 1)) / steps;
        points.push(
          Math.cos(t0) * reading.ringRadius, 0, Math.sin(t0) * reading.ringRadius,
          Math.cos(t1) * reading.ringRadius, 0, Math.sin(t1) * reading.ringRadius
        );
        // Only drawn when something stands on it. An empty ring that claims to
        // hold the unlinked memories would be a line that means nothing.
        if (reading.unlinked > 0) {
          points.push(
            Math.cos(t0) * reading.floorRadius, 0, Math.sin(t0) * reading.floorRadius,
            Math.cos(t1) * reading.floorRadius, 0, Math.sin(t1) * reading.floorRadius
          );
        }
      }
      for (const column of reading.columns) {
        points.push(
          column.ux * reading.ringRadius, 0, column.uz * reading.ringRadius,
          column.ux * reading.ringRadius, column.height, column.uz * reading.ringRadius
        );
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const material = new THREE.LineBasicMaterial({ color: PLATE_COLORS.rule, fog: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      return lines;
    }, [reading])
  );
  return <primitive object={object} />;
}

/** Every memory, as one instanced mesh: one draw call, 652 pinned beads. */
function Beads({
  data,
  reading,
  focus,
  live,
  onHover,
  onPick,
}: {
  data: ObsData;
  reading: Reading;
  focus: Focus;
  live: number | null;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useDisposable(
    useMemo(() => {
      const geometry = new THREE.IcosahedronGeometry(1, 0);
      // `transparent` at full opacity purely to move the beads into the
      // transparent pass, where `renderOrder` can put them after the focus
      // overlay. Opaque, they would render first and the chords converging on
      // the live memory would paint out its own marker. Depth testing still
      // occludes them correctly against the base chord field.
      const material = new THREE.MeshBasicMaterial({
        toneMapped: false,
        fog: false,
        transparent: true,
      });
      const instanced = new THREE.InstancedMesh(geometry, material, data.nodes.length);
      instanced.frustumCulled = false;
      instanced.renderOrder = 30;
      const matrix = new THREE.Matrix4();
      const neutral = new THREE.Color(PLATE_COLORS.memory);
      for (let i = 0; i < data.nodes.length; i++) {
        const r = reading.scale[i]!;
        matrix.makeScale(r, r, r);
        matrix.setPosition(
          reading.position[i * 3]!,
          reading.position[i * 3 + 1]!,
          reading.position[i * 3 + 2]!
        );
        instanced.setMatrixAt(i, matrix);
        // Seeded here, not in the effect below: `instanceColor` is allocated
        // zero-filled, and a passive effect can land after the first frame.
        instanced.setColorAt(i, neutral);
      }
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      return instanced;
    }, [data, reading])
  );

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    // Derived from the tokens, never typed: a memory outside the focus is the
    // neutral mark mixed back toward the ground it sits on.
    const back = new THREE.Color(PLATE_COLORS.memory).lerp(new THREE.Color(PLATE_COLORS.plate), 0.62);
    const lit = new THREE.Color(PLATE_COLORS.memoryLive);

    // One neighbour set, not a scan per bead.
    const neighbours = new Set<number>();
    const slot = focus?.kind === 'column' ? focus.slot : -1;
    if (focus?.kind === 'memory') {
      neighbours.add(focus.index);
      for (const k of reading.linksOfNode[focus.index] ?? []) {
        const link = data.links[k]!;
        neighbours.add(link.source);
        neighbours.add(link.target);
      }
    }

    for (let i = 0; i < data.nodes.length; i++) {
      let colour = rest;
      if (focus) {
        const inFocus = slot >= 0 ? reading.columnOf[i] === slot : neighbours.has(i);
        colour = inFocus ? rest : back;
      }
      if (i === live) colour = lit;
      mesh.setColorAt(i, colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [mesh, data, reading, focus, live, invalidate]);

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

/** Column tags, projected out of the scene onto DOM so they wear the page's
 *  own type rather than a texture. Only transform and opacity are written. */
function Tags({
  reading,
  elements,
}: {
  reading: Reading;
  elements: React.RefObject<(HTMLSpanElement | null)[]>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const point = useMemo(() => new THREE.Vector3(), []);
  const world = useMemo(
    () =>
      reading.columns.map(
        (c) =>
          new THREE.Vector3(
            c.ux * reading.ringRadius,
            c.height + PITCH * 5,
            c.uz * reading.ringRadius
          )
      ),
    [reading]
  );
  const depths = useMemo(() => new Float64Array(world.length), [world.length]);
  useFrame(() => {
    const list = elements.current;
    if (!list) return;
    // A tag on the far side of the colonnade recedes rather than competing
    // with the one in front of it. Normalised across this frame's own spread,
    // so the falloff holds at any orbit distance.
    let near = Infinity;
    let far = -Infinity;
    for (let i = 0; i < world.length; i++) {
      const d = world[i]!.distanceTo(camera.position);
      depths[i] = d;
      if (d < near) near = d;
      if (d > far) far = d;
    }
    const spread = Math.max(1e-3, far - near);
    for (let i = 0; i < world.length; i++) {
      const element = list[i];
      if (!element) continue;
      point.copy(world[i]!).project(camera);
      const x = (point.x * 0.5 + 0.5) * size.width;
      const y = (-point.y * 0.5 + 0.5) * size.height;
      const front = 1 - (depths[i]! - near) / spread;
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      element.style.opacity = point.z >= 1 ? '0' : (0.34 + 0.66 * front).toFixed(2);
    }
  });
  return null;
}

function Rig({ reading, reducedMotion }: { reading: Reading; reducedMotion: boolean }) {
  const target = useMemo(
    () => new THREE.Vector3(0, reading.tallest * 0.34, 0),
    [reading.tallest]
  );
  const fit = reading.floorRadius * 1.16;
  return (
    <OrbitControls
      makeDefault
      target={target}
      enablePan={false}
      autoRotate={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.09}
      rotateSpeed={0.62}
      zoomSpeed={0.7}
      minDistance={fit * 0.45}
      maxDistance={fit * 4}
      maxPolarAngle={Math.PI * 0.495}
      minPolarAngle={Math.PI * 0.06}
    />
  );
}

// ─── Sheets ─────────────────────────────────────────────────────────────────

/** The column ledger: twelve rows, each a bar whose LENGTH is that community's
 *  internal link count and whose split is how much of it contradicts. Density
 *  as geometry again, at the scale a number can be read at. */
function Ledger({
  reading,
  pinned,
  onHover,
  onPin,
}: {
  reading: Reading;
  pinned: number | null;
  onHover: (slot: number | null) => void;
  onPin: (slot: number | null) => void;
}) {
  // Seriation decides where the remainder column stands, so its ring slot has
  // to be looked up — it is not the last one by construction.
  const remainder = reading.columns.find((c) => c.community === -1);
  return (
    <aside className="cac-ledger" aria-label="Columns, by internal wiring">
      <p className="obs-label cac-head">
        Column · internal links, agree and contradict · members
      </p>
      <ol className="cac-rows">
        {reading.columns.map((column) => {
          const agree = column.within - column.withinContradict;
          return (
            <li key={column.slot}>
              <button
                type="button"
                className="cac-row"
                aria-pressed={pinned === column.slot}
                aria-label={
                  `Column ${column.slot + 1}: ${column.members.length} memories, ` +
                  `${column.within} internal links of which ${column.withinContradict} contradict, ` +
                  `${column.cross} leaving the column`
                }
                onPointerEnter={() => onHover(column.slot)}
                onPointerLeave={() => onHover(null)}
                onFocus={() => onHover(column.slot)}
                onBlur={() => onHover(null)}
                onClick={() => onPin(pinned === column.slot ? null : column.slot)}
              >
                <span className="cac-tagno obs-figure">{column.slot + 1}</span>
                <span className="cac-track">
                  <span
                    className="cac-meter"
                    style={{ width: `${(column.within / Math.max(1, reading.maxVane)) * 100}%` }}
                  >
                    {agree > 0 ? (
                      <span className="cac-seg cac-seg-a" style={{ flexGrow: agree }} />
                    ) : null}
                    {column.withinContradict > 0 ? (
                      <span className="cac-seg cac-seg-c" style={{ flexGrow: column.withinContradict }} />
                    ) : null}
                  </span>
                </span>
                <span className="cac-count obs-figure">{column.members.length}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="cac-foot obs-label">
        Bar length is the count, not the share: the longest is column{' '}
        {(reading.columns.find((c) => c.within === reading.maxVane)?.slot ?? 0) + 1} at{' '}
        {nf.format(reading.maxVane)} internal links.
        {remainder ? (
          <>
            {' '}
            Columns of their own hold {nf.format(reading.covered)} of{' '}
            {nf.format(reading.linked)} linked memories; column {remainder.slot + 1} is the
            remainder, {remainder.communities} communities too small for a shaft each, so a few of
            its arcs run between them rather than inside one.
          </>
        ) : null}
      </p>
    </aside>
  );
}

/** Denominators and the reading key. Every figure is computed, none typed. */
function KeySheet({ data, reading }: { data: ObsData; reading: Reading }) {
  const { stats } = data;
  const rows: { label: string; value: string; note: string }[] = [
    {
      label: 'Communities',
      value: nf.format(reading.communityCount),
      note: `Louvain on the links, modularity ${reading.modularity.toFixed(3)}`,
    },
    {
      label: 'Columns',
      value: nf.format(reading.columns.length),
      note:
        reading.remainderCommunities > 0
          ? `one per community, plus one holding the ${reading.remainderCommunities} smallest`
          : 'one per link community',
    },
    {
      label: 'On a column',
      value: `${nf.format(reading.linked)} of ${nf.format(data.nodes.length)}`,
      note: `${nf.format(reading.unlinked)} have no renderable link — the floor ring outside`,
    },
    {
      label: 'Inside a column',
      value: `${nf.format(reading.within)} links · ${pct(reading.within, stats.linksDrawn)}%`,
      note: `${pct(reading.withinContradict, reading.within)}% contradict — the vanes, outside the ring`,
    },
    {
      label: 'Crossing columns',
      value: `${nf.format(reading.crossing)} links · ${nf.format(reading.bundles)} bundles`,
      note: `${pct(reading.crossContradict, reading.crossing)}% contradict — the web inside the ring`,
    },
    {
      label: 'Drawn',
      value: `${nf.format(stats.linksDrawn)} of ${nf.format(stats.linksStored)}`,
      note: `${nf.format(stats.linksToArchived)} point at archived memories and cannot be drawn`,
    },
  ];
  return (
    <div className="cac-key">
      <dl className="cac-key-rows">
        {rows.map((row) => (
          <div className="cac-key-row" key={row.label}>
            <dt className="obs-label">{row.label}</dt>
            <dd>
              <span className="obs-figure">{row.value}</span>
              <span className="cac-key-note">{row.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="cac-key-foot obs-label">
        Bead radius is retention, never colour —{' '}
        {(['vivid', 'holding', 'fading', 'threshold'] as const)
          .map((band) => `${RETENTION_LABEL[band]} ${nf.format(stats.retention[band])}`)
          .join(' · ')}
        . {nf.format(reading.doubled)} pairs carry both an agreement and a contradiction and draw as
        two strands.
      </p>
    </div>
  );
}

function Readout({
  data,
  reading,
  focus,
  pinnedColumn,
  onClear,
}: {
  data: ObsData;
  reading: Reading;
  focus: Exclude<Focus, null>;
  pinnedColumn: number | null;
  onClear: () => void;
}) {
  if (focus.kind === 'column') {
    const column = reading.columns[focus.slot]!;
    // Not `members[0]`: the remainder column is grouped by community first, so
    // its base bead is one community's hub rather than the column's busiest.
    const hub = column.members.reduce<number | undefined>(
      (best, i) => (best === undefined || data.nodes[i]!.degree > data.nodes[best]!.degree ? i : best),
      undefined
    );
    return (
      <div className="cac-readout">
        <p className="obs-label">Column {column.slot + 1}</p>
        <p className="cac-readout-title">
          {column.communities > 1
            ? `${column.communities} small communities, ${column.members.length} memories`
            : `${column.members.length} memories in one community`}
        </p>
        <dl className="cac-readout-rows">
          <div>
            <dt className="obs-label">Inside</dt>
            <dd className="obs-figure">
              {nf.format(column.within)} links ·{' '}
              {pct(column.withinContradict, column.within)}% contradict
            </dd>
          </div>
          <div>
            <dt className="obs-label">Leaving</dt>
            <dd className="obs-figure">
              {nf.format(column.cross)} links · {pct(column.crossContradict, column.cross)}% contradict
            </dd>
          </div>
          <div>
            <dt className="obs-label">Busiest</dt>
            <dd className="obs-figure">
              {hub === undefined
                ? '—'
                : `${data.nodes[hub]!.degree} links${column.communities === 1 ? ', at the base' : ''}`}
            </dd>
          </div>
        </dl>
        {pinnedColumn === focus.slot ? (
          <button type="button" className="cac-clear obs-label" onClick={onClear}>
            Release column
          </button>
        ) : null}
      </div>
    );
  }

  const node = data.nodes[focus.index]!;
  const slot = reading.columnOf[focus.index]!;
  const column = slot >= 0 ? reading.columns[slot] : undefined;
  const leaving = reading.linksOfNode[focus.index]!.filter((i) => {
    const link = data.links[i]!;
    const other = link.source === focus.index ? link.target : link.source;
    return reading.columnOf[other] !== slot;
  }).length;

  return (
    <div className="cac-readout">
      <p className="obs-label">
        {node.type} · {RETENTION_LABEL[node.retentionBand]}
      </p>
      <p className="cac-readout-title">{node.label}</p>
      <dl className="cac-readout-rows">
        <div>
          <dt className="obs-label">Links</dt>
          <dd className="obs-figure">
            {node.degree} · {node.agreeDegree} agree, {node.contradictDegree} contradict
          </dd>
        </div>
        <div>
          <dt className="obs-label">Standing</dt>
          <dd className="obs-figure">
            {column
              ? `Column ${slot + 1}, rank ${reading.rankOf[focus.index]! + 1} of ${column.members.length}`
              : 'No renderable link — on the floor ring'}
          </dd>
        </div>
        <div>
          <dt className="obs-label">Leaving</dt>
          <dd className="obs-figure">
            {column ? `${leaving} of ${node.degree} cross to another column` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

const NO_LINKS: readonly number[] = [];

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const reading = useMemo(() => buildReading(data), [data]);
  const chords = useMemo(() => buildChords(data, reading), [data, reading]);

  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const [pinnedColumn, setPinnedColumn] = useState<number | null>(null);
  const tagRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const [webgl] = useState(() => {
    if (typeof document === 'undefined') return true;
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      // Hand the probe context straight back: nine demos share one browser's
      // context pool, and switching between them would otherwise drain it.
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
      return Boolean(probe);
    } catch {
      return false;
    }
  });

  const selectedIndex = useMemo(() => {
    if (!selectedId) return null;
    const found = data.nodes.findIndex((n) => n.id === selectedId);
    return found >= 0 ? found : null;
  }, [data.nodes, selectedId]);

  // Precedence, tightest first: the bead under the pointer, then the ledger row
  // under it, then a pinned column, then the selection the page is carrying.
  const focusMemory = hoveredNode ?? (hoveredColumn === null && pinnedColumn === null ? selectedIndex : null);
  const focusColumn = focusMemory === null ? (hoveredColumn ?? pinnedColumn) : null;
  // Memoised because it is a dependency of the bead-colouring effect: a fresh
  // object every render would re-tint 652 instances and force a redraw on each
  // one, which is the whole thing `frameloop="demand"` exists to avoid.
  const focus = useMemo<Focus>(
    () =>
      focusMemory !== null
        ? { kind: 'memory', index: focusMemory }
        : focusColumn !== null
          ? { kind: 'column', slot: focusColumn }
          : null,
    [focusMemory, focusColumn]
  );

  const focusLinks = useMemo<readonly number[]>(() => {
    if (focusMemory !== null) return reading.linksOfNode[focusMemory] ?? NO_LINKS;
    if (focusColumn !== null) {
      return [
        ...(reading.vaneOfColumn[focusColumn] ?? []),
        ...(reading.crossOfColumn[focusColumn] ?? []),
      ];
    }
    return NO_LINKS;
  }, [focusMemory, focusColumn, reading]);

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      setPinnedColumn(null);
      onSelect(selectedId === node.id ? null : node.id);
    },
    [data.nodes, onSelect, selectedId]
  );

  const clear = useCallback(() => {
    setPinnedColumn(null);
    onSelect(null);
  }, [onSelect]);

  // The camera is framed once, from the first measured box. Re-deriving it on
  // resize would snap the view back out from under the viewer's own orbit.
  const framing = useRef<{
    fov: number;
    near: number;
    far: number;
    position: [number, number, number];
  } | null>(null);
  if (!framing.current && width > 0 && height > 0) {
    const fit = Math.max(1, reading.floorRadius * 1.16);
    const vertical = (CAM_FOV * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(0.35, width / height));
    const distance = fit / Math.sin(Math.min(vertical, horizontal) / 2);
    // One stable object, held in a ref: handed to <Canvas camera={…}> as the
    // same reference on every render so nothing re-applies `position` and
    // yanks the view back out from under an orbit in progress.
    framing.current = {
      fov: CAM_FOV,
      near: 0.5,
      far: distance * 4,
      position: [
        CAM_DIR.x * distance,
        reading.tallest * 0.34 + CAM_DIR.y * distance,
        CAM_DIR.z * distance,
      ],
    };
  }

  const roomy = width >= 860 && height >= 470;
  // Unmounting the ledger under the pointer fires no `pointerleave`, so a
  // resize across this threshold mid-hover would strand the highlight on a
  // column with nothing left on screen to release it.
  useEffect(() => {
    if (!roomy) setHoveredColumn(null);
  }, [roomy]);

  const summary =
    `${nf.format(reading.linked)} of ${nf.format(data.nodes.length)} memories stand on ` +
    `${reading.columns.length} columns — one per link community, with the ` +
    `${reading.remainderCommunities} smallest sharing the last — each ranked by degree with its ` +
    `busiest memory at the base. The other ${nf.format(reading.unlinked)} have no renderable link ` +
    `and lie on a floor ring outside. ${nf.format(reading.within)} links stay inside a column and ` +
    `bow outward as vanes; ${nf.format(reading.crossing)} cross between columns in ` +
    `${nf.format(reading.bundles)} bundles through the middle, and ` +
    `${pct(reading.crossContradict, reading.crossing)}% of those crossing links are contradictions ` +
    `against ${pct(reading.withinContradict, reading.within)}% inside.`;

  return (
    <div className="cac-box" style={{ width, height }}>
      <style href="observatory-columns" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl && framing.current ? (
        <>
          <div className="cac-canvas" role="img" aria-label={summary}>
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
              <Scaffold reading={reading} />
              <ChordField chords={chords} dimmed={focus !== null} />
              {focus ? <FocusField chords={chords} indices={focusLinks} /> : null}
              <Beads
                data={data}
                reading={reading}
                focus={focus}
                live={hoveredNode ?? selectedIndex}
                onHover={setHoveredNode}
                onPick={pick}
              />
              <Tags reading={reading} elements={tagRefs} />
              <Rig reading={reading} reducedMotion={reducedMotion} />
            </Canvas>
          </div>
          <div className="cac-tags" aria-hidden>
            {reading.columns.map((column, i) => (
              <span
                key={column.slot}
                className="cac-tag obs-label"
                ref={(element) => {
                  tagRefs.current[i] = element;
                }}
              >
                {column.slot + 1}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="cac-nogl obs-note">
          This reading is drawn with WebGL and this browser did not give the page a context. The
          measurements still hold: {summary}
        </p>
      )}

      {roomy ? (
        <Ledger
          reading={reading}
          pinned={pinnedColumn}
          onHover={setHoveredColumn}
          onPin={setPinnedColumn}
        />
      ) : null}
      <KeySheet data={data} reading={reading} />
      {focus ? (
        <Readout
          data={data}
          reading={reading}
          focus={focus}
          pinnedColumn={pinnedColumn}
          onClear={clear}
        />
      ) : null}
    </div>
  );
}

// ─── The sheet ──────────────────────────────────────────────────────────────
//
// Scoped to this demo's box. Rule 9: the canvas bleeds to all four edges and
// the sheets bleed into the edges they sit against — hairline on the inner
// sides only, no radius, no shadow, no card.

const SHEET_CSS = `
.cac-box { position: absolute; inset: 0; overflow: hidden; }
.cac-canvas { position: absolute; inset: 0; }
.cac-nogl { position: absolute; inset: 0; margin: 0; padding: 28px 20px; max-width: 58ch; }

.cac-tags { position: absolute; inset: 0; pointer-events: none; }
.cac-tag {
  position: absolute; top: 0; left: 0;
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
  transform: translate3d(-100px, -100px, 0);
}

.cac-ledger {
  position: absolute; left: 0; bottom: 0;
  width: 264px; max-width: calc(100% - 24px);
  padding: 13px 15px 14px 20px;
  background: var(--margin);
  border-top: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
}
.cac-head { margin: 0 0 var(--gap-block); max-width: 30ch; }
.cac-rows { list-style: none; margin: 0; padding: 0; }
.cac-row {
  display: grid; grid-template-columns: 13px 1fr 26px;
  align-items: center; gap: 9px; width: 100%;
  padding: 3px 4px 3px 0;
}
.cac-row:hover, .cac-row[aria-pressed='true'] { background: var(--rule); }
.cac-tagno { color: var(--ink-3); font-size: var(--t-label); text-align: right; }
.cac-row:hover .cac-tagno, .cac-row[aria-pressed='true'] .cac-tagno { color: var(--ink); }
.cac-track { display: block; width: 100%; }
.cac-meter { display: flex; gap: 2px; height: 7px; min-width: 2px; }
/* At least as wide as the 2px gap beside it, so a one-link share still reads
   as a mark rather than as a seam. */
.cac-seg { display: block; min-width: 2px; }
.cac-seg-a { background: var(--agrees); }
.cac-seg-c { background: var(--contradicts); }
.cac-count { color: var(--ink-2); font-size: var(--t-label); text-align: right; }
.cac-foot { margin: var(--gap-block) 0 0; max-width: 32ch; line-height: 1.34; }

.cac-key {
  position: absolute; right: 0; bottom: 0;
  width: 322px; max-width: calc(100% - 20px);
  padding: 13px 20px 14px 16px;
  background: var(--margin);
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.cac-key-rows { margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--gap-row); }
.cac-key-row { display: grid; grid-template-columns: 96px 1fr; gap: 10px; align-items: baseline; }
.cac-key-row dd { margin: 0; display: flex; flex-direction: column; }
.cac-key-row .obs-figure { font-size: var(--t-body); }
.cac-key-note { font-size: var(--t-label); color: var(--ink-3); line-height: 1.3; }
.cac-key-foot { margin: var(--gap-block) 0 0; line-height: 1.36; }

.cac-readout {
  position: absolute; right: 0; top: 0;
  width: 288px; max-width: calc(100% - 20px);
  padding: 13px 20px 14px 16px;
  background: var(--margin);
  border-bottom: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.cac-readout > p:first-child { margin: 0; }
.cac-readout-title {
  margin: 3px 0 var(--gap-block);
  font-family: var(--font-note); font-weight: 300;
  font-size: var(--t-claim); line-height: 1.34; color: var(--ink);
}
.cac-readout-rows { margin: 0; display: flex; flex-direction: column; gap: var(--gap-row); }
.cac-readout-rows > div { display: grid; grid-template-columns: 62px 1fr; gap: 10px; align-items: baseline; }
.cac-readout-rows dd { margin: 0; font-size: var(--t-label); color: var(--ink-2); line-height: 1.35; }
.cac-clear { margin-top: var(--gap-block); color: var(--ink-3); }
.cac-clear:hover { color: var(--ink); }

@media (max-width: 700px) {
  .cac-key { width: 100%; max-width: none; }
  .cac-readout { width: 100%; max-width: none; }
}
`;

// ─── Module ─────────────────────────────────────────────────────────────────

export const axesAndChords: DemoModule = {
  id: 'axes-chords',
  name: 'Communities as columns',
  dimension: '3D',
  claim:
    'Nothing floats — each memory is pinned to the community its own links put it in and ranked ' +
    'by degree inside it — and the store’s argument becomes visible: links that stay inside a ' +
    'community mostly agree, while the few that cross columns are mostly contradictions.',
  Plate,
};
