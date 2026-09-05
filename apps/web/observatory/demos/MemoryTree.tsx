/**
 * SLOT — Memory Tree (Hybrid)
 *
 * A trunk rising from the ground line, boughs forking into branches that thin
 * as they climb, leaf dots at the ends; below the ground line, roots.
 *
 * ─── What the tree is a tree OF ────────────────────────────────────────────
 *
 * The link graph is not a hierarchy. Measured live on this store: 653
 * memories, 3,103 drawable links, cycles everywhere, one component of 538. A
 * tree has exactly (nodes − roots) edges, so any tree drawn over this graph
 * keeps a few hundred links and throws the rest away. This plate does that in
 * the open, and puts what it threw away where a tree keeps what it lives on:
 * in the roots.
 *
 *   TRUNK      every linked memory (616 here). Containment, not a link — it is
 *              drawn neutral, never in a link hue.
 *   BOUGHS     one per link community, found by Louvain on the drawn links
 *              (27 at modularity 0.786 on this store, sizes 89/88/83/82/52/41
 *              …/2). Also containment, also neutral. A bough is named by its
 *              busiest member's own text and its real size — there is no topic
 *              taxonomy in this store, so none is printed.
 *   BRANCHES   real links. Inside each community a spanning tree is grown by
 *              one of three rules the viewer can switch between: strongest
 *              link (Prim from the busiest member), nearest hub (breadth-first
 *              from it), or first written (each memory hangs on its strongest
 *              link to an older memory). The rule is a CHOICE, and switching
 *              it redraws the canopy so the reader sees that a tree over this
 *              graph is a decision, not a fact.
 *   LEAVES     memories. Dot size is degree; retention is a word in the readout.
 *   ROOTS      every link the tree could not keep, drawn between the same
 *              memories mirrored below the ground line. On this store that is
 *              2,514 of 3,103 links under the strongest-link rule, and 1,528
 *              of them are contradictions: the tree keeps agreement, and the
 *              argument lives underground. Every one of those counts is
 *              printed at the ground line, live from `data`.
 *   GROUND     the 37 memories with no link, on the ground line, unattached.
 *
 * ─── What was refused ──────────────────────────────────────────────────────
 *
 * The reference images print 12,428 memories, 317 topics and branches called
 * "Technology" and "Creativity", with a "core identity" at the base. None of
 * that exists here. No topic names, no core-identity record, no invented
 * figures: every number on this plate is computed from `data` at render. The
 * 5,393 stored links onto archived memories are real and are counted top
 * right, but their far ends are not returned by the API, so they are not
 * drawn — a shape for them would have been fiction. The "LIVE" pill is a
 * read-time stamp instead: the store is read once and is stable for the page.
 *
 * ─── Rules ─────────────────────────────────────────────────────────────────
 *
 * Hue is link kind only; containment is neutral. Strength is the token
 * lightness ramp, and glow is allowed on this set on one condition: every core
 * stroke is painted in a second pass, source-over, above every additive halo,
 * so a filament's centre is always its exact token colour and the three steps
 * stay apart wherever a filament is isolated. Where filaments overlap the
 * halos add up — that brightness IS density, which rule 4 asks to be geometry.
 * No colour literal anywhere; every rgba is derived from a token. Reduced
 * motion renders the settled tree at once with no growth. Only transform and
 * opacity move in the DOM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  linkColor,
  type DemoModule,
  type DemoProps,
  type ObsData,
  type ObsLink,
  type ObsNode,
} from './contract';

// ─── Measurements ───────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
/** The canopy fan, measured from the ground point; 90° is straight up. */
const FAN_START = 20 * DEG;
const FAN_END = 160 * DEG;
const SECTOR_GAP = 1.3 * DEG;
const MIN_SECTOR = 2.4 * DEG;
/** Stems sit at this fraction of the canopy reach; leaves run out to 1. */
const R_IN = 0.36;
/** Where the trunk forks into boughs, as a fraction of reach. */
const FORK = 0.2;
/** depth → radius is concave so the crowded inner levels get room. */
const DEPTH_EXP = 0.72;
const TOP_ROOM = 96;
const SIDE_ROOM = 176;
const BOTTOM_ROOM = 58;
const GROUND_AT = 0.6;
const CALLOUT_OFFSET = 34;
const CALLOUT_WIDTH = 190;
/** Chrome the callouts must keep clear of: the masthead block at top left,
 *  the figures row at top right. Estimated, since a pure layout cannot
 *  measure the DOM; the figure captions are kept short so the estimate holds. */
const MAST_RIGHT = 350;
const MAST_BOTTOM = 246;
const FIGURES_WIDTH = 800;
/** Below this width the figures row wraps to two lines and stands taller. */
const FIGURES_WRAP_AT = FIGURES_WIDTH + 420;
const TEXT_H = 34;
const SEG = 14;
const GROW_MS = 1700;
const HIT_RADIUS = 9;
const SCRIM = 0.74;
const MAX_DPR = 2;

const nf = new Intl.NumberFormat('en-US');
const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((100 * a) / b));

/** A token hex with an alpha, for canvas. The only way a colour is built here. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ─── Louvain ────────────────────────────────────────────────────────────────

interface Weighted {
  s: number;
  t: number;
  w: number;
}

/** Louvain modularity maximisation, weighted by strength, blind to kind, and
 *  deterministic (index order, ties keep the lower id), so the same store
 *  gives the same boughs on every load. */
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
          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best)) {
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

    const merged = new Map<number, number>();
    const next = remap.size;
    for (const e of current) {
      const a = renumbered[e.s]!;
      const b = renumbered[e.t]!;
      const key = a < b ? a * next + b : b * next + a;
      merged.set(key, (merged.get(key) ?? 0) + e.w);
    }
    current = [];
    for (const [key, w] of merged) current.push({ s: Math.floor(key / next), t: key % next, w });
    count = next;
  }
  return membership;
}

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
  for (let c = 0; c < communities; c++) q += (2 * inside[c]!) / m2 - (attached[c]! / m2) ** 2;
  return q;
}

// ─── The reading: communities, named by what they actually hold ─────────────

interface Community {
  /** Louvain id. */
  id: number;
  /** Node indices, linked memories only. */
  members: number[];
  /** The busiest member — the memory the bough is named after. */
  hub: number;
  internal: number;
  internalContradicts: number;
  name: string;
}

interface Reading {
  /** Node → position in `communities` (fan order), −1 for an unlinked memory. */
  slotOf: Int32Array;
  communities: Community[];
  modularity: number;
  cross: number;
  crossContradicts: number;
  /** Incident link indices per node. */
  incident: number[][];
}

/** A memory's text is whatever the writer stored — markdown headers, shouted
 *  capitals, brackets. Strip the markup and calm the capitals; change no word. */
