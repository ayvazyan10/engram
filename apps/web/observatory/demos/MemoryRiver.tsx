/**
 * SLOT — Memory River (Hybrid). "Left to right is when it was written."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Time is the one axis this store genuinely has. The median link joins two
 * memories written under a day apart, 55% join memories written inside
 * 24 hours of each other, and only 180 of 3,103 renderable links reach more
 * than one half-life. So the store is not a web spread over five months; it
 * is a sequence of sittings, each densely wired inside itself, with a few
 * long threads between them. That is a river with tributaries, drawn as one.
 *
 * ─── What the flow means, exactly ──────────────────────────────────────────
 *
 *   x    Order of writing. Every memory advances the axis by one unit; a
 *        calendar day with no writing advances it by 1.5 units. So a day is as
 *        wide as what was written in it, and a silence is narrow but never
 *        dropped — the axis under the river prints the real dates at their
 *        real positions, so the reader can see where it stretches. Days are
 *        UTC days, and the labels agree with that. The river ends at today and
 *        runs off the right edge toward tomorrow.
 *
 *   Streams   `node.source` — the client that wrote the memory. That field is
 *        on the API payload and survives the harness's spread, but it is not
 *        on the `ObsNode` type, so it is read through a narrow guard and any
 *        memory without a usable string goes into a stream called
 *        "unrecorded". Fifteen values on this store: reflection (358, all
 *        inside five days of July), claude-code (145, the whole span),
 *        autopilot-learning (61, March to April), consolidation, migration-pg,
 *        openclaw, claude-code-file-memory, mission-control, and seven with
 *        four memories or fewer. Streams are stacked top to bottom in order of
 *        first writing — the order tributaries join — and that same order is
 *        the list down the left edge, each name joined to the point where its
 *        stream begins by a hairline leader. A stream exists from its first
 *        memory to its last and not before or after.
 *
 *   Width of a stream   Its share of what was being written there: a
 *        Gaussian kernel (9px) over that source's memories, all sources
 *        stacked and centred. Between memories a stream is a 1.2px thread.
 *        Density is therefore geometry — thickness — and never a wash.
 *
 *   Height inside a stream   The memory's rank along the projection's first
 *        axis (`node.x`), so memories that mean similar things sit at
 *        similar heights and the links between them run nearly level. That is
 *        the only use of the embedding here, and it is a within-stream order,
 *        not a distance.
 *
 *   Filaments   Every renderable link, drawn from its older end to its newer
 *        end as a cubic with level tangents. Hue is kind, lightness step is
 *        strength — `linkColor` and nothing else. Same-day links are short
 *        bows; the 180 that cross a half-life are the long strands that leave
 *        one sitting for another.
 *
 *   Particles   One per memory, in the neutral memory grey, radius from
 *        degree. The busiest twentieth are white with a soft white halo.
 *
 * ─── What the reference implied and this plate refuses ─────────────────────
 *
 *   • Its counts (12,428 memories, 317 clusters, 1,892 connections) and its
 *     categories ("People & Relationships", "Work & Projects") do not exist
 *     here. There is no topic taxonomy in this store. Every figure printed
 *     below is derived from `data` at render time; the left-edge list is the
 *     real `source` field, not a category list.
 *   • Its bright blue halos on nodes. On this plate hue means link kind and
 *     nothing else, so a blue halo would make a memory look like an
 *     agreement. Focal cores and halos are white (`--memory-live`).
 *   • A LIVE badge that implies streaming. The store is read once from the
 *     running API when the page loads; the pill says "Live store" and its
 *     title says exactly that.
 *   • Perpetual flow animation. One reveal sweeps the river in from the left;
 *     after that nothing moves unless the pointer asks. `reducedMotion` skips
 *     the reveal and renders the settled state at once.
 *
 * ─── The glow, and why kind and strength survive it ─────────────────────────
 *
 * Each filament is drawn twice: a 5px stroke in its own colour at α 0.035
 * with `screen` compositing, then a 1.4px core in the exact token colour with
 * `source-over` at α 1. The core overwrites whatever glow is beneath it, so
 * the pixel a strand paints is the token itself at any haze depth. Simulated
 * with the canvas compositing formulae and checked with the dataviz
 * validator: cross-kind ΔE 27.8 (CVD 26.3) and step ΔL 0.076 / 0.086 are
 * unchanged at 0, 10, 30, 80 and 200 overlapping glow strokes. The only thing
 * that erodes them is antialiased coverage on a sub-pixel hairline (coverage
 * 0.6 pulls ΔE to ~16 and ΔL to ~0.05), which is why the core is 1.4px rather
 * than 1px. What the haze does cost is figure-ground for a single strand in
 * the densest ~80-deep centre of the July braid, where the braid reads as a
 * bright mass — which is the truthful reading of 2,548 links among 358
 * memories in five days.
 *
 * ─── Deliberately not drawn ────────────────────────────────────────────────
 *
 *   The 5,393 stored links onto archived memories — nobody can; the
 *   denominator is printed. Memory type as colour — it is a word and a filter
 *   (the stack of caps words under the title). Retention as anything — it is a
 *   word in the tooltip. The embedding's second and third axes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PLATE_COLORS, RETENTION_LABEL, linkColor } from './contract';
import type { DemoModule, DemoProps, MemoryType, ObsData, ObsLink, ObsNode } from './contract';

// ─── Constants ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Axis units a calendar day with no writing advances by; a memory is 1. */
const SILENT_DAY_UNITS = 1.5;
const KERNEL_PX = 9;
const KERNEL_REACH = KERNEL_PX * 3;
const THREAD_PX = 1.2;
const BAND_GAP_PX = 3;
const RIVER_FILL = 0.72;
const PARTICLE_SPREAD = 0.8;
const GLOW_WIDTH = 5;
const GLOW_ALPHA = 0.035;
const CORE_WIDTH = 1.4;
const HUB_QUANTILE = 0.95;
const HIT_RADIUS = 16;
const GRID_CELL = 32;
const PAD = 24;
const ARROW_RUN = 64;
const MIN_TICK_GAP = 30;
const MIN_DAY_TICK_WIDTH = 34;
const CALLOUT_COUNT = 3;
const CALLOUT_MIN_LINKS = 5;
const UNRECORDED = 'unrecorded';

const nf = new Intl.NumberFormat('en-US');
/** Dates are UTC days throughout, so the labels are built from UTC fields. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const monthName = (ms: number): string => MONTHS[new Date(ms).getUTCMonth()] ?? '';
const fmtDayMonth = { format: (ms: number): string => `${new Date(ms).getUTCDate()} ${monthName(ms)}` };
const fmtMonth = { format: monthName };
const fmtFull = { format: (ms: number): string => `${fmtDayMonth.format(ms)} ${new Date(ms).getUTCFullYear()}` };

type ViewId = 'all' | 'far' | 'cross' | 'contradicts';
type TypeFilter = MemoryType | 'all';

const VIEWS: readonly { id: ViewId; name: string }[] = [
  { id: 'all', name: 'All links' },
  { id: 'far', name: 'Across a half-life' },
  { id: 'cross', name: 'Between sources' },
  { id: 'contradicts', name: 'Contradicts' },
];

const TYPES: readonly { id: TypeFilter; name: string }[] = [
  { id: 'all', name: 'Every type' },
  { id: 'semantic', name: 'Semantic' },
  { id: 'episodic', name: 'Episodic' },
  { id: 'procedural', name: 'Procedural' },
];

// ─── Boundary ───────────────────────────────────────────────────────────────

/** `source` is on the API payload but not on the contract's type. Read it
 *  through a guard; anything that is not a usable string is "unrecorded". */
