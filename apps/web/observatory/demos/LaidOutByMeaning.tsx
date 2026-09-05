/**
 * SLOT 2 of 3 — three dimensions.  "Meaning as ground."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Cosmos spent all three axes on the projection and then drew the links as
 * hairs between the resulting points. Two measurements say that could never
 * have worked, and both are on this store:
 *
 *   1. Linked memories are 7.08 apart on average against 40.81 for any two
 *      memories picked at random. Every link is therefore a short chord
 *      inside the densest part of the cloud — a smudge a few pixels long,
 *      overdrawn by its neighbours. You cannot make that visible by making it
 *      brighter, because the problem is that it has nowhere to go.
 *
 *   2. The third component of the PCA keeps 4.6% of the embedding. (PC1 keeps
 *      24.1%, PC2 9.5%; the harness reports their sum, 38.2%.) So a third of
 *      the screen volume in Cosmos was carrying a twentieth of the meaning.
 *
 * Put those together and the third axis is not the problem — it is the
 * budget. Spend it on the links instead of on a coordinate:
 *
 *   • memories lie FLAT, on PC1 × PC2, the 33.6% of the embedding that is
 *     worth reading as position. They are a stipple, `--memory`, uniform, the
 *     size of a plotted point and no larger. They are the ground.
 *
 *   • every link STANDS OFF that ground as an arc, and the vertical axis
 *     carries nothing else. Contradictions rise above the plane, agreements
 *     hang below it, and an arc is as tall as the gap the projection left
 *     between its two ends.
 *
 * The chord that was three pixels long becomes an arc twenty-four units tall.
 * Arcs from neighbouring pairs point in different directions, so they comb
 * apart into a palisade instead of piling into a smudge — which is the whole
 * answer to (1). And because there is a ground plane with a scale on it, this
 * is a landscape with a horizon rather than a cloud in a void, which is the
 * whole answer to the rejection.
 *
 * Three things fall out of the encoding that no view of this store has shown:
 *
 *   • Half of all 3,099 links stand over about 3% of the projection's
 *     footprint — one thicket of roughly 1,700 arcs over 208 memories, most
 *     of them job-generated reflections. That is "where knowledge is dense",
 *     drawn as accumulated geometry, never as a wash (rule 4).
 *   • 459 memory pairs carry BOTH an agreement and a contradiction. Signing
 *     the height by kind makes each of them a mirrored arc — a lens standing
 *     on two dots.
 *   • The tall arcs are exactly the links the projection cannot explain. Arc
 *     height IS the residual: the 62% of variance PCA threw away, made
 *     visible as relief rather than confessed in a footnote.
 *
 * ─── What is deliberately not here ─────────────────────────────────────────
 *
 * No bloom. It is the genre's most generic move and it would flatten the
 * three-step strength ramp, whose whole point is three distinguishable
 * luminances (tokens.css measures them at 3.06–6.18:1).
 *
 * No autorotation, ever — not only under `reducedMotion`. Cosmos and Clusters
 * both drifted; drift is what makes a scene feel like a screensaver instead
 * of an instrument. Nothing in this file ticks, so the reduced-motion path
 * and the normal path render the same settled frame.
 *
 * No fog on the links. Fading a mark toward `--plate` walks it down through
 * the 3:1 mark floor that tokens.css measured against that exact ground. Fog
 * is applied to the memory stipple ONLY, which is substrate and carries no
 * value beyond position — so the ground recedes with distance while every
 * link stays at its measured contrast. Depth is cued by perspective, by the
 * ground's tick scale, and by occlusion.
 *
 * ─── Where this could be wrong ─────────────────────────────────────────────
 *
 * The thicket is genuinely opaque from the outside; you can see that half the
 * links live there but you cannot read inside it without selecting a memory,
 * which pulls that memory's arcs in front of everything (depthTest off). If
 * the owner needs to read inside the dense region at rest, this slot's answer
 * is a bundled or binned aggregate, not this one.
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
  type ObsData,
  type ObsLink,
} from './contract';

// ─── The encoding, as constants ─────────────────────────────────────────────

/** Arc apex = ARC_BASE + ARC_K·√span, in the same world units as the plane.
 *  √ rather than linear because span runs 0 → 43.5 with a median of 5.7: on a
 *  linear scale the 31 links past the 99th percentile would set the vertical
 *  extent for the other 3,068. √ keeps the order intact and the whole
 *  distribution inside one frame — median 16.4 tall, widest 41.6, against a
 *  plane roughly 70 × 74. ARC_BASE lifts the 83 zero-span links (identical
 *  embeddings) clear of the ground as short spikes instead of dots. */
