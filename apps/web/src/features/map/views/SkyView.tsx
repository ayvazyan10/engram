import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { api, type MapPayload } from '../../../lib/api.js';
import { useMediaQuery } from '../../../hooks/useMediaQuery.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { brightness, DAY, depthByAge, phase, SPREAD, DEPTH } from './sky.js';
import { starMat } from './shaders.js';
import { createStage, type Hover } from './threeStage.js';
import './views.css';

const COLORS = { semantic: '#447be4', episodic: '#bf56b9', procedural: '#05a388' };
const date = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'never';

export default function SkyView({ payload }: { payload: MapPayload }) {
  const host = useRef<HTMLDivElement>(null);
  const clear = useRef(() => {});
  const [unavailable, setUnavailable] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const [selected, setSelected] = useState(-1);
  const [edgeNote, setEdgeNote] = useState('Loading connections…');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 720px)');

  useEffect(() => {
    if (!host.current || !payload.nodes.length) return;
    const stage = createStage(host.current, reduced, true);
    if (!stage) { setUnavailable(true); return; }
    setUnavailable(false); setSelected(-1); setHover(null);
    const { scene, camera, controls, renderer } = stage;
    const nodes = payload.nodes, now = Date.parse(payload.generatedAt), n = nodes.length;
    const positions = depthByAge(nodes, now);
    stage.positions = positions;
    scene.background = new THREE.Color(0x070d10);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const attrs: Record<string, Float32Array> = {
      aColor: new Float32Array(n * 3), aSize: new Float32Array(n), aBright: new Float32Array(n),
      aHalo: new Float32Array(n), aTwinkle: new Float32Array(n), aPhase: new Float32Array(n), aLit: new Float32Array(n).fill(1),
    };
    nodes.forEach((node, i) => {
      new THREE.Color(COLORS[node.type]).toArray(attrs.aColor!, i * 3);
      attrs.aSize![i] = 1.6 + node.importance * 5.2;
      attrs.aBright![i] = brightness(node.retention);
      attrs.aHalo![i] = Number(node.protected);
      attrs.aTwinkle![i] = Number(!reduced && !!node.lastAccessedAt && now - Date.parse(node.lastAccessedAt) < 7 * DAY);
      attrs.aPhase![i] = phase(node.id);
    });
    Object.entries(attrs).forEach(([key, values]) => geometry.setAttribute(key, new THREE.BufferAttribute(values, key === 'aColor' ? 3 : 1)));
    const material = starMat();
    scene.add(new THREE.Points(geometry, material));
    const centre = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute).getCenter(new THREE.Vector3());
    controls.target.copy(centre);
    const frameSky = () => {
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const fit = Math.max(SPREAD * 0.85 / (tangent * camera.aspect), SPREAD * 0.85 / tangent) * 1.05;
      camera.position.copy(centre).add(new THREE.Vector3(0.25, -0.5, 0.83).normalize().multiplyScalar(fit * (stage.phone ? 1.3 : 1) + DEPTH * 0.3));
    };
    frameSky();
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'v3-labels';
    host.current.append(labels.domElement);
    const regionLabels: { id: string; count: number; element: HTMLDivElement }[] = [];
    for (const region of payload.regions) {
      const members = nodes.flatMap((node, i) => node.regionId === region.id ? [i] : []);
      if (!members.length) continue;
      const centre = new THREE.Vector3();
      members.forEach((i) => centre.add(new THREE.Vector3().fromArray(positions, i * 3)));
      centre.divideScalar(members.length).add(new THREE.Vector3(0, 9, 0));
      const element = document.createElement('div');
      element.className = 'v3-region';
      element.textContent = region.name;
      const count = document.createElement('span'); count.textContent = ` ${region.count}`; element.append(count);
      const label = new CSS2DObject(element); label.position.copy(centre); scene.add(label);
      regionLabels.push({ id: region.id, count: region.count, element });
    }
    regionLabels.sort((a, b) => b.count - a.count);
    const composer = new EffectComposer(renderer);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.4, 0.2);
    composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass());
    stage.onResize = (width, height) => {
      composer.setSize(width, height); labels.setSize(width, height);
      material.uniforms.uScale!.value = renderer.getPixelRatio() * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / 8;
    };
    stage.resize();
    const lineOptions = { vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    const base = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial(lineOptions));
    const highlights = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial(lineOptions));
    scene.add(base, highlights);
    const neighbours: { index: number; fault: boolean; strength: number }[][] = nodes.map(() => []);
    let focused = -1, hovered = -1, disposed = false;
    const lightThreads = (index: number) => {
      const p: number[] = [], c: number[] = [];
      for (const edge of neighbours[index] ?? []) {
        p.push(...positions.subarray(index * 3, index * 3 + 3), ...positions.subarray(edge.index * 3, edge.index * 3 + 3));
        const col = new THREE.Color(edge.fault ? '#e86518' : '#9db3ac').multiplyScalar(edge.fault ? 0.9 : 0.55 * (0.5 + 0.5 * edge.strength));
        c.push(...col.toArray(), ...col.toArray());
      }
      highlights.geometry.dispose();
      highlights.geometry = new THREE.BufferGeometry();
      highlights.geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      highlights.geometry.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    };
    const setLit = () => {
      const lit = new Set([focused, ...(neighbours[focused] ?? []).map((edge) => edge.index)]);
      nodes.forEach((_, i) => { attrs.aLit![i] = focused < 0 || lit.has(i) ? 1 : 0.12; });
      geometry.getAttribute('aLit').needsUpdate = true;
      base.material.opacity = focused < 0 ? 1 : 0.3;
    };
    setEdgeNote('Loading connections…');
    void api.getGraphEdges().then((result) => {
      if (disposed) return;
      const index = new Map(nodes.map((node, i) => [node.id, i]));
      const p: number[] = [], c: number[] = [];
      for (const edge of result.edges) {
        const a = index.get(edge.sourceId), b = index.get(edge.targetId);
        if (a === undefined || b === undefined) continue;
        const fault = edge.relationship === 'contradicts';
        neighbours[a]!.push({ index: b, fault, strength: edge.strength }); neighbours[b]!.push({ index: a, fault, strength: edge.strength });
        p.push(...positions.subarray(a * 3, a * 3 + 3), ...positions.subarray(b * 3, b * 3 + 3));
        const col = new THREE.Color(fault ? '#e86518' : '#9db3ac').multiplyScalar((fault ? 0.075 : 0.04) * (0.4 + 0.6 * edge.strength));
        c.push(...col.toArray(), ...col.toArray());
      }
      base.geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      base.geometry.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      setEdgeNote(`${p.length / 6} connections${result.truncated ? ' · server result is truncated' : ''}`);
      setLit(); lightThreads(focused >= 0 ? focused : hovered);
    }).catch(() => { if (!disposed) setEdgeNote('Connections unavailable.'); });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0xdce7e2, transparent: true, opacity: 0.32, depthWrite: false }));
    ring.visible = false; scene.add(ring);
    const focus = (i: number) => {
      focused = i; setSelected(i); setHover(null); setLit(); lightThreads(i); ring.visible = i >= 0;
      if (i >= 0) { ring.position.fromArray(positions, i * 3); ring.scale.setScalar(1.6 + nodes[i]!.importance * 1.2); }
      stage.focus(i, stage.phone ? 75 : 55);
    };
    stage.onPick = focus; stage.onClear = () => focus(-1); clear.current = stage.onClear;
    stage.onHover = (hit) => { setHover(hit); hovered = hit?.index ?? -1; if (focused < 0) lightThreads(hovered); };
    let frame = 0;
    stage.onFrame = (dt) => { if (!reduced) material.uniforms.uTime!.value += dt; ring.quaternion.copy(camera.quaternion); };
    stage.paint = () => {
      composer.render(); labels.render(scene, camera);
      if (++frame % 12) return;
      const shown: DOMRect[] = [], bounds = host.current!.getBoundingClientRect();
      const ordered = [...regionLabels].sort((a, b) => Number(b.id === nodes[focused]?.regionId) - Number(a.id === nodes[focused]?.regionId));
      for (const { id, element } of ordered) {
        const r = element.getBoundingClientRect();
        const hidden = r.left < bounds.left + 4 || r.right > bounds.right - 4 || r.top < bounds.top + 145 || r.bottom > bounds.bottom - 30 ||
          shown.some((s) => r.left < s.right + 6 && r.right > s.left - 6 && r.top < s.bottom + 2 && r.bottom > s.top - 2);
        element.style.opacity = hidden ? '0' : '';
        element.classList.toggle('on', id === nodes[focused]?.regionId);
        if (!hidden) shown.push(r);
      }
    };
    return () => {
      disposed = true;
      composer.passes.forEach((pass) => pass.dispose()); composer.dispose(); labels.domElement.remove(); stage.dispose();
    };
  }, [payload, reduced]);

  const node = payload.nodes[selected], tip = hover ? payload.nodes[hover.index] : null;
  const region = (id: string) => payload.regions.find((r) => r.id === id)?.name ?? 'Unassigned';
  if (!payload.nodes.length) return <p className="v3-empty">No memories to show in the sky yet.</p>;
  return <section className="v3-view v3-sky" aria-label="Sky view">
    <div className="v3-canvas" ref={host} aria-label="Drag to orbit, scroll to zoom, choose a star for details" />
    <header className="v3-heading"><small>Atlas · Constellation</small><h2>Night sky of memory</h2><p>Each star is one memory, placed by meaning; clusters are regions, and older clusters lie further back.</p></header>
    {unavailable ? <p className="v3-empty" role="status">WebGL is unavailable in this browser.</p> : <>
      <details className="v3-legend v3-panel" open={!phone}><summary>Legend</summary><ul>
        <li className="v3-types"><span>● semantic</span><span>● episodic</span><span>● procedural</span></li>
        <li>Size = importance · brightness = retention (log)</li><li>Halo = protected · twinkling = recalled in the last 7 days</li>
        <li>Threads = relates to · orange = contradicts</li><li>{edgeNote}</li><li>Meaning-map distances are approximate; depth shows age.</li>
      </ul></details>
      {tip && hover && !node && <div className="v3-tip v3-panel" style={{ left: hover.x, top: hover.y }}><b>{tip.label}</b><small>{region(tip.regionId)} · {tip.type} · retention {(tip.retention * 100).toFixed(1)}%</small></div>}
      {node && <aside className="v3-card v3-panel" aria-label="Star details" aria-live="polite">
        <button className="v3-close" aria-label="Close star details" onClick={() => clear.current()}>×</button>
        <small>{node.type}{node.protected ? ' · protected' : ''}</small><h3>{node.label}</h3>
        <dl><dt>Region</dt><dd>{region(node.regionId)}</dd><dt>Retention</dt><dd>{(node.retention * 100).toFixed(1)}%</dd><dt>Importance</dt><dd>{node.importance.toFixed(2)}</dd><dt>Created</dt><dd>{date(node.createdAt)}</dd><dt>Last recalled</dt><dd>{date(node.lastAccessedAt)}</dd><dt>Connections</dt><dd>{node.degree}</dd><dt>Contradictions</dt><dd>{node.contradictCount}</dd></dl>
        <button className="at-btn" onClick={() => useNeuralStore.getState().selectNeuron(node.id)}>Open</button>
      </aside>}
    </>}
  </section>;
}