function sourceOf(node: ObsNode): string {
  const raw = (node as ObsNode & { source?: unknown }).source;
  if (typeof raw !== 'string') return UNRECORDED;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : UNRECORDED;
}

function dayOf(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

function rgba(hex: string, alpha: number): string {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ─── Frame ──────────────────────────────────────────────────────────────────

interface Frame {
  width: number;
  height: number;
  listLeft: number;
  listWidth: number;
  listTop: number;
  rowH: number;
  showCaps: boolean;
  plotLeft: number;
  plotRight: number;
  bandTop: number;
  bandBottom: number;
  mid: number;
  axisY: number;
  /** How many of the four figures fit beside the title: 4, 2 or none. */
  figureCount: 0 | 2 | 4;
  showTypes: boolean;
}

/** Widths the figures block occupies at each count, estimated from its text. */
const FIGURES_WIDTH: Record<0 | 2 | 4, number> = { 0: 0, 2: 440, 4: 850 };
const TITLE_WIDTH = 360;

function makeFrame(width: number, height: number, sourceCount: number): Frame {
  const listWidth = Math.round(Math.min(210, Math.max(150, width * 0.16)));
  const listLeft = PAD;
  const plotLeft = listLeft + listWidth + 34;
  const axisY = height - 66;
  const showTypes = height >= 520;
  const listTop = showTypes ? 164 : 96;
  const listBottom = height - 126;
  const rowH = Math.min(30, Math.max(15, (listBottom - listTop) / Math.max(1, sourceCount)));
  return {
    width,
    height,
    listLeft,
    listWidth,
    listTop,
    rowH,
    showCaps: rowH >= 25,
    plotLeft,
    plotRight: Math.max(plotLeft + 40, width - ARROW_RUN),
    bandTop: 92,
    bandBottom: axisY - 18,
    mid: (92 + axisY - 18) / 2,
    axisY,
    figureCount: width >= TITLE_WIDTH + FIGURES_WIDTH[4] + 40 ? 4 : width >= TITLE_WIDTH + FIGURES_WIDTH[2] + 40 ? 2 : 0,
    showTypes,
  };
}

// ─── Sources ────────────────────────────────────────────────────────────────

interface RiverSource {
  index: number;
  name: string;
  members: readonly number[];
  count: number;
  firstMs: number;
  lastMs: number;
  /** Links with both ends in this source. */
  agrees: number;
  contradicts: number;
  stillWriting: boolean;
}

function collectSources(data: ObsData, times: Float64Array, now: number): RiverSource[] {
  const byName = new Map<string, number[]>();
  data.nodes.forEach((node, i) => {
    const name = sourceOf(node);
    const list = byName.get(name);
    if (list) list.push(i);
    else byName.set(name, [i]);
  });
  const nameOf = data.nodes.map(sourceOf);
  const within = new Map<string, { agrees: number; contradicts: number }>();
  for (const link of data.links) {
    const a = nameOf[link.source]!;
    if (a !== nameOf[link.target]) continue;
    const tally = within.get(a) ?? { agrees: 0, contradicts: 0 };
    within.set(a, {
      agrees: tally.agrees + (link.kind === 'agrees' ? 1 : 0),
      contradicts: tally.contradicts + (link.kind === 'contradicts' ? 1 : 0),
    });
  }
  const horizon = data.stats.halfLifeDays * DAY_MS;
  const unordered = [...byName.entries()].map(([name, members]) => {
    let firstMs = Infinity;
    let lastMs = -Infinity;
    for (const i of members) {
      const t = times[i]!;
      if (t < firstMs) firstMs = t;
      if (t > lastMs) lastMs = t;
    }
    const tally = within.get(name) ?? { agrees: 0, contradicts: 0 };
    return {
      name,
      members,
      count: members.length,
      firstMs,
      lastMs,
      agrees: tally.agrees,
      contradicts: tally.contradicts,
      stillWriting: now - lastMs <= horizon,
    };
  });
  unordered.sort((a, b) => a.firstMs - b.firstMs || a.name.localeCompare(b.name));
  return unordered.map((s, index) => ({ ...s, index }));
}

// ─── Time scale ─────────────────────────────────────────────────────────────

interface TimeScale {
  firstDay: number;
  today: number;
  /** Axis unit at the start of each day from `firstDay`, plus the end. */
  dayStart: readonly number[];
  uEnd: number;
  uNow: number;
  unitPx: number;
  nodeX: Float64Array;
  silentDays: number;
  daysWithWriting: number;
  spanDays: number;
  undated: number;
}

function parseTimes(nodes: readonly ObsNode[], now: number): { times: Float64Array; undated: number } {
  const times = new Float64Array(nodes.length);
  let undated = 0;
  nodes.forEach((node, i) => {
    const t = Date.parse(node.createdAt);
    if (Number.isFinite(t)) times[i] = Math.min(t, now);
    else {
      times[i] = now;
      undated++;
    }
  });
  return { times, undated };
}

function buildTimeScale(times: Float64Array, undated: number, frame: Frame, now: number): TimeScale {
  const order = Array.from(times.keys()).sort((a, b) => times[a]! - times[b]! || a - b);
  const today = dayOf(now);
  const firstDay = order.length ? dayOf(times[order[0]!]!) : today;
  const lastMemoryDay = order.length ? dayOf(times[order[order.length - 1]!]!) : today;
  const endDay = Math.max(today, lastMemoryDay);

  const perDay = new Map<number, number>();
  for (const t of times) perDay.set(dayOf(t), (perDay.get(dayOf(t)) ?? 0) + 1);

  const dayStart: number[] = [];
  let u = 0;
  for (let d = firstDay; d <= endDay; d++) {
    dayStart.push(u);
    const m = perDay.get(d) ?? 0;
    u += m > 0 ? m : SILENT_DAY_UNITS;
  }
  dayStart.push(u);
  const uEnd = Math.max(u, 1);
  const uNow = dayStart[today - firstDay] ?? uEnd;
  const unitPx = (frame.plotRight - frame.plotLeft) / uEnd;

  const nodeX = new Float64Array(times.length);
  const seen = new Map<number, number>();
  for (const i of order) {
    const d = dayOf(times[i]!);
    const j = seen.get(d) ?? 0;
    seen.set(d, j + 1);
    nodeX[i] = frame.plotLeft + ((dayStart[d - firstDay] ?? 0) + j + 0.5) * unitPx;
  }

  let silentDays = 0;
  for (let d = firstDay; d <= lastMemoryDay; d++) if (!perDay.has(d)) silentDays++;

  return {
    firstDay,
    today,
    dayStart,
    uEnd,
    uNow,
    unitPx,
    nodeX,
    silentDays,
    daysWithWriting: perDay.size,
    spanDays: lastMemoryDay - firstDay + 1,
    undated,
  };
}

// ─── Bands ──────────────────────────────────────────────────────────────────

interface Bands {
  nCols: number;
  centre: readonly Float32Array[];
  half: readonly Float32Array[];
  top: Float32Array;
  bottom: Float32Array;
  colFirst: readonly number[];
  colLast: readonly number[];
  /** The column where each source is thickest. */
  colPeak: readonly number[];
}

function buildBands(sources: readonly RiverSource[], nodeX: Float64Array, frame: Frame): Bands {
  const nCols = Math.ceil(frame.width) + 1;
  const dens = sources.map(() => new Float32Array(nCols));
  const colFirst: number[] = [];
  const colLast: number[] = [];
  const colPeak: number[] = [];

  sources.forEach((s, si) => {
    const d = dens[si]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of s.members) {
      const x = nodeX[i]!;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      const from = Math.max(0, Math.floor(x - KERNEL_REACH));
      const to = Math.min(nCols - 1, Math.ceil(x + KERNEL_REACH));
      for (let c = from; c <= to; c++) {
        const z = (c - x) / KERNEL_PX;
        d[c] = (d[c] ?? 0) + Math.exp(-0.5 * z * z);
      }
    }
    colFirst[si] = Math.max(0, Math.floor(lo));
    colLast[si] = Math.min(nCols - 1, Math.ceil(hi));
    let peak = colFirst[si]!;
    for (let c = colFirst[si]!; c <= colLast[si]!; c++) if ((d[c] ?? 0) > (d[peak] ?? 0)) peak = c;
    colPeak[si] = peak;
  });

  let maxTotal = 0;
  for (let c = 0; c < nCols; c++) {
    let total = 0;
    sources.forEach((_, si) => {
      if (c >= colFirst[si]! && c <= colLast[si]!) total += dens[si]![c] ?? 0;
    });
    if (total > maxTotal) maxTotal = total;
  }
  const scale = (RIVER_FILL * (frame.bandBottom - frame.bandTop)) / Math.max(maxTotal, 1e-6);

  const centre = sources.map(() => new Float32Array(nCols));
  const half = sources.map(() => new Float32Array(nCols));
  const top = new Float32Array(nCols);
  const bottom = new Float32Array(nCols);
  const thick = new Float32Array(sources.length);

  for (let c = 0; c < nCols; c++) {
    let total = 0;
    let alive = 0;
    sources.forEach((_, si) => {
      const on = c >= colFirst[si]! && c <= colLast[si]!;
      const th = on ? Math.max(THREAD_PX, (dens[si]![c] ?? 0) * scale) : 0;
      thick[si] = th;
      if (on) {
        total += th;
        alive++;
      }
    });
    total += BAND_GAP_PX * Math.max(0, alive - 1);
    let y = frame.mid - total / 2;
    top[c] = y;
    bottom[c] = frame.mid + total / 2;
    sources.forEach((_, si) => {
      const th = thick[si] ?? 0;
      if (th <= 0) return;
      centre[si]![c] = y + th / 2;
      half[si]![c] = th / 2;
      y += th + BAND_GAP_PX;
    });
  }

  return { nCols, centre, half, top, bottom, colFirst, colLast, colPeak };
}

// ─── Particles and filaments ────────────────────────────────────────────────

interface Particle {
  node: number;
  source: number;
  x: number;
  y: number;
  r: number;
  hub: boolean;
}

interface Filament {
  index: number;
  link: ObsLink;
  older: number;
  newer: number;
  x0: number;
  y0: number;
  cx0: number;
  cx1: number;
  x1: number;
  y1: number;
  far: boolean;
  cross: boolean;
}

function hubThreshold(nodes: readonly ObsNode[]): number {
  const degrees = nodes
    .map((n) => n.degree)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (!degrees.length) return Infinity;
  return Math.max(2, degrees[Math.min(degrees.length - 1, Math.floor(degrees.length * HUB_QUANTILE))]!);
}

function placeParticles(
  data: ObsData,
  sources: readonly RiverSource[],
  scale: TimeScale,
  bands: Bands
): Particle[] {
  const particles: Particle[] = new Array<Particle>(data.nodes.length);
  const hubAt = hubThreshold(data.nodes);
  sources.forEach((s, si) => {
    const byMeaning = [...s.members].sort((a, b) => data.nodes[a]!.x - data.nodes[b]!.x || a - b);
    byMeaning.forEach((i, k) => {
      const rank = (k + 0.5) / byMeaning.length;
      const x = scale.nodeX[i]!;
      const c = Math.min(bands.nCols - 1, Math.max(0, Math.round(x)));
      const y = (bands.centre[si]![c] ?? 0) + (rank - 0.5) * 2 * (bands.half[si]![c] ?? 0) * PARTICLE_SPREAD;
      const degree = data.nodes[i]!.degree;
      particles[i] = {
        node: i,
        source: si,
        x,
        y,
        r: 1 + 0.45 * Math.sqrt(degree),
        hub: degree >= hubAt,
      };
    });
  });
  return particles;
}

function makeFilaments(
  data: ObsData,
  times: Float64Array,
  particles: readonly Particle[]
): Filament[] {
  const horizon = data.stats.halfLifeDays * DAY_MS;
  return data.links.map((link, index) => {
    const flip = times[link.source]! > times[link.target]!;
    const older = flip ? link.target : link.source;
    const newer = flip ? link.source : link.target;
    const a = particles[older]!;
    const b = particles[newer]!;
    const dx = b.x - a.x;
    let cx0: number;
    let cx1: number;
    if (dx < 8) {
      const bulge = 8 + Math.abs(b.y - a.y) * 0.3;
      cx0 = a.x + bulge;
      cx1 = b.x + bulge;
    } else {
      cx0 = a.x + dx * 0.5;
      cx1 = b.x - dx * 0.5;
    }
    return {
      index,
      link,
      older,
      newer,
      x0: a.x,
      y0: a.y,
      cx0,
      cx1,
      x1: b.x,
      y1: b.y,
      far: Math.abs(times[newer]! - times[older]!) > horizon,
      cross: a.source !== b.source,
    };
  });
}

// ─── Callouts ───────────────────────────────────────────────────────────────

interface CalloutText {
  key: string;
  name: string;
  caps: readonly string[];
  /** The junction the leader points at. */
  x: number;
  y: number;
}

interface Callout extends CalloutText {
  /** The text block, estimated from its characters; `flip` right-aligns it. */
  left: number;
  top: number;
  width: number;
  height: number;
  flip: boolean;
  /** Where the leader leaves the block. */
  anchorX: number;
  anchorY: number;
}

function floodCallout(sources: readonly RiverSource[], bands: Bands): CalloutText | null {
  let best: RiverSource | null = null;
  for (const s of sources) {
    if (!best || s.agrees + s.contradicts > best.agrees + best.contradicts) best = s;
  }
  if (!best || best.agrees + best.contradicts === 0) return null;
  const links = best.agrees + best.contradicts;
  const c = bands.colPeak[best.index]!;
  const sameDay = dayOf(best.firstMs) === dayOf(best.lastMs);
  const when = sameDay
    ? fmtDayMonth.format(best.firstMs)
    : `${fmtDayMonth.format(best.firstMs)} to ${fmtDayMonth.format(best.lastMs)}`;
  return {
    key: `flood:${best.name}`,
    name: `${best.name}, ${when}`,
    caps: [
      `${nf.format(best.count)} memories`,
      `${nf.format(links)} links`,
      `${Math.round((best.contradicts / links) * 100)}% contradict`,
    ],
    x: c,
    y: bands.centre[best.index]![c] ?? 0,
  };
}

interface PairTally {
  a: number;
  b: number;
  count: number;
  agrees: number;
  contradicts: number;
  aOlder: number;
  sumX: number;
  sumY: number;
}

function junctionCallouts(
  sources: readonly RiverSource[],
  particles: readonly Particle[],
  filaments: readonly Filament[]
): CalloutText[] {
  const pairs = new Map<string, PairTally>();
  for (const f of filaments) {
    if (!f.cross) continue;
    const sa = particles[f.older]!.source;
    const sb = particles[f.newer]!.source;
    const [a, b] = sa < sb ? [sa, sb] : [sb, sa];
    const key = `${a}|${b}`;
    const t = pairs.get(key) ?? { a, b, count: 0, agrees: 0, contradicts: 0, aOlder: 0, sumX: 0, sumY: 0 };
    pairs.set(key, {
      ...t,
      count: t.count + 1,
      agrees: t.agrees + (f.link.kind === 'agrees' ? 1 : 0),
      contradicts: t.contradicts + (f.link.kind === 'contradicts' ? 1 : 0),
      aOlder: t.aOlder + (sa === a ? 1 : 0),
      sumX: t.sumX + (f.x0 + 3 * f.cx0 + 3 * f.cx1 + f.x1) / 8,
      sumY: t.sumY + (f.y0 + f.y1) / 2,
    });
  }
  return [...pairs.values()]
    .filter((t) => t.count >= CALLOUT_MIN_LINKS)
    .sort((p, q) => q.count - p.count)
    .slice(0, CALLOUT_COUNT)
    .map((t) => {
      const aFirst = t.aOlder * 2 >= t.count;
      const older = sources[aFirst ? t.a : t.b]!.name;
      const newer = sources[aFirst ? t.b : t.a]!.name;
      return {
        key: `pair:${t.a}:${t.b}`,
        name: `${older} → ${newer}`,
        caps: [
          `${nf.format(t.count)} links`,
          `${nf.format(t.agrees)} agree`,
          `${nf.format(t.contradicts)} contradict`,
        ],
        x: t.sumX / t.count,
        y: t.sumY / t.count,
      };
    });
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CALLOUT_HEIGHT = 34;
const CALLOUT_STANDOFF = 30;
const CALLOUT_MIN_STANDOFF = 14;
const CALLOUT_STEP = 40;
const CALLOUT_MARGIN = 8;
const CALLOUT_LEAD = 14;

function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y
  );
}