const ARC_BASE = 2;
const ARC_K = 6;

/** Segments per arc. Short arcs are nearly straight spikes and do not need
 *  the tessellation; this keeps the merged field at ~26k segments. */
const SEG_MIN = 5;
const SEG_MAX = 18;

/** Line widths in CSS pixels. The field is a hairline-plus so 3,099 arcs
 *  accumulate into readable relief rather than into a solid; the focused
 *  memory's arcs are twice that and ignore depth, so selecting a memory
 *  lifts its links out of the thicket. */
const FIELD_WIDTH = 1.35;
const FOCUS_WIDTH = 3;
/** What the rest of the field drops to while one memory is focused. */
const CONTEXT_OPACITY = 0.26;

/** The memory stipple: a plotted point, not a star. */
const NODE_SIZE = 0.62;
/** Half-length of the selection crosshair's three arms, in world units. */
const MARK_ARM = 2.8;

const CAM_FOV = 38;
/** Distance that puts a sphere of `radius` inside the frame on both axes.
 *  Vertical governs a landscape box; a portrait box is pushed further back
 *  rather than cropping the plane at the sides. */
function fitDistance(radius: number, width: number, height: number): number {
  const half = Math.tan(((CAM_FOV / 2) * Math.PI) / 180);
  const aspect = height > 0 ? width / height : 1;
  return radius / (half * Math.min(1, aspect));
}
/** A low three-quarter view: you look ACROSS the field, not down into it, so
 *  the skyline and the keel read as a silhouette against the plate. */
const CAM_DIR = new THREE.Vector3(0.55, 0.38, 0.74).normalize();

/** Ground ticks every this many units of PCA space. */
const TICK_STEP = 10;
const TICK_LEN = 1.8;

/** Pointer pick radius around a memory, in world units. The stipple draws at
 *  well under a world unit, so the target is generous without overlapping its
 *  neighbours in all but the densest bins. */
const PICK_RADIUS = 1.2;

/** Bins per side for the plan-of-density figure in the key. */
const DENSITY_BINS = 10;

const nf = new Intl.NumberFormat('en-US');
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

// ─── Derived measurements ───────────────────────────────────────────────────

function arcHeight(span: number): number {
  return ARC_BASE + ARC_K * Math.sqrt(span);
}

function arcSegments(span: number): number {
  return Math.max(SEG_MIN, Math.min(SEG_MAX, Math.round(SEG_MIN + span * 0.5)));
}

interface Reading {
  /** Per-component share of the embedding's variance. */
  shares: [number, number, number];
  /** PC1 + PC2 — what the plane keeps. */
  planeShare: number;
  meanLinkSpan: number;
  meanRandomSpan: number;
  medianSpan: number;
  widestSpan: number;
  /** Node pairs joined by an agreement AND a contradiction. */
  mirroredPairs: number;
  /** Plan of link density: counts per bin, largest-first cover of half. */
  grid: number[];
  maxBin: number;
  binsForHalf: number;
  footprintShare: number;
  /** Half-extent of the drawn scene, for framing the camera. */
  fitRadius: number;
}

/**
 * Everything this demo asserts on screen, derived from `data` alone so it can
 * never go stale against the store.
 *
 * The per-component variance split is not on `ObsStats` (which carries only
 * the 38.2% sum), so it is recovered from the coordinates: the server fits all
 * three components into ONE cube, scaling every axis by the same factor, so
 * the ratio of coordinate variances is the ratio of eigenvalues. Checked
 * against `/api/graph/layout`'s own `explainedVariance` on this store — it
 * reproduces 0.2410 / 0.0947 / 0.0464 to four decimals. If a future server
 * ever scaled the axes independently this split would drift, which is why the
 * authoritative total on screen stays `stats.explainedVariance`.
 */
