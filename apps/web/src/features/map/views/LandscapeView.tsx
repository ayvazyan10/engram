import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MapPayload } from '../../../lib/api.js';
import { useMediaQuery } from '../../../hooks/useMediaQuery.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { loadPolicy } from '../../memory/MemorySheet.js';
import { archiveDay, decayProjection, decades, DEFAULT_POLICY, DECADE, EXTENT, FLOOR, GRID, heightAt, heightField, WORLD } from './landscape.js';
import { DAY } from './sky.js';
import { terrainMat, markerMat } from './shaders.js';
import { createStage, ease, type Hover } from './threeStage.js';
import './views.css';

export default function LandscapeView({ payload }: { payload: MapPayload }) {
  const host = useRef<HTMLDivElement>(null);
  const changeDay = useRef((_day: number, _animate: boolean) => {});
  const clear = useRef(() => {});
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [day, setDay] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const [selected, setSelected] = useState(-1);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 720px)');
  useEffect(() => {
    let active = true;
    void loadPolicy().then((value) => { if (active) setPolicy(value); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!host.current || !payload.nodes.length) return;
    const stage = createStage(host.current, reduced, false);
    if (!stage) { setUnavailable(true); return; }
    setUnavailable(false); setSelected(-1); setHover(null);
    const { scene, camera, controls, renderer } = stage;
    const nodes = payload.nodes, n = nodes.length;
    camera.position.set(stage.phone ? 3 : 4.6, stage.phone ? 13.5 : 8.4, stage.phone ? 15 : 10.2);
    controls.target.set(0.4, -0.3, stage.phone ? 1.2 : 0.6);
    const terrainGeometry = new THREE.PlaneGeometry(2 * EXTENT * WORLD, 2 * EXTENT * WORLD, GRID - 1, GRID - 1);
    terrainGeometry.rotateX(-Math.PI / 2);
    const terrainMaterial = terrainMat();
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial); scene.add(terrain);
    const waterMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), waterMaterial);
    water.position.y = 0.002; water.renderOrder = 2; scene.add(water);
    const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3), sizes = new Float32Array(n), alphas = new Float32Array(n), rings = new Float32Array(n);
    const markerGeometry = new THREE.BufferGeometry();
    markerGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    markerGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    markerGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    markerGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    markerGeometry.setAttribute('aRing', new THREE.BufferAttribute(rings, 1));
    stage.positions = positions;
    const markerMaterial = markerMat();
    const markers = new THREE.Points(markerGeometry, markerMaterial); markers.renderOrder = 3; scene.add(markers);
    const tetherPositions = new Float32Array(n * 6), tetherGeometry = new THREE.BufferGeometry();
    tetherGeometry.setAttribute('position', new THREE.BufferAttribute(tetherPositions, 3));
    const tetherMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false });
    const tethers = new THREE.LineSegments(tetherGeometry, tetherMaterial); tethers.renderOrder = 1; scene.add(tethers);
    const focusRing = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.11, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }));
    focusRing.renderOrder = 4; focusRing.visible = false; scene.add(focusRing);
    const nodeHeights = new Float32Array(n), archiveDays = nodes.map((node) => archiveDay(node, policy));
    let currentDay = 0, archivedCount = -1, focused = -1;
    let animation: { from: number; to: number; t: number; duration: number } | null = null;
    let typeColors: Record<string, THREE.Color> = {};
    const update = (d: number, force = false) => {
      currentDay = d;
      const archived = archiveDays.filter((a) => a <= d).length;
      if (archived !== archivedCount || force) {
        archivedCount = archived;
        const field = heightField(nodes, d, policy), p = terrainGeometry.getAttribute('position');
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
          p.setY((GRID - 1 - y) * GRID + x, decades(field[y * GRID + x]!, policy.archiveThreshold) * DECADE);
        }
        p.needsUpdate = true; terrainGeometry.computeVertexNormals();
        nodes.forEach((node, i) => { nodeHeights[i] = heightAt(field, node.x, node.y, policy.archiveThreshold); });
      }
      const sink = Math.log10(decayProjection(1, d, policy.halfLifeDays)) * DECADE;
      terrain.position.y = sink; terrainMaterial.uniforms.uFloorY!.value = FLOOR * DECADE + sink;
      nodes.forEach((node, i) => {
        const ground = nodeHeights[i]! * DECADE + sink, afloat = node.protected && ground < 0, gone = archiveDays[i]! <= d;
        positions.set([node.x * WORLD, afloat ? 0.03 : ground + 0.03, -node.y * WORLD], i * 3);
        typeColors[node.type]!.toArray(colors, i * 3);
        const held = decayProjection(node.retention, d, policy.halfLifeDays) >= policy.archiveThreshold;
        sizes[i] = node.protected ? (afloat ? 50 : 34 + 46 * node.importance) * (held ? 1.15 : 1) : 90;
        alphas[i] = gone ? 0.3 : ground < 0 && !afloat ? 0.55 : 1;
        rings[i] = node.protected ? (afloat ? 1 : 0) : 2;
        tetherPositions.set(afloat ? [positions[i * 3]!, ground, positions[i * 3 + 2]!, positions[i * 3]!, 0, positions[i * 3 + 2]!] : [0, -50, 0, 0, -50, 0], i * 6);
      });
      Object.values(markerGeometry.attributes).forEach((a) => { a.needsUpdate = true; });
      markerGeometry.computeBoundingSphere();
      tetherGeometry.getAttribute('position').needsUpdate = true;
      if (focused >= 0) { focusRing.position.fromArray(positions, focused * 3); focusRing.position.y += 0.01; }
      setDay(d);
    };
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const css = getComputedStyle(document.documentElement);
      const c = (token: string) => new THREE.Color(css.getPropertyValue(token).trim());
      const theme = document.documentElement.dataset.theme;
      const dark = theme === 'dark' || (theme !== 'light' && scheme.matches);
      const paper = c('--paper'); scene.background = paper; scene.fog = new THREE.Fog(paper, 11, 26);
      const u = terrainMaterial.uniforms;
      ['--heat-1', '--heat-2', '--heat-3', '--heat-4'].forEach((key, i) => u[`uH${i + 1}`]!.value.copy(c(key)));
      if (dark) u.uH1!.value.copy(c('--terrain-5'));
      u.uDeep!.value.copy(c('--terrain-2')); u.uContour!.value.copy(c(dark ? '--paper' : '--ink-3'));
      u.uShore!.value.copy(c('--ink')); u.uPaper!.value.copy(paper); u.uDark!.value = Number(dark);
      waterMaterial.color.copy(c(dark ? '--paper' : '--surface')); waterMaterial.opacity = dark ? 0.55 : 0.62;
      tetherMaterial.color.copy(c('--ink-2')); focusRing.material.color.copy(c('--ink'));
      markerMaterial.uniforms.uRingCol!.value.copy(c('--ink')); markerMaterial.uniforms.uFill!.value.copy(c('--surface')); markerMaterial.uniforms.uFault!.value.copy(c('--fault'));
      typeColors = { semantic: c('--sem'), episodic: c('--epi'), procedural: c('--pro') };
      update(currentDay, true);
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    scheme.addEventListener('change', applyTheme);
    changeDay.current = (to, animate) => {
      if (animate && !reduced) animation = { from: currentDay, to, t: 0, duration: 0.6 + Math.abs(to - currentDay) / 40 };
      else { animation = null; update(to); }
    };
    stage.onResize = (_width, height) => { markerMaterial.uniforms.uScale!.value = renderer.getPixelRatio() * height / 900 * 1.2; };
    stage.resize();
    stage.onHover = setHover;
    stage.onPick = (i) => {
      if (i >= 0 && focused === i) { useNeuralStore.getState().selectNeuron(nodes[i]!.id); return; }
      focused = i; setSelected(i); setHover(null); focusRing.visible = i >= 0;
      if (i >= 0) { focusRing.position.fromArray(positions, i * 3); focusRing.position.y += 0.01; }
      stage.focus(i, stage.phone ? 7 : 5.2);
    };
    stage.onClear = () => stage.onPick(-1); clear.current = stage.onClear;
    stage.onFrame = (dt) => {
      if (!animation) return;
      animation.t = Math.min(1, animation.t + dt / animation.duration);
      update(animation.from + (animation.to - animation.from) * ease(animation.t));
      if (animation.t === 1) animation = null;
    };
    return () => { observer.disconnect(); scheme.removeEventListener('change', applyTheme); stage.dispose(); };
  }, [payload, policy, reduced]);

  const node = payload.nodes[selected] ?? (hover ? payload.nodes[hover.index] : undefined);
  const threshold = policy.archiveThreshold * 100;
  const held = payload.nodes.filter((n) => decayProjection(n.retention, day, policy.halfLifeDays) >= policy.archiveThreshold).length;
  const archived = payload.nodes.filter((n) => archiveDay(n, policy) <= day).length;
  const fmtDate = (d: number) => new Date(Date.parse(payload.generatedAt) + d * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const percent = (value: number) => value < 0.001 ? '<0.1%' : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
  if (!payload.nodes.length) return <p className="v3-empty">No memories to show in the landscape yet.</p>;
  return <section className="v3-view v3-landscape" aria-label="Landscape view">
    <div className="v3-canvas" ref={host} aria-label="Drag to orbit, scroll to zoom, choose a marker for details" />
    <header className="v3-heading"><small>Atlas · Forgetting landscape</small><h2>What will fade</h2><p>Ground height is how strongly memory is still held at each place on the meaning map; the waterline is the archive threshold.</p></header>
    {unavailable ? <p className="v3-empty" role="status">WebGL is unavailable in this browser.</p> : <>
      <details className="v3-legend v3-panel" open={!phone}><summary>Legend</summary><ul>
        <li>Land: summed retention above the archive line (log, contour = ×1.8)</li><li>Sea: below the line — faded</li>
        <li className="v3-types"><span>● semantic</span><span>● episodic</span><span>● procedural</span></li>
        <li>Protected: kept afloat, never archived</li><li>Orange rings: unprotected, faint ghosts after archiving below {threshold}%</li>
        <li>Decay: half-life {policy.halfLifeDays} days without recall. A projection, assuming no new recalls.</li>
      </ul></details>
      <section className="v3-time v3-panel" aria-label="Landscape time">
        <div className="v3-time-row"><b>{day === 0 ? 'Now' : `+${Math.round(day)} days`}<small>{fmtDate(day)}</small></b><span role="status">{held} of {payload.nodes.length} memories above {threshold}%{day > 0 ? ` (today ${payload.nodes.filter((n) => n.retention >= policy.archiveThreshold).length})` : ''} · {archived} of {payload.nodes.filter((n) => !n.protected).length} unprotected archived</span></div>
        <input type="range" min="0" max="90" step="0.5" value={day} aria-label="Days from now" onChange={(e) => changeDay.current(Number(e.target.value), false)} />
        <div className="v3-stops">{[0, 7, 30, 90].map((d) => <button key={d} aria-pressed={Math.round(day) === d} onClick={() => changeDay.current(d, true)}>{d === 0 ? 'Now' : `+${d} d`}</button>)}</div>
      </section>
      {node && <aside className={`${selected >= 0 ? 'v3-card' : 'v3-tip'} v3-panel`} aria-label="Memory forecast" style={selected < 0 && hover ? { left: hover.x, top: hover.y } : undefined}>
        {selected >= 0 && <button className="v3-close" aria-label="Close memory forecast" onClick={() => clear.current()}>×</button>}
        <h3>{node.label}</h3><small>{payload.regions.find((r) => r.id === node.regionId)?.name} · {node.type} · last recalled {node.lastAccessedAt ? new Date(node.lastAccessedAt).toLocaleDateString() : 'never'}</small>
        <p>Retention now {percent(node.retention)} → {percent(decayProjection(node.retention, day, policy.halfLifeDays))} at +{Math.round(day)} d</p>
        <p>{node.protected ? 'Protected — kept afloat, never archived' : archiveDay(node, policy) <= day ? `Projected archived by the decay sweep on ${fmtDate(archiveDay(node, policy))}` : `Archived around ${fmtDate(archiveDay(node, policy))} unless recalled`}</p>
        {selected >= 0 && <button className="at-btn" onClick={() => useNeuralStore.getState().selectNeuron(node.id)}>Open</button>}
      </aside>}
    </>}
  </section>;
}
