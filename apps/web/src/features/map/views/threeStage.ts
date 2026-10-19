import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export type Hover = { index: number; x: number; y: number } | null;

/** Shared canvas ownership: resize, input, camera easing, visibility and disposal. */
export function createStage(host: HTMLDivElement, reduced: boolean, sky: boolean) {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: !sky }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, host.clientWidth < 640 ? 1.5 : 2));
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const phone = host.clientWidth < 640;
  const camera = new THREE.PerspectiveCamera(sky ? (phone ? 62 : 48) : (phone ? 52 : 38), 1, sky ? 0.5 : 0.1, sky ? 2000 : 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.06;
  controls.autoRotateSpeed = sky ? 0.35 : 0.18;
  controls.minDistance = sky ? 8 : 3;
  controls.maxDistance = sky ? 600 : 32;
  if (!sky) controls.maxPolarAngle = Math.PI * 0.46;
  let width = 1, height = 1, idle = 0, dragging = false, focused = -1;
  let fly: { t: number; target: THREE.Vector3; cam: THREE.Vector3; fromTarget: THREE.Vector3; fromCam: THREE.Vector3 } | null = null;
  let down: { x: number; y: number } | null = null;
  const v = new THREE.Vector3();
  const abort = new AbortController();
  const stage = {
    scene, camera, controls, renderer, phone,
    positions: new Float32Array(),
    onHover: (_hover: Hover) => {},
    onPick: (_index: number) => {},
    onClear: () => {},
    onResize: (_width: number, _height: number) => {},
    onFrame: (_dt: number) => {},
    paint: () => renderer.render(scene, camera),
    focus(index: number, distance: number) {
      focused = index;
      controls.autoRotate = false;
      idle = 0;
      if (index < 0) { fly = null; return; }
      const target = new THREE.Vector3().fromArray(stage.positions, index * 3);
      if (!sky) target.y = Math.max(target.y, -0.6);
      const cam = camera.position.clone().sub(controls.target).setLength(distance).add(target);
      if (reduced) { controls.target.copy(target); camera.position.copy(cam); }
      else fly = { t: 0, target, cam, fromTarget: controls.target.clone(), fromCam: camera.position.clone() };
    },
    resize() {
      width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      stage.onResize(width, height);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      abort.abort();
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  const pick = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    let best = -1, distance = (event.pointerType === 'mouse' ? 14 : 24) ** 2;
    for (let i = 0; i < stage.positions.length / 3; i++) {
      v.fromArray(stage.positions, i * 3).project(camera);
      if (v.z < -1 || v.z > 1) continue;
      const d = ((v.x * 0.5 + 0.5) * width - x) ** 2 + ((-v.y * 0.5 + 0.5) * height - y) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return { index: best, x: Math.max(8, Math.min(x + 14, width - 284)), y: Math.max(8, Math.min(y + 16, height - 170)) };
  };
  const el = renderer.domElement, options = { signal: abort.signal };
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, options);
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || dragging) return;
    const hit = pick(e);
    stage.onHover(hit.index >= 0 ? hit : null);
    el.style.cursor = hit.index >= 0 ? 'pointer' : 'grab';
  }, options);
  el.addEventListener('pointerleave', () => stage.onHover(null), options);
  el.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6) stage.onPick(pick(e).index);
    down = null;
  }, options);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { stage.onClear(); stage.onHover(null); } }, options);
  controls.addEventListener('start', () => { dragging = true; fly = null; controls.autoRotate = false; idle = 0; });
  controls.addEventListener('end', () => { dragging = false; idle = 0; });
  const observer = new ResizeObserver(() => stage.resize());
  observer.observe(host);
  stage.resize();
  let last = 0;
  const frame = (time: number) => {
    const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
    last = time;
    idle += dt;
    controls.autoRotate = !reduced && !dragging && focused < 0 && idle >= 9;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / (sky ? 1.6 : 1.4));
      const k = ease(fly.t);
      controls.target.lerpVectors(fly.fromTarget, fly.target, k);
      camera.position.lerpVectors(fly.fromCam, fly.cam, k);
      if (fly.t === 1) fly = null;
    }
    stage.onFrame(dt);
    controls.update(dt);
    stage.paint();
  };
  const visibility = () => { last = 0; renderer.setAnimationLoop(document.hidden ? null : frame); };
  document.addEventListener('visibilitychange', visibility, options);
  idle = 9;
  visibility();
  return stage;
}