function read(data: ObsData): Reading {
  const { nodes, links, stats } = data;
  const n = nodes.length || 1;

  const mean = (get: (i: number) => number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += get(i);
    return sum / n;
  };
  const mx = mean((i) => nodes[i]!.x);
  const my = mean((i) => nodes[i]!.y);
  const mz = mean((i) => nodes[i]!.z);
  const vx = mean((i) => (nodes[i]!.x - mx) ** 2);
  const vy = mean((i) => (nodes[i]!.y - my) ** 2);
  const vz = mean((i) => (nodes[i]!.z - mz) ** 2);
  const vt = vx + vy + vz || 1;
  const total = stats.explainedVariance;
  const shares: [number, number, number] = [
    (vx / vt) * total,
    (vy / vt) * total,
    (vz / vt) * total,
  ];

  // Every pair, exactly — 211,575 of them at 651 memories, a few milliseconds
  // once. Sampling would put a random number on screen.
  let pairSum = 0;
  let pairCount = 0;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      pairSum += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      pairCount++;
    }
  }

  const spans = links.map((l) => l.span).sort((a, b) => a - b);
  const meanLinkSpan = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0;

  const kinds = new Map<string, number>();
  let mirroredPairs = 0;
  for (const l of links) {
    const key = l.source < l.target ? `${l.source}:${l.target}` : `${l.target}:${l.source}`;
    const bit = l.kind === 'agrees' ? 1 : 2;
    const seen = kinds.get(key) ?? 0;
    if (seen !== 0 && (seen | bit) === 3 && seen !== 3) mirroredPairs++;
    kinds.set(key, seen | bit);
  }

  // Plan of density: link midpoints binned over the projection's footprint.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const grid = new Array<number>(DENSITY_BINS * DENSITY_BINS).fill(0);
  for (const l of links) {
    const a = nodes[l.source]!;
    const b = nodes[l.target]!;
    const i = Math.min(DENSITY_BINS - 1, Math.floor((((a.x + b.x) / 2 - minX) / spanX) * DENSITY_BINS));
    const j = Math.min(DENSITY_BINS - 1, Math.floor((((a.y + b.y) / 2 - minY) / spanY) * DENSITY_BINS));
    grid[j * DENSITY_BINS + i]! += 1;
  }
  const ranked = [...grid].sort((a, b) => b - a);
  let running = 0;
  let binsForHalf = 0;
  for (const count of ranked) {
    if (running * 2 >= links.length) break;
    running += count;
    binsForHalf++;
  }

  let radius = 0;
  for (const node of nodes) radius = Math.max(radius, Math.hypot(node.x, node.y));
  for (const l of links) radius = Math.max(radius, arcHeight(l.span));

  return {
    shares,
    planeShare: shares[0] + shares[1],
    meanLinkSpan,
    meanRandomSpan: pairCount ? pairSum / pairCount : 0,
    medianSpan: spans.length ? spans[Math.floor(spans.length / 2)]! : 0,
    widestSpan: spans.length ? spans[spans.length - 1]! : 0,
    mirroredPairs,
    grid,
    maxBin: ranked[0] ?? 0,
    binsForHalf,
    footprintShare: binsForHalf / (DENSITY_BINS * DENSITY_BINS),
    fitRadius: radius,
  };
}

// ─── Arc geometry ───────────────────────────────────────────────────────────

interface ArcBuffers {
  positions: Float32Array;
  colors: Float32Array;
  segments: number;
}

/**
 * One merged buffer for however many links are asked for.
 *
 * PC1 → world X, PC2 → world Z, and world Y is the link's own axis: signed by
 * kind, scaled by the gap the projection left. 3,099 arcs at ~8.5 segments
 * each is ~26,300 instanced segments in a single draw call.
 */
function buildArcs(data: ObsData, indices: readonly number[], ramp: THREE.Color[][]): ArcBuffers {
  let segments = 0;
  for (const i of indices) segments += arcSegments(data.links[i]!.span);
  if (segments === 0) return { positions: new Float32Array(0), colors: new Float32Array(0), segments: 0 };

  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  let p = 0;

  for (const i of indices) {
    const link = data.links[i]!;
    const a = data.nodes[link.source]!;
    const b = data.nodes[link.target]!;
    const steps = arcSegments(link.span);
    const apex = arcHeight(link.span) * (link.kind === 'contradicts' ? 1 : -1);
    const colour = ramp[link.kind === 'contradicts' ? 1 : 0]![link.step]!;

    let px = a.x;
    let py = 0;
    let pz = a.y;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const qx = a.x + (b.x - a.x) * t;
      const qz = a.y + (b.y - a.y) * t;
      const qy = apex * Math.sin(Math.PI * t);
      positions[p] = px;
      positions[p + 1] = py;
      positions[p + 2] = pz;
      positions[p + 3] = qx;
      positions[p + 4] = qy;
      positions[p + 5] = qz;
      colors[p] = colour.r;
      colors[p + 1] = colour.g;
      colors[p + 2] = colour.b;
      colors[p + 3] = colour.r;
      colors[p + 4] = colour.g;
      colors[p + 5] = colour.b;
      p += 6;
      px = qx;
      py = qy;
      pz = qz;
    }
  }
  return { positions, colors, segments };
}

