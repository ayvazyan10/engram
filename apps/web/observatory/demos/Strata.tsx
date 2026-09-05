/**
 * SLOT 7 of 9 — three dimensions.  "Strata."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Cosmos, Neural Net and Clusters each spent all three axes on one projection
 * and then drew the links as hairs inside the resulting cloud. The
 * projection's own weights say why that could not work. PC1 keeps 24.1% of
 * the embedding, PC2 9.5%, PC3 4.6%: a third of the screen volume was
 * carrying a twentieth of the meaning. And linked memories sit 7.08 apart in
 * that space against 40.81 for a random pair, so every link was a short chord
 * buried in the densest region of the cloud.
 *
 * Strata takes the vertical back and spends it on the one property this store
 * orders completely and without argument: WHEN each memory was written.
 *
 *   • height  = the memory's age RANK, quantised into ten equal-count beds.
 *               Freshest bed on top, oldest at the bottom.
 *   • bearing = atan2(PC2, PC1) — the memory's direction from the centre of
 *               the projection, not its distance. Measured on this store,
 *               95.5% of drawn links join two memories within 30 degrees of
 *               each other in bearing, mean 9.5 against 88.4 for a random
 *               pair. Sharing a bearing is what makes a link SHORT here, and
 *               short in bearing plus far apart in time is exactly the thread
 *               that stands up.
 *   • radius  = the rank of the memory's distance from the centre of the
 *               projection, spread across a narrow band. It separates
 *               memories that share a bearing; it is not read as a distance.
 *
 * So each bed is a RING, not a deck. There is no fill to see through, and the
 * middle of the stack is deliberately empty. What is left is the reading:
 *
 *   A LINK THAT LIES FLAT JOINS TWO MEMORIES FROM THE SAME BED.
 *   A LINK THAT LEANS IS A CONNECTION ACROSS TIME.
 *
 * Orientation, not length or colour, carries the one distinction this slot
 * exists to test — and orientation survives at a glance and at a distance.
 * Measured with these beds: crossing links stand at a median 75 degrees off
 * horizontal, and a link that crosses several beds bows radially clear of the
 * stack in proportion to how many, so the deepest connections are the ones
 * drawn against empty background where nothing can overdraw them.
 *
 * ─── The 564 ───────────────────────────────────────────────────────────────
 *
 * The obvious way to stratify this store is by retention band, and it is a
 * dead end. 564 of 652 memories sit in the weakest band, and because
 * retention is a function of age and linked memories were written together,
 * 3,004 of the 3,101 drawn links — 96.9% — have BOTH ends inside that one
 * bed. Retention banding does not produce one fat layer and three thin ones;
 * it produces one fat layer that swallows the entire link structure. Only 97
 * links would be visible as threads.
 *
 * The same collapse happens to any banding cut on the age VALUE, because the
 * store was not written at a steady rate: 363 of 652 memories arrive in five
 * days in July, and single memories arrive weeks apart either side of that.
 * Log-spaced age bands (under a day, under three, under a week, …) leave 404
 * memories in one band and 94.3% of links inside it.
 *
 * What does not collapse is the age RANK. Ten equal-count beds of 65 give
 * 1,029 links inside a bed and 2,072 crossing, 569 of those crossing three
 * beds or more. That is the honest division, and the cost of it is stated on
 * screen: a bed is a fixed number of memories, not a fixed amount of time, so
 * the beds are 19 days, 26 days, then five beds under a day each, then 65
 * days and 49 days. Every bed prints its real date range, so the reader can
 * see that the middle of this store is five beds of one week in July.
 *
 * Both beddings are on the switch. The retention one is not there for
 * balance; it is there so the collapse can be watched rather than asserted.
 *
 * ─── What is deliberately not here ─────────────────────────────────────────
 *
 * No bloom. It flattens the three-step strength ramp whose whole purpose is
 * three separable luminances (tokens.css measures them at 3.06–6.18:1), and
 * it is the genre's most generic move.
 *
 * No ACES. R3F tone-maps by default, which would silently move every contrast
 * and every ΔE the token layer measured on raw sRGB. Tone mapping is set to
 * NoToneMapping explicitly.
 *
 * No autorotation, under any setting. No fog, no ticking, no entrance: this
 * file contains no animation of any kind, so the reduced-motion path and the
 * ordinary path render the identical settled frame and `reducedMotion` has
 * nothing to switch. Orbit damping is off for the same reason.
 *
 * No colour on retention and none on density. Retention is a word in the bed
 * log. Density is accumulated geometry — how many threads gather on a
 * bearing, how thick a bed's inner weave becomes — never a wash, which
 * measures at 1.73:1 under a link and is below the 3:1 mark floor.
 *
 * ─── Where this could be wrong ─────────────────────────────────────────────
 *
 * Bearing is one number where the projection offers two, so two memories on
 * opposite sides of the origin at the same bearing are drawn as neighbours
 * when they are not. Radius rank separates them on screen but is not read as
 * distance by the eye. If the owner needs projection DISTANCE to be readable,
 * this is the wrong slot — the flat meaning plane is.
 *
 * And in-bed links stay short here by construction: they lie flat inside a
 * ring whose members already share a bearing, so 1,029 of 3,101 links are
 * drawn as small marks that read as bed texture rather than as individual
 * connections. That is a deliberate trade — this slot spends its legibility
 * on the 2,072 links that cross time — but it is a real loss, and a reader
 * who wants to follow one specific in-bed link has to select a memory.
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
  type RetentionBand,
} from './contract';

// ─── The encoding, as constants ─────────────────────────────────────────────

const TAU = Math.PI * 2;

/** Equal-count beds in the age bedding. Ten because the link span histogram
 *  stops paying at twelve (32.5% in-bed against 33.2% at ten) while the log
 *  gains two more rows to read. */
const AGE_BEDS = 10;

/** The ring band. Narrow on purpose: a bed has to stay a ring you can see
 *  through, not a disc. */
const RING_INNER = 20;
const RING_OUTER = 30;

