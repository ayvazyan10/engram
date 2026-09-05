/**
 * SLOT 3 of 3 — hybrid. "Where, then what."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Three thousand links over six hundred memories is a hairball at any layout
 * and in any number of dimensions, so the overview here never draws a link. It draws the
 * store as a lower-triangular LATTICE: the memories are ordered into blocks by
 * which memories they link to, and one mark stands for every link between two
 * blocks. The mark's AREA is how many links, and its vertical cut is how many
 * of them agree against how many contradict. Density is therefore geometry —
 * a bigger square — exactly as rule 4 requires, and the eye reads the store's
 * block structure in one glance without a single edge on screen.
 *
 * The detail then draws real edges, but only for the one region you point at:
 * a vertical arc diagram where every arc is one actual link, coloured by kind
 * and level by the token ramp, and every memory carries its own name. That is
 * the half that answers "what exactly is connected to what", and it is the
 * only place in this harness where a contradiction can be read as a sentence
 * rather than counted.
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
 * memories with no link at all get the last block, which is why the bottom row
 * of the lattice is empty. That emptiness is a finding, so it is drawn.
 *
 * Measured on this store, ordering by community puts 52% of all links within
 * one block of the diagonal, against 19% for a degree ordering — which is the
 * whole reason the lattice reads as blocks instead of as fog.
 *
 * ─── The binding ───────────────────────────────────────────────────────────
 *
 * The focused cell is ringed in the lattice and its row and column are ruled,
 * so the region under inspection is always visible in the overview. The detail
 * names it in words above the arcs. Hovering a memory in the detail lights the
 * block it belongs to. Clicking one calls `onSelect`, which swings the detail
 * to that memory's own neighbours and leaves a labelled way back to the cell
 * you came from — and because `selectedId` is shared, a memory picked in
 * another demo arrives here already framed.
 *
 * ─── Rules held ────────────────────────────────────────────────────────────
 *
 * 3  No colour literal anywhere in this file; every stroke and fill is a
 *    `var(--…)` from the token layer.
 * 4  Density is the area of a mark and the length of a marginal bar. There is
 *    no wash, no ramp, no tinted ground.
 * 5  Retention is the RADIUS of a memory's dot, and its band is named in the
 *    detail's key and on the focused row.
 * 6  Nothing animates in. There is no simulation of any kind — the layout is
 *    computed once and rendered settled — and `reducedMotion` additionally
 *    cuts the hover transitions.
 * 7  Only `opacity` transitions.
 * 8  Every subset states its real denominator against `data.stats`.
 * 9  Two regions divided by one hairline. No card, no radius, no shadow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RETENTION_LABEL } from './contract';
import type { DemoModule, DemoProps, ObsData, ObsLink, RetentionBand } from './contract';

// ─── Token helpers ──────────────────────────────────────────────────────────

const STEP_NAME = ['weak', 'mid', 'strong'] as const;

/** The three-step ramp, as a token reference. Used for individual links. */
function linkVar(link: Pick<ObsLink, 'kind' | 'step'>): string {
  return `var(--${link.kind}-${STEP_NAME[link.step]})`;
}

/** The identity without its level. Used for aggregates, where a level would be
 *  an average of things that should not be averaged. */
const AGREES = 'var(--agrees)';
const CONTRADICTS = 'var(--contradicts)';

/** Retention as radius — never as colour. Bands run strongest first. */
const RETENTION_RADIUS: Record<RetentionBand, number> = {
  vivid: 5,
  holding: 4,
  fading: 3.1,
  threshold: 2.2,
};

const RETENTION_ORDER: RetentionBand[] = ['vivid', 'holding', 'fading', 'threshold'];

const nf = new Intl.NumberFormat('en-US');

// ─── Lattice geometry ───────────────────────────────────────────────────────

/** Page-edge inset, and the left channel that carries the region brackets and
 *  the marginal bars. */
const PAD = 22;
const GUTTER = 60;

const NOTE_FULL =
  'Every link in the store is counted on this lattice and not one of them is drawn. A mark is all the links between two blocks of memories — its area is how many, and its cut is how many agree against how many contradict.';