/** Text width from character counts — an estimate, used only to keep labels
 *  off each other and off the chrome. Archivo at 12.5px averages ~6.4px a
 *  glyph; the 11px tracked caps line ~7.6px. */
function estimateWidth(c: CalloutText): number {
  const caps = c.caps.reduce((n, part) => n + part.length, 0) * 7.6 + (c.caps.length - 1) * 12;
  return Math.ceil(Math.max(c.name.length * 6.4, caps));
}

/** Where a label may not go: the title block, the figures, the axis and the
 *  "tomorrow" caption above its right end. */
function reservedZones(frame: Frame): Rect[] {
  const zones: Rect[] = [
    { x: 0, y: 0, w: frame.width, h: 12 },
    { x: 0, y: 0, w: TITLE_WIDTH, h: frame.showTypes ? 168 : 84 },
    { x: 0, y: frame.axisY - 12, w: frame.width, h: 400 },
    { x: frame.width - 300, y: frame.axisY - 28, w: 300, h: 40 },
  ];
  const figures = FIGURES_WIDTH[frame.figureCount];
  if (figures > 0) zones.push({ x: frame.width - PAD - figures, y: 0, w: figures + PAD, h: 86 });
  return zones;
}

/** Labels are placed in the order given — the flood first, then junctions by
 *  link count — trying below or above the river, either side of the point,
 *  and stepping away. A label that cannot be placed without touching another
 *  label or the chrome is dropped rather than drawn on top of something. */
