import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import type { MapNode } from '../../lib/api.js';
import type { MapModel } from './lib/model.js';
import { regionMembers } from './lib/model.js';
import { LAYOUT_SIZE, between, boundsOf, centreOn, contains, easeCubicInOut, easeExpoOut, fitView, toScreen, type Rect, type View } from './lib/project.js';
import { pick } from './lib/hitTest.js';
import { rampColour } from './lib/terrain.js';
import { pickRouteBadge, ROUTE_BADGE_RADIUS, routeBadges, segmentProgress, type RouteStop } from '../recall/routeLayout.js';
import { lensAlpha, pickable, retentionAlpha, type LensState } from './lenses.js';

/**
 * The map's canvas: terrain, fault lines, marks, pins and rings, under a
 * d3-zoom camera. Drawing only. What is drawn and where comes from
 * lib/* and lenses.ts; MapView owns the keyboard, the labels and the words.
 * Redraws happen on a frame request (zoom, hover, a prop change) and keep
 * going only while something animates: a camera glide, dropping pins, an
 * arrival pulse.
 */

export interface MapCanvasHandle {
  zoomBy: (factor: number) => void;
  /** Back to the whole map. */
  fit: () => void;
  /** Glides so the memory is on screen, zooming in to at least `minZoom` times the fit. */
  reveal: (index: number, minZoom?: number) => void;
  showRegion: (regionId: string) => void;
}

interface Props {
  model: MapModel;
  area: Rect;
  lens: LensState;
  threshold: number;
  selectedId: string | null;
  focusId: string | null;
  hoverId: string | null;
  faults: readonly [number, number][] | null;
  /** Search results on the map, in rank order; `weak` ones get a hollow head. */
  pins: readonly string[];
  weak: ReadonlySet<string>;
  /** Recall stops use the same positions and camera as every map mark. */
  route?: readonly RouteStop[];
  arrivals: ReadonlyMap<string, number>;
  reduced: boolean;
  onHover: (id: string | null, at: [number, number] | null) => void;
  onPick: (id: string | null) => void;
  /** After every frame, with the view it was drawn at and the fit zoom. */
  onFrame: (view: View, fitK: number) => void;
  ref?: Ref<MapCanvasHandle>;
}

interface Colours {
  paper: string;
  ink: string;
  rule: string;
  contour: string;
  hill: string;
  fault: string;
  focus: string;
  ramp: string[];
  type: Record<MapNode['type'], string>;
}

function readColours(): Colours {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    paper: v('--paper') || '#EAF0EC',
    ink: v('--ink') || '#0F2A26',
    rule: v('--rule') || '#B7C9C0',
    contour: v('--contour') || '#8FAB9E',
    hill: v('--hill') || 'rgba(15,42,38,.1)',
    fault: v('--fault') || '#DF500C',
    focus: v('--focus') || '#1F5ED9',
    ramp: [1, 2, 3, 4, 5, 6].map((n) => v(`--terrain-${n}`)),
    type: { semantic: v('--sem') || '#1F5ED9', episodic: v('--epi') || '#AD36A7', procedural: v('--pro') || '#00977C' },
  };
}

const PIN_DROP_MS = 280;
const PIN_STAGGER_MS = 30;
const PIN_STAGGER_CAP_MS = 400;
const PIN_MAX = 60;
const GLIDE_MS = 600;
const PULSE_MS = 1400;
const PULSES = 2;
const PICK_PX = 14;
/** Opacity is drawn in this many steps, so marks batch into a few paths. */
const ALPHA_STEPS = 12;

/** A circle's control-point distance for four cubic Béziers. */
const KAPPA = 0.5523;

/** A mark's outline. `reverse` winds it the other way, so a smaller reversed
 *  copy inside a larger one cuts it to a ring under the nonzero fill rule. */
function markPath(path: Path2D, type: MapNode['type'], x: number, y: number, r: number, reverse = false): void {
  const d = reverse ? -1 : 1;
  if (type === 'semantic') {
    // Four Béziers: the same circle to the eye, several times cheaper than arc().
    const c = r * KAPPA;
    path.moveTo(x + r, y);
    path.bezierCurveTo(x + r, y + c * d, x + c, y + r * d, x, y + r * d);
    path.bezierCurveTo(x - c, y + r * d, x - r, y + c * d, x - r, y);
    path.bezierCurveTo(x - r, y - c * d, x - c, y - r * d, x, y - r * d);
    path.bezierCurveTo(x + c, y - r * d, x + r, y - c * d, x + r, y);
  } else if (type === 'episodic') {
    const h = r * 1.25;
    path.moveTo(x, y - h);
    path.lineTo(x + h * 1.05 * d, y + h * 0.78);
    path.lineTo(x - h * 1.05 * d, y + h * 0.78);
    path.closePath();
  } else {
    const q = r * 0.9;
    path.moveTo(x - q, y - q);
    path.lineTo(x + q * d, y - q * d);
    path.lineTo(x + q, y + q);
    path.lineTo(x - q * d, y + q * d);
    path.closePath();
  }
}