/** Total stack height, FIXED across beddings so switching the bedding does
 *  not re-frame the scene under the viewer. Bed pitch is height / (beds − 1). */
const STACK_HEIGHT = 99;

/** How far bearing is pulled toward a uniform spread before it is drawn.
 *  0 keeps the projection's bearing exactly and piles co-bearing memories on
 *  top of each other; 1 is a rank transform that spreads them evenly and
 *  throws the clustering away (mean link separation goes 9.5° → 20.3°). 0.42
 *  measured out at 13.6° with the tightest in-bed pair at 0.08 world units. */
const BEARING_SPREAD = 0.42;

/** An in-bed link bows toward the middle of its own ring so that it is a
 *  visible curve rather than a two-pixel chord. Floor plus a term in the
 *  chord it spans, capped clear of the empty core. */
const WEAVE_BOW_MIN = 2.4;
const WEAVE_BOW_K = 0.34;
const WEAVE_BOW_MAX = 9;
const WEAVE_SEGMENTS = 6;

/** A crossing link bows radially OUTWARD by this much per bed it crosses, so
 *  the deepest connections are drawn outside the stack against empty plate
 *  where nothing overdraws them. Nine beds crossed reaches radius 45.3. */
const CROSS_BULGE = 1.7;
const CROSS_SEGMENTS_BASE = 4;
const CROSS_SEGMENTS_MAX = 14;

/** Line widths in CSS pixels. The field is a hairline so that 3,101 threads
 *  accumulate into readable relief instead of a solid; a selected memory's
 *  links are three times that and ignore depth, so selecting lifts them out. */
const FIELD_WIDTH = 1.25;
const FOCUS_WIDTH = 3.4;
/** What the rest of the field drops to while one memory is selected. */
const CONTEXT_OPACITY = 0.2;

/** Memory marks, in world units, by how many links touch them. Three ordinal
 *  classes rather than a continuous size, because the classes are named and
 *  counted in the key. */
const MARK_SIZES = [0.42, 0.7, 1.3] as const;
const MARK_CLASS_NAMES = ['Unlinked', 'Linked', 'Busiest'] as const;

/** Generous, because a mark is a few pixels wide. */
const PICK_RADIUS = 1.4;

const RING_SEGMENTS = 96;

const CAM_FOV = 34;
/** Low, so the reader looks THROUGH the stack rather than down onto it. */
const CAM_ELEVATION = (17 * Math.PI) / 180;
const CAM_BEARING = 2.3;

const BAND_ORDER: readonly RetentionBand[] = ['vivid', 'holding', 'fading', 'threshold'];

type Bedding = 'age' | 'retention';

const BEDDINGS: readonly { id: Bedding; name: string }[] = [
  { id: 'age', name: 'Age decile' },
  { id: 'retention', name: 'Retention band' },
];

// ─── Placement ──────────────────────────────────────────────────────────────

interface Place {
  /** Ring bearing, radians. Monotone in atan2(PC2, PC1). */
  bearing: Float64Array;
  /** Ring radius, world units, inside [RING_INNER, RING_OUTER]. */
  radius: Float64Array;
}

/**
 * Bearing and radius are the same for every bedding — only height moves — so
 * they are computed once from the projection and reused.
 */
function placeOnRing(data: ObsData): Place {
  const count = data.nodes.length;
  const bearing = new Float64Array(count);
  const radius = new Float64Array(count);
  if (count === 0) return { bearing, radius };

  const raw = new Float64Array(count);
  const reach = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const node = data.nodes[i]!;
    const angle = Math.atan2(node.y, node.x);
    raw[i] = angle < 0 ? angle + TAU : angle;
    reach[i] = Math.hypot(node.x, node.y);
  }

  const byBearing = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (raw[a]! - raw[b]!) || (a - b)
  );
  byBearing.forEach((index, rank) => {
    const uniform = (rank / count) * TAU;
    bearing[index] = (1 - BEARING_SPREAD) * raw[index]! + BEARING_SPREAD * uniform;
  });

  const byReach = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (reach[a]! - reach[b]!) || (a - b)
  );
  const span = RING_OUTER - RING_INNER;
  byReach.forEach((index, rank) => {
    radius[index] = RING_INNER + span * (count === 1 ? 0.5 : rank / (count - 1));
  });

  return { bearing, radius };
}

// ─── Bedding ────────────────────────────────────────────────────────────────

interface Bed {
  /** 0 is the top of the stack: the freshest bed. */
  index: number;
  count: number;
  /** Epoch millis of the youngest and oldest member; 0 for an empty bed. */
  newest: number;
  oldest: number;
  /** Days between them. */
  thicknessDays: number;
  /** The band most of this bed sits in, and whether every member shares it. */
  band: RetentionBand;
  unanimous: boolean;
  /** Links with both ends here, and links with exactly one end here. */
  within: number;
  crossing: number;
  y: number;
}

function bedIndices(data: ObsData, mode: Bedding): { bedOf: Int32Array; bedCount: number } {
  const count = data.nodes.length;
  const bedOf = new Int32Array(count);

  if (mode === 'retention') {
    for (let i = 0; i < count; i++) {
      const at = BAND_ORDER.indexOf(data.nodes[i]!.retentionBand);
      bedOf[i] = at < 0 ? BAND_ORDER.length - 1 : at;
    }
    return { bedOf, bedCount: BAND_ORDER.length };
  }

  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
    const gap = Date.parse(data.nodes[b]!.createdAt) - Date.parse(data.nodes[a]!.createdAt);
    if (gap !== 0) return gap;
    return data.nodes[a]!.id < data.nodes[b]!.id ? -1 : 1;
  });
  order.forEach((index, rank) => {
    bedOf[index] = Math.min(AGE_BEDS - 1, Math.floor((rank / Math.max(count, 1)) * AGE_BEDS));
  });
  return { bedOf, bedCount: AGE_BEDS };
}

const DAY_MS = 86_400_000;

