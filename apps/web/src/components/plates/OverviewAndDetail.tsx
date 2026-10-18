/**
 * SLOT 3 of 3 — 3D. "Where, then what."
 *
 * ─── The argument, unchanged ───────────────────────────────────────────────
 *
 * Three thousand links over six hundred memories is a hairball at any layout
 * and in any number of dimensions, so the overview here never draws a link. It
 * sorts the memories into link-dense blocks and puts ONE MARK on every pair of
 * blocks: the mark's AREA is how many links join them, and its vertical cut is
 * how many of those agree against how many contradict. Density is geometry —
 * a bigger square — exactly as rule 4 requires, and the store's block
 * structure reads in one glance with not a single edge on screen.
 *
 * The detail then draws real edges, but only for the one region you point at:
 * every link inside the pointed-at cell, each one an arc, coloured by kind and
 * level by the token ramp, with the memories named in running text beside
 * them. That is the half that answers "what exactly is connected to what", and
 * it is the only place in the app where a contradiction can be read as a
 * sentence rather than counted.
 *
 * ─── Why this is now one 3D scene ──────────────────────────────────────────
 *
 * The two halves used to be two boxes side by side, and they needed 980px of
 * canvas to sit together. The dashboard gives this plate 928×826 at a
 * 1440×900 viewport and 768×726 at 1280×800, so on every ordinary laptop the
 * plate fell back to a stacked layout: the lattice squeezed into a square in
 * the top-left corner with the whole right half of its band empty, the detail
 * halved, and the key not rendering at all.
 *
 * Depth fixes both halves, and it fixes them differently.
 *
 * THE OVERVIEW. A lower-triangular lattice wants a square. Re-indexed by
 * `u = row + col` across and `v = row − col` into depth, the same triangle
 * becomes a DELTA — a wide, shallow field whose front edge is the diagonal
 * (links inside one block) and whose apex is the far corner (links between the
 * two most distant blocks). Laid on a floor plane and seen from 34° above and
 * 10° to the side, its depth axis foreshortens to a little over half, so the
 * field costs about a third of the box's height instead of a square of its
 * width. That is the space this re-authoring buys: the overview now spans the
 * whole width of the box at the bottom, and the detail owns everything above.
 *
 * THE DETAIL. Its old failure was worse than cramped: at 928 wide it drew 26
 * of the focused cell's 231 links, because a flat arc diagram stacks arcs on
 * top of each other and adding more only makes a smear. Here the memories
 * stand on one vertical rail and each link bows out from it at its own
 * AZIMUTH, so arcs that would coincide in a plane separate in depth. Every
 * link between two shown memories is drawn, and the lantern that results is
 * itself a reading — a fat one means the region argues with itself.
 *
 * The two are tied by a stem: a line in the scene from the ringed cell on the
 * floor up to the foot of the rail. Point at another cell and the stem swings.
 *
 * ─── Why the camera does not move ──────────────────────────────────────────
 *
 * It is orthographic, fixed, and scaled so that one world unit is one CSS
 * pixel. Three things follow, and all three are load-bearing:
 *
 *   · A mark's area on screen is exactly its area in the data. The DOM size
 *     key beside the field is drawn with the same function at the same pixel
 *     sizes, so a mark can be measured against it.
 *   · The rail is the vertical axis through the origin, so its beads land on
 *     fixed screen rows and the memory names beside them never reflow.
 *   · A wide, shallow delta swings badly under azimuth: at ±13° its screen
 *     height grows by 39% and it would climb into the detail. Free orbit and
 *     this composition cannot both be had, and the composition is the point.
 *
 * ─── How the blocks are found ──────────────────────────────────────────────
 *
 * Deterministic label propagation over the link graph: every memory starts as
 * its own label, then repeatedly takes the commonest label among its
 * neighbours, visiting in descending-degree order and breaking ties by the
 * smaller label so the result is reproducible and does not depend on a random
 * seed. It converges on this store in seven passes at modularity 0.62 — real
 * community structure, not an artefact. Neighbourhoods larger than a block are
 * sliced into consecutive blocks; everything smaller is packed together; the
 * memories with no link at all get the last block, which is why the right-hand
 * end of the delta's front edge is empty. That emptiness is a finding, so the
 * outline of the field is drawn whether or not a mark lands in it.
 *
 * Measured on this store, ordering by community puts 52% of all links within
 * one block of the diagonal, against 19% for a degree ordering — which is the
 * whole reason the delta reads as a bright front edge rather than as fog.
 *
 * ─── Rules held ────────────────────────────────────────────────────────────
 *
 * 3  No colour literal anywhere in this file. DOM and SVG take `var(--…)`;
 *    the scene takes `PLATE_COLORS` and `linkColorInt`, and the two aggregate
 *    fills are the mid step of each ramp, which IS `--agrees` / `--contradicts`.
 * 4  Density is the area of a mark and the length of a marginal bar. There is
 *    no wash, no ramp, no tinted ground, and no lighting — every material is
 *    `MeshBasicMaterial` so a colour on screen is the colour that was measured.
 * 5  Retention is the RADIUS of a bead, and its band is named in the key and
 *    on the live row.
 * 6  Nothing animates in, nothing rotates, nothing ticks. The camera is fixed,
 *    so `reducedMotion` has only the DOM transitions left to cut, and it cuts
 *    them.
 * 7  Only `opacity` transitions; the row transforms are static placements.
 * 8  Every subset states its real denominator against `data.stats`.
 * 9  The canvas bleeds to four edges. No card, no radius, no shadow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  PLATE_COLORS,
  RETENTION_LABEL,
  highlightIndices,
  linkColorInt,
  type DemoModule,
  type DemoProps,
  type ObsData,
  type ObsLink,
  type RetentionBand,
} from '../../lib/plate/contract.js';

// ─── Token helpers ──────────────────────────────────────────────────────────

const STEP_NAME = ['weak', 'mid', 'strong'] as const;

/** The three-step ramp, as a token reference. Used where a single link's own
 *  strength is shown — the arcs take the same ramp through `linkColorInt`. */
function linkVar(kind: ObsLink['kind'], step: 0 | 1 | 2): string {
  return `var(--${kind}-${STEP_NAME[step]})`;
}

/** The identity without its level. Used for aggregates, where a level would be
 *  an average of things that should not be averaged. */
const AGREES = 'var(--agrees)';
const CONTRADICTS = 'var(--contradicts)';

/** Same two identities for the scene, where a CSS variable cannot be read.
 *  The mid step of each ramp is the identity: `--agrees-mid` IS `--agrees`. */
function agreeInt(): number {
  return parseInt(PLATE_COLORS.agrees[1].slice(1), 16);
}
function contradictInt(): number {
  return parseInt(PLATE_COLORS.contradicts[1].slice(1), 16);
}

/** Retention as radius — never as colour. Bands run strongest first. */
const RETENTION_RADIUS: Record<RetentionBand, number> = {
  vivid: 5,
  holding: 4,
  fading: 3.1,
  threshold: 2.2,
};

const RETENTION_ORDER: RetentionBand[] = ['vivid', 'holding', 'fading', 'threshold'];

const nf = new Intl.NumberFormat('en-US');


// ─── Structure: communities → blocks → lattice cells ────────────────────────

interface Region {
  name: string;
  size: number;
  firstBlock: number;
  lastBlock: number;
}

interface Block {
  members: number[];
  region: number;
  /** Position of this block within its region, and how many the region has. */
  slice: number;
  slices: number;
}

interface Cell {
  row: number;
  col: number;
  agrees: number;
  contradicts: number;
  total: number;
}

interface Structure {
  blocks: Block[];
  regions: Region[];
  blockOf: Int32Array;
  cells: Map<number, Cell>;
  cellList: Cell[];
  maxCell: number;
  medianCell: number;
  rowTotals: number[];
  /** Of those, the ones that agree — the marginal bar's split. */
  rowAgrees: number[];
  maxRowTotal: number;
  neighbourhoods: number;
  smallClusters: number;
  isolated: number;
  densest: Cell | null;
}

/**
 * Deterministic label propagation. Visiting order is fixed (descending degree,
 * then index) and ties go to the smaller label, so two runs on the same store
 * always agree — a plate that reshuffled its own blocks between renders would
 * be unreadable.
 */