export default function MapCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const state = useRef({
    view: { k: 1, x: 0, y: 0 } as View,
    fitK: 1,
    moved: false,
    width: 0,
    height: 0,
    dpr: 1,
    raf: 0,
    glide: null as null | { from: View; to: View; t0: number },
    pinsAt: 0,
    routeAt: 0,
    badges: [] as RouteStop[],
    colours: null as Colours | null,
    terrain: null as null | { model: MapModel; paths: Path2D[] },
    zoom: null as ZoomBehavior<HTMLCanvasElement, unknown> | null,
  });

  const draw = () => {
    const s = state.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || s.width === 0 || document.hidden) {
      s.raf = 0;
      return;
    }
    // -1 while drawing: the zoom event a glide step fires must not queue a second frame.
    s.raf = -1;
    const p = live.current;
    const now = performance.now();
    let busy = false;

    if (s.glide) {
      const t = p.reduced ? 1 : Math.min(1, (now - s.glide.t0) / GLIDE_MS);
      const v = between(s.glide.from, s.glide.to, easeCubicInOut(t), p.area);
      if (t >= 1) s.glide = null;
      else busy = true;
      // Through d3-zoom, so a drag that follows starts from here.
      select(canvas).call(s.zoom!.transform, zoomIdentity.translate(v.x, v.y).scale(v.k));
    }

    const C = (s.colours ??= readColours());
    const { model } = p;
    const { k, x, y } = s.view;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, s.width, s.height);

    // A survey sheet's graticule, every tenth of the layout: it moves with the
    // ground, so a pan or a zoom always has something to hold on to.
    const cell = (LAYOUT_SIZE / 10) * k;
    ctx.strokeStyle = C.rule;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = x - Math.ceil(x / cell) * cell; gx <= s.width; gx += cell) {
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, s.height);
    }
    for (let gy = y - Math.ceil(y / cell) * cell; gy <= s.height; gy += cell) {
      ctx.moveTo(0, Math.round(gy) + 0.5);
      ctx.lineTo(s.width, Math.round(gy) + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Terrain, in layout units under the camera: a hill shadow, the band, its contour line.
    if (s.terrain?.model !== model) s.terrain = { model, paths: model.terrain.map((l) => new Path2D(l.path)) };
    ctx.setTransform(s.dpr * k, 0, 0, s.dpr * k, s.dpr * x, s.dpr * y);
    model.terrain.forEach((level, i) => {
      const path = s.terrain!.paths[i]!;
      // Every other band casts the shadow: the same terraced relief for half the fills.
      if (i % 2 === 0) {
        ctx.translate(0, 2.4 / k);
        ctx.fillStyle = C.hill;
        ctx.fill(path);
        ctx.translate(0, -2.4 / k);
      }
      ctx.fillStyle = rampColour(C.ramp, 0.25 + 0.75 * Math.pow(level.height, 0.8));
      ctx.fill(path);
    });
    ctx.strokeStyle = C.contour;
    model.terrain.forEach((level, i) => {
      ctx.globalAlpha = level.index ? 0.95 : 0.65;
      ctx.lineWidth = (level.index ? 1.25 : 0.55) / k;
      ctx.stroke(s.terrain!.paths[i]!);
    });
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.globalAlpha = 1;

    // Recall leaves the terrain legible but puts the numbered route first.
    if (p.route) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, s.width, s.height);
      ctx.globalAlpha = 1;
    }

    const sx = (i: number) => model.xs[i]! * k + x;
    const sy = (i: number) => model.ys[i]! * k + y;
    const grow = Math.min(1.8, Math.pow(k / s.fitK, 0.35));
    const small = p.area.right - p.area.left < 600;
    const radius = (i: number) => ((small ? 1.6 : 2.1) + model.nodes[i]!.importance * (small ? 2.4 : 3.4)) * grow;

    // Fault lines: one dashed path, bowed a little so pairs on a line stay apart.
    if (p.faults && p.faults.length > 0) {
      const path = new Path2D();
      for (const [i, j] of p.faults) {
        const ax = sx(i), ay = sy(i), bx = sx(j), by = sy(j);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        path.moveTo(ax, ay);
        path.quadraticCurveTo(mx - (by - ay) * 0.12, my + (bx - ax) * 0.12, bx, by);
      }
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = C.fault;
      ctx.globalAlpha = p.faults.length > 80 ? 0.4 : 0.85;
      ctx.stroke(path);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Marks, batched into a few paths by type, fill and opacity step; search
    // hits last, on top. Fills only, never strokes (5,000 small strokes are
    // the costliest thing to raster): a solid mark sits on a ring of paper
    // that keeps overlapping marks apart; a hollow one (a reflection) is a
    // ring of its type colour; once the marks are big enough a protected one
    // carries an ink stud.
    const groups = new Map<string, { type: MapNode['type']; hollow: boolean; alpha: number; outer: Path2D; inner: Path2D }>();
    const studs = new Path2D();
    const showStuds = k / s.fitK >= 2.2;
    const margin = 12;
    const add = (i: number, onTop: boolean) => {
      const node = model.nodes[i]!;
      const px = sx(i), py = sy(i);
      if (px < -margin || py < -margin || px > s.width + margin || py > s.height + margin) return;
      let a = retentionAlpha(node, p.threshold) * lensAlpha(node, model.created[i]!, p.lens);
      if (a === 0) return;
      if (onTop) a = Math.max(a, 0.95);
      const step = Math.max(1, Math.round(a * ALPHA_STEPS));
      const key = `${onTop ? 1 : 0}${node.type}${node.isReflection ? 1 : 0}${step}`;
      let group = groups.get(key);
      if (!group) {
        group = { type: node.type, hollow: node.isReflection, alpha: step / ALPHA_STEPS, outer: new Path2D(), inner: new Path2D() };
        groups.set(key, group);
      }
      const r = radius(i);
      if (node.isReflection) {
        markPath(group.outer, node.type, px, py, r + 0.65);
        markPath(group.outer, node.type, px, py, Math.max(0.5, r - 0.75), true);
      } else {
        markPath(group.outer, node.type, px, py, r + 0.9);
        markPath(group.inner, node.type, px, py, r);
      }
      if (showStuds && node.protected && a > 0.5) {
        studs.moveTo(px + r * 0.34, py);
        studs.arc(px, py, r * 0.34, 0, Math.PI * 2);
      }
    };
    const hits = p.lens.hits;
    for (let i = 0; i < model.nodes.length; i++) if (!hits?.has(model.nodes[i]!.id)) add(i, false);
    if (hits) for (const id of hits) if (model.at.has(id)) add(model.at.get(id)!, true);
    for (const g of groups.values()) {
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = g.hollow ? C.type[g.type] : C.paper;
      ctx.fill(g.outer);
      if (g.hollow) continue;
      ctx.fillStyle = C.type[g.type];
      ctx.fill(g.inner);
    }
    if (showStuds) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = C.ink;
      ctx.fill(studs);
    }

    // Arrivals: two rings spread from a new memory, then a quiet ring stays.
    ctx.lineWidth = 1.5;
    for (const [id, t0] of p.arrivals) {
      const i = model.at.get(id);
      if (i === undefined) continue;
      const r = radius(i);
      const age = now - t0;
      if (!p.reduced && age < PULSE_MS * PULSES) {
        busy = true;
        for (let n = 0; n < PULSES; n++) {
          const t = (age - n * (PULSE_MS / 2)) / PULSE_MS;
          if (t < 0 || t > 1) continue;
          ctx.globalAlpha = 0.85 * (1 - t);
          ctx.strokeStyle = C.ink;
          ctx.beginPath();
          ctx.arc(sx(i), sy(i), r + 3 + easeExpoOut(t) * 26, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = C.ink;
      ctx.beginPath();
      ctx.arc(sx(i), sy(i), r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Search pins drop in, staggered, in rank order.
    p.pins.slice(0, PIN_MAX).forEach((id, n) => {
      const i = model.at.get(id);
      if (i === undefined) return;
      const t = p.reduced ? 1 : Math.min(1, Math.max(0, (now - s.pinsAt - Math.min(n * PIN_STAGGER_MS, PIN_STAGGER_CAP_MS)) / PIN_DROP_MS));
      if (t < 1) busy = true;
      if (t <= 0) return;
      const px = sx(i);
      const py = sy(i) - (1 - easeExpoOut(t)) * 24;
      ctx.globalAlpha = Math.min(1, t * 2.5);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.bezierCurveTo(px - 2, py - 6, px - 7, py - 9, px - 7, py - 14);
      ctx.arc(px, py - 14, 7, Math.PI, 0);
      ctx.bezierCurveTo(px + 7, py - 9, px + 2, py - 6, px, py);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C.paper;
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py - 14, 3, 0, Math.PI * 2);
      if (p.weak.has(id)) {
        ctx.fillStyle = C.paper;
        ctx.fill();
      } else {
        ctx.fillStyle = C.type[model.nodes[i]!.type];
        ctx.fill();
      }
    });

    // Recall: one continuous, ranked route. A graph-expanded destination
    // makes its incoming segment dashed; badges arrive with the line.
    s.badges = p.route ? routeBadges(p.route, s.view, p.area) : [];
    if (s.badges.length) {
      const t = p.reduced ? 1 : Math.min(1, Math.max(0, (now - s.routeAt) / 900));
      if (t < 1) busy = true;
      const distance = s.badges[s.badges.length - 1]!.distance * easeCubicInOut(t);
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      for (let n = 1; n < s.badges.length; n++) {
        const from = s.badges[n - 1]!;
        const to = s.badges[n]!;
        const progress = segmentProgress(from, to, distance);
        if (progress <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(from.x + (to.x - from.x) * progress,
          from.y + (to.y - from.y) * progress);
        ctx.lineWidth = 7;
        ctx.strokeStyle = C.paper;
        ctx.stroke();
        ctx.setLineDash(to.via === 'graph' ? [6, 5] : []);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.lineCap = 'butt';
      for (const stop of s.badges) {
        if (stop.distance > distance) continue;
        ctx.beginPath();
        ctx.moveTo(sx(stop.index), sy(stop.index));
        ctx.lineTo(stop.x, stop.y);
        ctx.lineWidth = 1;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
      }
      // Paint every leader before the badges so no later line crosses a number.
      for (const stop of s.badges) {
        if (stop.distance > distance) continue;
        const active = stop.id === p.hoverId || stop.id === p.focusId;
        ctx.beginPath();
        ctx.arc(stop.x, stop.y, ROUTE_BADGE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = C.ink;
        ctx.fill();
        ctx.lineWidth = active ? 3 : 2;
        ctx.strokeStyle = active ? C.focus : C.paper;
        ctx.stroke();
        ctx.fillStyle = C.paper;
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(stop.rank), stop.x, stop.y);
      }
    }

    // Rings: hover (thin), keyboard focus (focus colour), open memory (heavy ink).
    const ring = (id: string | null, gap: number, width: number, colour: string) => {
      const i = id === null ? undefined : model.at.get(id);
      if (i === undefined) return;
      const badge = s.badges.find((stop) => stop.id === id);
      const r = (badge ? ROUTE_BADGE_RADIUS : radius(i)) + gap;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(badge?.x ?? sx(i), badge?.y ?? sy(i), r, 0, Math.PI * 2);
      ctx.lineWidth = width + 3.5;
      ctx.strokeStyle = C.paper;
      ctx.stroke();
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.stroke();
    };
    ring(p.hoverId, 4, 1.4, C.ink);
    ring(p.selectedId, 6, 2.2, C.ink);
    ring(p.focusId, 9, 2, C.focus);
    ctx.globalAlpha = 1;

    p.onFrame(s.view, s.fitK);
    s.raf = busy ? requestAnimationFrame(draw) : 0;
  };

  const request = () => {
    const s = state.current;
    if (!s.raf) s.raf = requestAnimationFrame(draw);
  };

  const goTo = (to: View, instant = live.current.reduced) => {
    const s = state.current;
    const canvas = canvasRef.current;
    if (!canvas || !s.zoom) return;
    if (instant) {
      s.glide = null;
      select(canvas).call(s.zoom.transform, zoomIdentity.translate(to.x, to.y).scale(to.k));
      return;
    }
    s.glide = { from: { ...s.view }, to, t0: performance.now() };
    request();
  };

  const fitTo = (): View | null => (live.current.model.bounds ? fitView(live.current.model.bounds, live.current.area) : null);

  useImperativeHandle(props.ref, () => ({
    zoomBy: (factor) => {
      const s = state.current;
      const { area } = live.current;
      const k = Math.min(s.fitK * 14, Math.max(s.fitK * 0.6, s.view.k * factor));
      const cx = (area.left + area.right) / 2;
      const cy = (area.top + area.bottom) / 2;
      s.moved = true;
      goTo(centreOn(s.view, (cx - s.view.x) / s.view.k, (cy - s.view.y) / s.view.k, area, k));
    },
    fit: () => {
      const to = fitTo();
      if (to) goTo(to);
      state.current.moved = false;
    },
    reveal: (index, minZoom = 1) => {
      const s = state.current;
      const { model, area } = live.current;
      const k = Math.max(s.view.k, s.fitK * minZoom);
      const [px, py] = toScreen(s.view, model.xs[index]!, model.ys[index]!);
      if (k === s.view.k && contains(area, px, py, 48)) return;
      s.moved = true;
      goTo(centreOn(s.view, model.xs[index]!, model.ys[index]!, area, k));
    },
    showRegion: (regionId) => {
      const { model, area } = live.current;
      const box = boundsOf(model.xs, model.ys, regionMembers(model, regionId));
      if (!box) return;
      const s = state.current;
      const k = Math.min(s.fitK * 14, Math.max(s.fitK, fitView(box, area, 0.62).k));
      s.moved = true;
      goTo(centreOn(s.view, (box.left + box.right) / 2, (box.top + box.bottom) / 2, area, k));
    },
  }));

  // The camera: d3-zoom on the canvas (drag, wheel, pinch, double-click).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const s = state.current;
    const behaviour = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 400])
      .duration(0)
      .on('zoom', (event: { transform: View; sourceEvent: Event | null }) => {
        s.view = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
        if (event.sourceEvent) {
          s.moved = true;
          s.glide = null;
          live.current.onHover(null, null);
        }
        request();
      });
    s.zoom = behaviour;
    select(canvas).call(behaviour);

    const pickAt = (px: number, py: number): number => {
      const p = live.current;
      if (p.route) {
        return pickRouteBadge(s.badges, px, py);
      }
      return pick(p.model.index, p.model.xs, p.model.ys, s.view, px, py, PICK_PX,
        (i) => pickable(p.model.created[i]!, p.lens));
    };

    const onMove = (event: PointerEvent) => {
      if (event.buttons) return;
      const rect = canvas.getBoundingClientRect();
      const p = live.current;
      const at = pickAt(event.clientX - rect.left, event.clientY - rect.top);
      const id = at === -1 ? null : p.model.nodes[at]!.id;
      if (id === p.hoverId) return;
      canvas.style.cursor = id ? 'pointer' : '';
      p.onHover(id, id ? toScreen(s.view, p.model.xs[at]!, p.model.ys[at]!) : null);
    };
    const onLeave = () => live.current.onHover(null, null);
    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const p = live.current;
      const at = pickAt(event.clientX - rect.left, event.clientY - rect.top);
      p.onPick(at === -1 ? null : p.model.nodes[at]!.id);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('click', onClick);

    // Colours follow the colour mode: a pick in Settings, or the system under Auto.
    const recolour = () => {
      s.colours = null;
      request();
    };
    const observer = new MutationObserver(recolour);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener('change', recolour);
    document.addEventListener('visibilitychange', request);

    // The canvas fills its box at the device's pixel ratio (at most 2).
    const resize = new ResizeObserver(() => {
      const box = canvas.parentElement!.getBoundingClientRect();
      s.dpr = Math.min(2, window.devicePixelRatio || 1);
      s.width = box.width;
      s.height = box.height;
      canvas.width = Math.round(box.width * s.dpr);
      canvas.height = Math.round(box.height * s.dpr);
      canvas.style.width = `${box.width}px`;
      canvas.style.height = `${box.height}px`;
      request();
    });
    resize.observe(canvas.parentElement!);

    return () => {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      select(canvas).on('.zoom', null);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      observer.disconnect();
      scheme?.removeEventListener('change', recolour);
      document.removeEventListener('visibilitychange', request);
      resize.disconnect();
    };
    // Mounted once; everything it reads changes through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new model or a new area: fit again, unless the reader has moved the camera.
  const { model, area } = props;
  useEffect(() => {
    const s = state.current;
    const to = model.bounds ? fitView(model.bounds, area) : null;
    if (!to) return;
    s.fitK = to.k;
    s.zoom?.scaleExtent([to.k * 0.6, to.k * 14]);
    if (!s.moved) goTo(to, true);
    request();
    // goTo and request only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, area.left, area.top, area.right, area.bottom]);

  // New pins drop from now.
  useEffect(() => {
    state.current.pinsAt = performance.now();
  }, [props.pins]);

  useEffect(() => {
    state.current.routeAt = performance.now();
  }, [props.route]);

  // Anything else that changes what is drawn.
  useEffect(request);

  return <canvas ref={canvasRef} className="mp-canvas" aria-hidden="true" />;
}
