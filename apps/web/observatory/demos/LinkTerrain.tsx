/**
 * SLOT 9 — three dimensions.  "Terrain of connection."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Cosmos, Neural Net and Clusters all drew 3,101 links as 3,101 hairs inside a
 * point cloud, and the store's own numbers say that can never resolve: linked
 * memories sit a few units apart in a projection tens of units wide, so every
 * link is a short chord buried in the densest part of the cloud.
 *
 * This slot stops drawing links one at a time. It accumulates them into a
 * CONTINUOUS SURFACE and asks the viewer to look ACROSS it:
 *
 *     height(p) = the number of drawn links whose path passes within R of p
 *
 * That is the contract's rule 4 taken literally. Density may not be a
 * background wash — a link on the densest step of a plate-family wash measures
 * 1.73:1, under the 3:1 mark floor — so density is carried by GEOMETRY. Height
 * is geometry. A ridge is a neighbourhood where connection accumulates; a flat
 * is a neighbourhood where it does not.
 *
 * ─── The ground, and why it is this one ────────────────────────────────────
 *
 * The surface stands over PC1 × PC2 of the server's projection. That was not
 * the assumption — it was the measurement. The alternative the brief allows,
 * a ground derived from the links themselves, was built and rejected:
 *
 *   pivot MDS over graph-hop distance (60 max-min pivots, classical scaling)
 *     ONE massif. Half the accumulated height inside 0.62% of the square,
 *     26.8% of the square carrying anything at all, one local maximum above
 *     4% of the peak.
 *
 *   the projection, PC1 × PC2
 *     SEVENTEEN local maxima above 4% of the peak, 51.6% of the square
 *     carrying something, half the height inside 2.8%.
 *
 * A landscape needs more than one landform. Graph-distance MDS collapses a
 * store with a 15-hop diameter and one dense core into a spike on a plain,
 * and a spike is the cloud-in-a-void problem again with extra steps. The
 * projection, weak as it is, is the only ground here that has terrain on it.
 *
 * Its weakness is on screen, not in this comment: the three-component PCA
 * keeps 38% of the embedding and this ground uses two of its three axes, and
 * linked memories sit ~5.4 apart against ~37 for a random pair. The key sheet
 * states both. The piling is not incidental — it is what the height is
 * measuring — but it means the FOOTPRINT is a third of an explanation while
 * the HEIGHT is a complete count.
 *
 * ─── Not a heatmap wearing a costume ───────────────────────────────────────
 *
 * A terrain lit by a colour ramp keyed to height fails exactly the measurement
 * rule 4 fails. So:
 *
 *   • The surface has NO hue. It is `--rule`, shaded by a fixed-azimuth
 *     Lambertian hillshade computed per vertex from the SLOPE. Shading is
 *     slope; the value is the height and the contour rings. The lit band is
 *     clamped to k ∈ [0.35, 2.0] of `--rule` — measured, that is #0f1717 to
 *     #2e3e3f, across which `--memory` holds 3.24–5.27:1 and `--ink-3`
 *     3.29–5.35:1, so every mark that lies on the land clears the 3:1 floor.
 *
 *   • Quantity is read off labelled CONTOUR RINGS at real link counts, the way
 *     a topographic map is read. Their spacing is the gradient.
 *
 *   • Hue appears in exactly one place at rest: the two-part chip beside each
 *     summit in the register, on `--margin`, where `--agrees` and
 *     `--contradicts` measure 4.13:1 and 3.98:1. It carries what height cannot
 *     — the AGREE/CONTRADICT MIX of a feature. On this store that mix is the
 *     find: the one massif is ~61% contradictions, and the separate hills a
 *     tenth its height are 8–16%. Height alone would have said they were the
 *     same kind of place, smaller.
 *
 * Measured, that restraint is forced rather than tasteful. Against the
 * brightest lit facet the weak strength steps reach 2.26:1 and 2.17:1. A link
 * cannot be drawn on lit ground at all.
 *
 * ─── Getting from a ridge back to an actual link ───────────────────────────
 *
 * A surface aggregates, so at rest no individual link exists. Three cuts, each
 * narrower than the last:
 *
 *   1. HOVER anywhere — the readout names the links standing over that patch
 *      and their split. Answers "where", with the real number.
 *   2. CLICK the ground, or a row of the register — a core sample. Every link
 *      in that disc or that summit's basin is drawn as a strand DRAPED over
 *      the relief it built, in its own hue and strength step. The ridge
 *      visibly decomposes into the links it is made of.
 *   3. CLICK a memory — its own links drape, and the readout lists them by
 *      name: kind, strength, and the label at the far end. That is a single
 *      named link, which is as far down as this view goes.
 *
 * Cutting a sample DIMS the land to k ∈ [0.16, 0.30] — at or under `--plate`.
 * That is not a mood: it is the only ground the three-step strength ramp was
 * validated against (3.06–6.18:1), and on lit terrain the weak steps fall
 * under 3:1. You cannot have lit relief and legible links at once, so the
 * sample chooses the links and the landform stays as a contour drawing.
 *
 * ─── What is deliberately not here ─────────────────────────────────────────
 *
 * No bloom, and tone mapping is set to NoToneMapping rather than inherited —
 * R3F's ACES default would move every ratio measured above.
 * No autorotation, no simulation, no entrance. Nothing in this file animates,
 * so the reduced-motion path and the normal path render the identical frame;
 * only OrbitControls' inertia is gated.
 * No fog. Fading a mark toward `--plate` walks it down through the floor the
 * token layer measured against that exact ground.
 * No colour on the surface, at any height, for any reason.
 *
 * ─── Where this could be wrong ─────────────────────────────────────────────
 *
 * The massif is 83 memories inside one sample radius. Picking an individual
 * memory in there is a lottery — the ground is the honest handle at that
 * scale, and the register is the honest index. If the owner's real question is
 * "show me this link", this is the wrong view and slot 1 or 3 is the right one.
 * And the footprint is still the weak projection: two neighbourhoods that
 * share a ridge share it because PCA put them there, which is a claim about
 * 38% of the embedding.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type ObsData,
} from './contract';

// ─── The encoding, as constants ─────────────────────────────────────────────

/** Cells per side of the height field. 161² samples, 51,200 triangles — the
 *  whole field builds in ~10 ms, so it is a memo and never a frame cost. */
const GRID = 160;

/** Sample radius, as a fraction of the projection's half-extent: 3.2 units on
 *  a 84-unit footprint. Chosen against the store's own mean link span (~5.4):
 *  wide enough that a neighbourhood is a neighbourhood and not a point, narrow
 *  enough that the 17 separate landforms stay separate. */
const RADIUS_FRAC = 0.076;

/** The tallest ridge, as a fraction of the footprint's width. Vertical
 *  exaggeration is stated on screen; the contour rings carry the real counts. */
