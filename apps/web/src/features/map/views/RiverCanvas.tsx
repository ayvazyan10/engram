import { useEffect, useRef } from 'react';
import { area, curveBasis } from 'd3-shape';
import { brushX, type D3BrushEvent } from 'd3-brush';
import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { dateLabel, hash, particlePosition, type RiverModel, type TimeWindow } from './river.js';

export type RiverHit = { kind: 'particle'; id: string } | { kind: 'band'; id: string } | { kind: 'eddy'; index: number };

/** Canvas-only painting and pointer geometry. The data layout lives in river.ts. */
export default function RiverCanvas({ model, focus, reduced, onHover, onPick }: {
  model: RiverModel; focus: string | null; reduced: boolean;
  onHover: (hit: RiverHit | null, point: [number, number]) => void;
  onPick: (hit: RiverHit | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onHover, onPick });
  callbacks.current = { onHover, onPick };
  useEffect(() => {
    const el = canvas.current!;
    // jsdom has no layout or 2D context.
    if (!el.clientWidth) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const backing = document.createElement('canvas'), bg = backing.getContext('2d')!;
    const { width: w, height: h } = model;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [el, backing]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const colors: Record<string, string> = {};
    const sprites: Record<string, HTMLCanvasElement> = {};
    let dark = false, hover: RiverHit | null = null;
    const readColors = () => {
      const style = getComputedStyle(document.documentElement);
      for (const name of ['sem', 'epi', 'pro', 'fault', 'ink', 'ink-3', 'series', 'contour']) colors[name] = style.getPropertyValue(`--${name}`).trim();
      dark = style.colorScheme === 'dark';
      for (const name of ['sem', 'epi', 'pro']) sprites[name] = glowSprite(colors[name]!);
    };
    const drawBands = () => {
      bg.setTransform(dpr, 0, 0, dpr, 0, 0); bg.clearRect(0, 0, w, h);
      bg.font = '11px Archivo, sans-serif'; bg.textAlign = 'center';
      const ticks = Math.max(2, Math.floor(w / 160));
      for (let i = 0; i <= ticks; i++) {
        const x = i * w / ticks;
        bg.strokeStyle = colors.contour!; bg.globalAlpha = 0.45; bg.setLineDash([2, 4]);
        bg.beginPath(); bg.moveTo(x, 28); bg.lineTo(x, h - 26); bg.stroke(); bg.setLineDash([]);
        bg.globalAlpha = 1; bg.fillStyle = colors['ink-3']!;
        bg.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center';
        bg.fillText(dateLabel(model.window[0] + i / ticks * (model.window[1] - model.window[0])), x, h - 10);
      }
      const shape = area<RiverModel['bands'][number]['series'][number]>().curve(curveBasis).x((_, i) => (i - 3.5) * model.dx)
        .y0((d) => model.y(d[0])).y1((d) => model.y(d[1])).context(bg);
      model.bands.forEach((band, i) => {
        const active = focus === band.id || (hover?.kind === 'band' && hover.id === band.id);
        bg.globalAlpha = focus && focus !== band.id ? 0.05 : active ? 0.38 : i % 2 ? 0.13 : 0.22;
        bg.fillStyle = colors.series!; bg.beginPath(); shape(band.series); bg.fill();
        bg.globalAlpha = active ? 0.7 : 0.18; bg.strokeStyle = colors.ink!; bg.lineWidth = active ? 1.3 : 0.7; bg.stroke();
      });
      bg.globalAlpha = 1; bg.textAlign = 'right'; bg.fillStyle = colors['ink-3']!;
      bg.fillText('memories per step (√)', w - 18, 18);
      const keys = [1, 2, 5, 10, 20, 50, 100, 200].filter((n) => Math.sqrt(n) * model.pixelsPerUnit <= h * 0.26).slice(-2);
      keys.forEach((n, i) => {
        const x = w - 22 - i * 44, height = Math.sqrt(n) * model.pixelsPerUnit;
        bg.globalAlpha = 0.6; bg.fillStyle = colors.series!; bg.fillRect(x, 28, 3, height);
        bg.globalAlpha = 1; bg.fillStyle = colors['ink-3']!; bg.fillText(String(n), x - 4, 28 + height);
      });
    };
    let positions: { id: string; x: number; y: number; alpha: number }[] = [];
    let raf = 0, seconds = 0, previous = 0;
    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.drawImage(backing, 0, 0, w, h);
      ctx.strokeStyle = colors.fault!; ctx.lineWidth = 1;
      for (const e of model.eddies) {
        ctx.globalAlpha = focus && focus !== e.regionId ? 0.1 : 0.72;
        const rotation = hash(e.regionId, e.bin) * 6 - (reduced ? 0 : seconds * (1.6 - e.radius / 30));
        ctx.beginPath();
        for (let k = 0; k <= 60; k++) {
          const f = k / 60, angle = rotation + f * Math.PI * 5, r = e.radius * f;
          const x = e.x + Math.cos(angle) * r, y = e.y + Math.sin(angle) * r * 0.62;
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      positions = model.particles.map((p) => {
        const pos = particlePosition(p, model, seconds, reduced);
        pos.alpha *= focus && focus !== p.node.regionId ? 0.08 : 1;
        const type = p.node.type === 'semantic' ? 'sem' : p.node.type === 'episodic' ? 'epi' : 'pro';
        ctx.globalAlpha = pos.alpha;
        if (dark) { const s = p.radius * 5.2; ctx.drawImage(sprites[type]!, pos.x - s / 2, pos.y - s / 2, s, s); }
        else { ctx.fillStyle = colors[type]!; ctx.beginPath(); ctx.arc(pos.x, pos.y, p.radius * 0.8, 0, Math.PI * 2); ctx.fill(); }
        if (hover?.kind === 'particle' && hover.id === p.node.id) {
          ctx.strokeStyle = colors.ink!; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(pos.x, pos.y, p.radius + 4, 0, Math.PI * 2); ctx.stroke();
        }
        return { id: p.node.id, ...pos };
      });
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    };
    const frame = (now: number) => {
      if (previous) seconds += (now - previous) / 1000;
      previous = now; paint();
      if (!reduced && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const resume = () => { cancelAnimationFrame(raf); previous = 0; if (!document.hidden) raf = requestAnimationFrame(frame); };
    const refresh = () => { readColors(); drawBands(); paint(); };
    const hitTest = (event: PointerEvent | MouseEvent): RiverHit | null => {
      const rect = el.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      let best: typeof positions[number] | undefined, distance = ('pointerType' in event && event.pointerType === 'touch' ? 16 : 9) ** 2;
      for (const p of positions) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (p.alpha >= 0.05 && d < distance) { best = p; distance = d; }
      }
      if (best) return { kind: 'particle', id: best.id };
      const eddy = model.eddies.findIndex((e) => (e.x - x) ** 2 + (e.y - y) ** 2 < (e.radius + 4) ** 2);
      if (eddy >= 0) return { kind: 'eddy', index: eddy };
      const band = model.bands.find((b) => { const [top, bottom] = b.bounds(x); return bottom - top > 1 && y >= top && y <= bottom; });
      return band ? { kind: 'band', id: band.id } : null;
    };
    const point = (event: PointerEvent) => {
      hover = hitTest(event); callbacks.current.onHover(hover, [event.clientX, event.clientY]); drawBands(); paint();
    };
    const leave = () => { hover = null; callbacks.current.onHover(null, [0, 0]); drawBands(); paint(); };
    const pick = (event: MouseEvent) => callbacks.current.onPick(hitTest(event));
    readColors(); drawBands(); paint(); resume();
    const theme = new MutationObserver(refresh); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)'); darkQuery.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', resume);
    el.addEventListener('pointermove', point); el.addEventListener('pointerdown', point); el.addEventListener('pointerleave', leave); el.addEventListener('click', pick);
    return () => {
      cancelAnimationFrame(raf); theme.disconnect(); darkQuery.removeEventListener('change', refresh); document.removeEventListener('visibilitychange', resume);
      el.removeEventListener('pointermove', point); el.removeEventListener('pointerdown', point); el.removeEventListener('pointerleave', leave); el.removeEventListener('click', pick);
    };
  }, [model, focus, reduced]);
  return <canvas ref={canvas} className="flow-river-canvas" aria-label="Streams of memories over time. Use the region and memory controls below for keyboard access." />;
}