const NOTE_TIGHT =
  'A mark is every link between two blocks: its area is how many, its cut is agree against contradict.';

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
 * always agree — a demo that reshuffled its own blocks between renders would
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

  const target = Math.max(8, Math.ceil(data.nodes.length / Math.max(1, targetBlocks)));
  // A community earns its own named region — and therefore its own diagonal
  // cell — at half a block. Below that it is packed with the other stragglers,
  // because a bracket per two-memory cluster is a picket fence, not a reading.
  const named = Math.max(6, Math.ceil(target / 2));
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

  const width = blocks.length;
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

// ─── Component ──────────────────────────────────────────────────────────────

const STILL = 'oad-still';

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const stacked = width < 980;
  const overviewW = stacked ? width : Math.round(Math.min(Math.max(width * 0.46, 400), 760));
  const overviewH = stacked
    ? Math.round(Math.max(200, Math.min(Math.max(height * 0.5, 240), height - 220)))
    : height;
  const detailW = stacked ? width : Math.max(280, width - overviewW - 1);
  const detailH = stacked ? Math.max(160, height - overviewH - 1) : height;

  // How many blocks the lattice can carry at a pitch a mark is still readable
  // at. Same arithmetic as the lattice's own, so the two never disagree.
  const latticeSpan = Math.min(overviewW - PAD * 2 - GUTTER, overviewH - PAD - 46 - 14);
  const targetBlocks = Math.max(12, Math.min(34, Math.round(Math.max(latticeSpan, 200) / 18)));

  const structure = useMemo(() => buildStructure(data, targetBlocks), [data, targetBlocks]);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    data.nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [data]);

  // The focused cell is remembered by one representative memory from each side,
  // so a resize that re-blocks the store keeps the viewer where they were.
  const [anchors, setAnchors] = useState<[number, number] | null>(null);
  const [hoverCell, setHoverCell] = useState<Cell | null>(null);
  /** The block of the memory the pointer is on in the detail, echoed back into
   *  the lattice so the two halves are never out of step. */
  const [echoBlock, setEchoBlock] = useState<number | null>(null);

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
  // link the focused lattice cell stands for.
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

  const focusRegions = useMemo(() => {
    const set = new Set<number>();
    if (selectedIndex !== null) {
      const block = structure.blocks[structure.blockOf[selectedIndex] ?? 0];
      if (block) set.add(block.region);
    } else {
      const a = structure.blocks[focus.row];
      const b = structure.blocks[focus.col];
      if (a) set.add(a.region);
      if (b) set.add(b.region);
    }
    return set;
  }, [structure, focus, selectedIndex]);

  const highlightBlock = selectedIndex !== null ? (structure.blockOf[selectedIndex] ?? null) : null;

  const root: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    gridTemplate: stacked ? `${overviewH}px 1px 1fr / 1fr` : `1fr / ${overviewW}px 1px 1fr`,
    background: 'var(--plate)',
  };

  return (
    <div className={reducedMotion ? `oad ${STILL}` : 'oad'} style={root}>
      <style>{CSS}</style>

      <Lattice
        data={data}
        structure={structure}
        width={overviewW}
        height={overviewH}
        focus={focus}
        highlightBlock={highlightBlock}
        hoverBlockFromDetail={echoBlock}
        focusRegions={focusRegions}
        hoverCell={hoverCell}
        onHoverCell={setHoverCell}
        onChooseCell={chooseCell}
        memoryFramed={selectedIndex !== null}
      />

      <div className="oad-seam" />

      <Detail
        data={data}
        structure={structure}
        width={detailW}
        height={detailH}
        links={view.links}
        members={view.members}
        anchor={view.anchor}
        focus={focus}
        selectedId={selectedId}
        onSelect={onSelect}
        onHoverBlock={setEchoBlock}
      />
    </div>
  );
}

// ─── The lattice ────────────────────────────────────────────────────────────

interface LatticeProps {
  data: ObsData;
  structure: Structure;
  width: number;
  height: number;
  focus: { row: number; col: number };
  highlightBlock: number | null;
  hoverBlockFromDetail: number | null;
  focusRegions: Set<number>;
  hoverCell: Cell | null;
  onHoverCell: (cell: Cell | null) => void;
  onChooseCell: (cell: { row: number; col: number }) => void;
  memoryFramed: boolean;
}