function describeBeds(data: ObsData, bedOf: Int32Array, bedCount: number): Bed[] {
  const heightOf = (bed: number) =>
    bedCount <= 1 ? 0 : STACK_HEIGHT / 2 - bed * (STACK_HEIGHT / (bedCount - 1));

  const beds: Bed[] = Array.from({ length: bedCount }, (_, index) => ({
    index,
    count: 0,
    newest: 0,
    oldest: 0,
    thicknessDays: 0,
    band: 'threshold' as RetentionBand,
    unanimous: true,
    within: 0,
    crossing: 0,
    y: heightOf(index),
  }));

  const bandTally = beds.map(() => new Map<RetentionBand, number>());

  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i]!;
    const bed = beds[bedOf[i]!]!;
    const at = Date.parse(node.createdAt);
    bed.count += 1;
    bed.newest = bed.newest === 0 ? at : Math.max(bed.newest, at);
    bed.oldest = bed.oldest === 0 ? at : Math.min(bed.oldest, at);
    const tally = bandTally[bedOf[i]!]!;
    tally.set(node.retentionBand, (tally.get(node.retentionBand) ?? 0) + 1);
  }

  for (const link of data.links) {
    const a = bedOf[link.source]!;
    const b = bedOf[link.target]!;
    if (a === b) beds[a]!.within += 1;
    else {
      beds[a]!.crossing += 1;
      beds[b]!.crossing += 1;
    }
  }

  beds.forEach((bed, index) => {
    bed.thicknessDays = bed.count === 0 ? 0 : (bed.newest - bed.oldest) / DAY_MS;
    const tally = bandTally[index]!;
    let best: RetentionBand = 'threshold';
    let bestCount = -1;
    for (const band of BAND_ORDER) {
      const seen = tally.get(band) ?? 0;
      if (seen > bestCount) {
        best = band;
        bestCount = seen;
      }
    }
    bed.band = best;
    bed.unanimous = tally.size <= 1;
  });

  return beds;
}

/** The one number each bedding is judged on: how much of the link structure
 *  it buries inside a single bed. */
interface Verdict {
  bedCount: number;
  largestBed: number;
  within: number;
  crossing: number;
  deepest: number;
  /** Links with both ends in the single most populous bed. */
  buried: number;
}

function judge(data: ObsData, bedOf: Int32Array, bedCount: number): Verdict {
  const population = new Int32Array(bedCount);
  for (let i = 0; i < data.nodes.length; i++) population[bedOf[i]!] = (population[bedOf[i]!] ?? 0) + 1;
  let fattest = 0;
  for (let b = 1; b < bedCount; b++) if ((population[b] ?? 0) > (population[fattest] ?? 0)) fattest = b;

  let within = 0;
  let deepest = 0;
  let buried = 0;
  for (const link of data.links) {
    const a = bedOf[link.source]!;
    const b = bedOf[link.target]!;
    const gap = Math.abs(a - b);
    if (gap === 0) {
      within += 1;
      if (a === fattest) buried += 1;
    }
    if (gap >= 3) deepest += 1;
  }
  return {
    bedCount,
    largestBed: population[fattest] ?? 0,
    within,
    crossing: data.links.length - within,
    deepest,
    buried,
  };
}

// ─── Curves ─────────────────────────────────────────────────────────────────

interface LineBuffers {
  positions: Float32Array;
  colors: Float32Array;
  segments: number;
}

function shortestDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

function segmentsFor(crossed: number): number {
  return crossed === 0
    ? WEAVE_SEGMENTS
    : Math.min(CROSS_SEGMENTS_MAX, CROSS_SEGMENTS_BASE + crossed);
}

/**
 * Every link, or a named subset, as one interleaved segment buffer.
 *
 * In-bed links stay exactly in their bed's plane and bow toward the middle of
 * the ring; crossing links interpolate bearing, radius and height together and
 * bow outward in proportion to the beds they cross. Bow is the only thing that
 * separates the two families geometrically, and orientation does the rest.
 */
function buildLines(
  data: ObsData,
  place: Place,
  bedOf: Int32Array,
  beds: readonly Bed[],
  ramp: readonly (readonly THREE.Color[])[],
  subset: readonly number[] | null
): LineBuffers {
  const chosen = subset ?? null;
  const total = chosen ? chosen.length : data.links.length;

  let segments = 0;
  for (let k = 0; k < total; k++) {
    const link = data.links[chosen ? chosen[k]! : k]!;
    segments += segmentsFor(Math.abs(bedOf[link.source]! - bedOf[link.target]!));
  }

  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  let cursor = 0;

  for (let k = 0; k < total; k++) {
    const link = data.links[chosen ? chosen[k]! : k]!;
    const a = link.source;
    const b = link.target;
    const crossed = Math.abs(bedOf[a]! - bedOf[b]!);
    const steps = segmentsFor(crossed);

    const bearingA = place.bearing[a]!;
    const sweep = shortestDelta(bearingA, place.bearing[b]!);
    const radiusA = place.radius[a]!;
    const radiusB = place.radius[b]!;
    const heightA = beds[bedOf[a]!]!.y;
    const heightB = beds[bedOf[b]!]!.y;

    let bow: number;
    if (crossed === 0) {
      const ax = radiusA * Math.cos(bearingA);
      const az = radiusA * Math.sin(bearingA);
      const bx = radiusB * Math.cos(place.bearing[b]!);
      const bz = radiusB * Math.sin(place.bearing[b]!);
      const chord = Math.hypot(ax - bx, az - bz);
      bow = Math.min(WEAVE_BOW_MAX, WEAVE_BOW_MIN + WEAVE_BOW_K * chord);
    } else {
      bow = -CROSS_BULGE * crossed;
    }

    const colour = ramp[link.kind === 'agrees' ? 0 : 1]![link.step]!;

    let px = 0;
    let py = 0;
    let pz = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const angle = bearingA + sweep * t;
      const reach = radiusA + (radiusB - radiusA) * t - bow * Math.sin(Math.PI * t);
      const x = reach * Math.cos(angle);
      const y = heightA + (heightB - heightA) * t;
      const z = reach * Math.sin(angle);
      if (s > 0) {
        positions[cursor] = px;
        positions[cursor + 1] = py;
        positions[cursor + 2] = pz;
        positions[cursor + 3] = x;
        positions[cursor + 4] = y;
        positions[cursor + 5] = z;
        colors[cursor] = colour.r;
        colors[cursor + 1] = colour.g;
        colors[cursor + 2] = colour.b;
        colors[cursor + 3] = colour.r;
        colors[cursor + 4] = colour.g;
        colors[cursor + 5] = colour.b;
        cursor += 6;
      }
      px = x;
      py = y;
      pz = z;
    }
  }

  return { positions, colors, segments };
}