const RELIEF_FRAC = 0.23;

/** Height law: y = maxY · √(links / peak). √ rather than linear because the
 *  peak is ~950 against a median of a handful — linear would make one needle
 *  and call the rest sea. √ keeps the order and lets a five-link swell read. */
function heightOf(count: number, peak: number, maxY: number): number {
  return peak <= 0 ? 0 : maxY * Math.sqrt(Math.max(0, count) / peak);
}

/** The measured lighting band on `--rule`. See the header: across it every
 *  mark that lies on the land clears the 3:1 floor. */
const LIT_MIN = 0.35;
const LIT_MAX = 2.0;
/** The dimmed band, at or under `--plate` — the ground the link ramp was
 *  measured against. */
const DIM_MIN = 0.16;
const DIM_MAX = 0.3;

/** Hillshade direction. Fixed in world space, never camera-relative: a light
 *  that follows the eye makes relief unreadable when you orbit. */
const LIGHT = ((): readonly [number, number, number] => {
  const v = new THREE.Vector3(-0.62, 0.66, -0.42).normalize();
  return [v.x, v.y, v.z];
})();

/** Contour rings come off a 1–2–5 ladder, then thin out any ring closer than
 *  this fraction of the relief to the one below it. */
const RING_MIN_GAP = 0.085;

const STRAND_WIDTH = 1.5;
const CAM_FOV = 34;
const CAM_ELEVATION = 0.245; // radians ≈ 14°, looking across rather than down
const CAM_TURN = 1.31; // radians ≈ 75°, swings the tallest feature screen-right

const nf = new Intl.NumberFormat('en-US');

// ─── The field ──────────────────────────────────────────────────────────────

interface Field {
  /** Samples per side, GRID + 1. */
  g: number;
  /** World coordinate of sample 0 on both axes, and the step between samples. */
  lo: number;
  cell: number;
  size: number;
  radius: number;
  /** Links, and contradicting links, within `radius` of each sample. */
  count: Float32Array;
  contra: Float32Array;
  /** World Y of each sample. */
  height: Float32Array;
  peak: number;
  maxY: number;
  /** Share of the projection square with no link over it at all. */
  flatShare: number;
  /** Share of the square holding half of all accumulated height. */
  halfShare: number;
  /** Mean 2D span of a link against a deterministic random pair, both in
   *  projection units — the ground's own weakness, measured on this store. */
  meanSpan: number;
  meanRandom: number;
}

function buildField(data: ObsData): Field {
  const g = GRID + 1;
  const lo = -data.halfExtent;
  const size = data.halfExtent * 2;
  const cell = size / GRID;
  const radius = data.halfExtent * RADIUS_FRAC;
  const r2 = radius * radius;
  const count = new Float32Array(g * g);
  const contra = new Float32Array(g * g);

  // A link raises every sample whose distance to its SEGMENT is under the
  // radius — the capsule, not the endpoints. A long link therefore raises the
  // ground all the way along its path, which is what "links crossing here"
  // has to mean.
  for (const link of data.links) {
    const a = data.nodes[link.source]!;
    const b = data.nodes[link.target]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dd = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - lo) / cell));
    const i1 = Math.min(GRID, Math.ceil((Math.max(a.x, b.x) + radius - lo) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius - lo) / cell));
    const j1 = Math.min(GRID, Math.ceil((Math.max(a.y, b.y) + radius - lo) / cell));
    const contradicts = link.kind === 'contradicts';
    for (let j = j0; j <= j1; j++) {
      const pz = lo + j * cell;
      for (let i = i0; i <= i1; i++) {
        const px = lo + i * cell;
        let t = dd > 0 ? ((px - a.x) * dx + (pz - a.y) * dy) / dd : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a.x + dx * t - px;
        const qz = a.y + dy * t - pz;
        if (qx * qx + qz * qz > r2) continue;
        const k = j * g + i;
        count[k]! += 1;
        if (contradicts) contra[k]! += 1;
      }
    }
  }

  let peak = 0;
  let total = 0;
  let flat = 0;
  for (let k = 0; k < count.length; k++) {
    const v = count[k]!;
    if (v > peak) peak = v;
    if (v === 0) flat++;
    total += v;
  }
  const maxY = size * RELIEF_FRAC;
  const height = new Float32Array(g * g);
  for (let k = 0; k < count.length; k++) height[k] = heightOf(count[k]!, peak, maxY);

  const sorted = Array.from(count).sort((a, b) => b - a);
  let running = 0;
  let cells = 0;
  for (const v of sorted) {
    running += v;
    cells++;
    if (running * 2 >= total) break;
  }

  let spanSum = 0;
  for (const link of data.links) {
    const a = data.nodes[link.source]!;
    const b = data.nodes[link.target]!;
    spanSum += Math.hypot(a.x - b.x, a.y - b.y);
  }
  // Deterministic stand-in for "any two memories": a fixed coprime stride, so
  // the number on screen is the same on every load.
  let randomSum = 0;
  const n = data.nodes.length;
  for (let i = 0; i < n; i++) {
    const a = data.nodes[i]!;
    const b = data.nodes[(i * 257 + 131) % n]!;
    randomSum += Math.hypot(a.x - b.x, a.y - b.y);
  }

  return {
    g,
    lo,
    cell,
    size,
    radius,
    count,
    contra,
    height,
    peak,
    maxY,
    flatShare: flat / count.length,
    halfShare: cells / count.length,
    meanSpan: data.links.length ? spanSum / data.links.length : 0,
    meanRandom: n ? randomSum / n : 0,
  };
}

function sampleIndex(field: Field, x: number, z: number): number | null {
  const i = Math.round((x - field.lo) / field.cell);
  const j = Math.round((z - field.lo) / field.cell);
  if (i < 0 || j < 0 || i >= field.g || j >= field.g) return null;
  return j * field.g + i;
}