function makeArcObject(buffers: ArcBuffers, width: number, focus: boolean): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(buffers.positions);
  geometry.setColors(buffers.colors);
  const material = new LineMaterial({
    vertexColors: true,
    worldUnits: false,
    linewidth: width,
    transparent: true,
    opacity: 1,
    depthTest: !focus,
    depthWrite: !focus,
    fog: false,
  });
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = focus ? 20 : 1;
  return object;
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

/** The whole link field: one object, one draw call. */
function ArcField(props: { data: ObsData; ramp: THREE.Color[][]; dimmed: boolean }) {
  const { data, ramp, dimmed } = props;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const object = useMemo(() => {
    const all = data.links.map((_, i) => i);
    return makeArcObject(buildArcs(data, all, ramp), FIELD_WIDTH, false);
  }, [data, ramp]);
  useDisposable(object);

  useEffect(() => {
    const material = object.material;
    material.resolution.set(size.width, size.height);
    material.opacity = dimmed ? CONTEXT_OPACITY : 1;
    material.needsUpdate = true;
    invalidate();
  }, [object, size.width, size.height, dimmed, invalidate]);

  return <primitive object={object} />;
}

/** The focused memory's links, drawn in front of everything else. */
function FocusArcs(props: { data: ObsData; ramp: THREE.Color[][]; indices: readonly number[] }) {
  const { data, ramp, indices } = props;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const object = useMemo(
    () => makeArcObject(buildArcs(data, indices, ramp), FOCUS_WIDTH, true),
    [data, indices, ramp]
  );
  useDisposable(object);

  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [object, size.width, size.height, invalidate]);

  if (indices.length === 0) return null;
  return <primitive object={object} />;
}

interface FloorProps {
  data: ObsData;
  focusIndex: number | null;
  neighbours: ReadonlySet<number>;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}

/** The memories: a flat stipple on PC1 × PC2, and the only thing fog touches. */
function MemoryFloor({ data, focusIndex, neighbours, onHover, onPick }: FloorProps) {
  const invalidate = useThree((s) => s.invalidate);

  const object = useMemo(() => {
    const count = data.nodes.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const rest = new THREE.Color(PLATE_COLORS.memory);
    for (let i = 0; i < count; i++) {
      const node = data.nodes[i]!;
      positions[i * 3] = node.x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = node.y;
      colors[i * 3] = rest.r;
      colors[i * 3 + 1] = rest.g;
      colors[i * 3 + 2] = rest.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      vertexColors: true,
      size: NODE_SIZE,
      sizeAttenuation: true,
      fog: true,
    });
    return new THREE.Points(geometry, material);
  }, [data]);
  useDisposable(object);

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    const live = new THREE.Color(PLATE_COLORS.memoryLive);
    const attribute = object.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < data.nodes.length; i++) {
      const lit = i === focusIndex || neighbours.has(i);
      const colour = lit ? live : rest;
      attribute.setXYZ(i, colour.r, colour.g, colour.b);
    }
    attribute.needsUpdate = true;
    invalidate();
  }, [object, data, focusIndex, neighbours, invalidate]);

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

/**
 * The ground: the footprint of the projection, its axes through the origin,
 * and a tick every 10 units so the plane has a scale you can count against.
 * Hairlines in `--rule`, which is what that token is for — this is a
 * reference, not a mark, and it never competes with a link.
 */