/** The bed rims: two hairline circles per bed, at the band's inner and outer
 *  edge. They are drawn in `--rule`, the token layer's own hairline, because
 *  they are structure and must never compete with a mark. */
function buildRims(beds: readonly Bed[], only: number | null): Float32Array {
  const chosen = only === null ? beds : beds.filter((bed) => bed.index === only);
  const positions = new Float32Array(chosen.length * 2 * RING_SEGMENTS * 6);
  let cursor = 0;
  for (const bed of chosen) {
    for (const radius of [RING_INNER, RING_OUTER]) {
      for (let s = 0; s < RING_SEGMENTS; s++) {
        const a = (s / RING_SEGMENTS) * TAU;
        const b = ((s + 1) / RING_SEGMENTS) * TAU;
        positions[cursor] = radius * Math.cos(a);
        positions[cursor + 1] = bed.y;
        positions[cursor + 2] = radius * Math.sin(a);
        positions[cursor + 3] = radius * Math.cos(b);
        positions[cursor + 4] = bed.y;
        positions[cursor + 5] = radius * Math.sin(b);
        cursor += 6;
      }
    }
  }
  return positions;
}

// ─── The reading ────────────────────────────────────────────────────────────

interface Reading {
  bedOf: Int32Array;
  beds: Bed[];
  verdict: Verdict;
  /** Every node's world position, for the mark layers. */
  positions: Float32Array;
  /** Node indices per mark class: unlinked, linked, busy. */
  classes: number[][];
  /** Link indices touching each node, as a CSR pair. */
  linkStart: Int32Array;
  linkList: Int32Array;
  field: LineBuffers;
  rims: Float32Array;
  /** Degree above which a memory draws in the largest mark class. */
  busyThreshold: number;
  /** Half-extent of what has to fit, vertically and horizontally. */
  halfHeight: number;
  halfWidth: number;
}

function buildReading(
  data: ObsData,
  place: Place,
  mode: Bedding,
  ramp: readonly (readonly THREE.Color[])[]
): Reading {
  const { bedOf, bedCount } = bedIndices(data, mode);
  const beds = describeBeds(data, bedOf, bedCount);
  const verdict = judge(data, bedOf, bedCount);

  const count = data.nodes.length;
  const positions = new Float32Array(count * 3);
  const classes: number[][] = [[], [], []];

  // The largest mark is the busiest quarter of the CONNECTED memories, not
  // everything above the median: the median is 7 and half the store sits above
  // it, which would make "busy" mean nothing.
  const linked = data.nodes.map((node) => node.degree).filter((degree) => degree > 0).sort((a, b) => a - b);
  const busyThreshold = linked.length === 0 ? 1 : linked[Math.floor(linked.length * 0.75)]!;

  for (let i = 0; i < count; i++) {
    const angle = place.bearing[i]!;
    const radius = place.radius[i]!;
    positions[i * 3] = radius * Math.cos(angle);
    positions[i * 3 + 1] = beds[bedOf[i]!]!.y;
    positions[i * 3 + 2] = radius * Math.sin(angle);
    const degree = data.nodes[i]!.degree;
    classes[degree === 0 ? 0 : degree > busyThreshold ? 2 : 1]!.push(i);
  }

  const linkStart = new Int32Array(count + 1);
  for (const link of data.links) {
    linkStart[link.source + 1] = (linkStart[link.source + 1] ?? 0) + 1;
    linkStart[link.target + 1] = (linkStart[link.target + 1] ?? 0) + 1;
  }
  for (let i = 0; i < count; i++) linkStart[i + 1] = (linkStart[i + 1] ?? 0) + (linkStart[i] ?? 0);
  const linkList = new Int32Array(data.links.length * 2);
  const fill = Int32Array.from(linkStart.subarray(0, count));
  for (let i = 0; i < data.links.length; i++) {
    const link = data.links[i]!;
    linkList[fill[link.source]!] = i;
    fill[link.source] = (fill[link.source] ?? 0) + 1;
    linkList[fill[link.target]!] = i;
    fill[link.target] = (fill[link.target] ?? 0) + 1;
  }

  let maxCrossed = 0;
  for (const link of data.links) {
    const gap = Math.abs(bedOf[link.source]! - bedOf[link.target]!);
    if (gap > maxCrossed) maxCrossed = gap;
  }

  return {
    bedOf,
    beds,
    verdict,
    positions,
    classes,
    linkStart,
    linkList,
    field: buildLines(data, place, bedOf, beds, ramp, null),
    rims: buildRims(beds, null),
    busyThreshold,
    halfHeight: STACK_HEIGHT / 2 + MARK_SIZES[2] * 2,
    halfWidth: RING_OUTER + CROSS_BULGE * maxCrossed,
  };
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
      });
    },
    [object]
  );
  return object;
}

function makeLineObject(buffers: LineBuffers, width: number, front: boolean): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(buffers.positions);
  geometry.setColors(buffers.colors);
  const material = new LineMaterial({
    vertexColors: true,
    worldUnits: false,
    linewidth: width,
    transparent: true,
    opacity: 1,
    depthTest: !front,
    depthWrite: !front,
    fog: false,
  });
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = front ? 20 : 1;
  return object;
}

function makeRimObject(positions: Float32Array, colour: string, front: boolean): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: new THREE.Color(colour).getHex(),
    worldUnits: false,
    linewidth: 1,
    transparent: false,
    depthTest: !front,
    depthWrite: !front,
    fog: false,
  });
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = front ? 15 : 0;
  return object;
}