function placeCallouts(raw: readonly CalloutText[], bands: Bands, frame: Frame): Callout[] {
  const zones = reservedZones(frame);
  const placed: Callout[] = [];
  for (const c of raw) {
    const col = Math.min(bands.nCols - 1, Math.max(0, Math.round(c.x)));
    const w = estimateWidth(c);
    const naturalFlip = c.x + CALLOUT_LEAD + w > frame.width - PAD;
    const prefer = c.y >= frame.mid ? 'below' : 'above';
    const riverTop = bands.top[col] ?? frame.mid;
    const riverBottom = bands.bottom[col] ?? frame.mid;
    /** The block at its ideal standoff, then slid toward the river until it
     *  clears the chrome, but never inside the minimum standoff. */
    const rectFor = (above: boolean, flip: boolean, offset: number): Rect | null => {
      const rect: Rect = {
        x: flip ? c.x - CALLOUT_LEAD - w : c.x + CALLOUT_LEAD,
        y: above ? riverTop - CALLOUT_STANDOFF - offset - CALLOUT_HEIGHT : riverBottom + CALLOUT_STANDOFF + offset,
        w,
        h: CALLOUT_HEIGHT,
      };
      for (let i = 0; i < 60 && zones.some((z) => overlaps(rect, z)); i++) rect.y += above ? 2 : -2;
      const standoff = above ? riverTop - (rect.y + rect.h) : rect.y - riverBottom;
      return standoff >= CALLOUT_MIN_STANDOFF ? rect : null;
    };
    let chosen: { above: boolean; flip: boolean; rect: Rect } | null = null;
    outer: for (const offset of [0, CALLOUT_STEP, CALLOUT_STEP * 2]) {
      for (const above of prefer === 'above' ? [true, false] : [false, true]) {
        for (const flip of [naturalFlip, !naturalFlip]) {
          const rect = rectFor(above, flip, offset);
          if (!rect) continue;
          const inside = rect.x >= frame.plotLeft - 40 && rect.x + rect.w <= frame.width - PAD;
          const clear =
            inside &&
            zones.every((z) => !overlaps(rect, z)) &&
            placed.every((p) => !overlaps(rect, { x: p.left, y: p.top, w: p.width, h: p.height }, CALLOUT_MARGIN));
          if (clear) {
            chosen = { above, flip, rect };
            break outer;
          }
        }
      }
    }
    if (!chosen) continue;
    placed.push({
      ...c,
      left: chosen.rect.x,
      top: chosen.rect.y,
      width: w,
      height: CALLOUT_HEIGHT,
      flip: chosen.flip,
      anchorX: chosen.flip ? chosen.rect.x + w : chosen.rect.x,
      anchorY: chosen.above ? chosen.rect.y + CALLOUT_HEIGHT + 2 : chosen.rect.y - 2,
    });
  }
  return placed;
}

// ─── Axis ───────────────────────────────────────────────────────────────────

interface Tick {
  x: number;
  label: string;
  major: boolean;
}

/** Ticks too close together resolve by rank: the ends of the axis beat a
 *  month, a month beats a day; on a tie the later one stays. */
function buildTicks(scale: TimeScale, frame: Frame): Tick[] {
  const xOfUnit = (u: number) => frame.plotLeft + u * scale.unitPx;
  const ticks: (Tick & { rank: number })[] = [];
  const push = (x: number, label: string, rank: number) => {
    const last = ticks[ticks.length - 1];
    if (last && x - last.x < MIN_TICK_GAP) {
      if (rank < last.rank) return;
      ticks.pop();
    }
    ticks.push({ x, label, major: rank >= 2, rank });
  };
  push(xOfUnit(0), fmtDayMonth.format(scale.firstDay * DAY_MS), 3);
  for (let d = scale.firstDay + 1; d <= scale.today; d++) {
    const k = d - scale.firstDay;
    const start = scale.dayStart[k];
    const end = scale.dayStart[k + 1];
    if (start === undefined || end === undefined) continue;
    const date = new Date(d * DAY_MS);
    if (date.getUTCDate() === 1) push(xOfUnit(start), fmtMonth.format(d * DAY_MS), 2);
    else if ((end - start) * scale.unitPx >= MIN_DAY_TICK_WIDTH) push(xOfUnit(start), String(date.getUTCDate()), 1);
  }
  push(xOfUnit(scale.uNow), 'Today', 3);
  return ticks.map(({ x, label, major }) => ({ x, label, major }));
}

// ─── The river ──────────────────────────────────────────────────────────────

interface Grid {
  cells: Map<number, number[]>;
  cols: number;
}

function buildGrid(particles: readonly Particle[]): Grid {
  const cells = new Map<number, number[]>();
  const cols = 4096;
  for (const p of particles) {
    const key = Math.floor(p.x / GRID_CELL) + Math.floor(p.y / GRID_CELL) * cols;
    const cell = cells.get(key);
    if (cell) cell.push(p.node);
    else cells.set(key, [p.node]);
  }
  return { cells, cols };
}