/**
 * A glowing light drawn once per colour and stamped with drawImage each frame:
 * a per-particle shadowBlur made the dark river crawl at a frame or two a second.
 */
function glowSprite(color: string) {
  const size = 64, half = size / 2, sprite = document.createElement('canvas');
  sprite.width = sprite.height = size;
  const g = sprite.getContext('2d')!, glow = g.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0.14, '#000'); glow.addColorStop(0.32, 'rgba(0,0,0,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, size, size);
  const core = g.createRadialGradient(half, half, 0, half, half, half * 0.14);
  core.addColorStop(0, '#fff'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'source-over'; g.fillStyle = core; g.fillRect(0, 0, size, size);
  return sprite;
}

export function RiverOverview({ model, window, onWindow }: { model: RiverModel; window: TimeWindow; onWindow: (window: TimeWindow) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const callback = useRef(onWindow); callback.current = onWindow;
  const currentWindow = useRef(window); currentWindow.current = window;
  const brushRef = useRef<ReturnType<typeof brushX> | null>(null);
  useEffect(() => {
    const el = svg.current!, w = model.width;
    const root = select(el); root.selectAll('*').remove();
    const x = scaleLinear().domain(model.window).range([0, w]);
    const counts = model.rows.slice(4, -4).map((row) => Object.values(row).reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...counts);
    const shape = area<number>().curve(curveBasis).x((_, i) => (i + 0.5) * model.dx)
      .y0((n) => 23 - Math.sqrt(n / max) * 19).y1((n) => 23 + Math.sqrt(n / max) * 19);
    root.append('path').attr('d', shape(counts)).attr('fill', 'var(--series)').attr('opacity', 0.55);
    const brush = brushX().extent([[0, 0], [w, 44]]).on('brush end', (event: D3BrushEvent<unknown>) => {
      if (!event.sourceEvent) return;
      const selection = event.selection as [number, number] | null;
      callback.current(selection && selection[1] - selection[0] > 4 ? [x.invert(selection[0]), x.invert(selection[1])] : [...model.window]);
    });
    brushRef.current = brush;
    const group = root.append('g').attr('class', 'flow-brush').call(brush);
    if (currentWindow.current[0] !== model.window[0] || currentWindow.current[1] !== model.window[1]) group.call(brush.move, [x(currentWindow.current[0]), x(currentWindow.current[1])]);
    return () => { root.selectAll('*').remove(); brushRef.current = null; };
  }, [model]);
  useEffect(() => {
    const brush = brushRef.current;
    if (!brush) return;
    const x = scaleLinear().domain(model.window).range([0, model.width]);
    select(svg.current!).select<SVGGElement>('.flow-brush').call(brush.move,
      window[0] === model.window[0] && window[1] === model.window[1] ? null : [x(window[0]), x(window[1])]);
  }, [window, model]);
  return <svg ref={svg} className="flow-overview" viewBox={`0 0 ${model.width} 58`} aria-label="Whole history; drag to zoom a time window, tap to reset" />;
}
