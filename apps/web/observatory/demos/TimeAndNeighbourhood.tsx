/**
 * SLOT — hybrid, and its axis is time. "When, then who."
 *
 * ─── The argument ──────────────────────────────────────────────────────────
 *
 * Time is the one dimension none of the other demos spends, and it is the one
 * dimension this store actually has a lot of: 651 memories over 167 days. The
 * question this plate asks is not "what is near what" — the projection already
 * answers that badly — but "when was this store written, and does it ever link
 * across its own history".
 *
 * The answer, measured on this store, is that it barely does:
 *
 *   • The median link joins two memories written 0.86 days apart. 55% of all
 *     renderable links join two memories written on the SAME day, and 94% join
 *     two memories written inside one half-life of each other.
 *   • Only 178 of 3,101 links reach further than 7 days. Only 98 reach further
 *     than 30 days — the age at which the server itself calls a memory spent.
 *   • Those far links are almost all agreements: 163 agree against 15
 *     contradict past a half-life, and 93 against 5 past a month. The store
 *     contradicts itself only in the moment; it agrees across time.
 *
 * So the graph is not a web spread over five months. It is a stack of
 * sittings, each one densely wired inside itself, with a few dozen threads
 * running between them. That is a picture no layout of the embedding can show,
 * because the embedding does not know what time it is.
 *
 * ─── The retention pile, and why it is not a rendering problem ─────────────
 *
 * 564 of 651 memories sit in the weakest retention band, which is the thing
 * that breaks a naive time plot. But retention here is not an independent
 * variable to be squeezed onto an axis. The server's rule is
 * `retention = 2^(-ageDays / 7)`, so retention is age, exactly, with no
 * information of its own. Plotting it as a VALUE is what piles 564 marks onto
 * one pixel, because an exponential of a linear quantity has to.
 *
 * This plate therefore never plots retention. It plots the age that retention
 * is made of, linearly, and draws the four bands as what they literally are —
 * four intervals of the time axis:
 *
 *   Vivid        newer than 7 days      (retention ≥ 0.5)
 *   Holding      7 to 14 days
 *   Fading       14 to ~30.2 days       (7 · log2 20)
 *   At threshold older than ~30.2 days  (retention < 0.05)
 *
 * Drawn that way the pile stops being an artefact and becomes the finding: the
 * "At threshold" band is 82% of the axis, so a 7-day half-life over a 167-day
 * store puts 87% of the memories past threshold by arithmetic, not by neglect.
 * The counts are printed inside each band with the real denominator.
 *
 * The other half of the pile is the writing itself, and that one is left
 * exactly as it is. The store was written in two sittings and a thin tail:
 * roughly 56% of every memory it holds arrived inside a single five-day window
 * in July, and there is a 25-day stretch with nothing in it at all. The axis is
 * linear calendar time, so the five-day spike is five columns and the silences
 * are gaps. Nothing is ranked, binned to equal width, or smoothed. The column
 * heights are shares of the whole, so a tall column is honestly tall.
 *
 * ─── What the overview draws ───────────────────────────────────────────────
 *
 * Three tracks on one shared calendar axis, oldest left:
 *
 *   REACH   the 178 links that span more than one half-life, grouped into
 *           day-pairs and drawn as horizontal threads. Height is how far back
 *           the thread reaches, on a log scale floored at the half-life;
 *           thickness is how many links are in the bundle, so density is
 *           geometry (rule 4) and never a wash. This is the track that carries
 *           the claim: it is nearly empty, and nearly all blue.
 *
 *   SHARE   per day, two bars on ONE scale: this day's share of all memories
 *           beside this day's share of all links. Not a dual axis — both are
 *           percentages of their own total, indexed to a common base, which is
 *           the only way two counts three orders apart can share a frame. The
 *           gap between the pair is the interesting quantity: 18 July holds
 *           14.1% of the store's memories and 22.8% of its connections, so
 *           that sitting is denser in knowledge than in volume.
 *
 *   BANDS   the four retention intervals as regions of the axis, named, with
 *           counts and the denominator.
 *
 * A link is counted on the day of its NEWER endpoint — a connection is born
 * with the second memory, not the first — so every link is counted once and
 * the shares sum to 100%. The same convention governs the detail: a link is
 * always drawn as its newer end reaching BACK to its older end.
 *
 * ─── What the detail draws ─────────────────────────────────────────────────
 *
 * The link neighbourhood of one moment — one calendar day of writing.
 *
 * The day's memories sit on a centre line at their real clock time. Every
 * link touching them leaves that line, and how far it travels vertically is
 * how far it travels in TIME, on a log scale from a minute to six months with
 * the half-life ruled and named. Links to memories written later go up; links
 * to memories written earlier go down; a link between two memories of the same
 * day is a bow dipping below the line to the depth of the gap between them.
 * So the detail's vertical axis is the same quantity the overview's reach
 * track measures, one zoom level in.
 *
 * The picture that produces is the claim at close range: a shallow trough of
 * bows and a dense fringe of short links a few hours deep, and then almost
 * nothing until the very bottom of the frame, where two or three long threads
 * drop away to March.
 *
 * ─── How the two halves stay coupled ───────────────────────────────────────
 *
 * A wedge. The focused day's column in the overview opens downward into the
 * full width of the detail, so the slice of time under inspection is a drawn
 * object, not a caption. The column itself is lit for its whole height, its
 * far threads grow white drop-ticks to the axis, and the caption between the
 * two halves names the date and its counts.
 *
 * Geometry does not move when the focus does: the detail's x axis is always
 * 00:00–24:00 and its y axis is always a minute to six months, so stepping
 * from day to day changes what is drawn and never where to look. Pointing is
 * enough; the focus persists when the pointer leaves. Arrow keys step between
 * days that have writing in them.
 *
 * `selectedId` is honoured in both directions. A memory arriving from another
 * demo pulls the focus onto its own day and lands ringed and named. Clicking a
 * memory here filters the detail to that memory's own links — a filter, not a
 * fade, because fading a token link past 80% opacity walks it under the 3:1
 * mark floor these colours were measured against. The count and its
 * denominator are printed whenever the filter is on.
 *
 * ─── Deliberately not drawn ────────────────────────────────────────────────
 *
 *   The embedding. All three PCA coordinates are ignored. This plate spends
 *   its axes on time, and the 38% of variance the projection keeps has no
 *   claim on them.
 *
 *   2,923 of the 3,101 renderable links, in the overview's reach track. They
 *   are inside one half-life and would be threads shorter than their own
 *   stroke width. They are all present in the SHARE bars, counted, and all
 *   present in the detail. The track says what it excludes.
 *
 *   5,393 more links exist in the store and point at memories that have been
 *   archived. Nobody can draw them; the denominator is stated.
 *
 *   Memory type. 79% of this store is semantic and 96% of links join two
 *   memories of the same type, so it partitions nothing. It survives as a word
 *   in the caption.
 *
 *   The 38 memories with no renderable link. They are in the SHARE bars —
 *   they were written — and they can be focused, and the detail then honestly
 *   shows a moment with nothing leaving it.
 *
 *   Retention as colour (rule 5), as a wash (rule 4), or as a value on an
 *   axis (see above). It is an interval of time and a named band.
 *
 * ─── Where this could be wrong ─────────────────────────────────────────────
 *
 * If the owner's question is "what is related to what", time is the wrong
 * primary axis and this plate makes them work for it. It is also a bet that
 * the store keeps writing in bursts; a store that ingested evenly would make
 * the calendar axis dull and the reach track empty for the opposite reason.
 * And the day is a coarse moment — two sittings inside one day are one column
 * here, which the detail's clock axis exposes but the overview does not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RETENTION_LABEL, linkColor } from './contract';
import type { DemoModule, DemoProps, LinkKind, ObsData, RetentionBand } from './contract';

// ─── Units ──────────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The detail's vertical axis: a minute at the line, six months at the frame. */
const REACH_FLOOR_MS = MINUTE_MS;
const REACH_CEIL_MS = 183 * DAY_MS;