interface River {
  frame: Frame;
  times: Float64Array;
  scale: TimeScale;
  sources: readonly RiverSource[];
  bands: Bands;
  particles: readonly Particle[];
  filaments: readonly Filament[];
  callouts: readonly Callout[];
  ticks: readonly Tick[];
  grid: Grid;
  idIndex: Map<string, number>;
  within24h: number;
  farLinks: number;
  crossLinks: number;
}

function buildRiver(data: ObsData, width: number, height: number, now: number): River {
  const { times, undated } = parseTimes(data.nodes, now);
  const sources = collectSources(data, times, now);
  const frame = makeFrame(width, height, sources.length);
  const scale = buildTimeScale(times, undated, frame, now);
  const bands = buildBands(sources, scale.nodeX, frame);
  const particles = placeParticles(data, sources, scale, bands);
  const filaments = makeFilaments(data, times, particles);
  const callouts = placeCallouts(
    [floodCallout(sources, bands), ...junctionCallouts(sources, particles, filaments)].filter(
      (c): c is NonNullable<typeof c> => c !== null
    ),
    bands,
    frame
  );
  const idIndex = new Map<string, number>();
  data.nodes.forEach((n, i) => idIndex.set(n.id, i));
  let within24h = 0;
  for (const l of data.links) if (Math.abs(times[l.source]! - times[l.target]!) < DAY_MS) within24h++;
  return {
    frame,
    times,
    scale,
    sources,
    bands,
    particles,
    filaments,
    callouts,
    ticks: buildTicks(scale, frame),
    grid: buildGrid(particles),
    idIndex,
    within24h,
    farLinks: filaments.filter((f) => f.far).length,
    crossLinks: filaments.filter((f) => f.cross).length,
  };
}

function nearestParticle(river: River, visible: Visible, x: number, y: number): number | null {
  const { cells, cols } = river.grid;
  const cx = Math.floor(x / GRID_CELL);
  const cy = Math.floor(y / GRID_CELL);
  let best: number | null = null;
  let bestD = HIT_RADIUS * HIT_RADIUS;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cell = cells.get(cx + i + (cy + j) * cols);
      if (!cell) continue;
      for (const node of cell) {
        if (!visible.nodes[node]) continue;
        const p = river.particles[node]!;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = node;
        }
      }
    }
  }
  return best;
}

// ─── Visibility ─────────────────────────────────────────────────────────────

interface Visible {
  nodes: Uint8Array;
  links: Uint8Array;
  nodeCount: number;
  linkCount: number;
  /** Links passing the type filter alone — the denominator of the view. */
  typeLinks: number;
  agrees: number;
  contradicts: number;
}

function viewPass(f: Filament, view: ViewId): boolean {
  if (view === 'far') return f.far;
  if (view === 'cross') return f.cross;
  if (view === 'contradicts') return f.link.kind === 'contradicts';
  return true;
}

function computeVisible(data: ObsData, river: River, view: ViewId, type: TypeFilter): Visible {
  const nodes = new Uint8Array(data.nodes.length);
  let nodeCount = 0;
  data.nodes.forEach((n, i) => {
    if (type === 'all' || n.type === type) {
      nodes[i] = 1;
      nodeCount++;
    }
  });
  const links = new Uint8Array(river.filaments.length);
  let linkCount = 0;
  let typeLinks = 0;
  let agrees = 0;
  let contradicts = 0;
  for (const f of river.filaments) {
    if (!nodes[f.older] || !nodes[f.newer]) continue;
    typeLinks++;
    if (!viewPass(f, view)) continue;
    links[f.index] = 1;
    linkCount++;
    if (f.link.kind === 'agrees') agrees++;
    else contradicts++;
  }
  return { nodes, links, nodeCount, linkCount, typeLinks, agrees, contradicts };
}

// ─── Drawing ────────────────────────────────────────────────────────────────

function prepare(canvas: HTMLCanvasElement, frame: Frame): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const w = Math.round(frame.width * dpr);
  const h = Math.round(frame.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

function tracePath(ctx: CanvasRenderingContext2D, f: Filament): void {
  ctx.beginPath();
  ctx.moveTo(f.x0, f.y0);
  ctx.bezierCurveTo(f.cx0, f.y0, f.cx1, f.y1, f.x1, f.y1);
}

function traceThread(ctx: CanvasRenderingContext2D, river: River, si: number): void {
  const { colFirst, colLast, centre } = river.bands;
  const line = centre[si]!;
  const from = colFirst[si]!;
  const to = colLast[si]!;
  ctx.beginPath();
  ctx.moveTo(from, line[from] ?? river.frame.mid);
  for (let c = from + 1; c <= to; c += 2) ctx.lineTo(c, line[c] ?? river.frame.mid);
  if ((to - from) % 2 === 1) ctx.lineTo(to, line[to] ?? river.frame.mid);
}

function strokeFilaments(
  ctx: CanvasRenderingContext2D,
  river: River,
  pass: (f: Filament) => boolean,
  glow: { width: number; alpha: number },
  core: { width: number }
): void {
  const glowStyle = new Map<string, string>();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineWidth = glow.width;
  for (const f of river.filaments) {
    if (!pass(f)) continue;
    const hex = linkColor(f.link);
    let style = glowStyle.get(hex);
    if (!style) {
      style = rgba(hex, glow.alpha);
      glowStyle.set(hex, style);
    }
    ctx.strokeStyle = style;
    tracePath(ctx, f);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = core.width;
  for (const f of river.filaments) {
    if (!pass(f)) continue;
    ctx.strokeStyle = linkColor(f.link);
    tracePath(ctx, f);
    ctx.stroke();
  }
}

function fillHalo(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(PLATE_COLORS.memoryLive, alpha));
  g.addColorStop(1, rgba(PLATE_COLORS.memoryLive, 0));
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function fillParticle(ctx: CanvasRenderingContext2D, p: Particle, style: string, grow = 0): void {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + grow, 0, Math.PI * 2);
  ctx.fill();
}

function drawBase(canvas: HTMLCanvasElement, river: River, visible: Visible): void {
  const ctx = prepare(canvas, river.frame);
  if (!ctx) return;

  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(PLATE_COLORS.memory, 0.3);
  river.sources.forEach((_, si) => {
    traceThread(ctx, river, si);
    ctx.stroke();
  });

  strokeFilaments(
    ctx,
    river,
    (f) => visible.links[f.index] === 1,
    { width: GLOW_WIDTH, alpha: GLOW_ALPHA },
    { width: CORE_WIDTH }
  );

  const rest = rgba(PLATE_COLORS.memory, 0.95);
  for (const p of river.particles) {
    if (!visible.nodes[p.node]) continue;
    if (p.hub) {
      fillHalo(ctx, p.x, p.y, p.r * 3.2 + 4, 0.22);
      fillParticle(ctx, p, PLATE_COLORS.memoryLive);
    } else {
      fillParticle(ctx, p, rest);
    }
  }
}

interface Focus {
  node: number | null;
  source: number | null;
}

function drawOverlay(canvas: HTMLCanvasElement, river: River, visible: Visible, focus: Focus): void {
  const ctx = prepare(canvas, river.frame);
  if (!ctx) return;
  const { node, source } = focus;
  if (node === null && source === null) return;

  if (source !== null) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(PLATE_COLORS.ink, 0.85);
    traceThread(ctx, river, source);
    ctx.stroke();
    strokeFilaments(
      ctx,
      river,
      (f) =>
        visible.links[f.index] === 1 &&
        (river.particles[f.older]!.source === source || river.particles[f.newer]!.source === source),
      { width: 6, alpha: 0.12 },
      { width: 1.6 }
    );
    for (const i of river.sources[source]!.members) {
      if (!visible.nodes[i]) continue;
      fillParticle(ctx, river.particles[i]!, PLATE_COLORS.memoryLive, 0.4);
    }
  }

  if (node !== null && visible.nodes[node]) {
    const touching = new Set<number>();
    strokeFilaments(
      ctx,
      river,
      (f) => {
        const hit = visible.links[f.index] === 1 && (f.older === node || f.newer === node);
        if (hit) touching.add(f.older === node ? f.newer : f.older);
        return hit;
      },
      { width: 7, alpha: 0.3 },
      { width: 1.8 }
    );
    for (const i of touching) fillParticle(ctx, river.particles[i]!, rgba(PLATE_COLORS.memoryLive, 0.85), 0.3);
    const p = river.particles[node]!;
    fillHalo(ctx, p.x, p.y, p.r * 5 + 8, 0.55);
    fillParticle(ctx, p, PLATE_COLORS.memoryLive, 1.4);
  }
}