function GroundFrame({ data }: { data: ObsData }) {
  const object = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const node of data.nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minZ = Math.min(minZ, node.y);
      maxZ = Math.max(maxZ, node.y);
    }
    const pad = 3;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;

    const points: number[] = [];
    const edge = (ax: number, az: number, bx: number, bz: number) => {
      points.push(ax, 0, az, bx, 0, bz);
    };
    edge(minX, minZ, maxX, minZ);
    edge(maxX, minZ, maxX, maxZ);
    edge(maxX, maxZ, minX, maxZ);
    edge(minX, maxZ, minX, minZ);
    edge(minX, 0, maxX, 0);
    edge(0, minZ, 0, maxZ);
    for (let x = Math.ceil(minX / TICK_STEP) * TICK_STEP; x <= maxX; x += TICK_STEP) {
      edge(x, maxZ, x, maxZ - TICK_LEN);
      edge(x, minZ, x, minZ + TICK_LEN);
    }
    for (let z = Math.ceil(minZ / TICK_STEP) * TICK_STEP; z <= maxZ; z += TICK_STEP) {
      edge(minX, z, minX + TICK_LEN, z);
      edge(maxX, z, maxX - TICK_LEN, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: PLATE_COLORS.rule, fog: true });
    return new THREE.LineSegments(geometry, material);
  }, [data]);
  useDisposable(object);

  return <primitive object={object} />;
}

/** A three-axis crosshair on the focused memory — legible from any orbit, and
 *  the only marker an isolated memory gets, since it has no arcs. */