/** Bilinear, so a strand draped over the relief does not stair-step. */
function heightAt(field: Field, x: number, z: number): number {
  const fx = (x - field.lo) / field.cell;
  const fz = (z - field.lo) / field.cell;
  const i = Math.min(field.g - 2, Math.max(0, Math.floor(fx)));
  const j = Math.min(field.g - 2, Math.max(0, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i));
  const v = Math.min(1, Math.max(0, fz - j));
  const h = field.height;
  const g = field.g;
  const h00 = h[j * g + i]!;
  const h10 = h[j * g + i + 1]!;
  const h01 = h[(j + 1) * g + i]!;
  const h11 = h[(j + 1) * g + i + 1]!;
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

// ─── Features, by topographic prominence ────────────────────────────────────

interface Feature {
  cell: number;
  x: number;
  z: number;
  /** Links, and contradicting links, standing at the summit. */
  count: number;
  contra: number;
  /** Drop to the saddle that joins this summit to anything higher. */
  prominence: number;
  saddle: number;
  /** Memories within one radius of the summit, and the busiest of them. */
  memories: number;
  namedBy: number;
}

/**
 * Ranking summits by HEIGHT gets you eight views of the same massif. Ranking
 * by PROMINENCE — the drop to the saddle connecting a summit to anything
 * higher — is the cartographic answer and, on this store, the one that
 * surfaces the find: it puts three separate ~8–16% contradiction hills above
 * the massif's own shoulders.
 *
 * Standard descending-flood union-find: sort samples high to low, add them one
 * at a time, and when a new sample joins two existing components it IS the
 * saddle between them, so every component but the highest closes with its
 * prominence recorded.
 */
function findFeatures(field: Field, data: ObsData): Feature[] {
  const { g, count } = field;
  const order: number[] = [];
  for (let k = 0; k < count.length; k++) if (count[k]! > 0) order.push(k);
  order.sort((a, b) => count[b]! - count[a]!);

  const parent = new Int32Array(count.length).fill(-1);
  const summit = new Int32Array(count.length).fill(-1);
  const added = new Uint8Array(count.length);
  /** Cells that opened a component of their own — the only candidate summits.
   *  Every other cell merely joined one, and `summit` is meaningful for roots
   *  alone, so scanning the whole grid for `summit[k] === k` would nominate
   *  every absorbed cell and hand each of them the global maximum's
   *  prominence. */
  const summits: number[] = [];
  const closed = new Map<number, { prominence: number; saddle: number }>();

  const find = (x: number): number => {
    let root = x;
    while (parent[root]! !== root) root = parent[root]!;
    let walk = x;
    while (parent[walk]! !== walk) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };

  for (const c of order) {
    const i = c % g;
    const j = (c - i) / g;
    const roots: number[] = [];
    const push = (nb: number) => {
      if (nb < 0 || !added[nb]) return;
      const r = find(nb);
      if (!roots.includes(r)) roots.push(r);
    };
    push(i > 0 ? c - 1 : -1);
    push(i < g - 1 ? c + 1 : -1);
    push(j > 0 ? c - g : -1);
    push(j < g - 1 ? c + g : -1);

    added[c] = 1;
    parent[c] = c;
    summit[c] = c;
    if (roots.length === 0) {
      summits.push(c);
      continue;
    }

    let dominant = roots[0]!;
    for (const r of roots) if (count[summit[r]!]! > count[summit[dominant]!]!) dominant = r;
    for (const r of roots) {
      if (r === dominant) continue;
      const s = summit[r]!;
      if (!closed.has(s)) closed.set(s, { prominence: count[s]! - count[c]!, saddle: count[c]! });
      parent[r] = dominant;
    }
    parent[c] = dominant;
  }

  // Rank first, then survey. Naming a summit costs a pass over every memory,
  // and only the ones that make the register are ever named.
  const ranked = summits
    .filter((k) => count[k]! >= 4)
    .map((k) => {
      const shut = closed.get(k);
      return {
        cell: k,
        // The one summit that never closes is the global maximum; its
        // prominence is its whole height above the sea.
        prominence: shut ? shut.prominence : count[k]!,
        saddle: shut ? shut.saddle : 0,
      };
    })
    .sort((a, b) => b.prominence - a.prominence)
    .slice(0, 7);

  const radius = field.radius;
  return ranked.map(({ cell, prominence, saddle }) => {
    const i = cell % g;
    const x = field.lo + i * field.cell;
    const z = field.lo + ((cell - i) / g) * field.cell;
    let memories = 0;
    let namedBy = -1;
    let best = -1;
    for (let n = 0; n < data.nodes.length; n++) {
      const node = data.nodes[n]!;
      if (Math.hypot(node.x - x, node.y - z) > radius) continue;
      memories++;
      if (node.degree > best) {
        best = node.degree;
        namedBy = n;
      }
    }
    return { cell, x, z, count: count[cell]!, contra: field.contra[cell]!, prominence, saddle, memories, namedBy };
  });
}

/** Everything above the summit's key saddle that drains to it. */
function basinMask(field: Field, feature: Feature): Uint8Array {
  const { g, count } = field;
  const floor = Math.max(feature.saddle, 1);
  const mask = new Uint8Array(count.length);
  const stack = [feature.cell];
  mask[feature.cell] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const i = c % g;
    const j = (c - i) / g;
    const here = count[c]!;
    const neighbours = [i > 0 ? c - 1 : -1, i < g - 1 ? c + 1 : -1, j > 0 ? c - g : -1, j < g - 1 ? c + g : -1];
    for (const nb of neighbours) {
      if (nb < 0 || mask[nb]) continue;
      const there = count[nb]!;
      if (there < floor || there > here) continue;
      mask[nb] = 1;
      stack.push(nb);
    }
  }
  return mask;
}

// ─── Which links stand where ────────────────────────────────────────────────

function linksNear(data: ObsData, x: number, z: number, radius: number): number[] {
  const out: number[] = [];
  const r2 = radius * radius;
  for (let li = 0; li < data.links.length; li++) {
    const link = data.links[li]!;
    const a = data.nodes[link.source]!;
    const b = data.nodes[link.target]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dd = dx * dx + dy * dy;
    let t = dd > 0 ? ((x - a.x) * dx + (z - a.y) * dy) / dd : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + dx * t - x;
    const qz = a.y + dy * t - z;
    if (qx * qx + qz * qz <= r2) out.push(li);
  }
  return out;
}

function linksInMask(data: ObsData, field: Field, mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let li = 0; li < data.links.length; li++) {
    const link = data.links[li]!;
    const a = data.nodes[link.source]!;
    const b = data.nodes[link.target]!;
    const steps = Math.max(
      1,
      Math.min(120, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (field.cell * 0.8)))
    );
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const k = sampleIndex(field, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      if (k !== null && mask[k]) {
        out.push(li);
        break;
      }
    }
  }
  return out;
}

/** Strongest first, because the readout only has room to name a handful and
 *  the ones worth naming are the ones the store is most sure of. */
function linksOfNode(data: ObsData, index: number): number[] {
  const out: number[] = [];
  for (let li = 0; li < data.links.length; li++) {
    const link = data.links[li]!;
    if (link.source === index || link.target === index) out.push(li);
  }
  return out.sort((a, b) => data.links[b]!.strength - data.links[a]!.strength);
}

// ─── Geometry ───────────────────────────────────────────────────────────────