// ─── Text helpers ───────────────────────────────────────────────────────────

function monthRange(first: number, last: number): string {
  const a = fmtMonth.format(first);
  const b = fmtMonth.format(last);
  return a === b ? a : `${a}–${b}`;
}

function viewNote(view: ViewId, visible: Visible, data: ObsData, type: TypeFilter): string {
  const of = `of ${nf.format(visible.typeLinks)}${type === 'all' ? '' : ` between ${type} memories`}`;
  const split = `${nf.format(visible.agrees)} agree, ${nf.format(visible.contradicts)} contradict`;
  switch (view) {
    case 'far':
      return `${nf.format(visible.linkCount)} ${of} join memories written more than ${data.stats.halfLifeDays} days apart; ${split}.`;
    case 'cross':
      return `${nf.format(visible.linkCount)} ${of} join memories from two different sources; ${split}.`;
    case 'contradicts':
      return `${nf.format(visible.linkCount)} ${of} contradict.`;
    default:
      return `${nf.format(visible.linkCount)} ${of} drawn; ${nf.format(data.stats.linksToArchived)} more in the store point at archived memories and cannot be.`;
  }
}

// ─── Chrome pieces ──────────────────────────────────────────────────────────

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="mr-fig">
      <div className="mr-fig-value">{value}</div>
      <div className="mr-caps">{label}</div>
    </div>
  );
}