/**
 * Rungs on that axis, in the order they earn their place. The half-life leads
 * because the claim is stated against it; the rest fill in while there is room,
 * so a short window loses the crowded middle rather than every label at once.
 */
const REACH_RUNGS: { at: number; label: string; solid?: boolean }[] = [
  { at: DAY_MS, label: '1 day' },
  { at: HOUR_MS, label: '1 hour' },
  { at: 30 * DAY_MS, label: '1 month' },
  { at: 6 * HOUR_MS, label: '6 hours' },
  { at: 90 * DAY_MS, label: '3 months' },
];

const nf = new Intl.NumberFormat('en-US');
const fmtDayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const fmtFull = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const fmtClock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function midnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function pct(share: number): string {
  if (share > 0 && share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
}

// ─── Derivation: the store laid along its own history ───────────────────────

interface DayBin {
  key: string;
  start: number;
  end: number;
  /** Node indices written that day, oldest first. */
  memories: number[];
  /** Links whose NEWER endpoint falls here — every link counted exactly once. */
  born: number;
  bornAgrees: number;
  bornContradicts: number;
  /** Links touching this day that span more than one half-life. */
  far: number;
}

interface ReachBundle {
  /** Earliest and latest endpoint in the bundle. */
  from: number;
  to: number;
  kind: LinkKind;
  count: number;
  spanDays: number;
  fromKey: string;
  toKey: string;
}

interface BandRegion {
  band: RetentionBand;
  from: number;
  to: number;
  count: number;
}

interface History {
  now: number;
  ts: number[];
  bins: DayBin[];
  binOfNode: Int32Array;
  binIndexByKey: Map<string, number>;
  indexById: Map<string, number>;
  domainStart: number;
  domainEnd: number;
  /** Largest of the two shares in any single day — the shared bar scale. */
  maxShare: number;
  maxShareKey: string;
  bundles: ReachBundle[];
  far: number;
  farAgrees: number;
  farContradicts: number;
  maxSpanDays: number;
  bands: BandRegion[];
  calendarDays: number;
  silentDays: number;
  months: { at: number; label: string }[];
  halfLifeDays: number;
  thresholdDays: number;
}

/**
 * Recover the instant the harness computed retention against, from retention
 * itself: `retention = 2^(-ageDays / halfLife)` inverts exactly. Using this
 * rather than `Date.now()` keeps the band boundaries drawn here identical to
 * the bands counted in `data.stats`, however long the page has been open.
 */
function derivedNow(data: ObsData): number {
  const halfLife = data.stats.halfLifeDays;
  let total = 0;
  let seen = 0;
  for (const node of data.nodes) {
    if (!(node.retention > 0)) continue;
    total += Date.parse(node.createdAt) - halfLife * Math.log2(node.retention) * DAY_MS;
    seen++;
  }
  return seen > 0 ? total / seen : Date.now();
}

function buildHistory(data: ObsData): History {
  const now = derivedNow(data);
  const halfLife = data.stats.halfLifeDays;
  const ts = data.nodes.map((n) => Date.parse(n.createdAt));

  const indexById = new Map<string, number>();
  data.nodes.forEach((n, i) => indexById.set(n.id, i));

  // Calendar-day bins, created only where the store actually wrote or linked.
  const binIndexByKey = new Map<string, number>();
  const bins: DayBin[] = [];
  const binFor = (at: number): DayBin => {
    const key = dayKey(at);
    const existing = binIndexByKey.get(key);
    if (existing !== undefined) return bins[existing]!;
    const start = midnight(at);
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    const bin: DayBin = {
      key,
      start,
      end: next.getTime(),
      memories: [],
      born: 0,
      bornAgrees: 0,
      bornContradicts: 0,
      far: 0,
    };
    binIndexByKey.set(key, bins.length);
    bins.push(bin);
    return bin;
  };

  const binOfNode = new Int32Array(data.nodes.length).fill(-1);
  data.nodes.forEach((_, i) => {
    const bin = binFor(ts[i]!);
    bin.memories.push(i);
  });

  // Reach bundles: one thread per (older day, newer day, kind).
  const grouped = new Map<string, ReachBundle>();
  let far = 0;
  let farAgrees = 0;
  let farContradicts = 0;

  for (const link of data.links) {
    const a = ts[link.source]!;
    const b = ts[link.target]!;
    const older = Math.min(a, b);
    const newer = Math.max(a, b);
    const bornIn = binFor(newer);
    bornIn.born++;
    if (link.kind === 'agrees') bornIn.bornAgrees++;
    else bornIn.bornContradicts++;

    const spanDays = (newer - older) / DAY_MS;
    if (spanDays <= halfLife) continue;

    far++;
    if (link.kind === 'agrees') farAgrees++;
    else farContradicts++;

    const olderBin = binFor(older);
    bornIn.far++;
    if (olderBin.key !== bornIn.key) olderBin.far++;

    const key = `${olderBin.key}|${bornIn.key}|${link.kind}`;
    const bundle = grouped.get(key);
    if (bundle) {
      bundle.count++;
      bundle.from = Math.min(bundle.from, older);
      bundle.to = Math.max(bundle.to, newer);
      bundle.spanDays = (bundle.to - bundle.from) / DAY_MS;
    } else {
      grouped.set(key, {
        from: older,
        to: newer,
        kind: link.kind,
        count: 1,
        spanDays,
        fromKey: olderBin.key,
        toKey: bornIn.key,
      });
    }
  }

  bins.sort((x, y) => x.start - y.start);
  binIndexByKey.clear();
  bins.forEach((bin, i) => {
    binIndexByKey.set(bin.key, i);
    for (const node of bin.memories) binOfNode[node] = i;
    bin.memories.sort((p, q) => ts[p]! - ts[q]!);
  });

  const totalMemories = data.nodes.length || 1;
  const totalLinks = data.links.length || 1;
  let maxShare = 0;
  let maxShareKey = bins[0]?.key ?? '';
  for (const bin of bins) {
    const memoryShare = bin.memories.length / totalMemories;
    const linkShare = bin.born / totalLinks;
    const local = Math.max(memoryShare, linkShare);
    if (local > maxShare) {
      maxShare = local;
      maxShareKey = bin.key;
    }
  }

  const domainStart = bins[0]?.start ?? now - DAY_MS;
  const domainEnd = now;

  // The four retention bands are four intervals of this same axis.
  const thresholdDays = halfLife * Math.log2(20);
  const bands: BandRegion[] = [
    {
      band: 'threshold',
      from: domainStart,
      to: now - thresholdDays * DAY_MS,
      count: data.stats.retention.threshold,
    },
    {
      band: 'fading',
      from: now - thresholdDays * DAY_MS,
      to: now - 2 * halfLife * DAY_MS,
      count: data.stats.retention.fading,
    },
    {
      band: 'holding',
      from: now - 2 * halfLife * DAY_MS,
      to: now - halfLife * DAY_MS,
      count: data.stats.retention.holding,
    },
    { band: 'vivid', from: now - halfLife * DAY_MS, to: domainEnd, count: data.stats.retention.vivid },
  ];

  const months: { at: number; label: string }[] = [];
  const walk = new Date(domainStart);
  walk.setDate(1);
  walk.setHours(0, 0, 0, 0);
  if (walk.getTime() < domainStart) walk.setMonth(walk.getMonth() + 1);
  while (walk.getTime() <= domainEnd && months.length < 40) {
    months.push({ at: walk.getTime(), label: fmtMonth.format(walk) });
    walk.setMonth(walk.getMonth() + 1);
  }

  const bundles = [...grouped.values()].sort((x, y) => x.count - y.count);
  const calendarDays = Math.max(1, Math.round((domainEnd - domainStart) / DAY_MS));

  return {
    now,
    ts,
    bins,
    binOfNode,
    binIndexByKey,
    indexById,
    domainStart,
    domainEnd,
    maxShare: maxShare || 1,
    maxShareKey,
    bundles,
    far,
    farAgrees,
    farContradicts,
    maxSpanDays: bundles.reduce((m, b) => Math.max(m, b.spanDays), halfLife * 2),
    bands,
    calendarDays,
    silentDays: Math.max(0, calendarDays - bins.filter((b) => b.memories.length > 0).length),
    months,
    halfLifeDays: halfLife,
    thresholdDays,
  };
}

// ─── Derivation: one moment's neighbourhood ─────────────────────────────────

interface MomentNode {
  index: number;
  x: number;
  y: number;
  focus: boolean;
  /** Signed time distance to the moment; 0 for the moment's own memories. */
  deltaMs: number;
}

interface MomentEdge {
  key: string;
  path: string;
  stroke: string;
  a: number;
  b: number;
}

interface Moment {
  bin: DayBin;
  nodes: MomentNode[];
  edges: MomentEdge[];
  inside: number;
  outside: number;
  neighbours: number;
  /** Links touching the moment that reach past a half-life. */
  far: number;
  clockShift: boolean;
}

interface PlotBox {
  left: number;
  right: number;
  centreY: number;
  halfH: number;
}

function reachOffset(deltaMs: number, halfH: number): number {
  const magnitude = Math.max(Math.abs(deltaMs), REACH_FLOOR_MS);
  const fraction = Math.log(magnitude / REACH_FLOOR_MS) / Math.log(REACH_CEIL_MS / REACH_FLOOR_MS);
  return Math.max(2.5, Math.min(1, fraction) * halfH);
}

/**
 * Lay the moment out. The day's memories go on the centre line at their clock
 * time, nudged right where two writes land closer than a mark; everything they
 * link to goes off the line at the log of its time distance.
 */
function buildMoment(data: ObsData, history: History, bin: DayBin, box: PlotBox): Moment {
  const { ts } = history;
  const span = bin.end - bin.start;
  const usable = Math.max(40, box.right - box.left);
  const rawX = (at: number) => box.left + ((at - bin.start) / span) * usable;

  const focusX = new Map<number, number>();
  let gap = 7;
  let placed: number[] = [];
  for (;;) {
    placed = [];
    let last = Number.NEGATIVE_INFINITY;
    for (const node of bin.memories) {
      const x = Math.max(rawX(ts[node]!), last + gap);
      placed.push(x);
      last = x;
    }
    const overflow = (placed[placed.length - 1] ?? box.left) > box.right;
    if (!overflow || gap <= 2.5) break;
    gap = gap <= 3.5 ? 2.5 : gap - 1.75;
  }
  const first = placed[0] ?? box.left;
  const last = placed[placed.length - 1] ?? box.right;
  const overshoot = last - box.right;
  const squeeze = overshoot > 0 && last > first ? (box.right - box.left) / (last - first) : 1;
  bin.memories.forEach((node, i) => {
    const x = placed[i]!;
    focusX.set(node, squeeze < 1 ? box.left + (x - first) * squeeze : x);
  });

  const focusSet = new Set(bin.memories);
  const nodes: MomentNode[] = [];
  const edges: MomentEdge[] = [];
  const neighbourX = new Map<number, { sum: number; n: number; nearest: number }>();

  let inside = 0;
  let outside = 0;
  let far = 0;

  for (const link of data.links) {
    const sourceIn = focusSet.has(link.source);
    const targetIn = focusSet.has(link.target);
    if (!sourceIn && !targetIn) continue;
    const spanMs = Math.abs(ts[link.source]! - ts[link.target]!);
    if (spanMs > history.halfLifeDays * DAY_MS) far++;
    if (sourceIn && targetIn) {
      inside++;
      continue;
    }
    outside++;
    const anchor = sourceIn ? link.source : link.target;
    const other = sourceIn ? link.target : link.source;
    const signed = ts[other]! - ts[anchor]!;
    const seat = neighbourX.get(other);
    if (seat) {
      seat.sum += focusX.get(anchor)!;
      seat.n++;
      if (Math.abs(signed) < Math.abs(seat.nearest)) seat.nearest = signed;
    } else {
      neighbourX.set(other, { sum: focusX.get(anchor)!, n: 1, nearest: signed });
    }
  }

  for (const node of bin.memories) {
    nodes.push({ index: node, x: focusX.get(node)!, y: box.centreY, focus: true, deltaMs: 0 });
  }
  const neighbourPos = new Map<number, { x: number; y: number }>();
  for (const [node, seat] of neighbourX) {
    const x = seat.sum / seat.n;
    const offset = reachOffset(seat.nearest, box.halfH);
    const y = seat.nearest >= 0 ? box.centreY - offset : box.centreY + offset;
    neighbourPos.set(node, { x, y });
    nodes.push({ index: node, x, y, focus: false, deltaMs: seat.nearest });
  }

  // Second pass for geometry, now that every endpoint has a seat.
  for (const link of data.links) {
    const sourceIn = focusSet.has(link.source);
    const targetIn = focusSet.has(link.target);
    if (!sourceIn && !targetIn) continue;
    const stroke = linkColor(link);
    if (sourceIn && targetIn) {
      // Both written in this moment: a bow dipping to the gap between them.
      const x1 = focusX.get(link.source)!;
      const x2 = focusX.get(link.target)!;
      const depth = reachOffset(ts[link.source]! - ts[link.target]!, box.halfH);
      edges.push({
        key: link.id,
        path: `M${x1.toFixed(1)},${box.centreY.toFixed(1)}Q${((x1 + x2) / 2).toFixed(1)},${(
          box.centreY +
          2 * depth
        ).toFixed(1)} ${x2.toFixed(1)},${box.centreY.toFixed(1)}`,
        stroke,
        a: link.source,
        b: link.target,
      });
      continue;
    }
    const anchor = sourceIn ? link.source : link.target;
    const other = sourceIn ? link.target : link.source;
    const seat = neighbourPos.get(other)!;
    const ax = focusX.get(anchor)!;
    edges.push({
      key: link.id,
      path: `M${ax.toFixed(1)},${box.centreY.toFixed(1)}L${seat.x.toFixed(1)},${seat.y.toFixed(1)}`,
      stroke,
      a: anchor,
      b: other,
    });
  }

  return {
    bin,
    nodes,
    edges,
    inside,
    outside,
    neighbours: neighbourX.size,
    far,
    clockShift: gap < 7 || squeeze < 1,
  };
}

// ─── Layout metrics ─────────────────────────────────────────────────────────

interface Metrics {
  gutter: number;
  right: number;
  bandTop: number;
  reachTop: number;
  reachBottom: number;
  barsTop: number;
  barsBase: number;
  axisBottom: number;
  wedgeBottom: number;
  captionH: number;
  plotTop: number;
  centreY: number;
  halfH: number;
}

function metricsFor(width: number, height: number): Metrics {
  // Wide enough for the longest gutter label ("7 days · half-life") at 11px in
  // Archivo's 78% cut, so no axis name ever runs off the left edge.
  const gutter = Math.max(96, Math.min(128, Math.round(width * 0.09)));
  const right = width - 18;
  const captionH = 46;
  const bandLabelH = 20;
  const axisH = 24;
  const wedgeH = 24;
  const trackGap = 18;

  // The moment always keeps a floor of room, so the overview yields rather
  // than pushing marks off the bottom of the box on a short window.
  const available = height - captionH;
  const wanted = Math.max(196, Math.min(392, Math.round(available * 0.44)));
  const historyH = Math.min(wanted, Math.max(120, available - wedgeH - 150));
  const tracksH = Math.max(56, historyH - bandLabelH - axisH - trackGap);
  const reachH = Math.round(tracksH * 0.46);
  const barsH = tracksH - reachH;

  const bandTop = 6;
  const reachTop = bandTop + bandLabelH;
  const reachBottom = reachTop + reachH;
  const barsTop = reachBottom + trackGap;
  const barsBase = barsTop + barsH;
  const axisBottom = barsBase + axisH;
  const wedgeBottom = axisBottom + wedgeH;
  const plotTop = wedgeBottom + captionH;
  const plotH = Math.max(120, height - plotTop);

  return {
    gutter,
    right,
    bandTop,
    reachTop,
    reachBottom,
    barsTop,
    barsBase,
    axisBottom,
    wedgeBottom,
    captionH,
    plotTop,
    centreY: plotTop + plotH / 2,
    halfH: Math.max(46, plotH / 2 - 20),
  };
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function GutterLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text className="obs-label" x={x} y={y} textAnchor="end" fill="currentColor">
      {text}
    </text>
  );
}