function buildSurface(field: Field): THREE.BufferGeometry {
  const { g, lo, cell, height } = field;
  const positions = new Float32Array(g * g * 3);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const k = (j * g + i) * 3;
      positions[k] = lo + i * cell;
      positions[k + 1] = height[j * g + i]!;
      positions[k + 2] = lo + j * cell;
    }
  }
  const index = new Uint32Array(GRID * GRID * 6);
  let t = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * g + i;
      const b = a + 1;
      const c = a + g;
      const d = c + 1;
      index[t++] = a;
      index[t++] = c;
      index[t++] = b;
      index[t++] = b;
      index[t++] = c;
      index[t++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Per-vertex hillshade. Lambert against the fixed light, from the slope of the
 * height field — never from its value, which is the heatmap trap. The result
 * is clamped into a band measured against every mark that lies on the land.
 */
function shade(field: Field, low: number, high: number): Float32Array {
  const { g, cell, height } = field;
  const base = new THREE.Color(PLATE_COLORS.rule);
  const out = new Float32Array(g * g * 3);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const k = j * g + i;
      const left = height[j * g + Math.max(0, i - 1)]!;
      const right = height[j * g + Math.min(g - 1, i + 1)]!;
      const back = height[Math.max(0, j - 1) * g + i]!;
      const front = height[Math.min(g - 1, j + 1) * g + i]!;
      const dx = (right - left) / (2 * cell);
      const dz = (front - back) / (2 * cell);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      const lambert = Math.max(0, -dx * inv * LIGHT[0] + inv * LIGHT[1] + -dz * inv * LIGHT[2]);
      const level = low + (high - low) * lambert;
      out[k * 3] = base.r * level;
      out[k * 3 + 1] = base.g * level;
      out[k * 3 + 2] = base.b * level;
    }
  }
  return out;
}

/** The ring ladder: 1–2–5 decades, thinned so no two rings crowd each other. */
function ringLevels(field: Field): number[] {
  const kept: number[] = [];
  let last = -1;
  for (let decade = 0; decade < 7; decade++) {
    for (const mantissa of [1, 2, 5]) {
      const level = mantissa * Math.pow(10, decade);
      if (level > field.peak) return kept;
      const y = heightOf(level, field.peak, field.maxY) / field.maxY;
      if (last >= 0 && y - last < RING_MIN_GAP) continue;
      kept.push(level);
      last = y;
    }
  }
  return kept;
}

/** Marching squares on the count field. An iso-line of count is an iso-line of
 *  height by construction, so each ring is flat and sits at its own level. */
function ringGeometry(field: Field, level: number): Float32Array {
  const { g, lo, cell, count } = field;
  const y = heightOf(level, field.peak, field.maxY);
  const out: number[] = [];
  const cross = (a: number, b: number) => (b === a ? 0.5 : (level - a) / (b - a));
  for (let j = 0; j < g - 1; j++) {
    for (let i = 0; i < g - 1; i++) {
      const v00 = count[j * g + i]!;
      const v10 = count[j * g + i + 1]!;
      const v11 = count[(j + 1) * g + i + 1]!;
      const v01 = count[(j + 1) * g + i]!;
      let code = 0;
      if (v00 >= level) code |= 1;
      if (v10 >= level) code |= 2;
      if (v11 >= level) code |= 4;
      if (v01 >= level) code |= 8;
      if (code === 0 || code === 15) continue;
      const x0 = lo + i * cell;
      const z0 = lo + j * cell;
      const bx = x0 + cell * cross(v00, v10);
      const rz = z0 + cell * cross(v10, v11);
      const tx = x0 + cell * cross(v01, v11);
      const lz = z0 + cell * cross(v00, v01);
      const edge: Record<string, [number, number]> = {
        b: [bx, z0],
        r: [x0 + cell, rz],
        t: [tx, z0 + cell],
        l: [x0, lz],
      };
      const link = (from: string, to: string) => {
        const p = edge[from]!;
        const q = edge[to]!;
        out.push(p[0], y, p[1], q[0], y, q[1]);
      };
      switch (code) {
        case 1:
        case 14:
          link('l', 'b');
          break;
        case 2:
        case 13:
          link('b', 'r');
          break;
        case 3:
        case 12:
          link('l', 'r');
          break;
        case 4:
        case 11:
          link('r', 't');
          break;
        case 6:
        case 9:
          link('b', 't');
          break;
        case 7:
        case 8:
          link('l', 't');
          break;
        case 5:
          link('l', 'b');
          link('r', 't');
          break;
        case 10:
          link('l', 't');
          link('b', 'r');
          break;
        default:
          break;
      }
    }
  }
  return new Float32Array(out);
}

// ─── Scene pieces ───────────────────────────────────────────────────────────

function Surface({
  field,
  dimmed,
  onProbe,
  onCut,
}: {
  field: Field;
  dimmed: boolean;
  onProbe: (x: number, z: number) => void;
  onCut: (x: number, z: number) => void;
}) {
  // Geometry and BOTH shadings are built together, and the lit one is attached
  // before this ever renders: attaching the colour attribute in an effect
  // instead would leave the first frame with `vertexColors` on and no colours,
  // which draws the whole landscape black.
  const surface = useMemo(() => {
    const geometry = buildSurface(field);
    const lit = shade(field, LIT_MIN, LIT_MAX);
    const dim = shade(field, DIM_MIN, DIM_MAX);
    geometry.setAttribute('color', new THREE.BufferAttribute(lit, 3));
    return { geometry, lit, dim };
  }, [field]);
  useEffect(() => {
    surface.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(dimmed ? surface.dim : surface.lit, 3)
    );
  }, [surface, dimmed]);
  useEffect(() => () => surface.geometry.dispose(), [surface]);
  return (
    <mesh
      geometry={surface.geometry}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => onProbe(event.point.x, event.point.z)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onCut(event.point.x, event.point.z);
      }}
    >
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function Rings({ field, levels, dimmed }: { field: Field; levels: number[]; dimmed: boolean }) {
  const rings = useMemo(
    () =>
      levels.map((level, i) => ({
        level,
        shore: i === 0,
        positions: ringGeometry(field, level),
      })),
    [field, levels]
  );
  const geometries = useMemo(
    () =>
      rings.map((ring) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(ring.positions, 3));
        return geometry;
      }),
    [rings]
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  const lift = field.maxY * 0.004;
  return (
    <group position={[0, lift, 0]}>
      {geometries.map((geometry, i) => (
        <lineSegments key={rings[i]!.level} geometry={geometry}>
          <lineBasicMaterial
            color={rings[i]!.shore || dimmed ? PLATE_COLORS.ink2 : PLATE_COLORS.ink3}
            transparent
            opacity={rings[i]!.shore ? 0.95 : 0.6}
            depthWrite={false}
          />
        </lineSegments>
      ))}
    </group>
  );
}

/** The extent of the projection the ground is: a hairline square and a centre
 *  cross, so the terrain has a footprint and a horizon rather than floating. */