function Caps({ parts }: { parts: readonly string[] }) {
  return (
    <div className="mr-caps mr-caps-row">
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </div>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const [now] = useState(() => Date.now());
  const [view, setView] = useState<ViewId>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [hover, setHover] = useState<number | null>(null);
  const [hoverSource, setHoverSource] = useState<number | null>(null);
  const [pinnedSource, setPinnedSource] = useState<number | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);

  const river = useMemo(() => buildRiver(data, width, height, now), [data, width, height, now]);
  const visible = useMemo(() => computeVisible(data, river, view, type), [data, river, view, type]);
  const selected = selectedId === null ? null : (river.idIndex.get(selectedId) ?? null);
  const focusNode = hover ?? selected;
  const focusSource = hoverSource ?? pinnedSource;

  useEffect(() => {
    if (baseRef.current) drawBase(baseRef.current, river, visible);
  }, [river, visible]);

  useEffect(() => {
    if (overRef.current) drawOverlay(overRef.current, river, visible, { node: focusNode, source: focusSource });
  }, [river, visible, focusNode, focusSource]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onSelect(null);
      setPinnedSource(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onSelect]);

  const locate = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      return nearestParticle(river, visible, event.clientX - box.left, event.clientY - box.top);
    },
    [river, visible]
  );
  const onMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => setHover(locate(event)), [locate]);
  const onLeave = useCallback(() => setHover(null), []);
  const onClick = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const node = locate(event);
      onSelect(node === null ? null : data.nodes[node]!.id);
    },
    [locate, onSelect, data]
  );

  const { frame, scale, sources } = river;
  const { stats } = data;
  const linksDrawn = data.links.length;
  const pct24 = linksDrawn ? Math.round((river.within24h / linksDrawn) * 100) : 0;
  const agreeShare = linksDrawn ? stats.agrees / linksDrawn : 0.5;
  const firstMs = scale.firstDay * DAY_MS;
  const lastMs = sources.reduce((m, s) => Math.max(m, s.lastMs), firstMs);
  const tip = focusNode === null ? null : river.particles[focusNode]!;
  const tipNode = tip ? data.nodes[tip.node]! : null;
  const summary =
    `Memory River: ${nf.format(stats.memories)} memories from ${sources.length} sources drawn left to right by ` +
    `order of writing, ${fmtFull.format(firstMs)} to ${fmtFull.format(lastMs)}; ${nf.format(linksDrawn)} links drawn ` +
    `of ${nf.format(stats.linksStored)} stored, ${nf.format(stats.agrees)} agree and ${nf.format(stats.contradicts)} contradict.`;

  return (
    <div className="mr-box" style={{ width, height }}>
      <style href="observatory-memory-river" precedence="medium">
        {CSS}
      </style>

      <canvas ref={baseRef} className="mr-canvas" style={{ width, height }} role="img" aria-label={summary} />
      <canvas
        ref={overRef}
        className="mr-canvas is-top"
        style={{ width, height }}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onClick={onClick}
        aria-hidden
      />
      {reducedMotion ? null : <div className="mr-cover" aria-hidden />}

      <svg
        className={`mr-figure${reducedMotion ? '' : ' is-entering'}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
      >
        <FigureLayer river={river} lit={focusSource} />
      </svg>

      <header className="mr-title">
        <h2>Memory River</h2>
        <div className="mr-caps mr-sub">
          {nf.format(scale.spanDays)} days of one store, oldest on the left
          {scale.undated ? `, ${scale.undated} undated drawn at today` : ''}
        </div>
        <div className="mr-key" title={`${nf.format(stats.agrees)} agree, ${nf.format(stats.contradicts)} contradict`}>
          <i style={{ width: `${Math.round(agreeShare * 100)}%`, background: 'var(--agrees)' }} />
          <i style={{ width: `${Math.round((1 - agreeShare) * 100)}%`, background: 'var(--contradicts)' }} />
        </div>
        {frame.showTypes ? (
          <nav className="mr-nav" aria-label="Memory type">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="mr-caps mr-nav-item"
                aria-pressed={type === t.id}
                onClick={() => setType(t.id)}
              >
                <span>{t.name}</span>
                <span className="mr-nav-n">{t.id === 'all' ? nf.format(stats.memories) : nf.format(stats.byType[t.id])}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      {frame.figureCount > 0 ? (
        <div className="mr-figs">
          <Figure value={String(sources.length)} label="sources" />
          {frame.figureCount === 4 ? (
            <Figure value={String(scale.daysWithWriting)} label={`days with writing of ${scale.spanDays}`} />
          ) : null}
          {frame.figureCount === 4 ? <Figure value={`${pct24}%`} label="links inside 24 hours" /> : null}
          <Figure value={nf.format(river.farLinks)} label={`links over ${stats.halfLifeDays} days apart`} />
          <div
            className={`mr-live mr-caps${reducedMotion ? '' : ' is-pulsing'}`}
            title="Read from the running API when this page loaded; nothing here is a fixture"
          >
            <i aria-hidden />
            Live store
          </div>
        </div>
      ) : null}

      <ol
        className="mr-list"
        aria-label="Sources, in order of first writing"
        style={{ left: frame.listLeft, top: frame.listTop, width: frame.listWidth, height: frame.rowH * sources.length }}
      >
        {sources.map((s) => (
          <li key={s.name} style={{ top: s.index * frame.rowH, height: frame.rowH }}>
            <button
              type="button"
              className={`mr-row${focusSource === s.index ? ' is-lit' : ''}${pinnedSource === s.index ? ' is-pinned' : ''}`}
              aria-pressed={pinnedSource === s.index}
              onPointerEnter={() => setHoverSource(s.index)}
              onPointerLeave={() => setHoverSource(null)}
              onFocus={() => setHoverSource(s.index)}
              onBlur={() => setHoverSource(null)}
              onClick={() => setPinnedSource((p) => (p === s.index ? null : s.index))}
              title={`${s.name}: ${nf.format(s.count)} memories, ${fmtFull.format(s.firstMs)} to ${fmtFull.format(s.lastMs)}`}
            >
              <span className="mr-ring" aria-hidden />
              <span className="mr-row-text">
                <span className="mr-row-name">{s.name}</span>
                {frame.showCaps ? <Caps parts={[nf.format(s.count), monthRange(s.firstMs, s.lastMs)]} /> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {river.callouts.map((c) => (
        <div
          key={c.key}
          className={`mr-callout${c.flip ? ' is-flipped' : ''}`}
          style={c.flip ? { right: width - (c.left + c.width), top: c.top } : { left: c.left, top: c.top }}
        >
          <div className="mr-callout-name">{c.name}</div>
          <Caps parts={c.caps} />
        </div>
      ))}

      <div className="mr-views" role="radiogroup" aria-label="Which links are drawn">
        {VIEWS.map((v) => {
          const count =
            v.id === 'all'
              ? visible.typeLinks
              : river.filaments.filter((f) => visible.nodes[f.older] && visible.nodes[f.newer] && viewPass(f, v.id)).length;
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={view === v.id}
              className="mr-view"
              onClick={() => setView(v.id)}
            >
              <span className="mr-dot" aria-hidden />
              <span>{v.name}</span>
              <span className="mr-view-n">{nf.format(count)}</span>
            </button>
          );
        })}
        <p className="mr-view-note">{viewNote(view, visible, data, type)}</p>
      </div>

      <div className="mr-tag mr-caps">
        <div>A day is as wide as what was written in it</div>
        <div className="mr-tag-2">
          {nf.format(scale.silentDays)} silent days are drawn narrow, not dropped
        </div>
      </div>

      {tip && tipNode ? (
        <div
          className="mr-tip"
          role="status"
          style={tip.x + 280 > width ? { right: width - tip.x + 14, top: tip.y - 12 } : { left: tip.x + 14, top: tip.y - 12 }}
        >
          <div className="mr-tip-label">{tipNode.label}</div>
          <div className="mr-tip-meta">
            {sources[tip.source]!.name}, {fmtFull.format(river.times[tip.node]!)}
            <br />
            {tipNode.type}, {nf.format(tipNode.degree)} links: {nf.format(tipNode.agreeDegree)} agree,{' '}
            {nf.format(tipNode.contradictDegree)} contradict
            <br />
            {RETENTION_LABEL[tipNode.retentionBand]}
            {selected === tip.node ? ', selected' : ''}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── SVG figure layer: leaders, rings, axis, arrow ──────────────────────────

const f1 = (n: number): string => n.toFixed(1);

function directLeader(lx: number, ly: number, ex: number, ey: number): string {
  const mx = (lx + ex) / 2;
  return `M${f1(lx)},${f1(ly)} C${f1(mx)},${f1(ly)} ${f1(mx)},${f1(ey)} ${f1(ex)},${f1(ey)}`;
}

/** A source that arrives late is, by construction, the lowest band at its
 *  entry column — streams stack in arrival order — so its leader can run
 *  along the river's underside and rise into it without crossing any other
 *  stream. `k` staggers the channels so several can run side by side. */
function undersideLeader(river: River, lx: number, ly: number, entry: Particle, k: number): string {
  const { bands, frame } = river;
  const chan = (x: number): number => {
    const c = Math.min(bands.nCols - 1, Math.max(0, Math.round(x)));
    return (bands.bottom[c] ?? frame.mid) + 8 + 3 * k;
  };
  const xJoin = frame.plotLeft + 26 + 6 * k;
  const xLeave = entry.x - 40 - 6 * k;
  const mx = (lx + xJoin) / 2;
  const parts = [`M${f1(lx)},${f1(ly)}`, `C${f1(mx)},${f1(ly)} ${f1(mx)},${f1(chan(xJoin))} ${f1(xJoin)},${f1(chan(xJoin))}`];
  for (let x = xJoin + 4; x < xLeave; x += 4) parts.push(`L${x},${f1(chan(x))}`);
  parts.push(`L${f1(xLeave)},${f1(chan(xLeave))}`);
  parts.push(`C${f1(xLeave + 22)},${f1(chan(xLeave))} ${f1(entry.x - 22)},${f1(entry.y)} ${f1(entry.x - 4)},${f1(entry.y)}`);
  return parts.join(' ');
}

function FigureLayer({ river, lit }: { river: River; lit: number | null }) {
  const { frame, sources, bands, particles, ticks, callouts, scale } = river;
  const listRight = frame.listLeft + frame.listWidth + 4;
  const arrowX = frame.width - 4;
  const entries = sources.map((s) => {
    const first = s.members.reduce((a, b) => (river.times[a]! <= river.times[b]! ? a : b));
    return particles[first]!;
  });
  const nearLeft = frame.plotLeft + (frame.plotRight - frame.plotLeft) * 0.12;
  const routed = sources
    .filter((s) => entries[s.index]!.x > nearLeft)
    .sort((a, b) => entries[a.index]!.x - entries[b.index]!.x);
  const channel = new Map(routed.map((s, k) => [s.index, k]));
  return (
    <>
      {sources.map((s) => {
        const entry = entries[s.index]!;
        const rowY = frame.listTop + (s.index + 0.5) * frame.rowH;
        const k = channel.get(s.index);
        const d =
          k === undefined || entry.x - 40 - 6 * k <= frame.plotLeft + 60 + 6 * k
            ? directLeader(listRight, rowY, entry.x - 4, entry.y)
            : undersideLeader(river, listRight, rowY, entry, k);
        return (
          <g key={s.name} className={`mr-leader${lit === s.index ? ' is-lit' : ''}`}>
            <path d={d} />
            <circle cx={entry.x} cy={entry.y} r={2.6} />
          </g>
        );
      })}

      {sources
        .filter((s) => s.stillWriting)
        .map((s) => {
          const c = bands.colLast[s.index]!;
          const y = bands.centre[s.index]![c] ?? frame.mid;
          const from = Math.max(c, frame.plotRight);
          return (
            <path
              key={`delta-${s.name}`}
              className="mr-delta"
              d={`M${c},${y.toFixed(1)} L${from},${y.toFixed(1)} Q${(frame.width - 20).toFixed(1)},${y.toFixed(1)} ${arrowX},${frame.mid.toFixed(1)}`}
            />
          );
        })}
      <path
        className="mr-arrow"
        d={`M${arrowX - 12},${(frame.mid - 8).toFixed(1)} L${arrowX},${frame.mid.toFixed(1)} L${arrowX - 12},${(frame.mid + 8).toFixed(1)}`}
      />

      {callouts.map((c) => (
        <g key={c.key} className="mr-callout-leader">
          <path d={`M${c.anchorX.toFixed(1)},${c.anchorY.toFixed(1)} L${c.x.toFixed(1)},${c.y.toFixed(1)}`} />
          <circle cx={c.x} cy={c.y} r={3.5} />
        </g>
      ))}

      <g className="mr-axis">
        <path d={`M${frame.plotLeft},${frame.axisY} L${frame.width},${frame.axisY}`} />
        {ticks.map((t) => (
          <g key={`${t.label}-${t.x.toFixed(0)}`} className={t.major ? 'is-major' : 'is-minor'}>
            <path d={`M${t.x.toFixed(1)},${frame.axisY} v${t.major ? 6 : 3}`} />
            <text x={t.x} y={frame.axisY + 17} textAnchor="middle">
              {t.label}
            </text>
          </g>
        ))}
        <text className="mr-axis-tomorrow" x={frame.width - PAD} y={frame.axisY - 8} textAnchor="end">
          {`tomorrow, after ${fmtDayMonth.format(scale.today * DAY_MS)}`}
        </text>
      </g>
    </>
  );
}

// ─── Style ──────────────────────────────────────────────────────────────────

const CSS = `
.mr-box { position: absolute; inset: 0; overflow: hidden; font-family: var(--font-instrument); color: var(--ink); }
.mr-canvas { position: absolute; left: 0; top: 0; display: block; }
.mr-canvas.is-top { cursor: crosshair; }
.mr-figure { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.mr-figure.is-entering { animation: mr-appear 700ms var(--ease) 450ms both; }
@keyframes mr-appear { from { opacity: 0; } to { opacity: 1; } }

.mr-cover {
  position: absolute; top: 0; bottom: 0; left: 0; width: calc(100% + 160px);
  background: linear-gradient(90deg, transparent 0, var(--plate) 160px);
  transform: translateX(-160px); pointer-events: none;
  animation: mr-flow 1300ms var(--ease) forwards;
}
@keyframes mr-flow { from { transform: translateX(-160px); } to { transform: translateX(100%); } }

.mr-caps {
  font-size: var(--t-label); font-weight: 500; font-stretch: 90%;
  text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-3); line-height: 1.3;
}
.mr-caps-row { display: flex; gap: 12px; white-space: nowrap; }

.mr-title { position: absolute; left: ${PAD}px; top: 16px; pointer-events: none; }
.mr-title h2 {
  margin: 0; font-family: var(--font-note); font-weight: 200; font-size: 34px;
  line-height: 1; letter-spacing: -0.005em; color: var(--ink); white-space: nowrap;
}
.mr-sub { margin-top: 7px; white-space: nowrap; }
.mr-key { display: flex; gap: 2px; width: 44px; height: 2px; margin-top: 8px; }
.mr-key i { display: block; height: 2px; }
.mr-nav { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; margin-top: 12px; pointer-events: auto; }
.mr-nav-item { display: flex; gap: 8px; align-items: baseline; padding: 1px 0; color: var(--ink-3); transition: color var(--dur) var(--ease); }
.mr-nav-item:hover { color: var(--ink-2); }
.mr-nav-item[aria-pressed='true'] { color: var(--ink); }
.mr-nav-n { font-variant-numeric: tabular-nums; letter-spacing: 0.04em; opacity: 0.8; }

.mr-figs { position: absolute; right: ${PAD}px; top: 16px; display: flex; align-items: flex-start; pointer-events: none; }
.mr-fig { padding: 0 16px; border-left: 1px solid var(--rule); }
.mr-fig:first-child { border-left: none; padding-left: 0; }
.mr-fig-value { font-size: 26px; font-weight: 400; line-height: 1; letter-spacing: -0.01em; color: var(--ink); }
.mr-fig .mr-caps { margin-top: 6px; white-space: nowrap; }
.mr-live {
  display: inline-flex; align-items: center; gap: 7px; margin: 3px 0 0 16px; padding: 4px 10px;
  border: 1px solid var(--rule); border-radius: 999px; color: var(--ink-2); pointer-events: auto;
}
.mr-live i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink); }
.mr-live.is-pulsing i { animation: mr-pulse 2.6s ease-in-out infinite; }
@keyframes mr-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