function cleanLabel(raw: string): string {
  let s = raw
    .replace(/[*#_`>[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:\-–—]+$/, '')
    .trim();
  const letters = s.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length > 3 && upper.length / letters.length > 0.8) {
    s = s.charAt(0) + s.slice(1).toLowerCase();
  }
  return s.length > 0 ? s : raw.trim();
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Greedy chain seriation of the communities by shared links, so boughs that
 *  link to each other stand side by side and the crossing roots stay short.
 *  Communities with no link to anything placed go to alternate edges. */
function seriate(k: number, affinity: Float64Array, sizes: readonly number[]): number[] {
  if (k === 0) return [];
  const placed = new Uint8Array(k);
  let first = 0;
  for (let i = 1; i < k; i++) if (sizes[i]! > sizes[first]!) first = i;
  const chain = [first];
  placed[first] = 1;
  let edgeToggle = false;
  while (chain.length < k) {
    const head = chain[0]!;
    const tail = chain[chain.length - 1]!;
    let best = -1;
    let bestW = 0;
    let atTail = true;
    for (let c = 0; c < k; c++) {
      if (placed[c]) continue;
      const wT = affinity[tail * k + c]!;
      const wH = affinity[head * k + c]!;
      if (wT > bestW) {
        best = c;
        bestW = wT;
        atTail = true;
      }
      if (wH > bestW) {
        best = c;
        bestW = wH;
        atTail = false;
      }
    }
    if (best < 0) {
      for (let c = 0; c < k; c++) if (!placed[c] && (best < 0 || sizes[c]! > sizes[best]!)) best = c;
      atTail = edgeToggle;
      edgeToggle = !edgeToggle;
    }
    if (atTail) chain.push(best);
    else chain.unshift(best);
    placed[best] = 1;
  }
  return chain;
}

function readCommunities(data: ObsData): Reading {
  const { nodes, links } = data;
  const n = nodes.length;
  const incident: number[][] = nodes.map(() => []);
  links.forEach((l, i) => {
    incident[l.source]!.push(i);
    incident[l.target]!.push(i);
  });
  const weighted: Weighted[] = links.map((l) => ({ s: l.source, t: l.target, w: l.strength }));
  const membership = louvain(n, weighted);
  const modularity = modularityOf(n, weighted, membership);

  const byId = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (nodes[i]!.degree === 0) continue;
    const id = membership[i]!;
    const list = byId.get(id);
    if (list) list.push(i);
    else byId.set(id, [i]);
  }
  const raw: Community[] = [];
  for (const [id, members] of byId) {
    let hub = members[0]!;
    for (const m of members) if (nodes[m]!.degree > nodes[hub]!.degree) hub = m;
    raw.push({ id, members, hub, internal: 0, internalContradicts: 0, name: cleanLabel(nodes[hub]!.label) });
  }
  const rawIndex = new Map<number, number>();
  raw.forEach((c, i) => rawIndex.set(c.id, i));

  const k = raw.length;
  const affinity = new Float64Array(k * k);
  let cross = 0;
  let crossContradicts = 0;
  for (const l of links) {
    const a = rawIndex.get(membership[l.source]!);
    const b = rawIndex.get(membership[l.target]!);
    if (a === undefined || b === undefined) continue;
    if (a === b) {
      raw[a]!.internal++;
      if (l.kind === 'contradicts') raw[a]!.internalContradicts++;
    } else {
      cross++;
      if (l.kind === 'contradicts') crossContradicts++;
      affinity[a * k + b]! += 1;
      affinity[b * k + a]! += 1;
    }
  }

  const order = seriate(
    k,
    affinity,
    raw.map((c) => c.members.length)
  );
  const communities = order.map((i) => raw[i]!);
  const slotOf = new Int32Array(n).fill(-1);
  communities.forEach((c, slot) => {
    for (const m of c.members) slotOf[m] = slot;
  });
  return { slotOf, communities, modularity, cross, crossContradicts, incident };
}

// ─── The three ways to grow a tree over one graph ───────────────────────────

type Rule = 'strongest' | 'hub' | 'oldest';

const RULES: readonly { id: Rule; name: string; note: string }[] = [
  {
    id: 'strongest',
    name: 'Strongest link',
    note: 'Grown from each community’s busiest memory; every next memory joins by the strongest link into what is already grown.',
  },
  {
    id: 'hub',
    name: 'Nearest hub',
    note: 'Breadth-first from the busiest memory; every memory hangs on the first link that reached it, from the busiest parent that could.',
  },
  {
    id: 'oldest',
    name: 'First written',
    note: 'Every memory hangs on its strongest link to an older memory. A memory with no older neighbour in its community stands as its own stem.',
  },
];

interface Tree {
  /** Node → index of the link it hangs on, −1 for a stem or an unlinked memory. */
  parentLink: Int32Array;
  parentNode: Int32Array;
  /** −1 for an unlinked memory. */
  depth: Int32Array;
  /** Nodes in the subtree, self included. */
  subtree: Int32Array;
  children: number[][];
  /** Stems per community slot. */
  stems: number[][];
  kept: number;
  keptContradicts: number;
  dropped: number[];
  droppedContradicts: number;
  /** Dropped link indices per node. */
  droppedAt: number[][];
  maxDepth: number;
  stemCount: number;
}

function otherEnd(link: ObsLink, v: number): number {
  return link.source === v ? link.target : link.source;
}

function writtenBefore(a: ObsNode, b: ObsNode): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
}

/** Prim's maximum spanning tree by strength, seeded at the busiest member;
 *  ties prefer the shallower attachment, then the lower link index. */
function growStrongest(
  data: ObsData,
  reading: Reading,
  slot: number,
  parentLink: Int32Array,
  depth: Int32Array
): number[] {
  const { nodes, links } = data;
  const community = reading.communities[slot]!;
  const remaining = new Set(community.members);
  const inTree: number[] = [];
  const stems: number[] = [];
  while (remaining.size) {
    let start = -1;
    for (const m of remaining) if (start < 0 || nodes[m]!.degree > nodes[start]!.degree) start = m;
    stems.push(start);
    remaining.delete(start);
    depth[start] = 0;
    inTree.push(start);
    for (;;) {
      let bestLink = -1;
      let bestNode = -1;
      let bestStrength = -1;
      let bestDepth = Infinity;
      for (const v of inTree) {
        for (const li of reading.incident[v]!) {
          const l = links[li]!;
          const o = otherEnd(l, v);
          if (!remaining.has(o)) continue;
          const d = depth[v]!;
          if (
            l.strength > bestStrength + 1e-9 ||
            (Math.abs(l.strength - bestStrength) <= 1e-9 && (d < bestDepth || (d === bestDepth && li < bestLink)))
          ) {
            bestLink = li;
            bestNode = o;
            bestStrength = l.strength;
            bestDepth = d;
          }
        }
      }
      if (bestLink < 0) break;
      parentLink[bestNode] = bestLink;
      depth[bestNode] = bestDepth + 1;
      remaining.delete(bestNode);
      inTree.push(bestNode);
    }
  }
  return stems;
}

/** Breadth-first from the busiest member; within a level the busier parent
 *  claims a child first. */
function growHub(
  data: ObsData,
  reading: Reading,
  slot: number,
  parentLink: Int32Array,
  depth: Int32Array
): number[] {
  const { nodes, links } = data;
  const community = reading.communities[slot]!;
  const remaining = new Set(community.members);
  const stems: number[] = [];
  while (remaining.size) {
    let start = -1;
    for (const m of remaining) if (start < 0 || nodes[m]!.degree > nodes[start]!.degree) start = m;
    stems.push(start);
    remaining.delete(start);
    depth[start] = 0;
    let level = [start];
    while (level.length) {
      level.sort((a, b) => nodes[b]!.degree - nodes[a]!.degree);
      const next: number[] = [];
      for (const v of level) {
        for (const li of reading.incident[v]!) {
          const o = otherEnd(links[li]!, v);
          if (!remaining.has(o)) continue;
          remaining.delete(o);
          parentLink[o] = li;
          depth[o] = depth[v]! + 1;
          next.push(o);
        }
      }
      level = next;
    }
  }
  return stems;
}

/** Each memory hangs on its strongest link to an OLDER member of its community.
 *  Time is a strict order, so this can never cycle; it can leave several stems. */
function growOldest(
  data: ObsData,
  reading: Reading,
  slot: number,
  parentLink: Int32Array,
  depth: Int32Array
): number[] {
  const { nodes, links } = data;
  const community = reading.communities[slot]!;
  const stems: number[] = [];
  for (const v of community.members) {
    let best = -1;
    for (const li of reading.incident[v]!) {
      const l = links[li]!;
      const o = otherEnd(l, v);
      if (reading.slotOf[o] !== slot || !writtenBefore(nodes[o]!, nodes[v]!)) continue;
      if (best < 0 || l.strength > links[best]!.strength) best = li;
    }
    if (best >= 0) parentLink[v] = best;
    else stems.push(v);
  }
  // Depth by walking up; every chain ends at a stem because parents are older.
  const resolve = (v: number): number => {
    if (depth[v]! >= 0) return depth[v]!;
    const p = parentLink[v]!;
    const d = p < 0 ? 0 : resolve(otherEnd(links[p]!, v)) + 1;
    depth[v] = d;
    return d;
  };
  for (const v of community.members) resolve(v);
  return stems;
}

