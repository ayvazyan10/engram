import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapPayload } from '../../../lib/api.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useMediaQuery } from '../../../hooks/useMediaQuery.js';
import RiverCanvas, { RiverOverview, type RiverHit } from './RiverCanvas.js';
import { dateLabel, DAY, historyWindow, riverLayout, type TimeWindow } from './river.js';
import { useFlowEdges } from './flow.js';
import './flow.css';

export default function RiverView({ payload }: { payload: MapPayload }) {
  const { edges, note } = useFlowEdges(payload);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const full = useMemo(() => historyWindow(payload.nodes), [payload]);
  const [window, setWindow] = useState<TimeWindow>(full);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{ hit: RiverHit; point: [number, number] } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 460 });
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => { setWindow(full); setFocus(null); setHover(null); }, [full]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth) setSize({ width: el.clientWidth, height: el.clientHeight }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [payload.nodes.length]);
  const model = useMemo(() => riverLayout(payload, edges, window, size.width, size.height), [payload, edges, window, size]);
  const overview = useMemo(() => riverLayout(payload, [], full, size.width, 100), [payload, full, size.width]);
  const pick = (hit: RiverHit | null) => {
    if (hit?.kind === 'particle') useNeuralStore.getState().selectNeuron(hit.id);
    else if (hit?.kind === 'band') setFocus((id) => id === hit.id ? null : hit.id);
    else if (!hit) setFocus(null);
  };
  if (!payload.nodes.length) return <p className="flow-empty">No memories to carry along the river yet.</p>;
  const hit = hover?.hit;
  const particle = hit?.kind === 'particle' ? payload.nodes.find((n) => n.id === hit.id) : null;
  const eddy = hover?.hit.kind === 'eddy' ? model.eddies[hover.hit.index] : null;
  const regionId = particle?.regionId ?? eddy?.regionId ?? (hover?.hit.kind === 'band' ? hover.hit.id : null);
  const region = payload.regions.find((r) => r.id === regionId);
  const visible = model.particles.filter((p) => !focus || p.node.regionId === focus);
  return <section className="flow-view" aria-label="River of time">
    <header className="flow-head">
      <h1>River of time</h1>
      <p>Every memory is a light carried from the day it was made. Each region’s band swells with the memories it gained at that time.</p>
      <ul className="flow-legend" aria-label="River legend">
        <li>● size = importance</li><li>retention: faded sink and dim (log scale)</li>
        <li className="flow-sem">● semantic</li><li className="flow-epi">● episodic</li><li className="flow-pro">● procedural</li>
        <li className="flow-fault">◎ contradictions, dated by the later memory</li>
      </ul>
      {focus && <span className="flow-chip">Following {payload.regions.find((r) => r.id === focus)?.name}<button type="button" aria-label="Clear focus" onClick={() => setFocus(null)}>×</button></span>}
    </header>
    {note && <p className="flow-note" role="status">{note}</p>}
    <p className="flow-note">{model.particles.length} memories · {dateLabel(window[0])} – {dateLabel(window[1])} · {Math.round(model.duration / DAY * 10) / 10} days per step · band width ∝ √ memories</p>
    <div className="flow-river-stage" ref={stage}>
      <RiverCanvas model={model} focus={focus} reduced={reduced} onPick={pick}
        onHover={(hit, point) => setHover(hit ? { hit, point } : null)} />
    </div>
    <RiverOverview model={overview} window={window} onWindow={setWindow} />
    <div className="flow-tools"><button type="button" onClick={() => setWindow(full)}>Show whole history</button>
      <label>From <input aria-label="Window start" type="range" min={full[0]} max={full[1] - model.duration} step={1} value={window[0]}
        onChange={(e) => setWindow([Math.min(Number(e.target.value), window[1] - 1), window[1]])} /></label>
      <label>To <input aria-label="Window end" type="range" min={full[0] + 1} max={full[1]} step={1} value={window[1]}
        onChange={(e) => setWindow([window[0], Math.max(Number(e.target.value), window[0] + 1)])} /></label></div>
    <p className="flow-note">Drag across the strip to zoom; tap it to reset. Hover a light, band or whirlpool for details. Click a band to follow its region; click a light to open its memory.</p>
    <details className="flow-access"><summary>Explore regions and memories</summary>
      <div className="flow-tools" aria-label="Follow a region">{payload.regions.map((r) => <button type="button" key={r.id} aria-pressed={focus === r.id} onClick={() => pick({ kind: 'band', id: r.id })}>{r.name}</button>)}</div>
      <ul>{visible.map(({ node }) => <li key={node.id}><button type="button" onClick={() => pick({ kind: 'particle', id: node.id })}>{node.label}</button></li>)}</ul>
    </details>
    {hover && <div className="flow-tooltip" role="tooltip" style={{ left: Math.max(8, Math.min(hover.point[0] + 14, globalThis.innerWidth - 310)), top: Math.max(8, Math.min(hover.point[1] + 14, globalThis.innerHeight - 190)) }}>
      <strong>{particle?.label ?? (eddy ? `${eddy.count} contradiction${eddy.count === 1 ? '' : 's'}` : region?.name)}</strong>
      {particle ? <><span>{region?.name} · {particle.type} · {dateLabel(Date.parse(particle.createdAt))}</span><span>Importance {particle.importance.toFixed(2)} · retention {particle.retention.toExponential(1)}{particle.protected ? ' · protected' : ''}</span><span>{particle.contradictCount} contradictions · Click to open</span></>
        : eddy ? <span>Arrived in {region?.name}, from {dateLabel(eddy.from)}</span>
          : <><span>{model.particles.filter((p) => p.node.regionId === regionId).length} of {region?.count} memories in this window</span><span>{region?.topTags.length ? `Top tags: ${region.topTags.slice(0, 5).join(', ')}` : 'No top tags (reflection region)'}</span><span>{region?.contradictions} contradictions overall</span></>}
    </div>}
  </section>;
}