function Frame({ field }: { field: Field }) {
  const geometry = useMemo(() => {
    const e = field.size / 2;
    const pts: number[] = [];
    const seg = (ax: number, az: number, bx: number, bz: number) => pts.push(ax, 0, az, bx, 0, bz);
    seg(-e, -e, e, -e);
    seg(e, -e, e, e);
    seg(e, e, -e, e);
    seg(-e, e, -e, -e);
    const tick = e * 0.045;
    for (let m = -4; m <= 4; m++) {
      const p = (m / 4) * e;
      seg(p, -e, p, -e + tick);
      seg(p, e, p, e - tick);
      seg(-e, p, -e + tick, p);
      seg(e, p, e - tick, p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, [field]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={PLATE_COLORS.rule} depthWrite={false} />
    </lineSegments>
  );
}

/** Memories, lying on the land they raised. Uniform: the terrain already
 *  carries how connected a place is, so a second size channel would restate
 *  it. The isolated ones are simply the dots standing on flat ground. */
function Stipple({
  field,
  data,
  onProbeNode,
  onPickNode,
}: {
  field: Field;
  data: ObsData;
  onProbeNode: (index: number | null) => void;
  onPickNode: (index: number) => void;
}) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(data.nodes.length * 3);
    data.nodes.forEach((node, i) => {
      positions[i * 3] = node.x;
      positions[i * 3 + 1] = heightAt(field, node.x, node.y) + field.maxY * 0.008;
      positions[i * 3 + 2] = node.y;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    return g;
  }, [data, field]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points
      geometry={geometry}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (event.index !== undefined) onProbeNode(event.index);
      }}
      onPointerOut={() => onProbeNode(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (event.index !== undefined) onPickNode(event.index);
      }}
    >
      <pointsMaterial color={PLATE_COLORS.memory} size={2.6} sizeAttenuation={false} />
    </points>
  );
}

/** The sampled links, draped over the relief they built. */
function Strands({
  field,
  data,
  indices,
  width,
  height,
}: {
  field: Field;
  data: ObsData;
  indices: number[];
  width: number;
  height: number;
}) {
  const object = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const lift = field.maxY * 0.016;
    const tint = new THREE.Color();
    for (const li of indices) {
      const link = data.links[li]!;
      const a = data.nodes[link.source]!;
      const b = data.nodes[link.target]!;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(2, Math.min(28, Math.ceil(span / (field.cell * 1.6)) + 2));
      tint.setHex(linkColorInt(link));
      let px = a.x;
      let pz = a.y;
      let py = heightAt(field, px, pz) + lift;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const x = a.x + (b.x - a.x) * u;
        const z = a.y + (b.y - a.y) * u;
        const y = heightAt(field, x, z) + lift;
        positions.push(px, py, pz, x, y, z);
        colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
        px = x;
        py = y;
        pz = z;
      }
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(positions));
    geometry.setColors(new Float32Array(colors));
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: STRAND_WIDTH,
      worldUnits: false,
      transparent: true,
      opacity: 0.9,
    });
    material.resolution.set(Math.max(1, width), Math.max(1, height));
    const line = new LineSegments2(geometry, material);
    line.computeLineDistances();
    line.frustumCulled = false;
    return { line, geometry, material };
  }, [field, data, indices, width, height]);

  useEffect(() => {
    object.material.resolution.set(Math.max(1, width), Math.max(1, height));
  }, [object, width, height]);
  useEffect(
    () => () => {
      object.geometry.dispose();
      object.material.dispose();
    },
    [object]
  );
  return <primitive object={object.line} />;
}

/** Where a core sample was cut: the disc's outline, following the surface. */
function CutRing({ field, x, z }: { field: Field; x: number; z: number }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const lift = field.maxY * 0.02;
    for (let i = 0; i < 96; i++) {
      const angle = (i / 96) * Math.PI * 2;
      const px = x + Math.cos(angle) * field.radius;
      const pz = z + Math.sin(angle) * field.radius;
      pts.push(px, heightAt(field, px, pz) + lift, pz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, [field, x, z]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    // `lineLoop`, not `line` — bare `line` in JSX resolves to the SVG element.
    <lineLoop geometry={geometry}>
      <lineBasicMaterial color={PLATE_COLORS.ink2} depthTest={false} depthWrite={false} />
    </lineLoop>
  );
}

/** A sounding line standing on one memory, readable through a ridge. */
function Sounding({ field, x, z }: { field: Field; x: number; z: number }) {
  const geometry = useMemo(() => {
    const base = heightAt(field, x, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([x, base, z, x, base + field.maxY * 0.55, z]),
        3
      )
    );
    return g;
  }, [field, x, z]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={PLATE_COLORS.memoryLive} depthTest={false} depthWrite={false} />
    </lineSegments>
  );
}

// ─── The scene ──────────────────────────────────────────────────────────────

interface Cut {
  kind: 'place' | 'feature' | 'memory';
  x: number;
  z: number;
  /** Feature rank, or node index, depending on `kind`. */
  ref: number;
  links: number[];
}