/** A gutter label that carries the fills it names, so the bars need no legend. */
function GutterKey({
  x,
  y,
  text,
  fills,
}: {
  x: number;
  y: number;
  text: string;
  fills: readonly string[];
}) {
  const width = fills.length * 3 + (fills.length - 1) * 1.5;
  return (
    <g>
      <text className="obs-label" x={x - width - 5} y={y} textAnchor="end" fill="currentColor">
        {text}
      </text>
      {fills.map((fill, i) => (
        <rect key={fill} x={x - width + i * 4.5} y={y - 8} width={3} height={9} fill={fill} />
      ))}
    </g>
  );
}

function CaptionCell({
  label,
  value,
  note,
  grow,
}: {
  label: string;
  value: string;
  note?: string;
  grow?: boolean;
}) {
  return (
    <div
      style={{
        padding: '0 16px',
        borderLeft: '1px solid var(--rule)',
        minWidth: 0,
        flex: grow ? '1 1 0' : '0 0 auto',
      }}
    >
      <div className="obs-label">{label}</div>
      <div
        className="obs-figure"
        style={{
          fontSize: 'var(--t-figure)',
          lineHeight: 1.22,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
      {note ? (
        <div
          className="obs-label"
          style={{ marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}

// ─── Plate ──────────────────────────────────────────────────────────────────


/**
 * The overview: three tracks on one calendar axis, and the wedge that opens
 * the focused column into the plate below. Everything here is a pure function
 * of the derived history and the box; it holds no state of its own.
 */
function HistoryTracks({
  history,
  m,
  scale,
  focusBin,
  totalMemories,
  totalLinks,
}: {
  history: History;
  m: Metrics;
  scale: (at: number) => number;
  focusBin: DayBin;
  totalMemories: number;
  totalLinks: number;
}) {
  const focusX0 = scale(focusBin.start);
  const focusX1 = scale(focusBin.end);
  const columnW = Math.max(2, focusX1 - focusX0);
  const barsH = m.barsBase - m.barsTop;
  const reachH = m.reachBottom - m.reachTop;
  const reachSpan = Math.log(history.maxSpanDays / history.halfLifeDays) || 1;
  const yReach = (spanDays: number) =>
    m.reachBottom -
    (Math.log(Math.max(spanDays, history.halfLifeDays) / history.halfLifeDays) / reachSpan) * reachH;

  return (
    <g>
      {/* ── the focused column, lit for the whole overview ──────────────── */}
      <rect
        x={focusX0}
        y={m.bandTop}
        width={columnW}
        height={m.axisBottom - m.bandTop}
        fill="var(--margin)"
      />

      {/* ── retention bands as intervals of the axis ────────────────────── */}
      {history.bands.map((band) => {
        const x0 = Math.max(m.gutter, scale(band.from));
        const x1 = Math.min(m.right, scale(band.to));
        if (x1 - x0 < 1) return null;
        const room = x1 - x0;
        return (
          <g key={band.band}>
            <line
              x1={x0}
              y1={m.bandTop + 12}
              x2={x0}
              y2={m.axisBottom}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            {room > 62 ? (
              <text className="obs-label" x={x0 + 6} y={m.bandTop + 9} fill="currentColor">
                {room > 168
                  ? `${RETENTION_LABEL[band.band]} · ${nf.format(band.count)} of ${nf.format(totalMemories)}`
                  : `${RETENTION_LABEL[band.band]} · ${nf.format(band.count)}`}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* ── track 1: the links that reach across the store's history ────── */}
      <line
        x1={m.gutter}
        y1={m.reachBottom}
        x2={m.right}
        y2={m.reachBottom}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      <GutterLabel
        x={m.gutter - 8}
        y={m.reachBottom + 12}
        text={`${history.halfLifeDays} days · half-life`}
      />
      {/* The subset this track draws, stated against the mark that qualifies it. */}
      <text className="obs-label" x={m.gutter + 6} y={m.reachBottom + 12} fill="currentColor">
        {m.right - m.gutter > 640
          ? `${nf.format(history.far)} of ${nf.format(totalLinks)} links reach further back than this line, in ${nf.format(history.bundles.length)} day-pairs · the other ${nf.format(totalLinks - history.far)} are not drawn here`
          : `${nf.format(history.far)} of ${nf.format(totalLinks)} links reach past this line`}
      </text>
      {[history.halfLifeDays * 2, 30, 90, 150].map((days) => {
        const y = yReach(days);
        if (days >= history.maxSpanDays || y > m.reachBottom - 12 || y < m.reachTop + 10)
          return null;
        return (
          <g key={days}>
            <line
              x1={m.gutter}
              y1={y}
              x2={m.right}
              y2={y}
              stroke="var(--rule)"
              strokeWidth={1}
              strokeDasharray="1 5"
            />
            <GutterLabel x={m.gutter - 8} y={y + 3} text={`${days} days`} />
          </g>
        );
      })}
      {history.bundles.map((bundle) => {
        const x0 = scale(bundle.from);
        const x1 = scale(bundle.to);
        const y = yReach(bundle.spanDays);
        const lit = bundle.fromKey === focusBin.key || bundle.toKey === focusBin.key;
        const stroke = bundle.kind === 'agrees' ? 'var(--agrees)' : 'var(--contradicts)';
        return (
          <g key={`${bundle.fromKey}|${bundle.toKey}|${bundle.kind}`}>
            <line
              x1={x0}
              y1={y}
              x2={x1}
              y2={y}
              stroke={stroke}
              strokeWidth={Math.min(3.6, 1 + (bundle.count - 1) * 0.42)}
              strokeLinecap="round"
            />
            {lit ? (
              <>
                <line x1={x0} y1={y} x2={x0} y2={m.reachBottom} stroke="var(--memory-live)" strokeWidth={1} />
                <line x1={x1} y1={y} x2={x1} y2={m.reachBottom} stroke="var(--memory-live)" strokeWidth={1} />
              </>
            ) : null}
          </g>
        );
      })}

      {/* ── track 2: what each day is a share of ────────────────────────── */}
      <line
        x1={m.gutter}
        y1={m.barsTop}
        x2={m.right}
        y2={m.barsTop}
        stroke="var(--rule)"
        strokeWidth={1}
        strokeDasharray="1 5"
      />
      <GutterLabel x={m.gutter - 8} y={m.barsTop + 4} text={`${pct(history.maxShare)} of the store`} />
      {barsH >= 52 ? (
        <>
          <GutterKey x={m.gutter - 8} y={m.barsTop + 21} text="memories" fills={['var(--memory)']} />
          <GutterKey
            x={m.gutter - 8}
            y={m.barsTop + 37}
            text="links born"
            fills={['var(--agrees)', 'var(--contradicts)']}
          />
        </>
      ) : null}
      {history.bins.map((bin) => {
        const cx = (scale(bin.start) + scale(bin.end)) / 2;
        const cw = Math.max(scale(bin.end) - scale(bin.start), 2.4);
        const bw = Math.max(1.1, Math.min(7, cw * 0.42));
        const memoryH = (bin.memories.length / totalMemories / history.maxShare) * barsH;
        const agreesH = (bin.bornAgrees / totalLinks / history.maxShare) * barsH;
        const contraH = (bin.bornContradicts / totalLinks / history.maxShare) * barsH;
        const gap = agreesH > 3 && contraH > 3 ? 2 : 0;
        return (
          <g key={bin.key}>
            {memoryH > 0.4 ? (
              <rect
                x={cx - bw - 0.75}
                y={m.barsBase - memoryH}
                width={bw}
                height={memoryH}
                fill="var(--memory)"
              />
            ) : null}
            {agreesH > 0.4 ? (
              <rect
                x={cx + 0.75}
                y={m.barsBase - agreesH}
                width={bw}
                height={agreesH}
                fill="var(--agrees)"
              />
            ) : null}
            {contraH > 0.4 ? (
              <rect
                x={cx + 0.75}
                y={m.barsBase - agreesH - gap - contraH}
                width={bw}
                height={contraH}
                fill="var(--contradicts)"
              />
            ) : null}
          </g>
        );
      })}

      {/* ── the calendar ────────────────────────────────────────────────── */}
      <line
        x1={m.gutter}
        y1={m.barsBase}
        x2={m.right}
        y2={m.barsBase}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      {history.months.map((month) => {
        const x = scale(month.at);
        // The two ends of the axis are already named; a month that lands on
        // top of "22 Mar" or "now" keeps its tick and loses its word.
        const room = x > m.gutter + 40 && x < m.right - 46;
        return (
          <g key={month.at}>
            <line
              x1={x}
              y1={m.barsBase}
              x2={x}
              y2={m.barsBase + 5}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            {room ? (
              <text className="obs-label" x={x + 4} y={m.barsBase + 15} fill="currentColor">
                {month.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <text className="obs-label" x={m.gutter} y={m.barsBase + 15} fill="currentColor">
        {fmtDayMonth.format(history.domainStart)}
      </text>
      <text
        className="obs-label"
        x={m.right}
        y={m.barsBase + 15}
        textAnchor="end"
        fill="currentColor"
      >
        now
      </text>

      {/* ── the wedge: this column, opened into the plate below ─────────── */}
      <path
        d={`M${focusX0},${m.axisBottom}L${focusX1},${m.axisBottom}L${m.right},${m.wedgeBottom}L${m.gutter},${m.wedgeBottom}Z`}
        fill="var(--margin)"
      />
      <path
        d={`M${focusX0},${m.axisBottom}L${m.gutter},${m.wedgeBottom}`}
        stroke="var(--rule)"
        strokeWidth={1}
        fill="none"
      />
      <path
        d={`M${focusX1},${m.axisBottom}L${m.right},${m.wedgeBottom}`}
        stroke="var(--rule)"
        strokeWidth={1}
        fill="none"
      />
    </g>
  );
}

/**
 * The detail: one moment on a centre line, and every link touching it leaving
 * that line by the log of how far it travels in time.
 */
function MomentPlot({
  m,
  height,
  rungs,
  moment,
  edges,
  live,
  filterTo,
  touched,
  transition,
}: {
  m: Metrics;
  height: number;
  rungs: { label: string; offset: number; solid: boolean }[];
  moment: Moment;
  edges: MomentEdge[];
  live: number | null;
  filterTo: number | null;
  touched: Set<number> | null;
  transition: string | undefined;
}) {
  const ring = live === null ? null : (moment.nodes.find((n) => n.index === live) ?? null);
  return (
    <g>
      {/* ── the moment ──────────────────────────────────────────────────── */}
      <line
        x1={0}
        y1={m.plotTop}
        x2={m.right + 18}
        y2={m.plotTop}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      {rungs.map((rung) => (
        <g key={rung.label}>
          <line
            x1={m.gutter}
            y1={m.centreY - rung.offset}
            x2={m.right}
            y2={m.centreY - rung.offset}
            stroke="var(--rule)"
            strokeWidth={1}
            strokeDasharray={rung.solid ? undefined : '1 5'}
          />
          <line
            x1={m.gutter}
            y1={m.centreY + rung.offset}
            x2={m.right}
            y2={m.centreY + rung.offset}
            stroke="var(--rule)"
            strokeWidth={1}
            strokeDasharray={rung.solid ? undefined : '1 5'}
          />
          <GutterLabel x={m.gutter - 8} y={m.centreY - rung.offset + 3} text={rung.label} />
          <GutterLabel x={m.gutter - 8} y={m.centreY + rung.offset + 3} text={rung.label} />
        </g>
      ))}
      <GutterLabel x={m.gutter - 8} y={m.plotTop + 16} text="written later" />
      <GutterLabel x={m.gutter - 8} y={height - 8} text="written earlier" />

      <g fill="none" strokeLinecap="round">
        {edges.map((edge) => {
          const lit = touched !== null && (edge.a === live || edge.b === live);
          return (
            <path
              key={edge.key}
              d={edge.path}
              stroke={edge.stroke}
              strokeWidth={lit ? 2.4 : 1}
            />
          );
        })}
      </g>

      <line
        x1={m.gutter}
        y1={m.centreY}
        x2={m.right}
        y2={m.centreY}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      <GutterLabel x={m.gutter - 8} y={m.centreY + 3} text="time of day" />
      {[6, 12, 18].map((hour) => {
        const x =
          m.gutter + (hour / 24) * (m.right - m.gutter);
        return (
          <line
            key={hour}
            x1={x}
            y1={m.centreY - 4}
            x2={x}
            y2={m.centreY + 4}
            stroke="var(--rule)"
            strokeWidth={1}
          />
        );
      })}
      {/* Nothing is dimmed. Highlight is additive — a lit mark, never a faded
          one — because token links and the memory grey both fall under the
          3:1 mark floor once they are blended toward the plate. */}
      {moment.nodes.map((node) => {
        const isPicked = node.index === live || node.index === filterTo;
        const lit = isPicked || (touched !== null && touched.has(node.index));
        return (
          <circle
            key={node.index}
            cx={node.x}
            cy={node.y}
            r={isPicked ? 4.2 : lit ? 3.2 : node.focus ? 2.6 : 2}
            fill={lit ? 'var(--memory-live)' : 'var(--memory)'}
          />
        );
      })}
      {/* The one moving thing on the plate. It is always mounted and only ever
          translated and faded, so the motion is compositor-only (rule 7); under
          `reducedMotion` the transition is dropped and it simply appears where
          it belongs (rule 6). */}
      <circle
        cx={0}
        cy={0}
        r={9}
        fill="none"
        stroke="var(--memory-live)"
        strokeWidth={1}
        opacity={ring ? 1 : 0}
        style={{
          transform: `translate(${(ring?.x ?? 0).toFixed(1)}px, ${(ring?.y ?? 0).toFixed(1)}px)`,
          transition,
        }}
      />
    </g>
  );
}

function Plate({ data, width, height, reducedMotion, selectedId, onSelect }: DemoProps) {
  const history = useMemo(() => buildHistory(data), [data]);
  const m = useMemo(() => metricsFor(width, height), [width, height]);

  const occupied = useMemo(
    () => history.bins.map((b, i) => (b.memories.length > 0 ? i : -1)).filter((i) => i >= 0),
    [history]
  );
  const busiest = useMemo(() => {
    let best = occupied[0] ?? 0;
    for (const i of occupied) if (history.bins[i]!.born > history.bins[best]!.born) best = i;
    return best;
  }, [history, occupied]);

  const [focusIndex, setFocusIndex] = useState(busiest);
  const [hovered, setHovered] = useState<number | null>(null);
  const plotTopRef = useRef(m.plotTop);
  plotTopRef.current = m.plotTop;

  const scale = useCallback(
    (at: number) =>
      m.gutter +
      ((at - history.domainStart) / Math.max(1, history.domainEnd - history.domainStart)) *
        (m.right - m.gutter),
    [history, m]
  );
  const unscale = useCallback(
    (px: number) =>
      history.domainStart +
      ((px - m.gutter) / Math.max(1, m.right - m.gutter)) * (history.domainEnd - history.domainStart),
    [history, m]
  );

  const focusBin = history.bins[focusIndex] ?? history.bins[busiest]!;

  // A memory picked anywhere — here or in another demo — pulls the focus onto
  // its own day, so a selection always arrives framed.
  useEffect(() => {
    if (!selectedId) return;
    const node = history.indexById.get(selectedId);
    if (node === undefined) return;
    const bin = history.binOfNode[node];
    if (bin !== undefined && bin >= 0) setFocusIndex(bin);
  }, [selectedId, history]);

  const moment = useMemo(
    () =>
      buildMoment(data, history, focusBin, {
        left: m.gutter,
        right: m.right,
        centreY: m.centreY,
        halfH: m.halfH,
      }),
    [data, history, focusBin, m]
  );

  const live = hovered ?? (selectedId ? (history.indexById.get(selectedId) ?? null) : null);
  const filterTo = selectedId ? (history.indexById.get(selectedId) ?? null) : null;

  const visibleEdges = useMemo(() => {
    if (filterTo === null) return moment.edges;
    return moment.edges.filter((e) => e.a === filterTo || e.b === filterTo);
  }, [moment, filterTo]);

  const touched = useMemo(() => {
    if (live === null) return null;
    const set = new Set<number>([live]);
    for (const edge of visibleEdges) {
      if (edge.a === live) set.add(edge.b);
      else if (edge.b === live) set.add(edge.a);
    }
    return set;
  }, [live, visibleEdges]);

  // ── pointing ──────────────────────────────────────────────────────────────

  const pointHistory = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      const at = unscale(event.clientX - box.left);
      let best = focusIndex;
      let bestGap = Number.POSITIVE_INFINITY;
      for (const i of occupied) {
        const bin = history.bins[i]!;
        const gap = Math.abs((bin.start + bin.end) / 2 - at);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      if (best !== focusIndex) setFocusIndex(best);
    },
    [focusIndex, history, occupied, unscale]
  );

  /**
   * The moment's pointer surface starts at `plotTop`, so its client box is
   * offset from the SVG origin the nodes are laid out in. Adding it back is
   * the difference between picking the memory under the pointer and picking
   * one a few hundred pixels away.
   */
  const hitMoment = useCallback(
    (event: React.PointerEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>): number | null => {
      const box = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top + plotTopRef.current;
      let best: number | null = null;
      let bestGap = 196;
      for (const node of moment.nodes) {
        const gap = (node.x - px) ** 2 + (node.y - py) ** 2;
        if (gap < bestGap) {
          bestGap = gap;
          best = node.index;
        }
      }
      return best;
    },
    [moment]
  );

  const step = useCallback(
    (delta: number) => {
      const at = occupied.indexOf(focusIndex);
      const next = occupied[Math.max(0, Math.min(occupied.length - 1, (at < 0 ? 0 : at) + delta))];
      if (next !== undefined) setFocusIndex(next);
    },
    [focusIndex, occupied]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'Home') setFocusIndex(occupied[0] ?? 0);
      else if (event.key === 'End') setFocusIndex(occupied[occupied.length - 1] ?? 0);
      else if (event.key === 'Escape') onSelect(null);
      else return;
      event.preventDefault();
    },
    [occupied, onSelect, step]
  );

  if (height < 300 || width < 420) {
    return (
      <p className="obs-message">
        This plate needs a window at least 420 by 300 to lay 167 days of history beside one day of
        it.
      </p>
    );
  }

  const totalMemories = data.nodes.length;
  const totalLinks = data.links.length;

  // The detail's rungs, placed outward from the half-life and dropped whenever
  // two would sit closer than their own labels. A short window therefore loses
  // the crowded middle of the scale, never the line the claim rests on.
  const rungs: { label: string; offset: number; solid: boolean }[] = [];
  {
    const ceiling = m.halfH - 10;
    const candidates = [
      {
        at: history.halfLifeDays * DAY_MS,
        label: `${history.halfLifeDays} days · half-life`,
        solid: true,
      },
      ...REACH_RUNGS.map((r) => ({ at: r.at, label: r.label, solid: false })),
    ];
    for (const candidate of candidates) {
      const offset = reachOffset(candidate.at, m.halfH);
      if (offset > ceiling) continue;
      if (rungs.some((placed) => Math.abs(placed.offset - offset) < 15)) continue;
      rungs.push({ label: candidate.label, offset, solid: candidate.solid });
    }
  }

  const transition = reducedMotion
    ? undefined
    : 'opacity var(--dur) var(--ease), transform var(--dur) var(--ease)';
  const selectedNode = filterTo !== null ? data.nodes[filterTo] : null;
  const liveNode = live !== null ? data.nodes[live] : null;
  const firstWrite = focusBin.memories[0];
  const lastWrite = focusBin.memories[focusBin.memories.length - 1];
  const written =
    firstWrite === undefined || lastWrite === undefined
      ? ''
      : `${fmtClock.format(history.ts[firstWrite]!)}–${fmtClock.format(history.ts[lastWrite]!)}`;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`The store's ${history.calendarDays}-day history and the link neighbourhood of ${fmtFull.format(focusBin.start)}. Left and right arrow keys step between days that have writing in them.`}
      onKeyDown={onKeyDown}
      style={{ position: 'absolute', inset: 0 }}
    >
      <svg width={width} height={height} style={{ display: 'block' }} aria-hidden>
        <HistoryTracks
          history={history}
          m={m}
          scale={scale}
          focusBin={focusBin}
          totalMemories={totalMemories}
          totalLinks={totalLinks}
        />

        <MomentPlot
          m={m}
          height={height}
          rungs={rungs}
          moment={moment}
          edges={visibleEdges}
          live={live}
          filterTo={filterTo}
          touched={touched}
          transition={transition}
        />

        {/* ── pointer surfaces ────────────────────────────────────────────── */}
        <rect
          x={0}
          y={0}
          width={width}
          height={m.axisBottom}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onPointerMove={pointHistory}
          onPointerDown={pointHistory}
        />
        <rect
          x={0}
          y={m.plotTop}
          width={width}
          height={Math.max(0, height - m.plotTop)}
          fill="transparent"
          style={{ cursor: live === null ? 'default' : 'pointer' }}
          onPointerMove={(event) => setHovered(hitMoment(event))}
          onPointerDown={(event) => setHovered(hitMoment(event))}
          onPointerLeave={() => setHovered(null)}
          onClick={(event) => {
            const hit = hitMoment(event);
            onSelect(hit === null ? null : data.nodes[hit]!.id);
          }}
        />
      </svg>

      {/* ── the caption between the two halves ───────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: m.wedgeBottom,
          height: m.captionH,
          display: 'flex',
          alignItems: 'center',
          background: 'var(--margin)',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
          overflow: 'hidden',
        }}
      >
        <CaptionCell
          label="Moment"
          value={fmtFull.format(focusBin.start)}
          note={`${nf.format(focusBin.memories.length)} of ${nf.format(totalMemories)} memories${
            written ? `, written ${written}` : ''
          }${moment.clockShift ? ' · marks nudged apart' : ''}`}
        />
        <CaptionCell
          label="Links born here"
          value={`${nf.format(focusBin.born)} · ${pct(focusBin.born / totalLinks)}`}
          note={`${nf.format(focusBin.bornAgrees)} agree · ${nf.format(focusBin.bornContradicts)} contradict`}
        />
        <CaptionCell
          label="Drawn below"
          value={`${nf.format(moment.inside)} inside · ${nf.format(moment.outside)} out`}
          note={`to ${nf.format(moment.neighbours)} memories · ${nf.format(moment.far)} reach past a half-life`}
        />
        <CaptionCell
          label={selectedNode ? 'Selected' : liveNode ? 'Under the pointer' : 'Reach, whole store'}
          value={
            liveNode
              ? liveNode.label
              : `${nf.format(history.far)} of ${nf.format(totalLinks)} links reach past ${history.halfLifeDays} days`
          }
          note={
            liveNode
              ? `${liveNode.type} · ${RETENTION_LABEL[liveNode.retentionBand]} · ${fmtClock.format(
                  Date.parse(liveNode.createdAt)
                )} on ${fmtDayMonth.format(Date.parse(liveNode.createdAt))} · degree ${nf.format(
                  liveNode.degree
                )} (${nf.format(liveNode.agreeDegree)} agree, ${nf.format(liveNode.contradictDegree)} contradict)`
              : `${nf.format(history.farAgrees)} agree · ${nf.format(history.farContradicts)} contradict · ${nf.format(
                  history.silentDays
                )} of ${nf.format(history.calendarDays)} days silent`
          }
          grow
        />
      </div>

      {/* ── how to read the lower half, and what is not on screen ────────── */}
      <div
        style={{
          position: 'absolute',
          left: m.gutter + 6,
          bottom: 6,
          maxWidth: '78ch',
          pointerEvents: 'none',
        }}
      >
        {filterTo !== null ? (
          <p className="obs-label" style={{ margin: 0 }}>
            Showing {nf.format(visibleEdges.length)} of {nf.format(moment.inside + moment.outside)}{' '}
            links touching this moment — the selected memory&rsquo;s own. Escape, or a click on
            empty plate, restores the rest.
          </p>
        ) : (
          <p className="obs-label" style={{ margin: 0 }}>
            Every link leaves this moment&rsquo;s line, and how far it travels down or up is how far
            it travels back or forward in time. {nf.format(data.stats.linksToArchived)} further
            links point at memories since archived and can be drawn by nobody.
          </p>
        )}
      </div>
    </div>
  );
}

export const timeAndNeighbourhood: DemoModule = {
  id: 'time-neighbourhood',
  name: 'Time, then neighbourhood',
  dimension: 'Hybrid',
  claim:
    'This store barely links across its own history — almost every connection joins two memories written within one half-life of each other — so what looks like a web is really a stack of separate sittings.',
  Plate,
};