function buildTree(data: ObsData, reading: Reading, rule: Rule): Tree {
  const { nodes, links } = data;
  const n = nodes.length;
  const parentLink = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n).fill(-1);
  const grow = rule === 'strongest' ? growStrongest : rule === 'hub' ? growHub : growOldest;
  const stems = reading.communities.map((_, slot) => grow(data, reading, slot, parentLink, depth));

  const parentNode = new Int32Array(n).fill(-1);
  const children: number[][] = nodes.map(() => []);
  const keptSet = new Uint8Array(links.length);
  let kept = 0;
  let keptContradicts = 0;
  let maxDepth = 0;
  for (let v = 0; v < n; v++) {
    const li = parentLink[v]!;
    if (depth[v]! > maxDepth) maxDepth = depth[v]!;
    if (li < 0) continue;
    const p = otherEnd(links[li]!, v);
    parentNode[v] = p;
    children[p]!.push(v);
    keptSet[li] = 1;
    kept++;
    if (links[li]!.kind === 'contradicts') keptContradicts++;
  }
  const subtree = new Int32Array(n).fill(1);
  const byDepth = Array.from({ length: n }, (_, i) => i)
    .filter((i) => depth[i]! >= 0)
    .sort((a, b) => depth[b]! - depth[a]!);
  for (const v of byDepth) {
    const p = parentNode[v]!;
    if (p >= 0) subtree[p]! += subtree[v]!;
  }
  const dropped: number[] = [];
  const droppedAt: number[][] = nodes.map(() => []);
  let droppedContradicts = 0;
  links.forEach((l, i) => {
    if (keptSet[i]) return;
    dropped.push(i);
    droppedAt[l.source]!.push(i);
    droppedAt[l.target]!.push(i);
    if (l.kind === 'contradicts') droppedContradicts++;
  });
  return {
    parentLink,
    parentNode,
    depth,
    subtree,
    children,
    stems,
    kept,
    keptContradicts,
    dropped,
    droppedContradicts,
    droppedAt,
    maxDepth,
    stemCount: stems.reduce((a, s) => a + s.length, 0),
  };
}

// ─── Geometry ───────────────────────────────────────────────────────────────

type Side = 'left' | 'right' | 'top';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlaps(a: Box, b: Box): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}

interface Callout {
  slot: number;
  /** The anchor: where the leader meets the text. */
  x: number;
  y: number;
  side: Side;
  /** The elbow, just outside the rim on the bough's own mean angle. */
  rimX: number;
  rimY: number;
  /** The ringed memory: the community's busiest member. */
  nodeX: number;
  nodeY: number;
}

interface Layout {
  cx: number;
  groundY: number;
  reach: number;
  sx: number;
  rootScale: number;
  forkY: number;
  /** Canopy positions; NaN for an unlinked memory. */
  x: Float32Array;
  y: Float32Array;
  /** Root positions: the canopy mirrored below the ground line, compressed. */
  ry: Float32Array;
  /** Polyline for the link each node hangs on, SEG+1 points, at node*(SEG+1)*2. */
  poly: Float32Array;
  boughs: { slot: number; pts: Float32Array; width: number }[];
  trunkWidth: number;
  callouts: Callout[];
  ground: { x: number; node: number }[];
  /** The stroke width a kept link is drawn with. */
  linkWidth: Float32Array;
  /** Dot radius per node. */
  dot: Float32Array;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function sampleCubic(
  out: Float32Array,
  at: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): void {
  for (let k = 0; k <= SEG; k++) {
    const t = k / SEG;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out[at + k * 2] = a * x0 + b * x1 + c * x2 + d * x3;
    out[at + k * 2 + 1] = a * y0 + b * y1 + c * y2 + d * y3;
  }
}

function layOut(data: ObsData, reading: Reading, tree: Tree, width: number, height: number): Layout {
  const { nodes } = data;
  const n = nodes.length;
  const cx = width / 2;
  const groundY = Math.round(height * GROUND_AT);
  const reach = Math.max(80, groundY - TOP_ROOM);
  const sx = Math.max(1, Math.min(2.1, (cx - SIDE_ROOM) / (Math.cos(FAN_START) * reach)));
  const rootScale = Math.max(0.3, Math.min(1, (height - groundY - BOTTOM_ROOM) / reach));
  const forkY = groundY - FORK * reach;

  // Sectors: one per community, proportional to size, with a floor so a
  // two-memory community is still a visible twig.
  const k = reading.communities.length;
  const span = FAN_END - FAN_START - SECTOR_GAP * Math.max(0, k - 1);
  const sizes = reading.communities.map((c) => c.members.length);
  const totalSize = sizes.reduce((a, b) => a + b, 0) || 1;
  const rawSector = sizes.map((s) => Math.max(MIN_SECTOR, (span * s) / totalSize));
  const fit = span / (rawSector.reduce((a, b) => a + b, 0) || 1);
  const sector = rawSector.map((s) => s * fit);

  const angle = new Float32Array(n).fill(NaN);
  const assign = (v: number, a0: number, a1: number): void => {
    angle[v] = (a0 + a1) / 2;
    const kids = tree.children[v]!;
    if (kids.length === 0) return;
    const sorted = [...kids].sort((a, b) => tree.subtree[b]! - tree.subtree[a]!);
    const order: number[] = [];
    sorted.forEach((c, i) => (i % 2 === 0 ? order.push(c) : order.unshift(c)));
    const total = order.reduce((s, c) => s + tree.subtree[c]!, 0);
    let a = a0;
    for (const c of order) {
      const w = ((a1 - a0) * tree.subtree[c]!) / total;
      assign(c, a, a + w);
      a += w;
    }
  };
  // The fan runs left→right, which is angle decreasing from FAN_END.
  let a = FAN_END;
  reading.communities.forEach((_, slot) => {
    const a1 = a;
    const a0 = a - sector[slot]!;
    const stems = tree.stems[slot]!;
    const total = stems.reduce((s, v) => s + tree.subtree[v]!, 0) || 1;
    let cursor = a1;
    for (const stem of stems) {
      const w = ((a1 - a0) * tree.subtree[stem]!) / total;
      assign(stem, cursor - w, cursor);
      cursor -= w;
    }
    a = a0 - SECTOR_GAP;
  });

  const maxDepth = Math.max(1, tree.maxDepth);
  const x = new Float32Array(n).fill(NaN);
  const y = new Float32Array(n).fill(NaN);
  const ry = new Float32Array(n).fill(NaN);
  const radius = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const d = tree.depth[v]!;
    if (d < 0) continue;
    const r = reach * (R_IN + (1 - R_IN) * (d / maxDepth) ** DEPTH_EXP);
    radius[v] = r;
    x[v] = cx + r * Math.cos(angle[v]!) * sx;
    y[v] = groundY - r * Math.sin(angle[v]!);
    ry[v] = groundY + (groundY - y[v]!) * rootScale;
  }