function Scene({
  data,
  field,
  levels,
  cut,
  width,
  height,
  reducedMotion,
  onProbe,
  onProbeNode,
  onCutPlace,
  onPickNode,
}: {
  data: ObsData;
  field: Field;
  levels: number[];
  cut: Cut | null;
  width: number;
  height: number;
  reducedMotion: boolean;
  onProbe: (x: number, z: number) => void;
  onProbeNode: (index: number | null) => void;
  onCutPlace: (x: number, z: number) => void;
  onPickNode: (index: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const raycaster = useThree((s) => s.raycaster);
  useEffect(() => {
    raycaster.params.Points = { threshold: field.radius * 0.26 };
  }, [raycaster, field]);
  useEffect(() => {
    invalidate();
  }, [invalidate, cut, width, height]);

  const reach = field.size * 0.62;
  return (
    <>
      <color attach="background" args={[PLATE_COLORS.plate]} />
      <Frame field={field} />
      <Surface field={field} dimmed={cut !== null} onProbe={onProbe} onCut={onCutPlace} />
      <Rings field={field} levels={levels} dimmed={cut !== null} />
      <Stipple field={field} data={data} onProbeNode={onProbeNode} onPickNode={onPickNode} />
      {cut ? (
        <Strands field={field} data={data} indices={cut.links} width={width} height={height} />
      ) : null}
      {cut?.kind === 'place' ? <CutRing field={field} x={cut.x} z={cut.z} /> : null}
      {cut && cut.kind !== 'place' ? <Sounding field={field} x={cut.x} z={cut.z} /> : null}
      <OrbitControls
        makeDefault
        autoRotate={false}
        enableDamping={!reducedMotion}
        dampingFactor={0.14}
        enablePan
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        target={[0, field.maxY * 0.3, 0]}
        minDistance={reach * 0.35}
        maxDistance={reach * 5}
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI / 2 - 0.03}
      />
    </>
  );
}

// ─── Overlay pieces ─────────────────────────────────────────────────────────

/** The one place hue appears at rest: what share of a feature's links disagree.
 *  Two identities on `--margin` (4.13:1 and 3.98:1), direct-labelled with the
 *  percentage, so identity is never carried by colour alone. */
function Split({ agrees, contradicts }: { agrees: number; contradicts: number }) {
  const total = agrees + contradicts;
  if (total === 0) return null;
  return (
    <span className="lt-split">
      <i style={{ flexGrow: agrees, background: 'var(--agrees)' }} aria-hidden />
      <i style={{ flexGrow: contradicts, background: 'var(--contradicts)' }} aria-hidden />
      <span className="lt-split-read">{Math.round((100 * contradicts) / total)}% contradict</span>
    </span>
  );
}

/** The ring ladder, drawn at the law the surface uses so the key is not a
 *  cartoon: each rung sits at √(level / peak) of the relief. */
function Ladder({ field, levels }: { field: Field; levels: number[] }) {
  const w = 224;
  const h = 74;
  const pad = 5;
  return (
    <svg width={w} height={h} role="img" aria-label={`Contour rings at ${levels.join(', ')} links`}>
      <line x1={0} y1={h - pad} x2={w} y2={h - pad} stroke="var(--rule)" strokeWidth={1} />
      {levels.map((level, i) => {
        const y = h - pad - (heightOf(level, field.peak, field.maxY) / field.maxY) * (h - pad * 2);
        const shore = i === 0;
        return (
          <g key={level}>
            <line
              x1={0}
              y1={y}
              x2={w - 34}
              y2={y}
              stroke={shore ? 'var(--ink-2)' : 'var(--ink-3)'}
              strokeWidth={1}
              opacity={shore ? 0.95 : 0.6}
            />
            <text x={w - 30} y={y + 3.4} fill="var(--ink-2)" fontSize={10.5} className="obs-figure">
              {nf.format(level)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A summit takes the name of the busiest memory standing on it, the way a
 *  peak on a map is named for what is on it. Markdown furniture off, since a
 *  lot of these labels are the head of a generated document. */
/**
 * Answered BEFORE the first render, not in an effect: an effect runs after the
 * Canvas has already mounted, so a context-less environment takes the whole
 * page down before the fallback can be chosen. The `WebGLRenderingContext`
 * test comes first because that is the one jsdom does not define, which is
 * what makes the harness's headless smoke test able to reach this file at all.
 */
function hasWebGL(): boolean {
  if (typeof document === 'undefined' || typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

function featureName(data: ObsData, feature: Feature): string {
  if (feature.namedBy < 0) return 'unnamed rise';
  const label = data.nodes[feature.namedBy]!.label
    .replace(/[#*`_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\-–—]\s*$/, '')
    .trim();
  if (!label) return 'unnamed rise';
  return label.length > 44 ? `${label.slice(0, 43)}…` : label;
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const field = useMemo(() => buildField(data), [data]);
  const levels = useMemo(() => ringLevels(field), [field]);
  const features = useMemo(() => findFeatures(field, data), [field, data]);

  const [place, setPlace] = useState<{ x: number; z: number } | null>(null);
  const [feature, setFeature] = useState<number | null>(null);
  const [probe, setProbe] = useState<{ x: number; z: number } | null>(null);
  const [probeNode, setProbeNode] = useState<number | null>(null);
  const [webgl] = useState(hasWebGL);

  const selectedIndex = useMemo(
    () => (selectedId ? data.nodes.findIndex((n) => n.id === selectedId) : -1),
    [data, selectedId]
  );

  const cut = useMemo<Cut | null>(() => {
    if (selectedIndex >= 0) {
      const node = data.nodes[selectedIndex]!;
      return { kind: 'memory', x: node.x, z: node.y, ref: selectedIndex, links: linksOfNode(data, selectedIndex) };
    }
    if (feature !== null && features[feature]) {
      const f = features[feature]!;
      return { kind: 'feature', x: f.x, z: f.z, ref: feature, links: linksInMask(data, field, basinMask(field, f)) };
    }
    if (place) {
      return { kind: 'place', x: place.x, z: place.z, ref: -1, links: linksNear(data, place.x, place.z, field.radius) };
    }
    return null;
  }, [data, field, features, feature, place, selectedIndex]);

  const cutPlace = useCallback(
    (x: number, z: number) => {
      setFeature(null);
      onSelect(null);
      setPlace({ x, z });
    },
    [onSelect]
  );

  const pickNode = useCallback(
    (index: number) => {
      setPlace(null);
      setFeature(null);
      onSelect(data.nodes[index]!.id);
    },
    [data, onSelect]
  );

  const chooseFeature = useCallback(
    (rank: number) => {
      setPlace(null);
      onSelect(null);
      setFeature((current) => (current === rank ? null : rank));
    },
    [onSelect]
  );

  const clear = useCallback(() => {
    setPlace(null);
    setFeature(null);
    onSelect(null);
  }, [onSelect]);

  const onProbe = useCallback(
    (x: number, z: number) => {
      setProbe((current) =>
        current && Math.abs(current.x - x) < field.cell && Math.abs(current.z - z) < field.cell
          ? current
          : { x, z }
      );
    },
    [field]
  );

  const camera = useMemo(() => {
    const tallest = features[0];
    const angle = tallest ? Math.atan2(tallest.z, tallest.x) + CAM_TURN : CAM_TURN;
    const distance = (field.size * 0.62) / Math.tan((CAM_FOV * Math.PI) / 360);
    const flat = Math.cos(CAM_ELEVATION) * distance;
    return {
      position: [Math.cos(angle) * flat, Math.sin(CAM_ELEVATION) * distance + field.maxY * 0.3, Math.sin(angle) * flat] as [
        number,
        number,
        number,
      ],
      far: distance * 6,
    };
  }, [features, field]);

  const roomy = width >= 780 && height >= 430;
  const summary =
    `A relief of ${nf.format(data.stats.linksDrawn)} links over the memory projection: height at any point is how many ` +
    `links pass within ${field.radius.toFixed(1)} projection units of it, peaking at ${nf.format(field.peak)}. ` +
    `${Math.round(field.flatShare * 100)}% of the square is flat.`;

  return (
    <div className="lt-box" style={{ width, height }}>
      <style href="observatory-link-terrain" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl ? (
        <div className="lt-canvas" role="img" aria-label={summary}>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{
              antialias: true,
              // The token layer's contrast was measured on raw sRGB. R3F's ACES
              // default would silently move every ratio in this file's header.
              toneMapping: THREE.NoToneMapping,
            }}
            camera={{ fov: CAM_FOV, near: 1, far: camera.far, position: camera.position }}
            onPointerMissed={clear}
          >
            <Scene
              data={data}
              field={field}
              levels={levels}
              cut={cut}
              width={width}
              height={height}
              reducedMotion={reducedMotion}
              onProbe={onProbe}
              onProbeNode={setProbeNode}
              onCutPlace={cutPlace}
              onPickNode={pickNode}
            />
          </Canvas>
        </div>
      ) : (
        <p className="lt-nogl obs-note">
          This relief is drawn with WebGL and this browser gave the page no context. The
          measurements still hold: {summary}
        </p>
      )}

      <KeySheet
        data={data}
        field={field}
        levels={levels}
        features={features}
        active={feature}
        onChoose={chooseFeature}
        roomy={roomy}
      />
      <Readout
        data={data}
        field={field}
        features={features}
        cut={cut}
        probe={probe}
        probeNode={probeNode}
        onClear={clear}
        roomy={roomy}
      />
    </div>
  );
}

function KeySheet({
  data,
  field,
  levels,
  features,
  active,
  onChoose,
  roomy,
}: {
  data: ObsData;
  field: Field;
  levels: number[];
  features: Feature[];
  active: number | null;
  onChoose: (rank: number) => void;
  roomy: boolean;
}) {
  const { stats } = data;
  return (
    <aside className="lt-sheet">
      <div className="lt-block">
        <p className="lt-line">
          Height is <span className="obs-figure">links within {field.radius.toFixed(1)}</span>{' '}
          projection units, over the first two principal components. The tallest ridge stands{' '}
          <span className="obs-figure">{nf.format(field.peak)}</span> links high; shading is slope,
          not value.
        </p>
      </div>

      <div className="lt-block">
        <div className="obs-label">Contour rings, in links</div>
        <Ladder field={field} levels={levels} />
      </div>

      <div className="lt-block">
        <div className="obs-label">Ground, and what it is worth</div>
        <p className="lt-line lt-quiet">
          The projection keeps{' '}
          <span className="obs-figure">{Math.round(stats.explainedVariance * 100)}%</span> of the
          embedding and this uses two of its three axes. Linked memories sit{' '}
          <span className="obs-figure">{field.meanSpan.toFixed(1)}</span> apart against{' '}
          <span className="obs-figure">{field.meanRandom.toFixed(1)}</span> for any two — that
          piling is what the height counts, and it is also why the footprint explains less than the
          height does.
        </p>
      </div>

      <div className="lt-block">
        <div className="obs-label">Denominators</div>
        <p className="lt-line lt-quiet">
          <span className="obs-figure">{nf.format(stats.linksDrawn)}</span> links drawn of{' '}
          <span className="obs-figure">{nf.format(stats.linksStored)}</span> stored —{' '}
          <span className="obs-figure">{nf.format(stats.linksToArchived)}</span> point at archived
          memories and raise nothing. <span className="obs-figure">{nf.format(stats.memories)}</span>{' '}
          memories, <span className="obs-figure">{nf.format(stats.isolated)}</span> of them on flat
          ground. <span className="obs-figure">{Math.round(field.flatShare * 100)}%</span> of the
          square carries no link; half of all height stands over{' '}
          <span className="obs-figure">{(field.halfShare * 100).toFixed(1)}%</span> of it.
        </p>
        <p className="lt-line lt-quiet">
          <span className="lt-chip" style={{ background: 'var(--agrees)' }} />
          {nf.format(stats.agrees)} agree
          <span className="lt-chip lt-chip-gap" style={{ background: 'var(--contradicts)' }} />
          {nf.format(stats.contradicts)} contradict
        </p>
      </div>

      {roomy ? (
        <div className="lt-block">
          <div className="obs-label">Summits, by prominence</div>
          <p className="lt-line lt-quiet">
            Prominence is the drop to the saddle joining a summit to anything higher, so a shoulder
            of the massif does not outrank a hill standing on its own. Take one.
          </p>
          <ol className="lt-register">
            {features.map((feature, rank) => (
              <li key={feature.cell}>
                <button
                  type="button"
                  className="lt-row"
                  aria-pressed={active === rank}
                  onClick={() => onChoose(rank)}
                >
                  <span className="lt-row-rank obs-figure">{rank + 1}</span>
                  <span className="lt-row-body">
                    <span className="lt-row-name">{featureName(data, feature)}</span>
                    <span className="lt-row-meta obs-label">
                      {nf.format(feature.count)} links · prominence {nf.format(Math.round(feature.prominence))} ·{' '}
                      {nf.format(feature.memories)} memories
                    </span>
                  </span>
                  <Split agrees={feature.count - feature.contra} contradicts={feature.contra} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}

function Readout({
  data,
  field,
  features,
  cut,
  probe,
  probeNode,
  onClear,
  roomy,
}: {
  data: ObsData;
  field: Field;
  features: Feature[];
  cut: Cut | null;
  probe: { x: number; z: number } | null;
  probeNode: number | null;
  onClear: () => void;
  roomy: boolean;
}) {
  if (probeNode !== null && !cut) {
    const node = data.nodes[probeNode];
    if (node) {
      return (
        <aside className="lt-readout">
          <p className="lt-title">{node.label}</p>
          <p className="lt-line lt-quiet">
            {node.degree === 0
              ? 'No renderable link — this memory stands on flat ground.'
              : `${nf.format(node.degree)} links. Click to lift them out of the terrain.`}
          </p>
        </aside>
      );
    }
  }

  if (!cut) {
    // Before the pointer has been anywhere there is no measurement to report,
    // so this says what to do instead of reporting a zero that means "nothing
    // has been asked yet" rather than "flat ground".
    const at = probe ? sampleIndex(field, probe.x, probe.z) : null;
    if (at === null) {
      return (
        <aside className="lt-readout">
          <p className="lt-line">
            Move over the land to count what stands on it. Click the ground to cut a sample, a row
            of the register to take a whole summit, or a memory to name its links.
          </p>
        </aside>
      );
    }
    const here = field.count[at]!;
    const contra = field.contra[at]!;
    return (
      <aside className="lt-readout">
        <div className="obs-label">Under the pointer</div>
        <p className="obs-stat">{nf.format(here)}</p>
        <p className="lt-line lt-quiet">
          {here === 0
            ? `links within ${field.radius.toFixed(1)} projection units — flat ground.`
            : `links within ${field.radius.toFixed(1)} projection units, of ${nf.format(data.stats.linksDrawn)} drawn.`}
        </p>
        {here > 0 ? <Split agrees={here - contra} contradicts={contra} /> : null}
        <p className="lt-line lt-quiet lt-hint">
          Click the ground to cut a sample, or a memory to name its links.
        </p>
      </aside>
    );
  }

  const agrees = cut.links.reduce((n, li) => n + (data.links[li]!.kind === 'agrees' ? 1 : 0), 0);
  const contradicts = cut.links.length - agrees;

  if (cut.kind === 'memory') {
    const node = data.nodes[cut.ref]!;
    const shown = roomy ? 7 : 3;
    return (
      <aside className="lt-readout">
        <p className="lt-title">{node.label}</p>
        <p className="lt-line lt-quiet">
          {node.type} · {RETENTION_LABEL[node.retentionBand]} · standing on ground{' '}
          {nf.format(field.count[sampleIndex(field, node.x, node.y) ?? 0] ?? 0)} links deep
        </p>
        <Split agrees={agrees} contradicts={contradicts} />
        <ul className="lt-links">
          {cut.links.slice(0, shown).map((li) => {
            const link = data.links[li]!;
            const other = data.nodes[link.source === cut.ref ? link.target : link.source]!;
            return (
              <li key={link.id}>
                <span
                  className="lt-chip"
                  style={{ background: link.kind === 'agrees' ? 'var(--agrees)' : 'var(--contradicts)' }}
                />
                <span className="lt-link-name">{other.label}</span>
                <span className="obs-label lt-link-meta">{link.strength.toFixed(2)}</span>
              </li>
            );
          })}
        </ul>
        <p className="lt-line lt-quiet">
          {cut.links.length > shown
            ? `${nf.format(shown)} of ${nf.format(cut.links.length)} links, strongest first.`
            : `${nf.format(cut.links.length)} links, all of them.`}
        </p>
        <button type="button" className="lt-clear" onClick={onClear}>
          Put it back
        </button>
      </aside>
    );
  }

  const feature = cut.kind === 'feature' ? features[cut.ref] : null;
  return (
    <aside className="lt-readout">
      <div className="obs-label">
        {feature ? `Summit ${cut.ref + 1}, whole basin` : 'Core sample'}
      </div>
      <p className="obs-stat">{nf.format(cut.links.length)}</p>
      <p className="lt-line lt-quiet">
        {feature
          ? `links standing over ${featureName(data, feature)} — everything above its saddle at ${nf.format(Math.round(feature.saddle))}.`
          : `links crossing a disc of radius ${field.radius.toFixed(1)} at PC1 ${cut.x.toFixed(1)}, PC2 ${cut.z.toFixed(1)}.`}{' '}
        Each is drawn as one strand, all {nf.format(cut.links.length)} of{' '}
        {nf.format(data.stats.linksDrawn)}.
      </p>
      <Split agrees={agrees} contradicts={contradicts} />
      <p className="lt-line lt-quiet lt-hint">
        The land is dimmed to the ground the strength ramp was measured against — on lit relief the
        weak steps fall under 3:1. Click a memory to name a single link.
      </p>
      <button type="button" className="lt-clear" onClick={onClear}>
        Put it back
      </button>
    </aside>
  );
}

/**
 * Scoped to this demo's box. No card, no radius, no shadow, no frame (rule 9):
 * the canvas bleeds to all four edges and the two instrument sheets sit on
 * `--margin`, the token layer's own reading surface, divided from the plate by
 * a hairline. Nothing animates a layout property (rule 7) because the only
 * transition in the file is an opacity.
 */
const SHEET_CSS = `
.lt-box { position: absolute; inset: 0; overflow: hidden; }
.lt-canvas { position: absolute; inset: 0; }
.lt-nogl { position: absolute; inset: 0; margin: 0; padding: 28px 20px; max-width: 56ch; }

.lt-sheet {
  position: absolute; left: 0; top: 0; bottom: 0; width: 300px; max-width: 46%;
  padding: 16px 18px 18px 20px;
  display: flex; flex-direction: column; gap: var(--gap-section);
  overflow-y: auto; overscroll-behavior: contain;
  background: var(--margin); border-right: 1px solid var(--rule);
}
.lt-block { display: flex; flex-direction: column; gap: var(--gap-row); }
.lt-block svg { display: block; }

.lt-readout {
  position: absolute; right: 0; bottom: 0; width: 292px; max-width: calc(100% - 24px);
  padding: 14px 20px 16px 16px;
  display: flex; flex-direction: column; gap: var(--gap-row);
  background: var(--margin);
  border-top: 1px solid var(--rule); border-left: 1px solid var(--rule);
}
.lt-readout .obs-stat { margin: 0; }

.lt-line { margin: 0; font-size: var(--t-body); line-height: 1.45; color: var(--ink-2); }
.lt-quiet { color: var(--ink-3); }
.lt-hint { margin-top: 2px; }
.lt-title {
  margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: var(--lead-tight);
  color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

.lt-chip { display: inline-block; width: 3px; height: 0.85em; margin-right: 6px; vertical-align: -0.06em; }
.lt-chip-gap { margin-left: 12px; }

.lt-split { display: flex; align-items: center; gap: 1px; height: 6px; }
.lt-split i { display: block; height: 6px; min-width: 2px; }
.lt-split-none { display: block; height: 1px; background: var(--rule); }
.lt-split-read {
  flex: 0 0 auto; margin-left: 8px; height: auto;
  font-size: var(--t-label); font-stretch: 78%; font-variant-numeric: tabular-nums;
  color: var(--ink-3);
}

.lt-register { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.lt-register li + li { border-top: 1px solid var(--rule); }
.lt-row {
  width: 100%; display: grid; grid-template-columns: 16px 1fr; gap: 4px 10px;
  align-items: baseline; padding: 8px 0; text-align: left;
  opacity: 0.78; transition: opacity var(--dur) var(--ease);
}
.lt-row:hover, .lt-row[aria-pressed='true'] { opacity: 1; }
.lt-row[aria-pressed='true'] .lt-row-name { color: var(--ink); }
.lt-row-rank { color: var(--ink-3); font-size: var(--t-label); }
.lt-row-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.lt-row-name {
  font-size: var(--t-body); line-height: 1.3; color: var(--ink-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lt-row-meta { line-height: 1.3; }
.lt-row .lt-split { grid-column: 2; }

.lt-links { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.lt-links li { display: flex; align-items: baseline; gap: 0; min-width: 0; }
.lt-link-name {
  flex: 1 1 auto; min-width: 0; font-size: var(--t-body); color: var(--ink-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lt-link-meta { flex: 0 0 auto; margin-left: 10px; font-variant-numeric: tabular-nums; }

.lt-clear {
  align-self: flex-start; margin-top: 4px;
  font-size: var(--t-label); font-stretch: 78%; font-weight: 500; color: var(--ink);
  border-bottom: 1px solid var(--rule); opacity: 0.72;
  transition: opacity var(--dur) var(--ease);
}
.lt-clear:hover { opacity: 1; }
`;

export const linkTerrain: DemoModule = {
  id: 'link-terrain',
  name: 'Terrain of connection',
  dimension: '3D',
  claim:
    'Density is landform: instead of drawing every link, this stands a surface over the projection whose height is how many links pass within a short radius of each point, so the store reads at a glance as one enormous contradiction massif against a handful of far lower, almost purely agreeing hills — and the cost of that reading is that no individual link exists until you cut a sample out of the ground.',
  Plate,
};