/** Every link, one object, one draw call. */
function LinkField({ buffers, dimmed }: { buffers: LineBuffers; dimmed: boolean }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useMemo(() => makeLineObject(buffers, FIELD_WIDTH, false), [buffers]);
  useDisposable(object);
  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    object.material.opacity = dimmed ? CONTEXT_OPACITY : 1;
    object.material.needsUpdate = true;
    invalidate();
  }, [object, size.width, size.height, dimmed, invalidate]);
  return <primitive object={object} />;
}

/** The selected memory's links, in front of everything. */
function FocusLinks({ buffers }: { buffers: LineBuffers | null }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useMemo(
    () => (buffers ? makeLineObject(buffers, FOCUS_WIDTH, true) : null),
    [buffers]
  );
  // Disposal is keyed on the OBJECT alone. Folding it into the resolution
  // effect would free the geometry on every resize while the same object was
  // still mounted.
  useEffect(() => {
    if (!object) return;
    return () => {
      object.geometry.dispose();
      object.material.dispose();
    };
  }, [object]);
  useEffect(() => {
    if (!object) return;
    object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [object, size.width, size.height, invalidate]);
  if (!object) return null;
  return <primitive object={object} />;
}

function Rims({ positions, colour, front }: { positions: Float32Array; colour: string; front: boolean }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useMemo(() => makeRimObject(positions, colour, front), [positions, colour, front]);
  useDisposable(object);
  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [object, size.width, size.height, invalidate]);
  return <primitive object={object} />;
}

interface MarkLayerProps {
  positions: Float32Array;
  members: readonly number[];
  size: number;
  lit: ReadonlySet<number>;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

/** One ordinal size class of memory mark. Three of these cover the store. */
function MarkLayer({ positions, members, size, lit, onHover, onPick }: MarkLayerProps) {
  const invalidate = useThree((s) => s.invalidate);

  const object = useMemo(() => {
    const local = new Float32Array(members.length * 3);
    const colours = new Float32Array(members.length * 3);
    for (let k = 0; k < members.length; k++) {
      const i = members[k]!;
      local[k * 3] = positions[i * 3]!;
      local[k * 3 + 1] = positions[i * 3 + 1]!;
      local[k * 3 + 2] = positions[i * 3 + 2]!;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(local, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const material = new THREE.PointsMaterial({
      vertexColors: true,
      size,
      sizeAttenuation: true,
      fog: false,
    });
    return new THREE.Points(geometry, material);
  }, [positions, members, size]);
  useDisposable(object);

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    const live = new THREE.Color(PLATE_COLORS.memoryLive);
    const attribute = object.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let k = 0; k < members.length; k++) {
      const colour = lit.has(members[k]!) ? live : rest;
      attribute.setXYZ(k, colour.r, colour.g, colour.b);
    }
    attribute.needsUpdate = true;
    invalidate();
  }, [object, members, lit, invalidate]);

  return (
    <primitive
      object={object}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (typeof event.index === 'number') {
          const member = members[event.index];
          if (member !== undefined) onHover(member);
        }
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (typeof event.index === 'number') {
          const member = members[event.index];
          if (member !== undefined) onPick(member);
        }
      }}
    />
  );
}

interface SceneProps {
  data: ObsData;
  place: Place;
  reading: Reading;
  ramp: readonly (readonly THREE.Color[])[];
  focusIndex: number | null;
  lit: ReadonlySet<number>;
  hoveredBed: number | null;
  distance: number;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

function Scene(props: SceneProps) {
  const { data, place, reading, ramp, focusIndex, lit, hoveredBed, distance, onHover, onPick } =
    props;
  const raycaster = useThree((s) => s.raycaster);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    raycaster.params.Points = { threshold: PICK_RADIUS };
  }, [raycaster]);

  useEffect(() => {
    invalidate();
  }, [invalidate, focusIndex, hoveredBed]);

  const focusBuffers = useMemo(() => {
    if (focusIndex === null) return null;
    const from = reading.linkStart[focusIndex] ?? 0;
    const to = reading.linkStart[focusIndex + 1] ?? from;
    if (to <= from) return null;
    const subset: number[] = [];
    for (let k = from; k < to; k++) subset.push(reading.linkList[k]!);
    return buildLines(data, place, reading.bedOf, reading.beds, ramp, subset);
  }, [data, place, reading, ramp, focusIndex]);

  const litRims = useMemo(
    () => (hoveredBed === null ? null : buildRims(reading.beds, hoveredBed)),
    [reading.beds, hoveredBed]
  );

  return (
    <>
      <color attach="background" args={[PLATE_COLORS.plate]} />
      <Rims positions={reading.rims} colour={PLATE_COLORS.rule} front={false} />
      {litRims ? <Rims positions={litRims} colour={PLATE_COLORS.ink3} front /> : null}
      <LinkField buffers={reading.field} dimmed={focusIndex !== null} />
      <FocusLinks buffers={focusBuffers} />
      <MarkLayer
        positions={reading.positions}
        members={reading.classes[0]!}
        size={MARK_SIZES[0]}
        lit={lit}
        onHover={onHover}
        onPick={onPick}
      />
      <MarkLayer
        positions={reading.positions}
        members={reading.classes[1]!}
        size={MARK_SIZES[1]}
        lit={lit}
        onHover={onHover}
        onPick={onPick}
      />
      <MarkLayer
        positions={reading.positions}
        members={reading.classes[2]!}
        size={MARK_SIZES[2]}
        lit={lit}
        onHover={onHover}
        onPick={onPick}
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping={false}
        autoRotate={false}
        minDistance={distance * 0.34}
        maxDistance={distance * 2.4}
        minPolarAngle={0.16 * Math.PI}
        maxPolarAngle={0.84 * Math.PI}
      />
    </>
  );
}

// ─── Overlay ────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('en-US');
const partsOf = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `5 Sep`, or `5 Sep 2026`. Built from parts because en-GB abbreviates
 *  September to "Sept", which reads as a typo in a column beside "Aug". */