  // The link each node hangs on, as d3's radial link: out along the parent's
  // angle, across at the mean radius, in along the child's.
  const poly = new Float32Array(n * (SEG + 1) * 2);
  const biggest = Math.max(1, ...sizes);
  const linkWidth = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const p = tree.parentNode[v]!;
    if (p < 0) continue;
    const rm = (radius[p]! + radius[v]!) / 2;
    const ap = angle[p]!;
    const av = angle[v]!;
    sampleCubic(
      poly,
      v * (SEG + 1) * 2,
      x[p]!,
      y[p]!,
      cx + rm * Math.cos(ap) * sx,
      groundY - rm * Math.sin(ap),
      cx + rm * Math.cos(av) * sx,
      groundY - rm * Math.sin(av),
      x[v]!,
      y[v]!
    );
    linkWidth[v] = 1.2 + 2.6 * Math.sqrt(tree.subtree[v]! / biggest);
  }

  const linked = sizes.reduce((s, c) => s + c, 0);
  const trunkWidth = 2 + 10 * Math.sqrt(linked / Math.max(1, n));
  const boughs: Layout['boughs'] = [];
  reading.communities.forEach((c, slot) => {
    for (const stem of tree.stems[slot]!) {
      const pts = new Float32Array((SEG + 1) * 2);
      const midY = (forkY + y[stem]!) / 2;
      sampleCubic(pts, 0, cx, forkY, cx, midY, x[stem]!, midY, x[stem]!, y[stem]!);
      boughs.push({ slot, pts, width: 1 + 7 * Math.sqrt(tree.subtree[stem]! / Math.max(1, linked)) });
    }
    void c;
  });

  const dot = new Float32Array(n);
  for (let v = 0; v < n; v++) dot[v] = 1.1 + 0.3 * Math.sqrt(nodes[v]!.degree);

  // Callouts for the largest boughs, placed by constraint. A label's text box
  // must lie inside the plate, outside the crown, clear of the masthead, the
  // figures and the ground captions, and clear of every label already placed.
  // Larger boughs are placed first; side labels hug the crown's outline at
  // their own height and slide down it until they are clear; top labels sit
  // above the apex. A bough that cannot be placed cleanly stays unnamed, and
  // the count on the plate says how many were named.
  const labelCount = Math.max(3, Math.min(10, Math.floor(width / 240)));
  const ranked = reading.communities
    .map((c, slot) => ({ slot, size: c.members.length }))
    .sort((p, q) => q.size - p.size)
    .slice(0, labelCount)
    .map((r) => r.slot);
  let cursorA = FAN_END;
  const midAngle = new Float32Array(k);
  reading.communities.forEach((_, slot) => {
    midAngle[slot] = cursorA - sector[slot]! / 2;
    cursorA -= sector[slot]! + SECTOR_GAP;
  });
  const textW = CALLOUT_WIDTH - 10;
  const figuresWrapped = width < FIGURES_WRAP_AT;
  const figuresW = Math.min(FIGURES_WIDTH, width - 420);
  const blocked: Box[] = [
    { x0: 28, y0: 24, x1: MAST_RIGHT, y1: MAST_BOTTOM },
    { x0: width - 28 - figuresW, y0: 26, x1: width - 28, y1: figuresWrapped ? 140 : 76 },
    { x0: 28, y0: groundY - 34, x1: 28 + 440, y1: groundY + 10 },
    { x0: width - 28 - 380, y0: groundY - 34, x1: width - 28, y1: groundY + 10 },
  ];
  const taken: Box[] = [];
  const inCrown = (px: number, py: number): boolean =>
    py < groundY && ((px - cx) / (reach * sx)) ** 2 + ((py - groundY) / reach) ** 2 < 1;
  const clear = (box: Box): boolean =>
    box.x0 >= 8 &&
    box.x1 <= width - 8 &&
    box.y0 >= 8 &&
    box.y1 <= groundY - 6 &&
    !blocked.some((r) => overlaps(box, r)) &&
    !taken.some((r) => overlaps(box, r)) &&
    !inCrown(box.x0, box.y1) &&
    !inCrown(box.x1, box.y1) &&
    !inCrown((box.x0 + box.x1) / 2, box.y1) &&
    !inCrown(box.x0, box.y0) &&
    !inCrown(box.x1, box.y0);
  const boxOf = (side: Side, ax: number, ay: number): Box =>
    side === 'top'
      ? { x0: ax - textW / 2, y0: ay - TEXT_H, x1: ax + textW / 2, y1: ay }
      : side === 'right'
        ? { x0: ax + 6, y0: ay - TEXT_H / 2, x1: ax + 6 + textW, y1: ay + TEXT_H / 2 }
        : { x0: ax - 6 - textW, y0: ay - TEXT_H / 2, x1: ax - 6, y1: ay + TEXT_H / 2 };
  const rimAt = (yy: number, dir: -1 | 1): number => {
    const dy = groundY - yy;
    return cx + dir * (Math.sqrt(Math.max(0, reach * reach - dy * dy)) * sx + 12);
  };
  const callouts: Callout[] = [];
  const accept = (slot: number, side: Side, ax: number, ay: number, th: number): void => {
    taken.push(boxOf(side, ax, ay));
    const hub = reading.communities[slot]!.hub;
    callouts.push({
      slot,
      x: ax,
      y: ay,
      side,
      rimX: cx + (reach + 8) * Math.cos(th) * sx,
      rimY: groundY - (reach + 8) * Math.sin(th),
      nodeX: x[hub]!,
      nodeY: y[hub]!,
    });
  };
  const apexY = groundY - reach - CALLOUT_OFFSET;
  for (const slot of ranked) {
    const th = midAngle[slot]!;
    let placed = false;
    if (th > 76 * DEG && th < 104 * DEG) {
      const nx = cx + (reach + CALLOUT_OFFSET) * Math.cos(th) * sx;
      for (const step of [0, -1, 1]) {
        const ax = nx + step * CALLOUT_WIDTH;
        if (clear(boxOf('top', ax, apexY))) {
          accept(slot, 'top', ax, apexY, th);
          placed = true;
          break;
        }
      }
    }
    if (placed) continue;
    const side: Side = th < 90 * DEG ? 'right' : 'left';
    const dir = side === 'right' ? 1 : -1;
    const natural = groundY - (reach + CALLOUT_OFFSET) * Math.sin(th);
    for (let ay = Math.max(natural, 8 + TEXT_H / 2); ay <= groundY - 24; ay += 8) {
      const rim = rimAt(ay + TEXT_H / 2, dir);
      const ax = side === 'right' ? Math.min(rim, width - 14 - textW) : Math.max(rim, 14 + textW);
      if (clear(boxOf(side, ax, ay))) {
        accept(slot, side, ax, ay, th);
        break;
      }
    }
  }

  // Unlinked memories lie on the ground, in no order: a seeded scatter.
  const random = seeded(0x51ed);
  const half = Math.cos(FAN_START) * reach * sx * 0.92;
  const ground: Layout['ground'] = [];
  for (let v = 0; v < n; v++) {
    if (tree.depth[v]! >= 0) continue;
    ground.push({ x: cx + (random() * 2 - 1) * half, node: v });
  }

  return {
    cx,
    groundY,
    reach,
    sx,
    rootScale,
    forkY,
    x,
    y,
    ry,
    poly,
    boughs,
    trunkWidth,
    callouts,
    ground,
    linkWidth,
    dot,
  };
}

// ─── Painting ───────────────────────────────────────────────────────────────

interface Focus {
  /** Nodes whose parent link is lit. */
  kept: number[];
  /** Dropped link indices lit in the roots. */
  dropped: number[];
  nodes: number[];
  slot: number;
}

interface Scene {
  data: ObsData;
  reading: Reading;
  tree: Tree;
  layout: Layout;
  width: number;
  height: number;
  dpr: number;
  roots: HTMLCanvasElement;
  settled: HTMLCanvasElement | null;
}

function stageF(progress: number, stage: number, stages: number): number {
  return Math.max(0, Math.min(1, progress * stages - stage));
}

function strokePoly(ctx: CanvasRenderingContext2D, poly: Float32Array, at: number, f: number): void {
  const last = f >= 1 ? SEG : f * SEG;
  const whole = Math.floor(last);
  ctx.beginPath();
  ctx.moveTo(poly[at]!, poly[at + 1]!);
  for (let k = 1; k <= whole; k++) ctx.lineTo(poly[at + k * 2]!, poly[at + k * 2 + 1]!);
  const rem = last - whole;
  if (rem > 0 && whole < SEG) {
    const ax = poly[at + whole * 2]!;
    const ay = poly[at + whole * 2 + 1]!;
    const bx = poly[at + whole * 2 + 2]!;
    const by = poly[at + whole * 2 + 3]!;
    ctx.lineTo(ax + (bx - ax) * rem, ay + (by - ay) * rem);
  }
  ctx.stroke();
}