function FocusMark({ x, z }: { x: number; z: number }) {
  const object = useMemo(() => {
    const points = [
      -MARK_ARM, 0, 0, MARK_ARM, 0, 0,
      0, -MARK_ARM, 0, 0, MARK_ARM, 0,
      0, 0, -MARK_ARM, 0, 0, MARK_ARM,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({
      color: PLATE_COLORS.memoryLive,
      depthTest: false,
      fog: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 30;
    return lines;
  }, []);
  useDisposable(object);

  return <primitive object={object} position={[x, 0, z]} />;
}

// ─── The scene ──────────────────────────────────────────────────────────────

interface FieldProps extends FloorProps {
  reading: Reading;
  reducedMotion: boolean;
  focusLinks: readonly number[];
  /** Framing distance, computed once by the plate and shared with the fog. */
  distance: number;
}

function Field(props: FieldProps) {
  const { data, reading, reducedMotion, focusIndex, focusLinks, neighbours, onHover, onPick } =
    props;
  const { distance } = props;
  const invalidate = useThree((s) => s.invalidate);
  const raycaster = useThree((s) => s.raycaster);

  // A generous pick radius for a stipple drawn at a couple of pixels. Set on
  // this Canvas's own raycaster, which is created and destroyed with it.
  useEffect(() => {
    raycaster.params.Points = { threshold: PICK_RADIUS };
  }, [raycaster]);

  // Six three.js colours, built once from the token layer.
  const ramp = useMemo<THREE.Color[][]>(() => {
    const steps: (0 | 1 | 2)[] = [0, 1, 2];
    const of = (kind: ObsLink['kind']) =>
      steps.map((step) => new THREE.Color(linkColorInt({ kind, step })));
    return [of('agrees'), of('contradicts')];
  }, []);

  const focusNode = focusIndex === null ? null : data.nodes[focusIndex];

  useEffect(() => {
    invalidate();
  }, [invalidate, focusIndex]);

  return (
    <>
      <color attach="background" args={[PLATE_COLORS.plate]} />
      {/* Fog reaches the stipple only; every link material sets fog: false. */}
      <fog attach="fog" args={[PLATE_COLORS.plate, distance * 0.72, distance * 1.55]} />

      <GroundFrame data={data} />
      <MemoryFloor
        data={data}
        focusIndex={focusIndex}
        neighbours={neighbours}
        onHover={onHover}
        onPick={onPick}
      />
      <ArcField data={data} ramp={ramp} dimmed={focusIndex !== null} />
      <FocusArcs data={data} ramp={ramp} indices={focusLinks} />
      {focusNode ? <FocusMark x={focusNode.x} z={focusNode.y} /> : null}

      <OrbitControls
        makeDefault
        autoRotate={false}
        // Damping is inertia that keeps moving after the pointer stops, so it
        // is the one piece of motion here a reduced-motion viewer can refuse.
        enableDamping={!reducedMotion}
        dampingFactor={0.14}
        enablePan
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        minDistance={reading.fitRadius * 0.5}
        maxDistance={reading.fitRadius * 8}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI - 0.08}
      />
    </>
  );
}

// ─── Overlay ────────────────────────────────────────────────────────────────

/** The encoding, drawn at the same law the scene uses: apex = 2 + 6·√span,
 *  width = span, one scale for both, so the key is not a cartoon. */
function EncodingDiagram({ median, widest }: { median: number; widest: number }) {
  const W = 250;
  const H = 128;
  const plane = H / 2;
  const scale = (H / 2 - 8) / arcHeight(widest);

  const arc = (cx: number, span: number, up: boolean) => {
    const half = (span * scale) / 2;
    const rise = arcHeight(span) * scale * (4 / 3);
    const y = plane + (up ? -rise : rise);
    return `M ${cx - half} ${plane} C ${cx - half / 3} ${y}, ${cx + half / 3} ${y}, ${cx + half} ${plane}`;
  };

  const near = 62;
  const far = 172;
  const feet = [
    [near - (median * scale) / 2, near + (median * scale) / 2],
    [far - (widest * scale) / 2, far + (widest * scale) / 2],
  ].flat();

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <line x1={8} y1={plane} x2={W - 8} y2={plane} stroke="var(--rule)" strokeWidth={1} />
      {[near, far].map((cx, i) => (
        <g key={cx}>
          <path
            d={arc(cx, i === 0 ? median : widest, true)}
            fill="none"
            stroke="var(--contradicts-mid)"
            strokeWidth={2}
          />
          <path
            d={arc(cx, i === 0 ? median : widest, false)}
            fill="none"
            stroke="var(--agrees-mid)"
            strokeWidth={2}
          />
        </g>
      ))}
      {feet.map((x) => (
        <circle key={x} cx={x} cy={plane} r={2} fill="var(--memory)" />
      ))}
    </svg>
  );
}

/** Where the links stand: link midpoints binned over the plane, drawn as
 *  graduated squares. Size carries the count, never colour and never a wash. */
function DensityPlan({ grid, max }: { grid: readonly number[]; max: number }) {
  const cell = 7;
  const side = cell * DENSITY_BINS;
  return (
    <svg
      width={side}
      height={side}
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label="Plan of the projection, ten by ten bins, each square sized by the number of links standing over it"
      focusable="false"
    >
      <rect x={0.5} y={0.5} width={side - 1} height={side - 1} fill="none" stroke="var(--rule)" />
      {grid.map((count, index) => {
        if (count === 0) return null;
        const i = index % DENSITY_BINS;
        const j = Math.floor(index / DENSITY_BINS);
        const size = Math.max(1.4, cell * Math.sqrt(count / (max || 1)));
        return (
          <rect
            key={index}
            x={i * cell + (cell - size) / 2}
            // PC2 grows upward, SVG y grows down.
            y={(DENSITY_BINS - 1 - j) * cell + (cell - size) / 2}
            width={size}
            height={size}
            fill="var(--ink-2)"
          />
        );
      })}
    </svg>
  );
}

const STRENGTH_SWATCHES = [
  '--agrees-weak',
  '--agrees-mid',
  '--agrees-strong',
  '--contradicts-weak',
  '--contradicts-mid',
  '--contradicts-strong',
];

function KeySheet({ data, reading, roomy }: { data: ObsData; reading: Reading; roomy: boolean }) {
  const { stats } = data;
  return (
    <div className="bym-sheet">
      <EncodingDiagram median={reading.medianSpan} widest={reading.widestSpan} />
      <p className="bym-line">
        Memories lie flat. Every link stands off the plane as an arc, as tall as the gap the
        projection leaves between its two ends —{' '}
        <i className="bym-chip" style={{ background: 'var(--contradicts)' }} aria-hidden />
        contradictions above,{' '}
        <i className="bym-chip" style={{ background: 'var(--agrees)' }} aria-hidden />
        agreements below. {nf.format(reading.mirroredPairs)} pairs carry both kinds and stand as
        mirrored arcs.
      </p>

      <div className="bym-strength">
        <span className="obs-label">Strength</span>
        <span className="bym-swatches" aria-hidden>
          {STRENGTH_SWATCHES.map((token) => (
            <i key={token} style={{ background: `var(${token})` }} />
          ))}
        </span>
        <span className="obs-label">weak to strong, within each kind</span>
      </div>

      {roomy ? (
        <div className="bym-density">
          <DensityPlan grid={reading.grid} max={reading.maxBin} />
          <p className="bym-line">
            Half of all {nf.format(stats.linksDrawn)} links stand over{' '}
            <span className="obs-figure">{pct(reading.footprintShare, 0)}</span> of the
            projection. The busiest bin alone holds {nf.format(reading.maxBin)}; the plan says
            whether that is one thicket or several.
          </p>
        </div>
      ) : (
        <p className="bym-line">
          Half of all {nf.format(stats.linksDrawn)} links stand over{' '}
          <span className="obs-figure">{pct(reading.footprintShare, 0)}</span> of the projection;
          the busiest bin alone holds {nf.format(reading.maxBin)}.
        </p>
      )}

      <p className="bym-line bym-quiet">
        Every one of the {nf.format(stats.linksDrawn)} renderable links is drawn;{' '}
        {nf.format(stats.linksToArchived)} more point at archived memories and cannot be. Linked
        memories sit <span className="obs-figure">{reading.meanLinkSpan.toFixed(2)}</span> apart on
        average against <span className="obs-figure">{reading.meanRandomSpan.toFixed(2)}</span> for
        any two.
      </p>
      <p className="bym-line bym-quiet">
        The plane is PC1 ({pct(reading.shares[0])}) and PC2 ({pct(reading.shares[1])}) —{' '}
        {pct(reading.planeShare)} of the embedding. PC3 held {pct(reading.shares[2])} and is
        dropped, so the vertical axis carries the links instead of a third coordinate. The
        projection keeps {pct(stats.explainedVariance)} in all: distance here is a strong hint, not
        a measurement. Ticks every {TICK_STEP} units.
      </p>
    </div>
  );
}

function Readout(props: { data: ObsData; index: number; pinned: boolean; onClear: () => void }) {
  const { data, index, pinned, onClear } = props;
  const node = data.nodes[index];
  if (!node) return null;
  const cluster =
    node.degree === 0
      ? 'no drawable link'
      : node.component === 0
        ? `in the ${nf.format(data.stats.largestComponent)}-memory cluster`
        : `in a smaller cluster`;
  return (
    <div className="bym-readout" aria-live="polite">
      <p className="bym-title">{node.label}</p>
      <p className="bym-line bym-quiet">
        {node.type} · <span className="obs-figure">{node.degree}</span> links:{' '}
        <span className="obs-figure">{node.agreeDegree}</span> agree,{' '}
        <span className="obs-figure">{node.contradictDegree}</span> contradict · {cluster}
      </p>
      <p className="bym-line bym-quiet">
        {RETENTION_LABEL[node.retentionBand]} · retention{' '}
        <span className="obs-figure">{node.retention.toFixed(3)}</span> against the{' '}
        {data.stats.halfLifeDays}-day half-life
      </p>
      {pinned ? (
        <button type="button" className="bym-clear" onClick={onClear}>
          Clear selection
        </button>
      ) : (
        <p className="obs-label bym-hint">Click to keep it.</p>
      )}
    </div>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function hasWebGL(): boolean {
  // The WebGLRenderingContext check comes first so the shared jsdom smoke test
  // never reaches getContext(), which jsdom reports as an unimplemented-method
  // error on stderr. In a browser the constructor is always there.
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
  const reading = useMemo(() => read(data), [data]);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    data.nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [data]);

  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? null) : null;
  const focusIndex = selectedIndex ?? hovered;

  const { focusLinks, neighbours } = useMemo(() => {
    if (focusIndex === null) {
      return { focusLinks: [] as number[], neighbours: new Set<number>() };
    }
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

  const pick = useCallback(
    (index: number) => {
      const node = data.nodes[index];
      if (!node) return;
      onSelect(node.id === selectedId ? null : node.id);
    },
    [data, onSelect, selectedId]
  );

  const clear = useCallback(() => onSelect(null), [onSelect]);

  // Computed from the FIRST measured box and then held: re-framing the scene
  // under the viewer while they are orbiting it would be worse than a crop.
  const framing = useRef<{ distance: number; position: [number, number, number] } | null>(null);
  if (!framing.current) {
    const d = fitDistance(reading.fitRadius, width, height);
    framing.current = { distance: d, position: [CAM_DIR.x * d, CAM_DIR.y * d, CAM_DIR.z * d] };
  }
  const { distance, position } = framing.current;

  // The pointer leaves the canvas without a pointerout on the Points object
  // often enough that the readout would stick; clear it at the box edge too.
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const leave = () => setHovered(null);
    box.addEventListener('pointerleave', leave);
    return () => box.removeEventListener('pointerleave', leave);
  }, []);

  const summary =
    `${nf.format(data.stats.memories)} memories laid flat on the first two principal components, ` +
    `with ${nf.format(data.stats.linksDrawn)} links standing off that plane as arcs — ` +
    `${nf.format(data.stats.contradicts)} contradictions above it and ${nf.format(data.stats.agrees)} agreements below.`;

  return (
    <div className="bym-box" ref={boxRef} style={{ width, height }}>
      <style href="observatory-by-meaning" precedence="medium">
        {SHEET_CSS}
      </style>

      {webgl ? (
        <div className="bym-canvas" role="img" aria-label={summary}>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            gl={{
              antialias: true,
              // The token layer's contrast and ΔE were measured on raw sRGB.
              // R3F's default ACES tone mapping would quietly move every one
              // of those numbers, so it is off.
              toneMapping: THREE.NoToneMapping,
            }}
            camera={{ fov: CAM_FOV, near: 1, far: reading.fitRadius * 20, position }}
            onPointerMissed={clear}
          >
            <Field
              data={data}
              reading={reading}
              reducedMotion={reducedMotion}
              focusIndex={focusIndex}
              focusLinks={focusLinks}
              neighbours={neighbours}
              distance={distance}
              onHover={setHovered}
              onPick={pick}
            />
          </Canvas>
        </div>
      ) : (
        <p className="bym-nogl obs-note">
          This reading is drawn with WebGL, and this browser did not give the page a context. The
          measurements below still hold: {summary}
        </p>
      )}

      <KeySheet data={data} reading={reading} roomy={height >= 560} />
      {focusIndex !== null ? (
        <Readout data={data} index={focusIndex} pinned={selectedIndex !== null} onClear={clear} />
      ) : null}
    </div>
  );
}

/**
 * Scoped to this demo's own box. No card, no radius, no shadow, no frame
 * (rule 9): the canvas bleeds to all four edges and the two instrument sheets
 * bleed into opposite corners on `--margin`, the token layer's own reading
 * surface. Nothing here animates a layout property (rule 7) because nothing
 * here animates at all.
 */
const SHEET_CSS = `
.bym-box { position: absolute; inset: 0; overflow: hidden; }
.bym-canvas { position: absolute; inset: 0; }
.bym-nogl { position: absolute; inset: 0; margin: 0; padding: 28px 20px; max-width: 56ch; }

.bym-sheet {
  position: absolute; left: 0; bottom: 0; width: 282px; max-width: calc(100% - 20px);
  padding: 14px 16px 14px 20px;
  display: flex; flex-direction: column; gap: var(--gap-block);
  background: var(--margin);
  border-top: 1px solid var(--rule); border-right: 1px solid var(--rule);
}
.bym-readout {
  position: absolute; right: 0; top: 0; width: 268px; max-width: calc(100% - 20px);
  padding: 14px 20px 14px 16px;
  display: flex; flex-direction: column; gap: var(--gap-row);
  background: var(--margin);
  border-bottom: 1px solid var(--rule); border-left: 1px solid var(--rule);
}

.bym-line { margin: 0; font-size: var(--t-body); line-height: 1.42; color: var(--ink-2); }
.bym-quiet { color: var(--ink-3); }
.bym-title {
  margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: var(--lead-tight);
  color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.bym-hint { margin: 2px 0 0; }

.bym-strength { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bym-swatches { display: inline-flex; gap: 1px; }
.bym-swatches i { display: block; width: 15px; height: 5px; }
.bym-chip {
  display: inline-block; width: 3px; height: 0.85em;
  margin-right: 5px; vertical-align: -0.06em;
}

.bym-density { display: flex; align-items: flex-start; gap: 12px; }
.bym-density svg { flex: 0 0 auto; }

.bym-clear {
  align-self: flex-start; margin-top: 4px;
  font-size: var(--t-label); font-stretch: 78%; font-weight: 500;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  opacity: 0.72;
  transition: opacity var(--dur) var(--ease);
}
.bym-clear:hover { opacity: 1; }
`;

export const laidOutByMeaning: DemoModule = {
  id: 'by-meaning',
  name: 'Meaning as ground',
  dimension: '3D',
  claim:
    'The third principal component holds 4.6% of the embedding, so this spends the third axis on the links instead of on a coordinate: memories lie flat on the two components that mean something, and every link stands off that floor as an arc — contradictions above, agreements below — as tall as the gap the projection left between its two ends.',
  Plate,
};