function writtenOn(at: number, withYear: boolean): string {
  const parts = partsOf.formatToParts(at);
  const take = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const stem = `${take('day')} ${take('month')}`;
  return withYear ? `${stem} ${take('year')}` : stem;
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function bedRange(bed: Bed): string {
  if (bed.count === 0) return 'empty';
  const newest = writtenOn(bed.newest, false);
  const oldest = writtenOn(bed.oldest, false);
  return newest === oldest ? newest : `${newest}\u2009\u2013\u2009${oldest}`;
}

interface LogProps {
  data: ObsData;
  reading: Reading;
  other: Verdict;
  mode: Bedding;
  roomy: boolean;
  onMode: (mode: Bedding) => void;
  onBed: (bed: number | null) => void;
}

function BedLog({ data, reading, other, mode, roomy, onMode, onBed }: LogProps) {
  const { verdict, beds } = reading;
  const drawn = data.links.length;
  const settled = beds.filter((bed) => bed.count > 0);
  const unanimous = settled.filter((bed) => bed.unanimous).length;
  const mixed = settled.filter((bed) => !bed.unanimous).map((bed) => bed.index + 1);

  return (
    <section className="str-log" aria-label="Bed log">
      <div className="str-modes" role="group" aria-label="Bedding">
        <span className="obs-label">Bedding</span>
        {BEDDINGS.map((bedding) => (
          <button
            key={bedding.id}
            type="button"
            className="str-mode"
            aria-pressed={bedding.id === mode}
            onClick={() => onMode(bedding.id)}
          >
            {bedding.name}
          </button>
        ))}
      </div>

      <p className="str-line">
        {verdict.bedCount} beds, largest {nf.format(verdict.largestBed)} of{' '}
        {nf.format(data.nodes.length)} memories.{' '}
        <span className="obs-figure">{nf.format(verdict.within)}</span> of {nf.format(drawn)} drawn
        links lie flat inside one bed ({percent(verdict.within, drawn)});{' '}
        <span className="obs-figure">{nf.format(verdict.crossing)}</span> stand up between beds,{' '}
        {nf.format(verdict.deepest)} of them across three or more.
      </p>

      <p className="str-line str-quiet">
        {nf.format(drawn)} links drawn of {nf.format(data.stats.linksStored)} stored;{' '}
        {nf.format(data.stats.linksToArchived)} point at archived memories and cannot be drawn.
        Bearing comes from the two strongest components of a projection that keeps{' '}
        {Math.round(data.stats.explainedVariance * 100)}% of the embedding — only its direction is
        read, never its distance.
      </p>

      <div className="str-table" role="table" aria-label="Beds, freshest first">
        <div className="str-head obs-label" role="row">
          <span role="columnheader" className="str-num">
            Bed
          </span>
          <span role="columnheader">Written</span>
          <span role="columnheader" className="str-num">
            Days
          </span>
          <span role="columnheader" className="str-num">
            Memories
          </span>
          <span role="columnheader" className="str-num">
            Flat
          </span>
          <span role="columnheader" className="str-num">
            Standing
          </span>
          <span role="columnheader">Retention</span>
        </div>
        {beds.map((bed) => (
          <div
            key={bed.index}
            role="row"
            className="str-row"
            onPointerEnter={() => onBed(bed.index)}
            onPointerLeave={() => onBed(null)}
          >
            <span role="cell" className="str-num str-figure">
              {bed.index + 1}
            </span>
            <span role="cell" className="str-when">
              {bedRange(bed)}
            </span>
            <span role="cell" className="str-num str-figure">
              {bed.thicknessDays < 1 ? bed.thicknessDays.toFixed(1) : Math.round(bed.thicknessDays)}
            </span>
            <span role="cell" className="str-num str-figure">
              {nf.format(bed.count)}
            </span>
            <span role="cell" className="str-num str-figure">
              {nf.format(bed.within)}
            </span>
            <span role="cell" className="str-num str-figure">
              {nf.format(bed.crossing)}
            </span>
            <span role="cell" className="str-band">
              {RETENTION_LABEL[bed.band]}
            </span>
          </div>
        ))}
      </div>

      {roomy ? (
        <p className="str-line str-quiet">
          {mode === 'age' ? (
            <>
              A bed is a fixed number of memories, not a fixed stretch of time — the store was
              written in bursts, so bed thickness runs from under a day to months. Retention follows
              age, so {unanimous} of {settled.length} beds hold a single band and the word names it;{' '}
              {mixed.length === 0
                ? 'none are mixed'
                : `bed${mixed.length > 1 ? 's' : ''} ${mixed.join(' and ')} ${
                    mixed.length > 1 ? 'are' : 'is'
                  } mixed, and the word there names the band most of the bed is in`}
              . Bedding by retention instead puts {nf.format(other.largestBed)} memories in one bed
              and buries {nf.format(other.buried)} of {nf.format(drawn)} links inside it.
            </>
          ) : (
            <>
              This is the collapse the age bedding avoids:{' '}
              {nf.format(verdict.largestBed)} of {nf.format(data.nodes.length)} memories in one bed,
              with {nf.format(verdict.buried)} of {nf.format(drawn)} links buried inside it and only{' '}
              {nf.format(verdict.crossing)} left standing. Ten equal-count age beds split the same
              store into beds of {Math.floor(data.nodes.length / other.bedCount)} and lift{' '}
              {nf.format(other.crossing)} links into the open.
            </>
          )}
        </p>
      ) : null}

    </section>
  );
}

function Key({ data, reading }: { data: ObsData; reading: Reading }) {
  const classCounts = reading.classes.map((members) => members.length);
  return (
    <section className="str-side" aria-label="Key">
      <p className="str-line">
        Height is age rank: the freshest bed on top, the oldest at the bottom. Bearing around the
        ring is the memory&rsquo;s direction in the projection, so two linked memories nearly always
        share one.
      </p>
      <p className="str-line">
        <span className="obs-figure">A link that lies flat</span> joins two memories from the same
        bed. <span className="obs-figure">A link that leans</span> is a connection across time, and
        the further it bows clear of the stack the more beds it crosses.
      </p>
      <dl className="str-key">
        <dt className="obs-label">Thread</dt>
        <dd>
          <span className="str-swatch" style={{ background: 'var(--agrees)' }} aria-hidden />
          {nf.format(data.stats.agrees)} agree
          <span className="str-swatch str-swatch-2" style={{ background: 'var(--contradicts)' }} aria-hidden />
          {nf.format(data.stats.contradicts)} contradict
        </dd>
        <dt className="obs-label">Brighter</dt>
        <dd>a stronger link, in three steps</dd>
        <dt className="obs-label">Mark</dt>
        <dd>
          {MARK_CLASS_NAMES.map((name, index) => `${name} ${nf.format(classCounts[index] ?? 0)}`).join(
            ', '
          )}{' '}
          — by links touched. The largest mark is a memory with more than{' '}
          {nf.format(reading.busyThreshold)} of them; the busiest has{' '}
          {nf.format(data.stats.degree.max)}.
        </dd>
      </dl>
    </section>
  );
}

interface ReadoutProps {
  data: ObsData;
  reading: Reading;
  index: number;
  pinned: boolean;
  onClear: () => void;
}

function Readout({ data, reading, index, pinned, onClear }: ReadoutProps) {
  const node = data.nodes[index]!;
  const from = reading.linkStart[index] ?? 0;
  const to = reading.linkStart[index + 1] ?? from;

  let lowest = reading.beds.length;
  let highest = -1;
  let deepest = 0;
  for (let k = from; k < to; k++) {
    const link = data.links[reading.linkList[k]!]!;
    const other = link.source === index ? link.target : link.source;
    const bed = reading.bedOf[other]!;
    if (bed < lowest) lowest = bed;
    if (bed > highest) highest = bed;
    const gap = Math.abs(bed - reading.bedOf[index]!);
    if (gap > deepest) deepest = gap;
  }

  const ageDays = Math.max(0, (Date.now() - Date.parse(node.createdAt)) / DAY_MS);

  return (
    <section className="str-side" aria-label="Selected memory">
      <p className="str-title">{node.label}</p>
      <p className="str-line str-quiet">
        {node.type}, {RETENTION_LABEL[node.retentionBand]}, written{' '}
        {writtenOn(Date.parse(node.createdAt), true)} — {Math.round(ageDays)} days ago
      </p>
      <p className="str-line">
        Bed <span className="obs-figure">{reading.bedOf[index]! + 1}</span> of{' '}
        {reading.beds.length}.{' '}
        {node.degree === 0 ? (
          <>No drawn link touches it — one of {nf.format(data.stats.isolated)} such memories.</>
        ) : (
          <>
            <span className="obs-figure">{nf.format(node.degree)}</span> links —{' '}
            {nf.format(node.agreeDegree)} agree, {nf.format(node.contradictDegree)} contradict.
          </>
        )}
      </p>
      {highest >= 0 ? (
        <p className="str-line">
          Reaches beds {lowest + 1} to {highest + 1}
          {deepest === 0 ? ', none of them across a boundary' : `; deepest crossing ${deepest} beds`}
          .
        </p>
      ) : null}
      {pinned ? (
        <button type="button" className="str-clear obs-label" onClick={onClear}>
          Clear selection
        </button>
      ) : null}
    </section>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function fitDistance(halfHeight: number, halfWidth: number, width: number, height: number): number {
  const fov = (CAM_FOV * Math.PI) / 180;
  const tan = Math.tan(fov / 2);
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  return Math.max(halfHeight / tan, halfWidth / (tan * aspect)) * 1.16;
}

function Plate({ data, width, height, selectedId, onSelect }: DemoProps) {
  const [webgl] = useState(hasWebGL);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoveredBed, setHoveredBed] = useState<number | null>(null);
  const [mode, setMode] = useState<Bedding>('age');

  const ramp = useMemo<readonly (readonly THREE.Color[])[]>(() => {
    const steps: (0 | 1 | 2)[] = [0, 1, 2];
    const of = (kind: LinkKind) => steps.map((step) => new THREE.Color(linkColorInt({ kind, step })));
    return [of('agrees'), of('contradicts')];
  }, []);

  const place = useMemo(() => placeOnRing(data), [data]);
  const reading = useMemo(() => buildReading(data, place, mode, ramp), [data, place, mode, ramp]);
  const other = useMemo(() => {
    const alternative: Bedding = mode === 'age' ? 'retention' : 'age';
    const { bedOf, bedCount } = bedIndices(data, alternative);
    return judge(data, bedOf, bedCount);
  }, [data, mode]);

  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    data.nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [data]);

  const selectedIndex = selectedId === null ? null : indexOf.get(selectedId) ?? null;
  const focusIndex = selectedIndex ?? hovered;

  const lit = useMemo(() => {
    const set = new Set<number>();
    if (hoveredBed !== null) {
      for (let i = 0; i < data.nodes.length; i++) if (reading.bedOf[i] === hoveredBed) set.add(i);
    }
    if (focusIndex !== null) {
      set.add(focusIndex);
      const from = reading.linkStart[focusIndex] ?? 0;
      const to = reading.linkStart[focusIndex + 1] ?? from;
      for (let k = from; k < to; k++) {
        const link = data.links[reading.linkList[k]!]!;
        set.add(link.source === focusIndex ? link.target : link.source);
      }
    }
    return set;
  }, [data, reading, focusIndex, hoveredBed]);

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      onSelect(node.id === selectedId ? null : node.id);
    },
    [data, onSelect, selectedId]
  );
  const clear = useCallback(() => onSelect(null), [onSelect]);

  // Framing is computed from the FIRST measured box and then held. Both
  // beddings share one stack height on purpose, so switching the bedding never
  // moves the camera under the viewer.
  const framing = useRef<{ distance: number; position: [number, number, number] } | null>(null);
  if (!framing.current) {
    const d = fitDistance(reading.halfHeight, reading.halfWidth, width, height);
    framing.current = {
      distance: d,
      position: [
        d * Math.cos(CAM_ELEVATION) * Math.cos(CAM_BEARING),
        d * Math.sin(CAM_ELEVATION),
        d * Math.cos(CAM_ELEVATION) * Math.sin(CAM_BEARING),
      ],
    };
  }
  const { distance, position } = framing.current;

  // The pointer can leave the canvas without the marks firing a pointerout,
  // which would stick the readout open; clear it at the box edge as well.
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const leave = () => setHovered(null);
    box.addEventListener('pointerleave', leave);
    return () => box.removeEventListener('pointerleave', leave);
  }, []);

  const summary =
    `${nf.format(data.nodes.length)} memories stacked in ${reading.verdict.bedCount} beds by ` +
    `${mode === 'age' ? 'age rank' : 'retention band'}, freshest on top, with ` +
    `${nf.format(data.links.length)} links drawn between them: ` +
    `${nf.format(reading.verdict.within)} lie flat inside a bed and ` +
    `${nf.format(reading.verdict.crossing)} stand up across beds.`;

  return (
    <div className="str-box" ref={boxRef} style={{ width, height }}>
      <style href="observatory-strata" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl ? (
        <div className="str-canvas" role="img" aria-label={summary}>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{
              antialias: true,
              // Contrast and ΔE in tokens.css were measured on raw sRGB. R3F's
              // default ACES tone mapping would move every one of them, so it
              // is set off rather than inherited.
              toneMapping: THREE.NoToneMapping,
            }}
            camera={{ fov: CAM_FOV, near: 1, far: distance * 8, position }}
            onPointerMissed={clear}
          >
            <Scene
              data={data}
              place={place}
              reading={reading}
              ramp={ramp}
              focusIndex={focusIndex}
              lit={lit}
              hoveredBed={hoveredBed}
              distance={distance}
              onHover={setHovered}
              onPick={pick}
            />
          </Canvas>
        </div>
      ) : (
        <p className="str-nogl obs-note">
          This reading is drawn with WebGL and this browser did not give the page a context. The
          measurement behind it still holds: {summary}
        </p>
      )}

      <BedLog
        data={data}
        reading={reading}
        other={other}
        mode={mode}
        roomy={height >= 620}
        onMode={setMode}
        onBed={setHoveredBed}
      />
      {focusIndex === null ? (
        <Key data={data} reading={reading} />
      ) : (
        <Readout
          data={data}
          reading={reading}
          index={focusIndex}
          pinned={selectedIndex !== null}
          onClear={clear}
        />
      )}
    </div>
  );
}