function makeCanvas(width: number, height: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * dpr));
  c.height = Math.max(1, Math.round(height * dpr));
  return c;
}

/** Root-space curve for a dropped link: between the two mirrored memories,
 *  bent toward the mirrored fork so long crossings sweep through the crown. */
function rootPath(ctx: CanvasRenderingContext2D, scene: Scene, link: ObsLink): void {
  const { x, ry, cx, forkY, groundY, rootScale } = scene.layout;
  const fx = cx;
  const fy = groundY + (groundY - forkY) * rootScale;
  const x1 = x[link.source]!;
  const y1 = ry[link.source]!;
  const x2 = x[link.target]!;
  const y2 = ry[link.target]!;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx + (fx - mx) * 0.3, my + (fy - my) * 0.3, x2, y2);
}

/** The roots, painted once per layout: every dropped link, halos in an
 *  additive pass, then every core source-over on top. */
function paintRoots(scene: Scene): void {
  const { roots, dpr, tree, data, layout } = scene;
  const ctx = roots.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 3.4;
  for (const li of tree.dropped) {
    const l = data.links[li]!;
    ctx.strokeStyle = alpha(linkColor(l), 0.05);
    rootPath(ctx, scene, l);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1;
  for (const li of tree.dropped) {
    const l = data.links[li]!;
    ctx.strokeStyle = linkColor(l);
    rootPath(ctx, scene, l);
    ctx.stroke();
  }
  ctx.fillStyle = alpha(PLATE_COLORS.memory, 0.6);
  for (let v = 0; v < data.nodes.length; v++) {
    if (tree.depth[v]! < 0) continue;
    ctx.beginPath();
    ctx.arc(layout.x[v]!, layout.ry[v]!, layout.dot[v]! * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintSkeleton(ctx: CanvasRenderingContext2D, scene: Scene, progress: number, stages: number): void {
  const { layout } = scene;
  const { cx, groundY, forkY, rootScale } = layout;
  const trunkF = stageF(progress, 0, stages);
  const boughF = stageF(progress, 1, stages);
  const mirrorY = (yy: number): number => groundY + (groundY - yy) * rootScale;
  ctx.lineCap = 'round';

  const trunk = (): void => {
    // Above ground, then its mirror below: the root crown is the same containment.
    ctx.beginPath();
    ctx.moveTo(cx, groundY);
    ctx.lineTo(cx, groundY - (groundY - forkY) * trunkF);
    ctx.moveTo(cx, groundY);
    ctx.lineTo(cx, groundY + (groundY - forkY) * rootScale * trunkF);
    ctx.stroke();
  };
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = alpha(PLATE_COLORS.ink3, 0.1);
  ctx.lineWidth = layout.trunkWidth + 8;
  trunk();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = alpha(PLATE_COLORS.memory, 0.85);
  ctx.lineWidth = layout.trunkWidth;
  trunk();

  if (boughF <= 0) return;
  for (const b of layout.boughs) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alpha(PLATE_COLORS.ink3, 0.08);
    ctx.lineWidth = b.width + 5;
    strokePoly(ctx, b.pts, 0, boughF);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = alpha(PLATE_COLORS.memory, 0.8);
    ctx.lineWidth = b.width;
    strokePoly(ctx, b.pts, 0, boughF);
    // The mirrored bough, thinner and quieter.
    ctx.strokeStyle = alpha(PLATE_COLORS.memory, 0.45);
    ctx.lineWidth = Math.max(0.8, b.width * 0.7);
    ctx.beginPath();
    for (let k = 0; k <= SEG; k++) {
      const px = b.pts[k * 2]!;
      const py = mirrorY(b.pts[k * 2 + 1]!);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function paintCanopy(ctx: CanvasRenderingContext2D, scene: Scene, progress: number, stages: number): void {
  const { data, tree, layout } = scene;
  const n = data.nodes.length;
  ctx.lineCap = 'round';
  // Pass one: every halo, additive.
  ctx.globalCompositeOperation = 'lighter';
  for (let v = 0; v < n; v++) {
    const li = tree.parentLink[v]!;
    if (li < 0) continue;
    const f = stageF(progress, tree.depth[v]! + 1, stages);
    if (f <= 0) continue;
    const colour = linkColor(data.links[li]!);
    const w = layout.linkWidth[v]!;
    ctx.strokeStyle = alpha(colour, 0.07);
    ctx.lineWidth = w + 6;
    strokePoly(ctx, layout.poly, v * (SEG + 1) * 2, f);
    ctx.strokeStyle = alpha(colour, 0.13);
    ctx.lineWidth = w + 2.5;
    strokePoly(ctx, layout.poly, v * (SEG + 1) * 2, f);
  }
  // Pass two: every core, source-over, so a filament's centre is its token.
  ctx.globalCompositeOperation = 'source-over';
  for (let v = 0; v < n; v++) {
    const li = tree.parentLink[v]!;
    if (li < 0) continue;
    const f = stageF(progress, tree.depth[v]! + 1, stages);
    if (f <= 0) continue;
    ctx.strokeStyle = linkColor(data.links[li]!);
    ctx.lineWidth = layout.linkWidth[v]!;
    strokePoly(ctx, layout.poly, v * (SEG + 1) * 2, f);
  }
}

function paintLeaves(ctx: CanvasRenderingContext2D, scene: Scene, progress: number, stages: number): void {
  const { data, tree, layout, reading } = scene;
  const n = data.nodes.length;
  ctx.globalCompositeOperation = 'source-over';
  for (let v = 0; v < n; v++) {
    const d = tree.depth[v]!;
    if (d < 0) continue;
    const f = d === 0 ? stageF(progress, 1, stages) : stageF(progress, d + 1, stages);
    if (f < 1) continue;
    const r = layout.dot[v]!;
    const isStem = tree.parentLink[v]! < 0;
    const isHub = reading.communities[reading.slotOf[v]!]?.hub === v;
    if (isStem || isHub) {
      ctx.fillStyle = alpha(PLATE_COLORS.ink, 0.16);
      ctx.beginPath();
      ctx.arc(layout.x[v]!, layout.y[v]!, r * 3 + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PLATE_COLORS.memoryLive;
      ctx.beginPath();
      ctx.arc(layout.x[v]!, layout.y[v]!, r + 0.9, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = alpha(PLATE_COLORS.memory, 0.92);
      ctx.beginPath();
      ctx.arc(layout.x[v]!, layout.y[v]!, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintGround(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { layout, width } = scene;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = PLATE_COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, layout.groundY + 0.5);
  ctx.lineTo(width - 24, layout.groundY + 0.5);
  ctx.stroke();
  ctx.fillStyle = alpha(PLATE_COLORS.memory, 0.9);
  for (const g of layout.ground) {
    ctx.beginPath();
    ctx.arc(g.x, layout.groundY + 0.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintFrame(ctx: CanvasRenderingContext2D, scene: Scene, progress: number): void {
  const { dpr, width, height, tree } = scene;
  const stages = tree.maxDepth + 3;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  paintGround(ctx, scene);
  paintSkeleton(ctx, scene, progress, stages);
  paintCanopy(ctx, scene, progress, stages);
  paintLeaves(ctx, scene, progress, stages);
  const rootAlpha = Math.max(0, Math.min(1, (progress - 0.4) / 0.5));
  if (rootAlpha > 0) {
    ctx.globalAlpha = rootAlpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scene.roots, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }
}

function paintFocus(ctx: CanvasRenderingContext2D, scene: Scene, focus: Focus, selected: number): void {
  const { data, tree, layout, dpr } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = alpha(PLATE_COLORS.plate, SCRIM);
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.lineCap = 'round';

  // The containment this focus hangs from.
  const { cx, groundY, forkY } = layout;
  ctx.strokeStyle = alpha(PLATE_COLORS.ink2, 0.7);
  ctx.lineWidth = Math.max(1, layout.trunkWidth * 0.5);
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.lineTo(cx, forkY);
  ctx.stroke();
  for (const b of layout.boughs) {
    if (b.slot !== focus.slot) continue;
    ctx.lineWidth = Math.max(1, b.width * 0.7);
    strokePoly(ctx, b.pts, 0, 1);
  }

  const lit = (li: number, halo: number, core: number, draw: () => void): void => {
    const colour = linkColor(data.links[li]!);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alpha(colour, 0.16);
    ctx.lineWidth = halo;
    draw();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = colour;
    ctx.lineWidth = core;
    draw();
  };
  for (const v of focus.kept) {
    const li = tree.parentLink[v]!;
    if (li < 0) continue;
    const w = layout.linkWidth[v]!;
    lit(li, w + 6, w + 0.4, () => strokePoly(ctx, layout.poly, v * (SEG + 1) * 2, 1));
  }
  for (const li of focus.dropped) {
    const l = data.links[li]!;
    lit(li, 5, 1.4, () => {
      rootPath(ctx, scene, l);
      ctx.stroke();
    });
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const v of focus.nodes) {
    const r = layout.dot[v]!;
    ctx.fillStyle = PLATE_COLORS.memoryLive;
    ctx.beginPath();
    ctx.arc(layout.x[v]!, layout.y[v]!, r + 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = alpha(PLATE_COLORS.memoryLive, 0.75);
    ctx.beginPath();
    ctx.arc(layout.x[v]!, layout.ry[v]!, r * 0.7 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (selected >= 0 && tree.depth[selected]! >= 0) {
    ctx.strokeStyle = PLATE_COLORS.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(layout.x[selected]!, layout.y[selected]!, layout.dot[selected]! + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function focusOfNode(v: number, tree: Tree, reading: Reading): Focus {
  const kept: number[] = [];
  const nodes = [v];
  let cursor = v;
  while (tree.parentNode[cursor]! >= 0) {
    kept.push(cursor);
    cursor = tree.parentNode[cursor]!;
    nodes.push(cursor);
  }
  for (const c of tree.children[v]!) {
    kept.push(c);
    nodes.push(c);
  }
  return { kept, dropped: tree.droppedAt[v]!, nodes, slot: reading.slotOf[v]! };
}

function focusOfSlot(slot: number, tree: Tree, reading: Reading, data: ObsData): Focus {
  const members = reading.communities[slot]!.members;
  const kept = members.filter((m) => tree.parentLink[m]! >= 0);
  const dropped = tree.dropped.filter(
    (li) => reading.slotOf[data.links[li]!.source] === slot || reading.slotOf[data.links[li]!.target] === slot
  );
  return { kept, dropped, nodes: members, slot };
}

// ─── The plate ──────────────────────────────────────────────────────────────

type Hover = { kind: 'node'; node: number; half: 'canopy' | 'root' } | { kind: 'slot'; slot: number };

const CSS = `
.mt { position: absolute; inset: 0; overflow: hidden; font-family: var(--font-instrument); color: var(--ink); }
.mt-canvas { position: absolute; inset: 0; display: block; cursor: default; }
.mt-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.mt-caps { font-size: 11px; line-height: 1.2; letter-spacing: 0.16em; text-transform: uppercase; font-stretch: 88%; font-weight: 400; color: var(--ink-3); white-space: nowrap; }
.mt-caps b { font-weight: 500; color: var(--ink-2); }
.mt-corner { position: absolute; pointer-events: none; }
.mt-title { font-family: var(--font-note); font-weight: 200; font-size: 36px; line-height: 1; letter-spacing: -0.005em; color: var(--ink); margin: 0; }
.mt-sub { margin-top: 9px; }
.mt-bar { display: flex; height: 2px; width: 64px; margin-top: 9px; gap: 2px; }
.mt-bar i { display: block; height: 100%; }
.mt-key { display: flex; flex-direction: column; gap: 9px; margin-top: 22px; }
.mt-key-row { display: flex; align-items: center; gap: 10px; }
.mt-key-row svg { width: 34px; height: 12px; flex: 0 0 auto; overflow: visible; }
.mt-figures { display: flex; align-items: flex-start; flex-wrap: wrap; justify-content: flex-end; row-gap: 14px; max-width: calc(100% - 420px); pointer-events: none; }
.mt-cell { padding: 2px 16px 0; border-left: 1px solid var(--rule); }
.mt-cell:first-child { border-left: 0; padding-left: 0; }
.mt-figure { font-size: 27px; font-weight: 400; line-height: 1; letter-spacing: -0.015em; color: var(--ink); font-variant-numeric: proportional-nums; }
.mt-cell .mt-caps { margin-top: 7px; letter-spacing: 0.12em; font-stretch: 82%; }
.mt-pill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px 4px 8px; border: 1px solid var(--rule); border-radius: 999px; margin-left: 18px; margin-top: 4px; }
.mt-pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-2); display: block; }
.mt-pill .mt-caps { letter-spacing: 0.14em; }
.mt-switch { position: absolute; left: 28px; bottom: 26px; display: flex; flex-direction: column; gap: 7px; max-width: 320px; }
.mt-switch .mt-caps { margin-bottom: 3px; }
.mt-radio { display: flex; align-items: center; gap: 10px; color: var(--ink-2); font-size: 13px; line-height: 1.2; text-align: left; transition: color var(--dur) var(--ease); }
.mt-radio:hover { color: var(--ink); }
.mt-radio[aria-checked='true'] { color: var(--ink); }
.mt-radio i { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--ink-3); display: block; flex: 0 0 auto; transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease); }
.mt-radio[aria-checked='true'] i { background: var(--ink); border-color: var(--ink); }
.mt-rule-note { font-size: 11.5px; line-height: 1.45; color: var(--ink-3); margin-top: 4px; max-width: 34ch; }
.mt-tag { position: absolute; right: 28px; bottom: 30px; text-align: right; pointer-events: none; }
.mt-groundnote { position: absolute; pointer-events: none; }
.mt-callout { position: absolute; left: 0; top: 0; width: ${CALLOUT_WIDTH - 10}px; pointer-events: auto; cursor: default; }
.mt-callout.right { text-align: left; }
.mt-callout.left { text-align: right; }
.mt-callout.top { text-align: center; }
.mt-name { font-size: 13px; line-height: 1.25; font-weight: 400; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-callout .mt-caps { margin-top: 3px; display: flex; gap: 12px; }
.mt-callout.left .mt-caps { justify-content: flex-end; }
.mt-callout.top .mt-caps { justify-content: center; }
.mt-tip { position: absolute; left: 0; top: 0; pointer-events: none; background: var(--plate); border: 1px solid var(--rule); padding: 7px 10px 8px; max-width: 300px; }
.mt-tip .mt-name { white-space: normal; }
.mt-tip .mt-caps { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 12px; white-space: normal; }
.mt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

function KeySwatch({ kind }: { kind: 'agrees' | 'contradicts' | 'containment' | 'roots' }) {
  // The ramp as drawn: three steps, each with the same halo the canvas paints.
  const steps =
    kind === 'agrees'
      ? ['var(--agrees-weak)', 'var(--agrees-mid)', 'var(--agrees-strong)']
      : kind === 'contradicts'
        ? ['var(--contradicts-weak)', 'var(--contradicts-mid)', 'var(--contradicts-strong)']
        : kind === 'roots'
          ? ['var(--contradicts-weak)', 'var(--agrees-strong)', 'var(--contradicts-mid)']
          : ['var(--memory)'];
  const filter = `mt-halo-${kind}`;
  return (
    <svg viewBox="0 0 34 12" aria-hidden>
      <defs>
        <filter id={filter} x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {steps.map((c, i) => {
        const w = 34 / steps.length;
        const x1 = i * w + 1;
        const x2 = (i + 1) * w - 1;
        const y = kind === 'roots' ? 6 + (i - 1) * 2.5 : 6;
        const width = kind === 'containment' ? 3 : kind === 'roots' ? 1 : 1.5;
        return (
          <g key={i}>
            <line x1={x1} y1={y} x2={x2} y2={y} stroke={c} strokeWidth={width + 3} strokeOpacity={0.35} filter={`url(#${filter})`} style={{ mixBlendMode: 'plus-lighter' }} />
            <line x1={x1} y1={y} x2={x2} y2={y} stroke={c} strokeWidth={width} strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const [rule, setRule] = useState<Rule>('strongest');
  const [hover, setHover] = useState<Hover | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const progressRef = useRef(1);
  const frameRef = useRef(0);
  /** The latest painter, so the growth loop never paints a stale focus. */
  const paintRef = useRef<(progress: number) => void>(() => undefined);
  /** When this plate was drawn. The store was read once, at page load, and
   *  is stable for the life of the page; there is no live feed to claim. */
  const readAt = useMemo(() => new Date(), []);

  const reading = useMemo(() => readCommunities(data), [data]);
  const tree = useMemo(() => buildTree(data, reading, rule), [data, reading, rule]);
  const layout = useMemo(() => layOut(data, reading, tree, width, height), [data, reading, tree, width, height]);
  const selected = useMemo(() => (selectedId ? data.nodes.findIndex((n) => n.id === selectedId) : -1), [data, selectedId]);

  const focus = useMemo<Focus | null>(() => {
    if (hover?.kind === 'node') return focusOfNode(hover.node, tree, reading);
    if (hover?.kind === 'slot') return focusOfSlot(hover.slot, tree, reading, data);
    if (selected >= 0 && tree.depth[selected]! >= 0) return focusOfNode(selected, tree, reading);
    return null;
  }, [hover, selected, tree, reading, data]);

  // Paint one frame: the settled tree from cache, or a growth frame, then focus.
  const paint = useCallback(
    (progress: number) => {
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!scene || !canvas || !ctx) return;
      if (progress >= 1) {
        if (!scene.settled) {
          scene.settled = makeCanvas(scene.width, scene.height, scene.dpr);
          const sctx = scene.settled.getContext('2d');
          if (sctx) paintFrame(sctx, scene, 1);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(scene.settled, 0, 0);
      } else {
        paintFrame(ctx, scene, progress);
      }
      if (focus && progress >= 1) paintFocus(ctx, scene, focus, selected);
    },
    [focus, selected]
  );
  paintRef.current = paint;

  // A new layout: rebuild the caches, then grow (or, reduced, settle at once).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const scene: Scene = {
      data,
      reading,
      tree,
      layout,
      width,
      height,
      dpr,
      roots: makeCanvas(width, height, dpr),
      settled: null,
    };
    paintRoots(scene);
    sceneRef.current = scene;
    cancelAnimationFrame(frameRef.current);
    if (reducedMotion) {
      progressRef.current = 1;
      paintRef.current(1);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const p = easeOutCubic(Math.min(1, (now - start) / GROW_MS));
      progressRef.current = p;
      paintRef.current(p);
      if (p < 1) frameRef.current = requestAnimationFrame(tick);
    };
    progressRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [data, reading, tree, layout, width, height, reducedMotion]);

  useEffect(() => {
    if (progressRef.current >= 1) paint(1);
  }, [paint]);

  const hitTest = useCallback(
    (px: number, py: number): Hover | null => {
      let best = -1;
      let bestD = HIT_RADIUS * HIT_RADIUS;
      let half: 'canopy' | 'root' = 'canopy';
      for (let v = 0; v < data.nodes.length; v++) {
        if (tree.depth[v]! < 0) continue;
        const dx = layout.x[v]! - px;
        const dc = dx * dx + (layout.y[v]! - py) ** 2;
        if (dc < bestD) {
          bestD = dc;
          best = v;
          half = 'canopy';
        }
        const dr = dx * dx + (layout.ry[v]! - py) ** 2;
        if (dr < bestD) {
          bestD = dr;
          best = v;
          half = 'root';
        }
      }
      return best < 0 ? null : { kind: 'node', node: best, half };
    },
    [data, tree, layout]
  );

  const onMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const next = hitTest(px, py);
      if (next) setPointer({ x: px, y: py });
      setHover((prev) => {
        if (prev?.kind === 'node' && next?.kind === 'node' && prev.node === next.node && prev.half === next.half) return prev;
        if (!prev && !next) return prev;
        return next;
      });
    },
    [hitTest]
  );

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = hitTest(event.clientX - rect.left, event.clientY - rect.top);
      onSelect(hit?.kind === 'node' ? data.nodes[hit.node]!.id : null);
    },
    [hitTest, onSelect, data]
  );

  const { stats } = data;
  const linked = reading.communities.reduce((s, c) => s + c.members.length, 0);
  const keptAgrees = tree.kept - tree.keptContradicts;
  const droppedAgrees = tree.dropped.length - tree.droppedContradicts;
  const activeRule = RULES.find((r) => r.id === rule) ?? RULES[0]!;
  const hoveredNode = hover?.kind === 'node' ? data.nodes[hover.node]! : null;
  const hoveredLink = hover?.kind === 'node' && tree.parentLink[hover.node]! >= 0 ? data.links[tree.parentLink[hover.node]!]! : null;
  const readTime = `${String(readAt.getHours()).padStart(2, '0')}:${String(readAt.getMinutes()).padStart(2, '0')}`;
  const selectedNode = selected >= 0 ? data.nodes[selected]! : null;
  const selectedOnTree = selected >= 0 && tree.depth[selected]! >= 0;

  const tipX = Math.min(width - 310, pointer.x + 16);
  const tipY = pointer.y > height - 90 ? pointer.y - 70 : pointer.y + 14;

  return (
    <div className="mt">
      <style>{CSS}</style>
      <canvas
        ref={canvasRef}
        className="mt-canvas"
        style={{ width, height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        aria-hidden
      />

      {/* Leaders and rings: hairlines in the DOM so they stay crisp at any DPR. */}
      <svg className="mt-svg" aria-hidden>
        {layout.callouts.map((c) => {
          const dx = c.rimX - c.nodeX;
          const dy = c.rimY - c.nodeY;
          const len = Math.hypot(dx, dy) || 1;
          const sx0 = c.nodeX + (dx / len) * 6;
          const sy0 = c.nodeY + (dy / len) * 6;
          const lit = hover?.kind === 'slot' && hover.slot === c.slot;
          return (
            <g key={c.slot} style={{ opacity: lit ? 1 : 0.7, transition: 'opacity var(--dur) var(--ease)' }}>
              <polyline
                points={`${sx0},${sy0} ${c.rimX},${c.rimY} ${c.x},${c.y}`}
                fill="none"
                stroke="var(--ink-3)"
                strokeWidth={1}
              />
              <circle cx={c.nodeX} cy={c.nodeY} r={5} fill="none" stroke={lit ? 'var(--ink)' : 'var(--ink-2)'} strokeWidth={1} />
            </g>
          );
        })}
        {selectedNode && selectedOnTree ? (
          <g>
            <line
              x1={layout.x[selected]! + 10}
              y1={layout.y[selected]! - 10}
              x2={layout.x[selected]! + 34}
              y2={layout.y[selected]! - 34}
              stroke="var(--ink-2)"
              strokeWidth={1}
            />
          </g>
        ) : null}
      </svg>

      {/* Bough callouts: the busiest member's own words, and the real size. */}
      {layout.callouts.map((c) => {
        const community = reading.communities[c.slot]!;
        const textW = CALLOUT_WIDTH - 10;
        const tx = c.side === 'right' ? c.x + 6 : c.side === 'left' ? c.x - 6 - textW : c.x - textW / 2;
        const ty = c.side === 'top' ? c.y - TEXT_H : c.y - TEXT_H / 2;
        return (
          <div
            key={c.slot}
            className={`mt-callout ${c.side}`}
            style={{ transform: `translate(${tx}px, ${ty}px)` }}
            onPointerEnter={() => setHover({ kind: 'slot', slot: c.slot })}
            onPointerLeave={() => setHover(null)}
          >
            <div className="mt-name" title={cleanLabel(data.nodes[community.hub]!.label)}>
              {shorten(community.name, 34)}
            </div>
            <div className="mt-caps">
              <span>{nf.format(community.members.length)} memories</span>
              <span>{pct(community.internalContradicts, community.internal)}% contradict</span>
            </div>
          </div>
        );
      })}

      {/* The selected memory, named where it stands. */}
      {selectedNode && selectedOnTree ? (
        <div
          className="mt-callout right"
          style={{ transform: `translate(${layout.x[selected]! + 38}px, ${layout.y[selected]! - 52}px)` }}
        >
          <div className="mt-name" title={cleanLabel(selectedNode.label)}>
            {shorten(cleanLabel(selectedNode.label), 34)}
          </div>
          <div className="mt-caps">
            <span>{selectedNode.type}</span>
            <span>{RETENTION_LABEL[selectedNode.retentionBand]}</span>
            <span>{selectedNode.degree} links</span>
          </div>
        </div>
      ) : null}

      {/* Top left: the masthead, its key, the ramp as drawn. */}
      <div className="mt-corner" style={{ left: 28, top: 24 }}>
        <h2 className="mt-title">Memory tree</h2>
        <div className="mt-caps mt-sub">A spanning tree over the link graph</div>
        <div className="mt-bar" aria-hidden>
          <i style={{ flex: keptAgrees, background: 'var(--agrees)' }} />
          <i style={{ flex: Math.max(tree.keptContradicts, 1), background: 'var(--contradicts)' }} />
        </div>
        <div className="mt-key">
          <div className="mt-key-row">
            <KeySwatch kind="agrees" />
            <span className="mt-caps">
              Agrees <b>{nf.format(keptAgrees)}</b> in the tree
            </span>
          </div>
          <div className="mt-key-row">
            <KeySwatch kind="contradicts" />
            <span className="mt-caps">
              Contradicts <b>{nf.format(tree.keptContradicts)}</b> in the tree
            </span>
          </div>
          <div className="mt-key-row">
            <KeySwatch kind="containment" />
            <span className="mt-caps">Trunk and boughs, containment</span>
          </div>
          <div className="mt-key-row">
            <KeySwatch kind="roots" />
            <span className="mt-caps">
              Roots, the <b>{nf.format(tree.dropped.length)}</b> links dropped
            </span>
          </div>
        </div>
      </div>

      {/* Top right: the denominators, every one from `data`. */}
      <div className="mt-corner mt-figures" style={{ right: 28, top: 26 }}>
        <div className="mt-cell">
          <div className="mt-figure">{nf.format(stats.memories)}</div>
          <div className="mt-caps">memories</div>
        </div>
        <div className="mt-cell">
          <div className="mt-figure">{nf.format(tree.kept)}</div>
          <div className="mt-caps">kept of {nf.format(stats.linksDrawn)} links</div>
        </div>
        <div className="mt-cell">
          <div className="mt-figure">{nf.format(tree.dropped.length)}</div>
          <div className="mt-caps">dropped to roots</div>
        </div>
        <div className="mt-cell">
          <div className="mt-figure">{nf.format(stats.linksToArchived)}</div>
          <div className="mt-caps">archived, not drawn</div>
        </div>
        <div className="mt-pill">
          <i aria-hidden />
          <span className="mt-caps">Drawn {readTime}</span>
        </div>
      </div>

      {/* The ground line, captioned at both ends with what lies above and below. */}
      <div className="mt-groundnote mt-caps" style={{ left: 28, top: layout.groundY - 30, lineHeight: 1.5 }}>
        <div>
          Above <b>{nf.format(tree.kept)}</b> kept, {nf.format(keptAgrees)} agree, {nf.format(tree.keptContradicts)} contradict
        </div>
        <div style={{ marginTop: 12 }}>
          Below <b>{nf.format(tree.dropped.length)}</b> dropped, {nf.format(droppedAgrees)} agree, {nf.format(tree.droppedContradicts)}{' '}
          contradict, {nf.format(reading.cross)} cross communities
        </div>
      </div>
      <div className="mt-groundnote mt-caps" style={{ right: 28, top: layout.groundY - 30, textAlign: 'right', lineHeight: 1.5 }}>
        <div>
          Trunk <b>{nf.format(linked)}</b> linked memories, {nf.format(tree.stemCount)} stems
        </div>
        <div style={{ marginTop: 12 }}>
          Ground <b>{nf.format(layout.ground.length)}</b> with no link, in no order
        </div>
      </div>

      {/* Bottom left: which tree. */}
      <div className="mt-switch" role="radiogroup" aria-label="How the tree is grown">
        <div className="mt-caps">Tree by</div>
        {RULES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            className="mt-radio"
            aria-checked={r.id === rule}
            onClick={() => setRule(r.id)}
          >
            <i aria-hidden />
            <span>{r.name}</span>
          </button>
        ))}
        <p className="mt-rule-note" style={{ margin: 0 }}>
          {activeRule.note} Deepest branch {tree.maxDepth} links.
        </p>
      </div>

      {/* Bottom right: the method, quietly. */}
      <div className="mt-tag mt-caps" style={{ lineHeight: 1.5 }}>
        <div>
          {nf.format(reading.communities.length)} communities by Louvain, modularity {reading.modularity.toFixed(3)}, ordered by
          shared links
        </div>
        <div>
          {nf.format(layout.callouts.length)} {layout.callouts.length === 1 ? 'bough' : 'boughs'} named, every bough on hover
        </div>
      </div>

      {/* The memory under the pointer. */}
      {hoveredNode && hover?.kind === 'node' ? (
        <div className="mt-tip" style={{ transform: `translate(${Math.max(8, tipX)}px, ${tipY}px)` }}>
          <div className="mt-name">{shorten(cleanLabel(hoveredNode.label), 96)}</div>
          <div className="mt-caps">
            <span>{hoveredNode.type}</span>
            <span>{RETENTION_LABEL[hoveredNode.retentionBand]}</span>
            <span>{hoveredNode.degree} links</span>
            {hoveredLink ? (
              <span>
                hangs on {hoveredLink.kind === 'agrees' ? 'agrees' : 'contradicts'} {hoveredLink.strength.toFixed(2)}
              </span>
            ) : (
              <span>stem</span>
            )}
            <span>{tree.droppedAt[hover.node]!.length} in the roots</span>
            <span>bough: {shorten(reading.communities[reading.slotOf[hover.node]!]?.name ?? '', 24)}</span>
          </div>
        </div>
      ) : null}

      <p className="mt-sr">
        A tree grown over the link graph by the {activeRule.name.toLowerCase()} rule: {nf.format(linked)} linked memories in{' '}
        {nf.format(reading.communities.length)} communities, {nf.format(tree.kept)} links kept and {nf.format(tree.dropped.length)}{' '}
        drawn as roots below the ground line. {nf.format(stats.isolated)} memories have no link.
      </p>
    </div>
  );
}

export const memoryTree: DemoModule = {
  id: 'tree',
  name: 'Memory Tree',
  dimension: 'Hybrid',
  claim:
    'A tree holds this graph only by dropping most of its links; drawing the dropped ones as the roots keeps the hierarchy honest and shows where the argument lives.',
  Plate,
};