function detectCommunities(data: ObsData): Int32Array {
  const count = data.nodes.length;
  const adjacency: number[][] = data.nodes.map(() => []);
  for (const link of data.links) {
    adjacency[link.source]!.push(link.target);
    adjacency[link.target]!.push(link.source);
  }
  const label = new Int32Array(count);
  for (let i = 0; i < count; i++) label[i] = i;

  const visit = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => data.nodes[b]!.degree - data.nodes[a]!.degree || a - b
  );

  for (let pass = 0; pass < 30; pass++) {
    let changed = 0;
    for (const v of visit) {
      const neighbours = adjacency[v]!;
      if (neighbours.length === 0) continue;
      const tally = new Map<number, number>();
      for (const w of neighbours) {
        const key = label[w]!;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      let best = label[v]!;
      let bestCount = tally.get(best) ?? 0;
      for (const [candidate, n] of tally) {
        if (n > bestCount || (n === bestCount && candidate < best)) {
          best = candidate;
          bestCount = n;
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

function buildStructure(data: ObsData, targetBlocks: number): Structure {
  const label = detectCommunities(data);

  const groups = new Map<number, number[]>();
  data.nodes.forEach((_, i) => {
    const key = label[i]!;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });

  const byDegree = (a: number, b: number) =>
    data.nodes[b]!.degree - data.nodes[a]!.degree || (data.nodes[a]!.id < data.nodes[b]!.id ? -1 : 1);

  const ranked = [...groups.entries()]
    .map(([key, list]) => ({ key, list: list.sort(byDegree) }))
    .sort((a, b) => b.list.length - a.list.length || a.key - b.key);

  const target = Math.max(6, Math.ceil(data.nodes.length / Math.max(1, targetBlocks)));
  // A community earns its own named region — and therefore its own diagonal
  // cell — at half a block. Below that it is packed with the other stragglers,
  // because a bracket per two-memory cluster is a picket fence, not a reading.
  const named = Math.max(5, Math.ceil(target / 2));
  const linked = ranked.filter((g) => g.list.length > 1);
  const singles = ranked.filter((g) => g.list.length === 1).flatMap((g) => g.list);
  const large = linked.filter((g) => g.list.length >= named);
  const small = linked.filter((g) => g.list.length < named);

  const blocks: Block[] = [];
  const regions: Region[] = [];

  large.forEach((group, index) => {
    const slices = Math.max(1, Math.ceil(group.list.length / target));
    const per = Math.ceil(group.list.length / slices);
    const first = blocks.length;
    for (let s = 0; s < slices; s++) {
      const members = group.list.slice(s * per, (s + 1) * per);
      if (members.length === 0) continue;
      blocks.push({ members, region: regions.length, slice: blocks.length - first, slices });
    }
    regions.push({
      name: `Neighbourhood ${index + 1}`,
      size: group.list.length,
      firstBlock: first,
      lastBlock: blocks.length - 1,
    });
  });

  if (small.length > 0) {
    const flat = small.flatMap((g) => g.list);
    const first = blocks.length;
    const slices = Math.max(1, Math.ceil(flat.length / target));
    const per = Math.ceil(flat.length / slices);
    for (let s = 0; s < slices; s++) {
      const members = flat.slice(s * per, (s + 1) * per);
      if (members.length === 0) continue;
      blocks.push({ members, region: regions.length, slice: blocks.length - first, slices });
    }
    regions.push({
      name: `${small.length} smaller clusters`,
      size: flat.length,
      firstBlock: first,
      lastBlock: blocks.length - 1,
    });
  }

  if (singles.length > 0) {
    const first = blocks.length;
    blocks.push({ members: singles, region: regions.length, slice: 0, slices: 1 });
    regions.push({
      name: `${singles.length} with no link`,
      size: singles.length,
      firstBlock: first,
      lastBlock: first,
    });
  }

  const blockOf = new Int32Array(data.nodes.length);
  blocks.forEach((block, i) => {
    for (const member of block.members) blockOf[member] = i;
  });

  const width = Math.max(1, blocks.length);
  const cells = new Map<number, Cell>();
  for (const link of data.links) {
    let row = blockOf[link.source]!;
    let col = blockOf[link.target]!;
    if (row < col) [row, col] = [col, row];
    const key = row * width + col;
    let cell = cells.get(key);
    if (!cell) {
      cell = { row, col, agrees: 0, contradicts: 0, total: 0 };
      cells.set(key, cell);
    }
    cell.total++;
    if (link.kind === 'agrees') cell.agrees++;
    else cell.contradicts++;
  }

  const rowTotals = new Array<number>(width).fill(0);
  const rowAgrees = new Array<number>(width).fill(0);
  for (const cell of cells.values()) {
    rowTotals[cell.row] = rowTotals[cell.row]! + cell.total;
    rowAgrees[cell.row] = rowAgrees[cell.row]! + cell.agrees;
    if (cell.row !== cell.col) {
      rowTotals[cell.col] = rowTotals[cell.col]! + cell.total;
      rowAgrees[cell.col] = rowAgrees[cell.col]! + cell.agrees;
    }
  }

  const cellList = [...cells.values()].sort((a, b) => b.total - a.total);
  const sortedTotals = cellList.map((c) => c.total);

  return {
    blocks,
    regions,
    blockOf,
    cells,
    cellList,
    maxCell: sortedTotals[0] ?? 1,
    medianCell: sortedTotals[Math.floor(sortedTotals.length / 2)] ?? 1,
    rowTotals,
    rowAgrees,
    maxRowTotal: rowTotals.reduce((a, b) => Math.max(a, b), 1),
    neighbourhoods: large.length,
    smallClusters: small.length,
    isolated: singles.length,
    densest: cellList[0] ?? null,
  };
}

/** Area-proportional above a visible floor: a single link still has to be seen. */
const SIDE_FLOOR = 2.4;
function markSide(count: number, max: number, full: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return full;
  return SIDE_FLOOR + (full - SIDE_FLOOR) * Math.sqrt((count - 1) / (max - 1));
}

function blockName(structure: Structure, index: number): string {
  const block = structure.blocks[index];
  if (!block) return `Block ${index + 1}`;
  const region = structure.regions[block.region];
  if (!region) return `Block ${index + 1}`;
  return block.slices > 1 ? `${region.name}, block ${block.slice + 1} of ${block.slices}` : region.name;
}

// ─── The projection ─────────────────────────────────────────────────────────
//
// Orthographic, fixed, one world unit to one CSS pixel. The camera sits 34°
// above the floor and 10° round from straight on: enough obliquity that the
// two lattice directions read as a plane receding, little enough that the
// delta keeps its width. Everything below is derived from those two angles, so
// changing either moves the whole composition consistently.

const DEG = Math.PI / 180;
const AZIMUTH = 10 * DEG;
const ELEVATION = 34 * DEG;
const SA = Math.sin(AZIMUTH);
const CA = Math.cos(AZIMUTH);
const SE = Math.sin(ELEVATION);
const CE = Math.cos(ELEVATION);

/** Camera basis. `DIRV` points from the target toward the camera. */
const RIGHT = new THREE.Vector3(CA, 0, -SA);
const UPV = new THREE.Vector3(-SA * SE, CE, -CA * SE);
const DIRV = new THREE.Vector3(SA * CE, SE, CA * CE);
/** A camera-facing quad's rotation. Constant, because the camera is. */
const FACING = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(RIGHT, UPV, DIRV)
);
const CAM_DIST = 4000;

/** Screen offset of a world point from the screen position of the origin. */
function projX(x: number, y: number, z: number): number {
  void y;
  return x * CA - z * SA;
}
function projY(x: number, y: number, z: number): number {
  return SA * SE * x - CE * y + CA * SE * z;
}

// ─── Scene plan ─────────────────────────────────────────────────────────────

/** Marginal bars reach this many depth steps in front of the diagonal. */
const BAR_STEPS = 4;
const BAR_INSET = 0.55;
const PAD = 22;

interface Plan {
  width: number;
  height: number;
  /** Blocks the field is cut into — as many as the field can carry. */
  blocks: number;
  /** Half-extent along u, and full extent along v, in world units. */
  ax: number;
  bz: number;
  hx: number;
  hz: number;
  /** Screen position of the world origin — the foot of the rail. */
  originX: number;
  originY: number;
  /** The biggest a mark may be before it touches its neighbour. */
  markFull: number;
  /** The rail's screen band, and the screen row the field's apex sits on. */
  coreTop: number;
  coreHeight: number;
  bandTop: number;
  /** Where the arcs may reach, and where the panels sit. */
  reach: number;
  keyWidth: number;
  titleLeft: number;
  titleWidth: number;
  labelLeft: number;
  labelWidth: number;
  /** False when the key would run under the rail's arcs (a narrow box): the
   *  title then takes the key's place, and the caption above the box and the
   *  title's own figures carry what the key would have said. */
  showKey: boolean;
  /** True when the box is too small to carry the field and the rail at once. */
  degenerate: boolean;
}

/**
 * How wide the field may be drawn. The marginal fringe leans a little further
 * left than the field's own corner, so the fit is against a slightly narrower
 * budget than the box; past 1080 a wider field only spreads the same marks
 * thinner, so it stops there and the box keeps the margin.
 */
function fieldWidth(width: number): number {
  return Math.min(width - PAD * 2 - 18, 1080);
}

/** How fine to cut the store, before the structure decides how many blocks
 *  that actually comes to. Wider box, finer cut, smaller regions to read. */
function targetBlocks(width: number): number {
  return Math.max(12, Math.min(30, Math.round(fieldWidth(width) / 32)));
}

function planScene(width: number, height: number, blocks: number): Plan {
  const originX = Math.round(width / 2);
  const deltaW = fieldWidth(width);
  const bandH = Math.max(120, Math.min(Math.round(height * 0.31), Math.round(deltaW * 0.32), 320));

  const ax = deltaW / (2 * CA);
  // Solved so the field's projected height — front edge, marginal fringe and
  // far apex — is exactly `bandH`.
  const bz = Math.max(
    40,
    (bandH / SE - ax * SA) / (CA * (1 + (BAR_INSET + BAR_STEPS) / Math.max(1, blocks - 1)))
  );
  const hx = ax / Math.max(1, blocks - 1);
  const hz = bz / Math.max(1, blocks - 1);

  // The two lattice directions are (Δu, Δv) = (1, ±1); a mark must clear the
  // tighter of them.
  const sep = Math.min(
    Math.hypot(projX(hx, 0, -hz), projY(hx, 0, -hz)),
    Math.hypot(projX(hx, 0, hz), projY(hx, 0, hz))
  );
  const markFull = Math.max(4, Math.min(sep - 1.6, 17));

  const fringeZ = (BAR_INSET + BAR_STEPS) * hz;
  const lowest = SE * (ax * SA + fringeZ * CA);
  const originY = height - 14 - lowest;
  const bandTop = originY - SE * Math.max(bz * CA, ax * SA);

  const reach = Math.max(84, Math.min(Math.round(width * 0.16), 230));
  const keyRoom = originX - reach - 46;
  const showKey = keyRoom >= 150;
  const keyWidth = Math.min(keyRoom, 300);
  const titleLeft = showKey ? PAD + keyWidth + 24 : PAD;
  const titleWidth = Math.max(180, width - titleLeft - 20);
  const labelLeft = originX + 16;
  const labelWidth = Math.max(120, Math.min(width - labelLeft - 18, 400));

  const coreTop = 92;
  const coreHeight = Math.max(0, bandTop - 26 - coreTop);

  return {
    width,
    height,
    blocks,
    ax,
    bz,
    hx,
    hz,
    originX,
    originY,
    markFull,
    coreTop,
    coreHeight,
    bandTop,
    reach,
    keyWidth,
    titleLeft,
    titleWidth,
    labelLeft,
    labelWidth,
    showKey,
    degenerate: coreHeight < 120 || width < 380,
  };
}

/** Floor position of a lattice cell: `u` runs across, `v` runs into depth. */
function cellPoint(row: number, col: number, plan: Plan): { x: number; z: number } {
  const u = row + col - (plan.blocks - 1);
  const v = row - col;
  return { x: u * plan.hx, z: -v * plan.hz };
}

// ─── Disposal ───────────────────────────────────────────────────────────────

/**
 * Frees everything three allocates outside React's knowledge. The dashboard
 * mounts and unmounts five plates as the viewer clicks the chooser and a
 * browser caps live WebGL contexts near eight, so a leaked buffer here turns
 * into a black plate a few clicks later.
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

// ─── The floor: lines, marks, marginal bars, pick targets ───────────────────

interface FloorLinesProps {
  structure: Structure;
  plan: Plan;
  focus: { row: number; col: number };
  echoBlock: number | null;
}

/** The field's outline, its region chevrons, and the crosshair through the
 *  cell the detail is holding. Nothing here encodes a quantity. */
function FloorLines({ structure, plan, focus, echoBlock }: FloorLinesProps) {
  const object = useDisposable(
    useMemo(() => {
      const n = plan.blocks;
      const frame: number[] = [];
      const push = (a: { x: number; z: number }, b: { x: number; z: number }) => {
        frame.push(a.x, 0, a.z, b.x, 0, b.z);
      };
      const p = (row: number, col: number) => cellPoint(row, col, plan);

      // Outline: the two receding edges. The front edge is the spine and is
      // drawn separately, brighter, because it is the row a reader starts on.
      push(p(0, 0), p(n - 1, 0));
      push(p(n - 1, n - 1), p(n - 1, 0));

      // A region boundary is a chevron opening back from the front edge: the
      // row line above it and the column line beside it, which in this
      // indexing are the two lattice directions.
      for (const region of structure.regions.slice(1)) {
        const b = region.firstBlock;
        push(p(b, b), p(b, 0));
        push(p(b, b), p(n - 1, b));
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(frame, 3));
      const material = new THREE.LineBasicMaterial({ color: PLATE_COLORS.rule, fog: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      return lines;
    }, [structure, plan])
  );

  const spine = useDisposable(
    useMemo(() => {
      const a = cellPoint(0, 0, plan);
      const b = cellPoint(plan.blocks - 1, plan.blocks - 1, plan);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([a.x, 0, a.z, b.x, 0, b.z], 3)
      );
      const material = new THREE.LineBasicMaterial({
        color: PLATE_COLORS.ink3,
        transparent: true,
        opacity: 0.42,
        fog: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 1;
      return lines;
    }, [plan])
  );

  const cross = useDisposable(
    useMemo(() => {
      const n = plan.blocks;
      const pts: number[] = [];
      const p = (row: number, col: number) => cellPoint(row, col, plan);
      const rows = new Set<number>([focus.row, focus.col]);
      if (echoBlock !== null) rows.add(echoBlock);
      for (const b of rows) {
        if (b < 0 || b >= n) continue;
        const a1 = p(b, 0);
        const a2 = p(b, b);
        pts.push(a1.x, 0, a1.z, a2.x, 0, a2.z);
        const c1 = p(b, b);
        const c2 = p(n - 1, b);
        pts.push(c1.x, 0, c1.z, c2.x, 0, c2.z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const material = new THREE.LineBasicMaterial({
        color: PLATE_COLORS.ink3,
        transparent: true,
        opacity: 0.55,
        fog: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 2;
      return lines;
    }, [plan, focus.row, focus.col, echoBlock])
  );

  return (
    <>
      <primitive object={object} />
      <primitive object={spine} />
      <primitive object={cross} />
    </>
  );
}

/**
 * One mark per block pair. The square's AREA is the number of links; the cut
 * across it is how many agree against how many contradict. The quads face the
 * camera, so a mark measures the same anywhere in the field and against the
 * key — the whole reason the camera is fixed.
 */
function Marks({ structure, plan }: { structure: Structure; plan: Plan }) {
  const built = useMemo(() => {
    const cells = structure.cellList;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const make = (colour: number) => {
      const material = new THREE.MeshBasicMaterial({ color: colour, toneMapped: false, fog: false });
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      mesh.count = 0;
      return mesh;
    };
    const agreeMesh = make(agreeInt());
    const againstMesh = make(contradictInt());

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    // Lifted toward the camera so a mark never fights the floor lines for the
    // same depth.
    const lift = DIRV.clone().multiplyScalar(2);
    let a = 0;
    let c = 0;
    for (const cell of cells) {
      const side = markSide(cell.total, structure.maxCell, plan.markFull);
      if (side <= 0) continue;
      const both = cell.agrees > 0 && cell.contradicts > 0;
      const gap = both && side >= 6 ? 1 : 0;
      const usable = side - gap;
      const agreeW = both
        ? Math.max(0.8, usable * (cell.agrees / cell.total))
        : cell.agrees > 0
          ? side
          : 0;
      const againstW = both ? Math.max(0.8, usable - agreeW) : cell.contradicts > 0 ? side : 0;
      const point = cellPoint(cell.row, cell.col, plan);
      const base = new THREE.Vector3(point.x, 0, point.z).add(lift);
      if (agreeW > 0) {
        position.copy(base).addScaledVector(RIGHT, -side / 2 + agreeW / 2);
        scale.set(agreeW, side, 1);
        matrix.compose(position, FACING, scale);
        agreeMesh.setMatrixAt(a++, matrix);
      }
      if (againstW > 0) {
        position.copy(base).addScaledVector(RIGHT, side / 2 - againstW / 2);
        scale.set(againstW, side, 1);
        matrix.compose(position, FACING, scale);
        againstMesh.setMatrixAt(c++, matrix);
      }
    }
    agreeMesh.count = a;
    againstMesh.count = c;
    agreeMesh.instanceMatrix.needsUpdate = true;
    againstMesh.instanceMatrix.needsUpdate = true;
    return { agreeMesh, againstMesh, geometry };
  }, [structure, plan]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      (built.agreeMesh.material as THREE.Material).dispose();
      (built.againstMesh.material as THREE.Material).dispose();
      built.agreeMesh.dispose();
      built.againstMesh.dispose();
    },
    [built]
  );

  return (
    <>
      <primitive object={built.agreeMesh} />
      <primitive object={built.againstMesh} />
    </>
  );
}

/**
 * The marginal fringe: one bar per block, lying flat in front of the diagonal,
 * whose LENGTH is every link that touches that block and whose split is how
 * many of them agree. Density as geometry at the block scale, where the marks
 * carry it at the pair scale.
 */
function Fringe({ structure, plan }: { structure: Structure; plan: Plan }) {
  const built = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const n = plan.blocks;
    const make = (colour: number) => {
      const material = new THREE.MeshBasicMaterial({ color: colour, toneMapped: false, fog: false });
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      mesh.count = 0;
      return mesh;
    };
    const agreeMesh = make(agreeInt());
    const againstMesh = make(contradictInt());
    const matrix = new THREE.Matrix4();
    const none = new THREE.Quaternion();
    const barW = Math.max(2, plan.hx * 0.6);
    let a = 0;
    let c = 0;
    for (let b = 0; b < n; b++) {
      const total = structure.rowTotals[b] ?? 0;
      if (total <= 0) continue;
      const agrees = structure.rowAgrees[b] ?? 0;
      const full = (total / structure.maxRowTotal) * BAR_STEPS * plan.hz;
      const point = cellPoint(b, b, plan);
      const z0 = point.z + BAR_INSET * plan.hz;
      const aLen = full * (agrees / total);
      const cLen = full - aLen;
      if (aLen > 0.4) {
        matrix.compose(
          new THREE.Vector3(point.x, 0, z0 + aLen / 2),
          none,
          new THREE.Vector3(barW, 1, aLen)
        );
        agreeMesh.setMatrixAt(a++, matrix);
      }
      if (cLen > 0.4) {
        matrix.compose(
          new THREE.Vector3(point.x, 0, z0 + aLen + cLen / 2),
          none,
          new THREE.Vector3(barW, 1, cLen)
        );
        againstMesh.setMatrixAt(c++, matrix);
      }
    }
    agreeMesh.count = a;
    againstMesh.count = c;
    agreeMesh.instanceMatrix.needsUpdate = true;
    againstMesh.instanceMatrix.needsUpdate = true;
    return { agreeMesh, againstMesh, geometry };
  }, [structure, plan]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      (built.agreeMesh.material as THREE.Material).dispose();
      (built.againstMesh.material as THREE.Material).dispose();
      built.agreeMesh.dispose();
      built.againstMesh.dispose();
    },
    [built]
  );

  return (
    <>
      <primitive object={built.agreeMesh} />
      <primitive object={built.againstMesh} />
    </>
  );
}

/** Invisible camera-facing squares, one per populated cell, so a mark two
 *  pixels across is still worth pointing at. */
function CellPicks({
  structure,
  plan,
  onHover,
  onChoose,
}: {
  structure: Structure;
  plan: Plan;
  onHover: (cell: Cell | null) => void;
  onChoose: (cell: Cell) => void;
}) {
  const mesh = useMemo(() => {
    const cells = structure.cellList;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
    instanced.frustumCulled = false;
    instanced.renderOrder = 8;
    const matrix = new THREE.Matrix4();
    const size = Math.max(9, plan.markFull + 2);
    const lift = DIRV.clone().multiplyScalar(4);
    cells.forEach((cell, i) => {
      const point = cellPoint(cell.row, cell.col, plan);
      matrix.compose(
        new THREE.Vector3(point.x, 0, point.z).add(lift),
        FACING,
        new THREE.Vector3(size, size, 1)
      );
      instanced.setMatrixAt(i, matrix);
    });
    instanced.count = cells.length;
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
  }, [structure, plan]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [mesh]
  );

  return (
    <primitive
      object={mesh}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const id = event.instanceId;
        if (id !== undefined) onHover(structure.cellList[id] ?? null);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const id = event.instanceId;
        const cell = id === undefined ? null : structure.cellList[id];
        if (cell) onChoose(cell);
      }}
    />
  );
}

/** The ring around the cell the detail is holding, and the stem from it up to
 *  the foot of the rail. This is the binding, drawn rather than implied. */
function Tether({
  plan,
  cell,
  railBottom,
  railTop,
  ringed,
}: {
  plan: Plan;
  cell: { row: number; col: number };
  railBottom: number;
  railTop: number;
  ringed: boolean;
}) {
  const object = useDisposable(
    useMemo(() => {
      const point = cellPoint(cell.row, cell.col, plan);
      const pts: number[] = [
        point.x,
        0.5,
        point.z,
        0,
        railBottom - 14,
        0,
        0,
        railBottom - 14,
        0,
        0,
        railTop,
        0,
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const material = new THREE.LineBasicMaterial({
        color: PLATE_COLORS.ink3,
        transparent: true,
        opacity: 0.7,
        fog: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 10;
      return lines;
    }, [plan, cell.row, cell.col, railBottom, railTop])
  );

  const ring = useDisposable(
    useMemo(() => {
      const point = cellPoint(cell.row, cell.col, plan);
      const s = plan.markFull / 2 + 2.5;
      const corner = [
        [-s, -s],
        [s, -s],
        [s, s],
        [-s, s],
      ] as const;
      const pts: number[] = [];
      const base = new THREE.Vector3(point.x, 0, point.z).addScaledVector(DIRV, 6);
      const v = new THREE.Vector3();
      for (let i = 0; i < 4; i++) {
        const a = corner[i]!;
        const b = corner[(i + 1) % 4]!;
        v.copy(base).addScaledVector(RIGHT, a[0]).addScaledVector(UPV, a[1]);
        pts.push(v.x, v.y, v.z);
        v.copy(base).addScaledVector(RIGHT, b[0]).addScaledVector(UPV, b[1]);
        pts.push(v.x, v.y, v.z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const material = new THREE.LineBasicMaterial({ color: PLATE_COLORS.ink, fog: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 12;
      return lines;
    }, [plan, cell.row, cell.col])
  );

  return (
    <>
      <primitive object={object} />
      {ringed ? <primitive object={ring} /> : null}
    </>
  );
}

// ─── The core: beads and the lantern of arcs ────────────────────────────────

interface Lantern {
  positions: Float32Array;
  colors: Float32Array;
  start: Int32Array;
  length: Int32Array;
  ends: { a: number; b: number }[];
}

const ARC_SEGMENTS = 16;

/**
 * Every link between two shown memories, as an arc bowing out from the rail.
 * The bow's AZIMUTH is spread deterministically, so two links that share both
 * endpoints — 459 such pairs on this store — separate in depth instead of one
 * hiding the other, and a bundle of parallel arcs opens into a lantern rather
 * than smearing into a band.
 */
function buildLantern(
  links: ObsLink[],
  position: Map<number, number>,
  y: (row: number) => number,
  reach: number
): Lantern {
  const kept: { link: ObsLink; a: number; b: number; rank: number }[] = [];
  const seen = new Map<string, number>();
  for (const link of links) {
    const a = position.get(link.source);
    const b = position.get(link.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    kept.push({ link, a, b, rank });
  }
  // Agreements first, so a contradiction is never buried under one.
  kept.sort((x, z) => (x.link.kind === z.link.kind ? 0 : x.link.kind === 'agrees' ? -1 : 1));

  const perArc = ARC_SEGMENTS * 2 * 3;
  const positions = new Float32Array(kept.length * perArc);
  const colors = new Float32Array(kept.length * perArc);
  const start = new Int32Array(kept.length);
  const length = new Int32Array(kept.length);
  const ends: { a: number; b: number }[] = [];
  const colour = new THREE.Color();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const cur = new THREE.Vector3();
  const prev = new THREE.Vector3();

  // The rail's full height, which is what "a long arc" is measured against.
  const span = Math.max(1, Math.abs(y(0) - y(Math.max(0, position.size - 1))));

  kept.forEach((arc, index) => {
    const ya = y(arc.a);
    const yb = y(arc.b);
    const dy = Math.abs(yb - ya);
    // Short arcs need the widest fan — they are the ones that pile up. The
    // hash is on both endpoints and takes 29 values, because a coarser spread
    // gathers the arcs into a handful of ribs and the ribs read as structure
    // that is not there.
    const fan = (38 - 21 * Math.min(1, dy / (span * 0.55))) * DEG;
    const base = (((arc.a * 9 + arc.b * 23) % 29) / 14) * 1 - 1;
    const psi = Math.max(-50 * DEG, Math.min(50 * DEG, base * fan + arc.rank * 13 * DEG));
    const out = Math.min(reach, 22 + dy * 0.56);
    const dx = -Math.cos(psi) * out;
    const dz = Math.sin(psi) * out;

    p0.set(0, ya, 0);
    p1.set(0, yb, 0);
    c1.set(dx, ya, dz);
    c2.set(dx, yb, dz);

    colour.set(linkColorInt(arc.link));
    const offset = index * perArc;
    start[index] = offset;
    length[index] = perArc;
    ends.push({ a: arc.a, b: arc.b });
    prev.copy(p0);
    let p = offset;
    for (let s = 1; s <= ARC_SEGMENTS; s++) {
      const t = s / ARC_SEGMENTS;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      cur.set(
        p0.x * w0 + c1.x * w1 + c2.x * w2 + p1.x * w3,
        p0.y * w0 + c1.y * w1 + c2.y * w2 + p1.y * w3,
        p0.z * w0 + c1.z * w1 + c2.z * w2 + p1.z * w3
      );
      positions[p] = prev.x;
      positions[p + 1] = prev.y;
      positions[p + 2] = prev.z;
      positions[p + 3] = cur.x;
      positions[p + 4] = cur.y;
      positions[p + 5] = cur.z;
      colors[p] = colour.r;
      colors[p + 1] = colour.g;
      colors[p + 2] = colour.b;
      colors[p + 3] = colour.r;
      colors[p + 4] = colour.g;
      colors[p + 5] = colour.b;
      p += 6;
      prev.copy(cur);
    }
  });

  return { positions, colors, start, length, ends };
}

function makeArcObject(
  positions: Float32Array,
  colors: Float32Array,
  linewidth: number,
  overlay: boolean
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions.length > 0 ? positions : new Float32Array(6));
  geometry.setColors(colors.length > 0 ? colors : new Float32Array(6));
  const material = new LineMaterial({
    vertexColors: true,
    worldUnits: false,
    linewidth,
    transparent: true,
    opacity: 1,
    depthTest: !overlay,
    depthWrite: !overlay,
    fog: false,
  });
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = overlay ? 22 : 14;
  return object;
}

function ArcField({ lantern, dimmed }: { lantern: Lantern; dimmed: boolean }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => makeArcObject(lantern.positions, lantern.colors, 1.1, false), [lantern])
  );
  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    object.material.opacity = dimmed ? 0.22 : 0.82;
    invalidate();
  }, [object, size.width, size.height, dimmed, invalidate]);
  return <primitive object={object} />;
}

function ArcFocus({ lantern, indices }: { lantern: Lantern; indices: readonly number[] }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const object = useDisposable(
    useMemo(() => {
      let total = 0;
      for (const k of indices) total += lantern.length[k] ?? 0;
      const positions = new Float32Array(total);
      const colors = new Float32Array(total);
      let p = 0;
      for (const k of indices) {
        const from = lantern.start[k] ?? 0;
        const len = lantern.length[k] ?? 0;
        positions.set(lantern.positions.subarray(from, from + len), p);
        colors.set(lantern.colors.subarray(from, from + len), p);
        p += len;
      }
      return makeArcObject(positions, colors, 2.1, true);
    }, [lantern, indices])
  );
  useEffect(() => {
    object.material.resolution.set(size.width, size.height);
    invalidate();
  }, [object, size.width, size.height, invalidate]);
  return <primitive object={object} />;
}

/** The memories of the region, standing on the rail. Radius is retention. */
function Beads({
  data,
  shown,
  y,
  live,
  touching,
  onHover,
  onPick,
}: {
  data: ObsData;
  shown: number[];
  y: (row: number) => number;
  live: number | null;
  touching: Set<number> | null;
  onHover: (row: number | null) => void;
  onPick: (row: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useDisposable(
    useMemo(() => {
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        toneMapped: false,
        fog: false,
        transparent: true,
      });
      const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, shown.length));
      instanced.frustumCulled = false;
      instanced.renderOrder = 26;
      instanced.count = shown.length;
      const matrix = new THREE.Matrix4();
      const neutral = new THREE.Color(PLATE_COLORS.memory);
      shown.forEach((index, i) => {
        const node = data.nodes[index]!;
        const r = RETENTION_RADIUS[node.retentionBand];
        matrix.makeScale(r, r, r);
        matrix.setPosition(0, y(i), 0);
        instanced.setMatrixAt(i, matrix);
        instanced.setColorAt(i, neutral);
      });
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      return instanced;
    }, [data, shown, y])
  );

  useEffect(() => {
    const rest = new THREE.Color(PLATE_COLORS.memory);
    // Derived from the tokens, never typed: a memory outside the focus is the
    // neutral mark mixed back toward the ground it sits on.
    const back = new THREE.Color(PLATE_COLORS.memory).lerp(new THREE.Color(PLATE_COLORS.plate), 0.6);
    const lit = new THREE.Color(PLATE_COLORS.memoryLive);
    for (let i = 0; i < shown.length; i++) {
      let colour = rest;
      if (touching) colour = touching.has(i) ? rest : back;
      if (i === live) colour = lit;
      mesh.setColorAt(i, colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [mesh, shown, live, touching, invalidate]);

  return (
    <primitive
      object={mesh}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (event.instanceId !== undefined) onHover(event.instanceId);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (event.instanceId !== undefined) onPick(event.instanceId);
      }}
    />
  );
}

/** The whole camera, set once per box. R3F is told to keep its hands off the
 *  frustum, because the frustum is the layout. */
function CameraRig({ plan }: { plan: Plan }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera & { manual?: boolean };
    ortho.manual = true;
    ortho.left = -plan.originX;
    ortho.right = plan.width - plan.originX;
    ortho.top = plan.originY;
    ortho.bottom = plan.originY - plan.height;
    ortho.near = 1;
    ortho.far = CAM_DIST * 3;
    ortho.position.set(DIRV.x * CAM_DIST, DIRV.y * CAM_DIST, DIRV.z * CAM_DIST);
    ortho.up.set(0, 1, 0);
    ortho.lookAt(0, 0, 0);
    ortho.updateProjectionMatrix();
    invalidate();
  }, [camera, plan, invalidate]);
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

const STILL = 'oad-still';
const NO_ARCS: readonly number[] = [];

function Plate({ data, width, height, reducedMotion, selectedId, onSelect, highlightedIds }: DemoProps) {
  // The active search's hits, lit while nothing is hovered or selected.
  const matches = useMemo(() => highlightIndices(data.nodes, highlightedIds), [data.nodes, highlightedIds]);
  // The structure decides how many blocks the store actually comes to, and the
  // field is then fitted to that number. Fitting to the *target* instead would
  // put the last few blocks outside the outline they are supposed to sit in.
  const target = useMemo(() => targetBlocks(Math.max(1, width)), [width]);
  const structure = useMemo(() => buildStructure(data, target), [data, target]);
  const plan = useMemo(
    () => planScene(Math.max(1, width), Math.max(1, height), Math.max(2, structure.blocks.length)),
    [width, height, structure.blocks.length]
  );

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    data.nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [data]);

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

  // The focused cell is remembered by one representative memory from each side,
  // so a resize that re-blocks the store keeps the viewer where they were.
  const [anchors, setAnchors] = useState<[number, number] | null>(null);
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [activeRow, setActiveRow] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const focus = useMemo(() => {
    const fallback = structure.densest;
    if (!anchors) {
      if (!fallback) return { row: 0, col: 0 };
      return { row: fallback.row, col: fallback.col };
    }
    let row = structure.blockOf[anchors[0]] ?? 0;
    let col = structure.blockOf[anchors[1]] ?? 0;
    if (row < col) [row, col] = [col, row];
    return { row, col };
  }, [anchors, structure]);

  const chooseCell = useCallback(
    (cell: { row: number; col: number }) => {
      const rowBlock = structure.blocks[cell.row];
      const colBlock = structure.blocks[cell.col];
      if (!rowBlock || !colBlock) return;
      setAnchors([rowBlock.members[0]!, colBlock.members[0]!]);
      onSelect(null);
    },
    [structure, onSelect]
  );

  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? null) : null;

  // The subgraph the detail draws: either one memory's neighbours, or every
  // link the focused cell stands for.
  const view = useMemo(() => {
    if (selectedIndex !== null) {
      const links = data.links.filter((l) => l.source === selectedIndex || l.target === selectedIndex);
      const members = new Set<number>([selectedIndex]);
      for (const link of links) {
        members.add(link.source);
        members.add(link.target);
      }
      return { links, members: [...members], anchor: selectedIndex };
    }
    const { row, col } = focus;
    const links = data.links.filter((l) => {
      let a = structure.blockOf[l.source]!;
      let b = structure.blockOf[l.target]!;
      if (a < b) [a, b] = [b, a];
      return a === row && b === col;
    });
    const members = new Set<number>();
    for (const link of links) {
      members.add(link.source);
      members.add(link.target);
    }
    return { links, members: [...members], anchor: null as number | null };
  }, [data, structure, focus, selectedIndex]);

  const degreeInView = useMemo(() => {
    const map = new Map<number, number>();
    for (const link of view.links) {
      map.set(link.source, (map.get(link.source) ?? 0) + 1);
      map.set(link.target, (map.get(link.target) ?? 0) + 1);
    }
    return map;
  }, [view.links]);

  const ordered = useMemo(() => {
    const rest = view.members.filter((m) => m !== view.anchor);
    rest.sort(
      (a, b) =>
        (degreeInView.get(b) ?? 0) - (degreeInView.get(a) ?? 0) ||
        data.nodes[b]!.degree - data.nodes[a]!.degree ||
        (data.nodes[a]!.id < data.nodes[b]!.id ? -1 : 1)
    );
    return view.anchor === null ? rest : [view.anchor, ...rest];
  }, [view.members, view.anchor, degreeInView, data]);

  const rowH = Math.max(
    13,
    Math.min(21, Math.floor(plan.coreHeight / Math.max(1, ordered.length)))
  );
  const capacity = Math.max(1, Math.floor(plan.coreHeight / rowH));
  const shown = useMemo(() => ordered.slice(0, capacity), [ordered, capacity]);

  const position = useMemo(() => {
    const map = new Map<number, number>();
    shown.forEach((m, i) => map.set(m, i));
    return map;
  }, [shown]);

  // Screen rows first, world second: the rail is the vertical axis through the
  // origin, so a bead's screen y is fixed and its world y follows from it.
  //
  // The rail hangs from the bottom of its band rather than the top, so a cell
  // holding two memories stands just above the field it was pulled out of on a
  // short stem, instead of floating at the top of the box on a long one.
  const railFoot = plan.coreTop + plan.coreHeight;
  const rowScreenY = useCallback(
    (i: number) => railFoot - rowH * (shown.length - i - 0.5),
    [railFoot, rowH, shown.length]
  );
  const rowWorldY = useCallback(
    (i: number) => (plan.originY - rowScreenY(i)) / CE,
    [plan.originY, rowScreenY]
  );

  const lantern = useMemo(
    () => buildLantern(view.links, position, rowWorldY, plan.reach),
    [view.links, position, rowWorldY, plan.reach]
  );

  const live = hoverRow ?? (view.anchor !== null ? 0 : null);

  const touching = useMemo(() => {
    if (live === null) {
      // Nothing focused: the search's hits among the rows on show, if any.
      const hits = new Set<number>();
      shown.forEach((index, i) => {
        if (matches.has(index)) hits.add(i);
      });
      return hits.size > 0 ? hits : null;
    }
    const set = new Set<number>([live]);
    for (const arc of lantern.ends) {
      if (arc.a === live) set.add(arc.b);
      else if (arc.b === live) set.add(arc.a);
    }
    return set;
  }, [live, lantern, shown, matches]);

  const focusArcs = useMemo<readonly number[]>(() => {
    if (live === null) return NO_ARCS;
    const out: number[] = [];
    lantern.ends.forEach((arc, k) => {
      if (arc.a === live || arc.b === live) out.push(k);
    });
    return out;
  }, [live, lantern]);

  const echoBlock = hoverRow !== null ? (structure.blockOf[shown[hoverRow] ?? 0] ?? null) : null;

  const bothKinds = useMemo(() => {
    const kinds = new Map<string, Set<string>>();
    for (const link of view.links) {
      const key =
        link.source < link.target ? `${link.source}:${link.target}` : `${link.target}:${link.source}`;
      const set = kinds.get(key) ?? new Set<string>();
      set.add(link.kind);
      kinds.set(key, set);
    }
    return [...kinds.values()].filter((s) => s.size > 1).length;
  }, [view.links]);

  useEffect(() => {
    setActiveRow(0);
    setHoverRow(null);
  }, [view.links]);

  const move = useCallback(
    (dRow: number, dCol: number) => {
      const count = structure.blocks.length;
      let row = focus.row;
      let col = focus.col;
      for (let step = 0; step < count; step++) {
        row += dRow;
        col += dCol;
        if (row < 0 || row >= count || col < 0 || col > row) return;
        if (structure.cells.has(row * count + col)) {
          chooseCell({ row, col });
          return;
        }
      }
    },
    [focus, structure, chooseCell]
  );

  const onSceneKeyDown = (event: React.KeyboardEvent) => {
    const map: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const delta = map[event.key];
    if (!delta) return;
    event.preventDefault();
    move(delta[0], delta[1]);
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = Math.max(
      0,
      Math.min(shown.length - 1, activeRow + (event.key === 'ArrowDown' ? 1 : -1))
    );
    setActiveRow(next);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-row="${next}"]`)?.focus();
  };

  const pickRow = useCallback(
    (i: number) => {
      const index = shown[i];
      if (index === undefined) return;
      const node = data.nodes[index]!;
      onSelect(node.id === selectedId ? null : node.id);
    },
    [shown, data.nodes, onSelect, selectedId]
  );

  const title =
    view.anchor !== null
      ? data.nodes[view.anchor]!.label
      : focus.row === focus.col
        ? `Inside ${blockName(structure, focus.row)}`
        : `${blockName(structure, focus.row)} × ${blockName(structure, focus.col)}`;

  // Rule 8: whenever this half shows a subset, it says so against the store's
  // own totals rather than against the subset it happens to have chosen.
  const truncated = lantern.ends.length < view.links.length || shown.length < view.members.length;
  const subLine = [
    truncated
      ? `${nf.format(lantern.ends.length)} of ${nf.format(
          view.links.length
        )} links drawn, between ${nf.format(shown.length)} of ${nf.format(
          view.members.length
        )} memories`
      : `all ${nf.format(view.links.length)} links between ${nf.format(view.members.length)} memories`,
    bothKinds > 0 ? `${nf.format(bothKinds)} pairs both agree and contradict` : null,
    `of ${nf.format(data.stats.linksDrawn)} links across ${nf.format(data.stats.memories)} memories in the store`,
  ]
    .filter(Boolean)
    .join(' · ');

  const fieldSummary =
    `${nf.format(data.stats.memories)} memories ordered into ${structure.blocks.length} blocks by ` +
    `what they link to — ${structure.neighbourhoods} neighbourhoods, ${structure.smallClusters} ` +
    `smaller clusters, ${structure.isolated} with no link at all. All ` +
    `${nf.format(data.stats.linksDrawn)} renderable links of the store's ` +
    `${nf.format(data.stats.linksStored)} are counted on the field and none is drawn.`;
  // The rail's own figures only belong in the summary when the rail is on
  // screen; in the short-box fallback below there is nothing for them to
  // describe.
  const summary = plan.degenerate ? fieldSummary : `${fieldSummary} On the rail beside it: ${subLine}.`;

  const root: React.CSSProperties = { position: 'absolute', inset: 0, background: 'var(--plate)' };
  const railBottomWorld = rowWorldY(Math.max(0, shown.length - 1));
  const railTopWorld = rowWorldY(0);

  return (
    <div className={reducedMotion ? `oad ${STILL}` : 'oad'} style={root}>
      <style href="plate-overview-detail" precedence="medium">
        {CSS}
      </style>

      {webgl && !plan.degenerate ? (
        <div
          className="oad-canvas"
          role="group"
          tabIndex={0}
          aria-label={`Link density field, ${structure.blocks.length} blocks. Arrow keys move between cells. ${summary}`}
          onKeyDown={onSceneKeyDown}
          onPointerLeave={() => {
            // R3F only fires `pointerout` while the ray is the thing that
            // moved. Leaving the canvas for a label row is a DOM event, so the
            // tip has to be released here or it sticks to the last mark.
            setHoverCell(null);
            setHoverRow(null);
          }}
        >
          <Canvas
            orthographic
            frameloop="demand"
            dpr={[1, 2]}
            gl={{
              antialias: true,
              // The token layer's contrast and ΔE were measured on raw sRGB.
              // R3F's ACES default would silently move every one of those
              // numbers, so tone mapping is named rather than inherited.
              toneMapping: THREE.NoToneMapping,
            }}
            onPointerMissed={() => onSelect(null)}
          >
            <CameraRig plan={plan} />
            <FloorLines structure={structure} plan={plan} focus={focus} echoBlock={echoBlock} />
            <Fringe structure={structure} plan={plan} />
            <Marks structure={structure} plan={plan} />
            <Tether
              plan={plan}
              cell={
                selectedIndex !== null
                  ? {
                      row: structure.blockOf[selectedIndex] ?? 0,
                      col: structure.blockOf[selectedIndex] ?? 0,
                    }
                  : focus
              }
              railBottom={railBottomWorld}
              railTop={railTopWorld}
              ringed={selectedIndex === null}
            />
            <ArcField lantern={lantern} dimmed={live !== null} />
            {live !== null ? <ArcFocus lantern={lantern} indices={focusArcs} /> : null}
            <Beads
              data={data}
              shown={shown}
              y={rowWorldY}
              live={live}
              touching={touching}
              onHover={setHoverRow}
              onPick={pickRow}
            />
            <CellPicks
              structure={structure}
              plan={plan}
              onHover={setHoverCell}
              onChoose={chooseCell}
            />
          </Canvas>
        </div>
      ) : (
        // Short boxes get the compact voice rather than the reading voice:
        // the denominators rule 8 owes have to be on screen, and Spectral at
        // --t-claim cannot put them there in 200 pixels of height.
        <p className={`oad-nogl ${height < 430 ? 'obs-label oad-nogl-tight' : 'obs-note'}`}>
          {webgl
            ? 'This area is too small to draw the field and the list together. '
            : 'This reading is drawn with WebGL and this browser did not give the page a context. '}
          The measurements still hold: {summary}
        </p>
      )}

      {plan.degenerate ? null : (
      <header className="oad-head" style={{ left: plan.titleLeft, width: plan.titleWidth }}>
        <h2 className="oad-title">{title}</h2>
        <p className="obs-label oad-sub">{subLine}</p>
        {selectedId ? (
          <button type="button" className="oad-back" onClick={() => onSelect(null)}>
            Back to {blockName(structure, focus.row)}
            {focus.row === focus.col ? '' : ` × ${blockName(structure, focus.col)}`}
          </button>
        ) : null}
      </header>
      )}

      {!plan.degenerate && plan.showKey ? (
        <FieldKey
          data={data}
          structure={structure}
          plan={plan}
          left={PAD}
          top={plan.coreTop + 6}
        />
      ) : null}

      <div
        className="oad-rows"
        ref={listRef}
        role="listbox"
        aria-label="Memories in this region"
        onKeyDown={onListKeyDown}
        onMouseLeave={() => setHoverRow(null)}
        style={{ display: plan.degenerate ? 'none' : undefined }}
      >
        {shown.map((index, i) => {
          const node = data.nodes[index]!;
          const dim = touching !== null && !touching.has(i);
          return (
            <button
              key={node.id}
              type="button"
              role="option"
              aria-selected={node.id === selectedId}
              data-row={i}
              tabIndex={i === activeRow ? 0 : -1}
              className={
                'oad-row' +
                (node.id === selectedId ? ' oad-row-on' : '') +
                (live === i ? ' oad-row-live' : '') +
                (dim ? ' oad-row-dim' : '')
              }
              style={{
                transform: `translate3d(${plan.labelLeft}px, ${rowScreenY(i) - rowH / 2}px, 0)`,
                width: plan.labelWidth,
                height: rowH,
              }}
              onMouseEnter={() => {
                setHoverRow(i);
                setHoverCell(null);
              }}
              onFocus={() => {
                setHoverRow(i);
                setActiveRow(i);
              }}
              onClick={() => pickRow(i)}
            >
              <span className="oad-row-label">{node.label}</span>
              <span className="oad-row-figs">
                {live === i ? (
                  <span className="oad-row-band">{RETENTION_LABEL[node.retentionBand]}</span>
                ) : null}
                <span className="obs-figure oad-row-here">
                  {nf.format(degreeInView.get(index) ?? 0)}
                </span>
                <span className="oad-row-all">/{nf.format(node.degree)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {hoverCell && !plan.degenerate ? (
        <CellTip cell={hoverCell} structure={structure} plan={plan} />
      ) : null}
    </div>
  );
}

// ─── Sheets ─────────────────────────────────────────────────────────────────

function CellTip({ cell, structure, plan }: { cell: Cell; structure: Structure; plan: Plan }) {
  const point = cellPoint(cell.row, cell.col, plan);
  const sx = plan.originX + projX(point.x, 0, point.z);
  const sy = plan.originY + projY(point.x, 0, point.z);
  const left = Math.max(10, Math.min(plan.width - 232, sx + 12));
  const top = Math.max(10, Math.min(plan.height - 74, sy - 56));
  return (
    <div className="oad-tip" style={{ left, top }}>
      <div className="obs-label oad-tip-title">
        {blockName(structure, cell.row)}
        {cell.row === cell.col ? '' : ` × ${blockName(structure, cell.col)}`}
      </div>
      <div className="oad-tip-figures">
        <span className="obs-figure">{nf.format(cell.total)}</span>
        <span className="oad-tip-unit">links</span>
        <span className="oad-swatch" style={{ background: AGREES }} />
        <span className="obs-figure">{nf.format(cell.agrees)}</span>
        <span className="oad-swatch" style={{ background: CONTRADICTS }} />
        <span className="obs-figure">{nf.format(cell.contradicts)}</span>
      </div>
    </div>
  );
}

/**
 * The field's key: how big a mark of a given size is, and the denominators
 * the field is drawn against. It sits over the empty upper-left of the box,
 * clear of both the arcs and the field, and is left out of a box too narrow
 * for that (`plan.showKey`). What a mark IS is the caption's job, above the
 * box.
 *
 * What it may say is decided by the room between the title and the field's
 * apex. Lines are added in order of what the plate owes a reader — the size
 * ramp that makes a mark measurable, the band names, then the two
 * denominators rule 8 owes — and the flourishes only go in if they still fit.
 * Nothing is clipped mid-sentence.
 */
function FieldKey({
  data,
  structure,
  plan,
  left,
  top,
}: {
  data: ObsData;
  structure: Structure;
  plan: Plan;
  left: number;
  top: number;
}) {
  const width = plan.keyWidth;
  const room = plan.bandTop - top - 12;

  const linksLong =
    `All ${nf.format(data.stats.linksDrawn)} drawable links are counted here; none is drawn as a ` +
    `line. The bars along the front edge count every link touching that block.`;
  const linksShort = `All ${nf.format(data.stats.linksDrawn)} drawable links are counted here.`;
  const blocksLong =
    `${nf.format(data.stats.memories)} memories in ${structure.blocks.length} blocks by what they ` +
    `link to: ${structure.neighbourhoods} neighbourhoods, ${structure.smallClusters} smaller ` +
    `clusters and ${structure.isolated} with no links.`;
  const blocksShort =
    `${nf.format(data.stats.memories)} memories in ${structure.blocks.length} blocks.`;
  const bandsText =
    'Bead size is how fresh a memory is: ' +
    RETENTION_ORDER.map((band) => `${RETENTION_LABEL[band]} ${data.stats.retention[band]}`).join(' · ');
  const hintLong =
    'Point at a square to see which blocks it joins, or click it to list them on the right; ' +
    'arrow keys move across the field. Click a memory in the list for its own links.';
  const hintShort = 'Click a square to list its memories; click a memory for its links.';

  // There is no text metrics API here, so the panel is fitted arithmetically.
  // `.obs-label` sets Archivo at 12px, which runs about 6.2px to the
  // character over an 18px line. Word wrap makes any such estimate a line out
  // either way, so a line of slack is allowed — the DOM order below is the
  // priority order, which means an overshoot can only ever clip the least
  // important line on the panel.
  const footCols = Math.max(12, Math.floor(width / 6.2));
  const footCost = (text: string) => Math.ceil(text.length / footCols) * 18 + 10;
  const sizeCost = width >= 150 ? 46 : 0;
  const budget = room + 18;

  let used = 0;
  let stopped = false;
  /** A strict cascade: once one line does not fit, nothing below it goes in
   *  either, so what survives is always a prefix of the priority order. */
  const fits = (cost: number): boolean => {
    if (stopped || used + cost > budget) {
      stopped = true;
      return false;
    }
    used += cost;
    return true;
  };
  const pick = (long: string, short: string): string | null => {
    if (stopped) return null;
    if (used + footCost(long) <= budget) {
      used += footCost(long);
      return long;
    }
    if (used + footCost(short) <= budget) {
      used += footCost(short);
      return short;
    }
    stopped = true;
    return null;
  };

  // The size key goes first: it is what makes a square readable at all. Then
  // the band names — retention is drawn as a radius, and a radius without its
  // words is not an encoding — then the counts and the hint.
  const showSize = fits(sizeCost);
  const showBands = fits(footCost(bandsText));
  const linksText = pick(linksLong, linksShort);
  const blocksText = pick(blocksLong, blocksShort);
  const showStrength = fits(31);
  const hintText = pick(hintLong, hintShort);

  const steps = [1, structure.medianCell, structure.maxCell].filter(
    (value, i, all) => all.indexOf(value) === i
  );
  const full = Math.min(plan.markFull, 16);
  const gapX = Math.max(20, Math.min(38, (width - 104 - full) / Math.max(1, steps.length)));
  const swatchX = steps.length * gapX + 10;

  // The DOM order is the priority order, so that if the estimate above runs a
  // line short and `overflow: hidden` has to cut something, what it cuts is
  // always the least important thing on the panel.
  return (
    <aside className="oad-key" style={{ left, top, width, maxHeight: Math.max(60, room) }}>
      {showSize ? (
        <div className="oad-sizekey">
          <svg width={Math.min(width, swatchX + full + 2)} height={full + 10} aria-hidden>
            {steps.map((value, i) => {
              const side = markSide(value, structure.maxCell, full);
              return (
                <rect
                  key={value}
                  x={i * gapX + (full - side) / 2}
                  y={full - side}
                  width={side}
                  height={side}
                  fill="var(--memory)"
                />
              );
            })}
            <rect x={swatchX} y={0} width={full * 0.45} height={full} fill={AGREES} />
            <rect
              x={swatchX + full * 0.45 + 1}
              y={0}
              width={full * 0.55 - 1}
              height={full}
              fill={CONTRADICTS}
            />
          </svg>
          <div className="oad-sizekey-labels">
            {steps.map((value, i) => (
              <span key={value} className="obs-label oad-sizekey-tick" style={{ left: i * gapX }}>
                {nf.format(value)}
              </span>
            ))}
            <span className="obs-label oad-sizekey-tick" style={{ left: swatchX }}>
              agree / contradict
            </span>
          </div>
        </div>
      ) : null}

      {showBands ? <p className="obs-label oad-key-foot oad-key-bands">{bandsText}</p> : null}

      {linksText ? <p className="obs-label oad-key-foot">{linksText}</p> : null}
      {blocksText ? <p className="obs-label oad-key-foot">{blocksText}</p> : null}

      {showStrength ? (
        <div className="oad-key-ramp">
          <svg width={78} height={9} aria-hidden>
            {([0, 1, 2] as const).map((step) => (
              <rect
                key={`a${step}`}
                x={step * 13}
                y={0}
                width={11}
                height={9}
                fill={linkVar('agrees', step)}
              />
            ))}
            {([0, 1, 2] as const).map((step) => (
              <rect
                key={`c${step}`}
                x={41 + step * 13}
                y={0}
                width={11}
                height={9}
                fill={linkVar('contradicts', step)}
              />
            ))}
          </svg>
          <span className="obs-label">list arcs, weak to strong</span>
        </div>
      ) : null}

      {hintText ? <p className="obs-label oad-key-foot">{hintText}</p> : null}
    </aside>
  );
}


// ─── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
.oad { color: var(--ink); }
.oad-canvas { position: absolute; inset: 0; }
.oad-canvas:focus-visible { outline: 2px solid var(--ink); outline-offset: -3px; }
.oad-nogl { position: absolute; inset: 0; margin: 0; padding: 24px 22px; max-width: 58ch; overflow: hidden; }
.oad-nogl-tight { max-width: 104ch; line-height: 1.5; }

.oad-head { position: absolute; top: 18px; }
.oad-title {
  margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: var(--lead-tight);
  letter-spacing: -0.005em; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.oad-sub { margin: 4px 0 0; line-height: 1.4; }
.oad-back {
  margin-top: 6px; color: var(--ink-2); font-size: var(--t-label);
  border-bottom: 1px solid var(--rule); padding-bottom: 1px;
  transition: color var(--dur) var(--ease);
}
.oad-back:hover { color: var(--ink); }

.oad-key { position: absolute; pointer-events: none; overflow: hidden; }
.oad-key-foot { margin: 10px 0 0; line-height: 1.36; color: var(--ink-3); }
.oad-key-bands { color: var(--ink-2); }
.oad-key-ramp { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.oad-sizekey { position: relative; }
.oad-sizekey-labels { position: relative; height: 18px; }
.oad-sizekey-tick { position: absolute; top: 0; white-space: nowrap; }

.oad-tip {
  position: absolute; pointer-events: none; background: var(--margin);
  border-left: 2px solid var(--ink-3); padding: 5px 9px 6px; max-width: 220px;
}
.oad-tip-title { color: var(--ink-2); }
.oad-tip-figures { display: flex; align-items: center; gap: 5px; margin-top: 2px; font-size: var(--t-body); }
.oad-tip-unit { color: var(--ink-3); font-size: var(--t-label); margin-right: 3px; }
.oad-swatch { width: 3px; height: 11px; display: inline-block; margin-left: 3px; }

.oad-rows { position: absolute; inset: 0; pointer-events: none; }
.oad-row {
  position: absolute; top: 0; left: 0; pointer-events: auto;
  display: flex; align-items: center; gap: 10px;
  text-align: left; color: var(--ink-2); font-size: var(--t-body);
  transition: opacity var(--dur) var(--ease), color var(--dur) var(--ease);
}
.oad-row-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oad-row-figs { flex: 0 0 auto; display: flex; align-items: baseline; gap: 4px; }
.oad-row-band { color: var(--ink-3); font-size: var(--t-label); margin-right: 4px; }
.oad-row-here { font-variant-numeric: tabular-nums; }
.oad-row-all { color: var(--ink-3); font-size: var(--t-label); font-variant-numeric: tabular-nums; }
.oad-row-live { color: var(--ink); }
.oad-row-on .oad-row-label { color: var(--ink); font-weight: 600; }
.oad-row-dim { opacity: 0.34; }
.oad-row:hover { color: var(--ink); }

.oad.oad-still .oad-row,
.oad.oad-still .oad-back { transition: none; }
`;

// ─── Module ─────────────────────────────────────────────────────────────────

export const overviewAndDetail: DemoModule = {
  id: 'overview-detail',
  name: 'Hotspots',
  dimension: '3D',
  caption:
    'Where your memories link most densely. A bigger square means more links between two blocks of memories; click one to list those memories and their links.',
  method:
    'Memories are sorted into blocks by what they link to: link communities, then smaller clusters, then memories with no links. The floor is a grid of block pairs, and each square counts every link between two blocks — its area is how many, and its split colour is how many agree (blue) against how many contradict (orange). No link is drawn on the floor itself. Pointing at or clicking a square fills the list beside it with that block’s memories, joined by arcs for their links, set higher the stronger the link. Bead size is how fresh a memory is (retention). Arrow keys move across the field.',
  Plate,
};