.mr-list { position: absolute; margin: 0; padding: 0; list-style: none; }
.mr-list li { position: absolute; left: 0; width: 100%; }
.mr-row {
  display: flex; align-items: center; gap: 9px; width: 100%; height: 100%;
  text-align: left; color: var(--ink-2); transition: color var(--dur) var(--ease);
}
.mr-ring { flex: 0 0 auto; width: 7px; height: 7px; border: 1px solid var(--ink-3); border-radius: 50%; transition: border-color var(--dur) var(--ease); }
.mr-row-text { min-width: 0; display: flex; flex-direction: column; }
.mr-row-name { font-size: var(--t-body); line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mr-row .mr-caps-row { margin-top: 2px; gap: 8px; }
.mr-row:hover, .mr-row.is-lit { color: var(--ink); }
.mr-row.is-lit .mr-ring { border-color: var(--ink); }
.mr-row.is-pinned .mr-ring { background: var(--ink); }

.mr-leader path { fill: none; stroke: var(--ink-3); stroke-width: 1; opacity: 0.55; transition: opacity var(--dur) var(--ease); }
.mr-leader circle { fill: none; stroke: var(--ink-3); stroke-width: 1; }
.mr-leader.is-lit path, .mr-leader.is-lit circle { stroke: var(--ink); opacity: 1; }
.mr-delta { fill: none; stroke: var(--ink-3); stroke-width: 1; opacity: 0.7; }
.mr-arrow { fill: none; stroke: var(--ink-2); stroke-width: 1.2; }
.mr-callout-leader path { fill: none; stroke: var(--ink-3); stroke-width: 1; }
.mr-callout-leader circle { fill: none; stroke: var(--ink-2); stroke-width: 1; }
.mr-axis path { fill: none; stroke: var(--rule); stroke-width: 1; }
.mr-axis text { font-size: var(--t-label); fill: var(--ink-3); font-stretch: 78%; font-weight: 500; }
.mr-axis .is-minor text { opacity: 0.75; }
.mr-axis-tomorrow {
  text-transform: uppercase; letter-spacing: 0.14em; font-stretch: 90% !important;
}

.mr-callout { position: absolute; pointer-events: none; }
.mr-callout.is-flipped { text-align: right; }
.mr-callout.is-flipped .mr-caps-row { justify-content: flex-end; }
.mr-callout-name { font-size: var(--t-body); line-height: 1.2; color: var(--ink); white-space: nowrap; }
.mr-callout .mr-caps-row { margin-top: 3px; }

.mr-views { position: absolute; left: ${PAD}px; bottom: 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.mr-view { display: flex; align-items: center; gap: 9px; font-size: var(--t-body); line-height: 1.2; color: var(--ink-3); transition: color var(--dur) var(--ease); }
.mr-view:hover { color: var(--ink-2); }
.mr-view[aria-checked='true'] { color: var(--ink); }
.mr-dot { position: relative; width: 9px; height: 9px; border: 1px solid currentColor; border-radius: 50%; }
.mr-view[aria-checked='true'] .mr-dot::after { content: ''; position: absolute; inset: 2px; border-radius: 50%; background: currentColor; }
.mr-view-n { font-variant-numeric: tabular-nums; color: var(--ink-3); }
.mr-view-note { margin: 3px 0 0 18px; max-width: 32ch; font-size: var(--t-label); line-height: 1.35; color: var(--ink-3); }

.mr-tag { position: absolute; right: ${PAD}px; bottom: 16px; text-align: right; pointer-events: none; }
.mr-tag-2 { opacity: 0.7; }

.mr-tip {
  position: absolute; pointer-events: none; max-width: 260px; padding: 8px 10px;
  background: var(--margin); border: 1px solid var(--rule);
}
.mr-tip-label {
  font-size: var(--t-body); line-height: 1.35; color: var(--ink); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.mr-tip-meta { margin-top: 4px; font-size: var(--t-label); line-height: 1.4; color: var(--ink-2); }
`;

export const memoryRiver: DemoModule = {
  id: 'river',
  name: 'Memory River',
  dimension: 'Hybrid',
  claim:
    'Time is the one axis this store genuinely has: laid out by order of writing, it becomes a few dense sittings joined by a handful of long threads, and one five-day flood of reflections holds almost every contradiction.',
  Plate,
};