/**
 * Scoped to this demo's own box. The canvas bleeds to all four edges and the
 * two instrument sheets bleed into opposite corners on `--margin`, the token
 * layer's own reading surface: no card, no radius, no shadow, no frame
 * (rule 9). Nothing here has a transition, because nothing here moves.
 */
const SHEET_CSS = `
.str-box { position: absolute; inset: 0; overflow: hidden; }
.str-canvas { position: absolute; inset: 0; }
.str-nogl { position: absolute; inset: 0; margin: 0; padding: 28px 24px; max-width: 56ch; }

.str-log {
  position: absolute; left: 0; bottom: 0;
  width: 396px; max-width: calc(100% - 24px);
  max-height: 100%; overflow: hidden;
  padding: 14px 18px 16px 22px;
  display: flex; flex-direction: column; gap: var(--gap-block);
  background: var(--margin);
  border-top: 1px solid var(--rule); border-right: 1px solid var(--rule);
}
.str-side {
  position: absolute; right: 0; top: 0;
  width: 296px; max-width: calc(100% - 24px);
  max-height: 100%; overflow: hidden;
  padding: 14px 22px 16px 18px;
  display: flex; flex-direction: column; gap: var(--gap-row);
  background: var(--margin);
  border-bottom: 1px solid var(--rule); border-left: 1px solid var(--rule);
}

.str-line { margin: 0; font-size: var(--t-body); line-height: 1.42; color: var(--ink-2); }
.str-quiet { color: var(--ink-3); }
.str-title {
  margin: 0; font-family: var(--font-note); font-weight: 300;
  font-size: var(--t-claim); line-height: 1.32; color: var(--ink);
  overflow-wrap: anywhere;
}

.str-modes { display: flex; align-items: baseline; gap: 14px; }
.str-mode {
  font-size: var(--t-label); font-stretch: 78%; font-weight: 500;
  color: var(--ink-3); padding-bottom: 2px;
  border-bottom: 1px solid transparent;
}
.str-mode:hover { color: var(--ink-2); }
.str-mode[aria-pressed='true'] { color: var(--ink); border-bottom-color: var(--ink); }

.str-table { display: flex; flex-direction: column; }
.str-head, .str-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 26px 44px 34px 46px 66px;
  column-gap: 7px; align-items: baseline;
}
.str-head { padding-bottom: 3px; border-bottom: 1px solid var(--rule); }
.str-row {
  padding: 2px 0; font-size: var(--t-label); color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.str-row:hover { background: var(--rule); }
.str-num { text-align: right; }
.str-figure { color: var(--ink); font-weight: 500; }
.str-when, .str-band { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.str-band { color: var(--ink-3); }

.str-key { margin: 0; display: grid; grid-template-columns: 58px minmax(0, 1fr); column-gap: 10px; row-gap: 4px; }
.str-key dt { padding-top: 1px; }
.str-key dd { margin: 0; font-size: var(--t-label); color: var(--ink-2); }
.str-swatch {
  display: inline-block; width: 14px; height: 2px; vertical-align: middle;
  margin-right: 5px; transform: translateY(-1px);
}
.str-swatch-2 { margin-left: 10px; }

.str-clear {
  align-self: flex-start; margin-top: 4px; color: var(--ink-3);
  border-bottom: 1px solid var(--rule); padding-bottom: 1px;
}
.str-clear:hover { color: var(--ink); border-bottom-color: var(--ink); }
`;

export const strata: DemoModule = {
  id: 'strata',
  name: 'Strata',
  dimension: '3D',
  claim:
    'Depth spent on age rank rather than a third embedding axis: two thirds of this store’s links cross a bed boundary and stand up as legible threads, where bedding by retention would bury 97% of them inside a single bed of 564.',
  Plate,
};