function Lattice({
  data,
  structure,
  width,
  height,
  focus,
  highlightBlock,
  hoverBlockFromDetail,
  focusRegions,
  hoverCell,
  onHoverCell,
  onChooseCell,
  memoryFramed,
}: LatticeProps) {
  const count = structure.blocks.length;
  const footerH = 46;
  const span = Math.max(
    120,
    Math.min(width - PAD * 2 - GUTTER, height - PAD - footerH - 14)
  );
  const pitch = span / count;
  const originX = PAD + GUTTER;
  const originY = PAD;
  const full = Math.max(3, pitch - 3);

  const move = useCallback(
    (dRow: number, dCol: number) => {
      let row = focus.row;
      let col = focus.col;
      for (let step = 0; step < count; step++) {
        row += dRow;
        col += dCol;
        if (row < 0 || row >= count || col < 0 || col > row) return;
        if (structure.cells.has(row * count + col)) {
          onChooseCell({ row, col });
          return;
        }
      }
    },
    [focus, count, structure, onChooseCell]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
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

  const highlightRows = new Set<number>();
  if (highlightBlock !== null) highlightRows.add(highlightBlock);
  else {
    highlightRows.add(focus.row);
    highlightRows.add(focus.col);
  }
  if (hoverBlockFromDetail !== null) highlightRows.add(hoverBlockFromDetail);

  // The key lives in the void above the diagonal, where width and height trade
  // against each other one for one: a block w wide has about span - w of height
  // before the diagonal cuts it off. So the note is not clipped to a guessed
  // box, it picks the widest box it actually fits in. There is no text metrics
  // API here — Spectral at 13.5px runs about 6.9px to the character, and the
  // size ramp beneath the note takes 52px.
  const keyPlan = (() => {
    for (const text of [NOTE_FULL, NOTE_TIGHT]) {
      for (const boxWidth of [316, 288, 256, 224, 192, 172]) {
        if (boxWidth > span - 90) continue;
        const room = span - boxWidth - 12;
        const lines = Math.ceil(text.length / Math.max(14, Math.floor(boxWidth / 6.9)));
        if (lines * 19.6 + 52 <= room) return { text, boxWidth, room };
      }
    }
    return null;
  })();

  return (
    <section className="oad-half" style={{ width, height }} aria-label="Lattice of link density">
      <svg
        className="oad-lattice"
        width={width}
        height={height}
        role="group"
        tabIndex={0}
        aria-label={`Link lattice, ${count} blocks. Arrow keys move between cells.`}
        onKeyDown={onKeyDown}
        onMouseLeave={() => onHoverCell(null)}
      >
        {/* Region brackets: the extent of each neighbourhood, down the far left. */}
        {structure.regions.map((region, i) => {
          const y1 = originY + region.firstBlock * pitch + 1;
          const y2 = originY + (region.lastBlock + 1) * pitch - 1;
          const live = focusRegions.has(i);
          return (
            <rect
              key={region.name}
              x={PAD - 20}
              y={y1}
              width={2.5}
              height={Math.max(2, y2 - y1)}
              fill={live ? 'var(--ink)' : 'var(--ink-3)'}
              opacity={live ? 1 : 0.55}
            >
              <title>{`${region.name} — ${nf.format(region.size)} memories`}</title>
            </rect>
          );
        })}

        {/* Region rules, across the lattice and through the gutter. */}
        {structure.regions.slice(1).map((region) => {
          const y = originY + region.firstBlock * pitch;
          return (
            <g key={`rule-${region.name}`}>
              <line
                x1={PAD - 20}
                y1={y}
                x2={originX + region.firstBlock * pitch}
                y2={y}
                stroke="var(--rule)"
                strokeWidth={1}
              />
              <line
                x1={originX + region.firstBlock * pitch}
                y1={originY + region.firstBlock * pitch}
                x2={originX + region.firstBlock * pitch}
                y2={originY + span}
                stroke="var(--rule)"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* The crosshair: which block, or which pair of blocks, the detail holds. */}
        {[...highlightRows].map((r) => (
          <g key={`cross-${r}`} opacity={0.5}>
            <line
              x1={originX}
              y1={originY + (r + 0.5) * pitch}
              x2={originX + (r + 1) * pitch}
              y2={originY + (r + 0.5) * pitch}
              stroke="var(--ink-3)"
              strokeWidth={1}
            />
            <line
              x1={originX + (r + 0.5) * pitch}
              y1={originY + r * pitch}
              x2={originX + (r + 0.5) * pitch}
              y2={originY + span}
              stroke="var(--ink-3)"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* Marginal bars: every link touching a block, split by kind. Geometry,
            not a wash — length is the count. */}
        {structure.rowTotals.map((total, r) => {
          if (total === 0) return null;
          const agrees = structure.rowAgrees[r]!;
          const barMax = GUTTER - 20;
          const length = (total / structure.maxRowTotal) * barMax;
          const aLen = length * (agrees / total);
          const right = originX - 5;
          const y = originY + (r + 0.5) * pitch - 2.5;
          const h = Math.min(5, Math.max(2, pitch - 4));
          return (
            <g key={`margin-${r}`} opacity={highlightRows.has(r) ? 1 : 0.82}>
              <rect x={right - length} y={y} width={Math.max(0.8, aLen)} height={h} fill={AGREES} />
              <rect
                x={right - length + aLen}
                y={y}
                width={Math.max(0.8, length - aLen)}
                height={h}
                fill={CONTRADICTS}
              />
              <title>{`Block ${r + 1}: ${nf.format(total)} links, ${nf.format(agrees)} agree`}</title>
            </g>
          );
        })}

        {/* The marks. One per block pair, area = link count, cut = kind mix. */}
        {structure.cellList.map((cell) => (
          <CellMark
            key={`cell-${cell.row}-${cell.col}`}
            cell={cell}
            cx={originX + (cell.col + 0.5) * pitch}
            cy={originY + (cell.row + 0.5) * pitch}
            max={structure.maxCell}
            full={full}
            ringed={cell.row === focus.row && cell.col === focus.col && !memoryFramed}
          />
        ))}

        {/* Hit targets, drawn last so they take the pointer. */}
        {structure.cellList.map((cell) => (
          <rect
            key={`hit-${cell.row}-${cell.col}`}
            x={originX + cell.col * pitch}
            y={originY + cell.row * pitch}
            width={pitch}
            height={pitch}
            fill="transparent"
            className="oad-hit"
            onMouseEnter={() => onHoverCell(cell)}
            onClick={() => onChooseCell(cell)}
          >
            <title>{`${blockName(structure, cell.row)} × ${blockName(structure, cell.col)} — ${nf.format(
              cell.total
            )} links`}</title>
          </rect>
        ))}
      </svg>

      {keyPlan ? (
        <div
          className="oad-key"
          style={{ top: PAD + 2, right: PAD, width: keyPlan.boxWidth, maxHeight: keyPlan.room }}
        >
          <p className="obs-note oad-key-note">{keyPlan.text}</p>
          <SizeKey structure={structure} boxWidth={keyPlan.boxWidth} />
        </div>
      ) : null}

      {hoverCell ? (
        <div
          className="oad-tip"
          style={{
            left: Math.min(
              width - 220,
              originX + (hoverCell.col + 1) * pitch + 8
            ),
            top: Math.max(4, originY + hoverCell.row * pitch - 6),
          }}
        >
          <div className="obs-label oad-tip-title">
            {blockName(structure, hoverCell.row)}
            {hoverCell.row === hoverCell.col ? '' : ` × ${blockName(structure, hoverCell.col)}`}
          </div>
          <div className="oad-tip-figures">
            <span className="obs-figure">{nf.format(hoverCell.total)}</span>
            <span className="oad-tip-unit">links</span>
            <span className="oad-swatch" style={{ background: AGREES }} />
            <span className="obs-figure">{nf.format(hoverCell.agrees)}</span>
            <span className="oad-swatch" style={{ background: CONTRADICTS }} />
            <span className="obs-figure">{nf.format(hoverCell.contradicts)}</span>
          </div>
        </div>
      ) : null}

      <p className="obs-label oad-foot" style={{ width: width - PAD * 2 }}>
        {keyPlan ? '' : `${NOTE_TIGHT} `}
        {nf.format(data.stats.memories)} memories ordered into {count} blocks by what they link to —{' '}
        {structure.neighbourhoods} neighbourhoods, {structure.smallClusters} smaller clusters,{' '}
        {structure.isolated} with no link at all. All {nf.format(data.stats.linksDrawn)} renderable
        links are counted here; none is drawn.
      </p>
    </section>
  );
}

/**
 * One block pair. The square's area is the number of links; the vertical cut
 * across it is how many agree against how many contradict. Nothing here is a
 * wash: if the region is denser, the square is bigger.
 */
function CellMark({
  cell,
  cx,
  cy,
  max,
  full,
  ringed,
}: {
  cell: Cell;
  cx: number;
  cy: number;
  max: number;
  full: number;
  ringed: boolean;
}) {
  const side = markSide(cell.total, max, full);
  const both = cell.agrees > 0 && cell.contradicts > 0;
  const gap = both && side >= 6 ? 1 : 0;
  const usable = side - gap;
  const agreeW = both ? Math.max(0.8, usable * (cell.agrees / cell.total)) : cell.agrees > 0 ? side : 0;
  const againstW = both ? Math.max(0.8, usable - agreeW) : cell.contradicts > 0 ? side : 0;
  const x0 = cx - side / 2;
  const y0 = cy - side / 2;
  return (
    <g className="oad-cell">
      {agreeW > 0 ? <rect x={x0} y={y0} width={agreeW} height={side} fill={AGREES} /> : null}
      {againstW > 0 ? (
        <rect x={x0 + agreeW + gap} y={y0} width={againstW} height={side} fill={CONTRADICTS} />
      ) : null}
      {ringed ? (
        <rect
          x={cx - full / 2 - 1.5}
          y={cy - full / 2 - 1.5}
          width={full + 3}
          height={full + 3}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1}
        />
      ) : null}
    </g>
  );
}

function SizeKey({ structure, boxWidth }: { structure: Structure; boxWidth: number }) {
  const full = 15;
  const steps = [1, structure.medianCell, structure.maxCell].filter(
    (value, i, all) => all.indexOf(value) === i
  );
  // The ramp has to live inside the box the note chose, so the step spacing
  // closes up rather than letting the split swatch's caption get clipped off.
  const captionW = 100;
  const gapX = Math.max(20, Math.min(40, (boxWidth - captionW - full) / Math.max(1, steps.length)));
  const swatchX = steps.length * gapX + 12;
  return (
    <div className="oad-sizekey" style={{ width: boxWidth }}>
      <svg width={Math.min(boxWidth, swatchX + full + 2)} height={26} aria-hidden>
        {steps.map((value, i) => {
          const side = markSide(value, structure.maxCell, full);
          return (
            <rect
              key={value}
              x={i * gapX + (full - side) / 2}
              y={16 - side}
              width={side}
              height={side}
              fill="var(--memory)"
            />
          );
        })}
        <rect x={swatchX} y={16 - full} width={full * 0.45} height={full} fill={AGREES} />
        <rect
          x={swatchX + full * 0.45 + 1}
          y={16 - full}
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
  );
}

function blockName(structure: Structure, index: number): string {
  const block = structure.blocks[index];
  if (!block) return `Block ${index + 1}`;
  const region = structure.regions[block.region];
  if (!region) return `Block ${index + 1}`;
  return block.slices > 1 ? `${region.name}, block ${block.slice + 1} of ${block.slices}` : region.name;
}

// ─── The detail ─────────────────────────────────────────────────────────────

interface DetailProps {
  data: ObsData;
  structure: Structure;
  width: number;
  height: number;
  links: ObsLink[];
  members: number[];
  anchor: number | null;
  focus: { row: number; col: number };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onHoverBlock: (block: number | null) => void;
}

function Detail({
  data,
  structure,
  width,
  height,
  links,
  members,
  anchor,
  focus,
  selectedId,
  onSelect,
  onHoverBlock,
}: DetailProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActive(0);
    setHover(null);
  }, [links]);

  const degreeInView = useMemo(() => {
    const map = new Map<number, number>();
    for (const link of links) {
      map.set(link.source, (map.get(link.source) ?? 0) + 1);
      map.set(link.target, (map.get(link.target) ?? 0) + 1);
    }
    return map;
  }, [links]);

  const ordered = useMemo(() => {
    const rest = members.filter((m) => m !== anchor);
    rest.sort(
      (a, b) =>
        (degreeInView.get(b) ?? 0) - (degreeInView.get(a) ?? 0) ||
        data.nodes[b]!.degree - data.nodes[a]!.degree ||
        (data.nodes[a]!.id < data.nodes[b]!.id ? -1 : 1)
    );
    return anchor === null ? rest : [anchor, ...rest];
  }, [members, anchor, degreeInView, data]);

  const padX = 22;
  // Measured for two wrapped lines of the sub-line plus the way-back control;
  // there is no text metrics API here, so the allowance is generous by design.
  const headerH = width < 760 ? 100 : 82;
  const footerH = 42;
  const listTop = 20 + headerH;
  const listBottom = height - 14 - footerH;
  const avail = Math.max(60, listBottom - listTop);

  const rowH = Math.max(15, Math.min(24, Math.floor(avail / Math.max(1, ordered.length))));
  const capacity = Math.max(1, Math.floor(avail / rowH));
  // Memoised so a hover does not rebuild the arc set underneath the pointer.
  const shown = useMemo(() => ordered.slice(0, capacity), [ordered, capacity]);

  const position = useMemo(() => {
    const map = new Map<number, number>();
    shown.forEach((m, i) => map.set(m, i));
    return map;
  }, [shown]);

  const gutterW = Math.round(Math.min(210, Math.max(84, width * 0.2)));
  const dotX = padX + gutterW;
  const rowLeft = dotX + 15;
  const rowW = Math.max(60, width - padX - rowLeft);
  const rowY = (i: number) => listTop + i * rowH + rowH / 2;

  const drawn = useMemo(
    () => links.filter((l) => position.has(l.source) && position.has(l.target)),
    [links, position]
  );

  // Two memories can both agree AND contradict — 459 such pairs when this store
  // was measured, out of 2,640 linked pairs, and they are the one thing worth
  // coming to a detail view for. Fan the arcs of a repeated pair so both are
  // visible instead of one hiding the other.
  const arcs = useMemo(() => {
    const seen = new Map<string, number>();
    const out = drawn.map((link) => {
      const a = position.get(link.source)!;
      const b = position.get(link.target)!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const rank = seen.get(key) ?? 0;
      seen.set(key, rank + 1);
      return { link, a, b, rank };
    });
    out.sort((x, y) => (x.link.kind === y.link.kind ? 0 : x.link.kind === 'agrees' ? -1 : 1));
    return out;
  }, [drawn, position]);

  const bothKinds = useMemo(() => {
    const kinds = new Map<string, Set<string>>();
    for (const link of links) {
      const key = link.source < link.target ? `${link.source}:${link.target}` : `${link.target}:${link.source}`;
      const set = kinds.get(key) ?? new Set<string>();
      set.add(link.kind);
      kinds.set(key, set);
    }
    return [...kinds.values()].filter((s) => s.size > 1).length;
  }, [links]);

  const live = hover ?? (anchor !== null ? 0 : null);
  const touching = useMemo(() => {
    if (live === null) return null;
    const set = new Set<number>([live]);
    for (const arc of arcs) {
      if (arc.a === live) set.add(arc.b);
      else if (arc.b === live) set.add(arc.a);
    }
    return set;
  }, [live, arcs]);

  const title =
    anchor !== null
      ? data.nodes[anchor]!.label
      : focus.row === focus.col
        ? `Inside ${blockName(structure, focus.row)}`
        : `${blockName(structure, focus.row)} × ${blockName(structure, focus.col)}`;

  // Rule 8: whenever this half shows a subset, it says so against the store's
  // own totals rather than against the subset it happens to have chosen.
  const truncated = drawn.length < links.length || shown.length < members.length;
  const subLine = [
    truncated
      ? `${nf.format(drawn.length)} of ${nf.format(links.length)} links drawn, between ${nf.format(
          shown.length
        )} of ${nf.format(members.length)} memories`
      : `${nf.format(links.length)} links between ${nf.format(members.length)} memories`,
    bothKinds > 0 ? `${nf.format(bothKinds)} pairs both agree and contradict` : null,
    `of ${nf.format(data.stats.linksDrawn)} links across ${nf.format(data.stats.memories)} memories in the store`,
  ]
    .filter(Boolean)
    .join(' · ');

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = Math.max(0, Math.min(shown.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
    setActive(next);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-row="${next}"]`)?.focus();
  };

  return (
    <section className="oad-half" style={{ width, height }} aria-label="The links inside the chosen region">
      <header className="oad-head" style={{ left: padX, top: 20, width: width - padX * 2 }}>
        <h2 className="oad-title">{title}</h2>
        <p className="obs-label oad-sub">{subLine}</p>
        {selectedId ? (
          <button type="button" className="oad-back" onClick={() => onSelect(null)}>
            Back to {blockName(structure, focus.row)}
            {focus.row === focus.col ? '' : ` × ${blockName(structure, focus.col)}`}
          </button>
        ) : null}
      </header>

      <svg className="oad-arcs" width={width} height={height} aria-hidden>
        {arcs.map(({ link, a, b, rank }) => {
          const y1 = rowY(a);
          const y2 = rowY(b);
          const fan = 1 + Math.min(rank, 2) * 0.17;
          const reach = Math.min((gutterW - 8) / 1.34, 12 + Math.abs(y2 - y1) * 0.5) * fan;
          const x = dotX;
          const resting = touching === null;
          const lit = resting || touching.has(a) || touching.has(b);
          const near = live !== null && (a === live || b === live);
          return (
            <path
              key={link.id}
              className="oad-arc"
              d={`M ${x} ${y1} C ${x - reach} ${y1} ${x - reach} ${y2} ${x} ${y2}`}
              fill="none"
              stroke={linkVar(link)}
              strokeWidth={near ? 2 : 1.4}
              opacity={near ? 1 : resting ? 0.85 : lit ? 0.72 : 0.22}
            />
          );
        })}
        {shown.map((index, i) => {
          const node = data.nodes[index]!;
          const isLive = live === i;
          return (
            <circle
              key={node.id}
              cx={dotX}
              cy={rowY(i)}
              r={RETENTION_RADIUS[node.retentionBand]}
              fill={isLive || node.id === selectedId ? 'var(--memory-live)' : 'var(--memory)'}
              opacity={touching === null || touching.has(i) ? 1 : 0.3}
            />
          );
        })}
      </svg>

      <div
        className="oad-rows"
        ref={listRef}
        role="listbox"
        aria-label="Memories in this region"
        onKeyDown={onKeyDown}
        onMouseLeave={() => {
          setHover(null);
          onHoverBlock(null);
        }}
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
              tabIndex={i === active ? 0 : -1}
              className={
                'oad-row' +
                (node.id === selectedId ? ' oad-row-on' : '') +
                (live === i ? ' oad-row-live' : '') +
                (dim ? ' oad-row-dim' : '')
              }
              style={{ top: rowY(i) - rowH / 2, height: rowH, left: rowLeft, width: rowW }}
              onMouseEnter={() => {
                setHover(i);
                onHoverBlock(structure.blockOf[index] ?? null);
              }}
              onFocus={() => {
                setHover(i);
                setActive(i);
                onHoverBlock(structure.blockOf[index] ?? null);
              }}
              onBlur={() => onHoverBlock(null)}
              onClick={() => onSelect(node.id === selectedId ? null : node.id)}
            >
              <span className="oad-row-label">{node.label}</span>
              <span className="oad-row-figs">
                {live === i ? (
                  <span className="oad-row-band">{RETENTION_LABEL[node.retentionBand]}</span>
                ) : null}
                <span className="obs-figure oad-row-here">{nf.format(degreeInView.get(index) ?? 0)}</span>
                <span className="oad-row-all">/{nf.format(node.degree)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="oad-detail-foot" style={{ left: padX, width: width - padX * 2 }}>
        <span className="obs-label">Dot size is retention</span>
        <svg width={168} height={14} aria-hidden>
          {RETENTION_ORDER.map((band, i) => (
            <circle key={band} cx={7 + i * 12} cy={7} r={RETENTION_RADIUS[band]} fill="var(--memory)" />
          ))}
        </svg>
        <span className="obs-label oad-foot-bands">
          {RETENTION_ORDER.map((band) => `${RETENTION_LABEL[band]} ${data.stats.retention[band]}`).join(
            ' · '
          )}
        </span>
        {width >= 760 ? (
          <span className="obs-label oad-foot-hint">
            Arc colour is the relationship; its level is the strength. Click a memory for its own
            neighbours.
          </span>
        ) : null}
      </div>
    </section>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
.oad { color: var(--ink); }
.oad-seam { background: var(--rule); }
.oad-half { position: relative; overflow: hidden; }

.oad-lattice { position: absolute; inset: 0; display: block; }
.oad-lattice:focus-visible { outline: 2px solid var(--ink); outline-offset: -3px; }
.oad-hit { cursor: pointer; }
.oad-arc { transition: opacity var(--dur) var(--ease); }
.oad.oad-still .oad-arc,
.oad.oad-still .oad-row { transition: none; }

.oad-key { position: absolute; overflow: hidden; pointer-events: none; }
.oad-key-note { margin: 0 0 12px; max-width: none; font-size: 13.5px; line-height: 1.45; }
.oad-sizekey { position: relative; }
.oad-sizekey-labels { position: relative; height: 14px; }
.oad-sizekey-tick { position: absolute; top: 0; white-space: nowrap; }

.oad-tip {
  position: absolute; pointer-events: none; background: var(--margin);
  border-left: 2px solid var(--ink-3); padding: 5px 9px 6px; max-width: 210px;
}
.oad-tip-title { color: var(--ink-2); }
.oad-tip-figures { display: flex; align-items: center; gap: 5px; margin-top: 2px; font-size: var(--t-body); }
.oad-tip-unit { color: var(--ink-3); font-size: var(--t-label); margin-right: 3px; }
.oad-swatch { width: 3px; height: 11px; display: inline-block; margin-left: 3px; }

.oad-foot { position: absolute; left: 22px; bottom: 16px; margin: 0; line-height: 1.4; }

.oad-head { position: absolute; }
.oad-title {
  margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: var(--lead-tight);
  letter-spacing: -0.005em; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.oad-sub { margin: 4px 0 0; line-height: 1.4; }
.oad-back {
  margin-top: 6px; color: var(--ink-2); font-size: var(--t-label); font-stretch: 78%;
  border-bottom: 1px solid var(--rule); padding-bottom: 1px;
  transition: color var(--dur) var(--ease);
}
.oad-back:hover { color: var(--ink); }

.oad-arcs { position: absolute; inset: 0; pointer-events: none; }
.oad-rows { position: absolute; inset: 0; }
.oad-row {
  position: absolute; display: flex; align-items: center; gap: 10px;
  text-align: left; color: var(--ink-2); font-size: var(--t-body);
  transition: opacity var(--dur) var(--ease), color var(--dur) var(--ease);
}
.oad-row-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oad-row-figs { flex: 0 0 auto; display: flex; align-items: baseline; gap: 4px; }
.oad-row-band { color: var(--ink-3); font-size: var(--t-label); font-stretch: 78%; margin-right: 4px; }
.oad-row-here { font-variant-numeric: tabular-nums; }
.oad-row-all { color: var(--ink-3); font-size: var(--t-label); font-variant-numeric: tabular-nums; }
.oad-row-live { color: var(--ink); }
.oad-row-on .oad-row-label { color: var(--ink); font-weight: 600; }
.oad-row-dim { opacity: 0.34; }
.oad-row:hover { color: var(--ink); }

.oad-detail-foot {
  position: absolute; bottom: 14px; display: flex; align-items: center;
  gap: 10px; flex-wrap: wrap;
}
.oad-foot-bands { color: var(--ink-3); }
.oad-foot-hint { flex: 1 1 100%; color: var(--ink-3); }
`;

// ─── Module ─────────────────────────────────────────────────────────────────

export const overviewAndDetail: DemoModule = {
  id: 'overview-detail',
  name: 'Where, then what',
  dimension: 'Hybrid',
  claim:
    'Where knowledge is dense and what a dense region contains are two questions, so the overview sorts the store into link-dense blocks and draws not one edge — density is the area of a mark — while the detail draws every real edge inside the block you point at, the claim being that this beats any single view and that the densest neighbourhoods here turn out to be the ones where memories contradict each other.',
  Plate,
};
