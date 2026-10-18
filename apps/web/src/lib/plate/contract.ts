/**
 * THE PLATE CONTRACT.
 *
 * Five visualizations were filled in independently, one file each, by separate
 * authors. This file is the only thing they share, and it is still the only
 * thing they share now that they render inside the Engram dashboard instead of
 * the comparison harness they were built in. Read it in full before touching a
 * plate; everything a plate may assume is stated here.
 *
 * A plate is handed a measured box and nothing else. There is app chrome
 * around that box — a header, a memory list, an inspector — but none of it is
 * available to hang anything on, and none of it explains a plate. Whatever a
 * visualization needs to explain itself, it draws inside its own box.
 *
 * ─── Rules of the boundary ─────────────────────────────────────────────────
 *
 * 1. One file per plate. A plate may not import another plate. The only
 *    imports from outside your file are this contract, React, and the packages
 *    already installed in apps/web (three, @react-three/fiber,
 *    @react-three/drei, @react-three/postprocessing, recharts, zustand,
 *    date-fns). Install nothing.
 * 2. No shared mutable state. A plate receives props and calls callbacks. It
 *    must not write to a global, a module-level mutable object, or any store
 *    another plate — or the app around it — can observe. Module-level
 *    constants are fine.
 * 3. No colour literals. Every colour comes from `PLATE_COLORS` / `linkColor`
 *    below, or from `var(--…)` in DOM and SVG. If you are typing a `#`, the
 *    answer is in the token layer (styles/plate.css) or the answer is no.
 * 4. Density is geometry, never a background wash. Measured: a link drawn on
 *    the densest step of a plate-family luminance wash falls to 1.73:1
 *    contrast, under the 3:1 mark floor. Show density with thickness,
 *    aggregation, binning, or mark size.
 * 5. Retention is never encoded by colour. `node.retentionBand` is a word; if
 *    you draw retention, draw it as radius or a ring, and name the band in
 *    your overlay.
 * 6. Respect `reducedMotion`. When true: no autorotation, no ticking
 *    simulation, no entrance animation — render the settled state at once.
 * 7. Animate `transform` and `opacity` only. Never width, height, top, left,
 *    margin, padding or font-size.
 * 8. If you draw a subset, say so on screen with the real denominator. Every
 *    count you need is on `data.stats`. There is no second legend anywhere on
 *    the page to fall back on: the app's own scene key was retired precisely
 *    because two legends on one screen disagree with each other.
 * 9. Your box bleeds to its edges. No card, no border-radius, no shadow, no
 *    frame. Do not add one. The host gives you a `position: relative` box, so
 *    an `inset: 0` root resolves against it.
 *
 * ─── What you get ──────────────────────────────────────────────────────────
 *
 * `data` is already fetched, joined and derived (lib/plate/data.ts), and it is
 * stable across plate switches: switching plates does not refetch and does not
 * drop the selection. Link endpoints carry array INDICES as well as ids,
 * degrees and connected components are counted, and retention is computed
 * against the server's real half-life.
 *
 * The box is measured for you and handed over as `width` / `height` in CSS
 * pixels, tracked across resizes. It is the app's canvas slot — the viewport
 * minus the header, the memory list and the inspector — not a whole window.
 *
 * `selectedId` / `onSelect` are the app's own selection: the memory a plate
 * selects is the memory the inspector fills with, and a memory selected
 * elsewhere arrives here. Escape is owned by the host, which clears that
 * selection; do not bind a window listener for it.
 */

import type { ComponentType } from 'react';

// ─── Data ───────────────────────────────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural';

/** The four retention bands, strongest first. The word is the accessible channel. */
export type RetentionBand = 'vivid' | 'holding' | 'fading' | 'threshold';

export const RETENTION_LABEL: Record<RetentionBand, string> = {
  vivid: 'Vivid',
  holding: 'Holding',
  fading: 'Fading',
  threshold: 'At threshold',
};

export interface ObsNode {
  id: string;
  type: MemoryType;
  /** Concept, or the head of the content. Server trims it to 80 characters. */
  label: string;
  importance: number;
  accessCount: number;
  createdAt: string;
  /** PCA coordinates inside a cube of `data.halfExtent`. Origin is the centre. */
  x: number;
  y: number;
  z: number;
  /** False when the position is a hash placeholder rather than a projection.
   *  651 of 651 are projected on this store — do not assume it stays that way. */
  projected: boolean;

  // ── derived by the harness, identical for every demo ──
  /** Links touching this node, both kinds. 0 for the 38 isolated memories. */
  degree: number;
  agreeDegree: number;
  contradictDegree: number;
  /** Connected-component index, 0 = the largest (538 members on this store). */
  component: number;
  /** 2^(-ageDays / 7) — the server's own decay curve. 1 = stored just now. */
  retention: number;
  retentionBand: RetentionBand;
}

/** The two relationship kinds this store actually contains. */
export type LinkKind = 'agrees' | 'contradicts';

export interface ObsLink {
  id: string;
  sourceId: string;
  targetId: string;
  /** `relates_to` → 'agrees'; `contradicts` → 'contradicts'. */
  kind: LinkKind;
  /** 0.4 – 1.0. Agrees run strong (median 0.93), contradicts weak (0.57), so
   *  strength and kind are correlated: a thin-and-warm link is the norm, not
   *  a coincidence. */
  strength: number;
  /** Which of the three ordinal strength steps this link paints with. */
  step: 0 | 1 | 2;
  /** Indices into `data.nodes`, precomputed. */
  source: number;
  target: number;
  /** Straight-line distance between endpoints in PCA space. Mean 7.08 against
   *  a mean random-pair distance of 40.81 — connected memories already sit on
   *  top of each other in the projection, which is exactly why edges vanish
   *  inside the cloud. Worth knowing before you commit to a layout. */
  span: number;
}

export interface ObsStats {
  /** Memories the dashboard can see. */
  memories: number;
  /** Memories with at least one renderable link, and without. */
  connected: number;
  isolated: number;
  /** Renderable links — both endpoints visible. */
  linksDrawn: number;
  /** Every non-deleted connection row in the store. */
  linksStored: number;
  /** Stored minus renderable: links onto memories that have been archived. */
  linksToArchived: number;
  agrees: number;
  contradicts: number;
  /** Connected components, and the size of the largest. */
  components: number;
  largestComponent: number;
  degree: { median: number; max: number };
  /** Fraction of embedding variance the 3-component PCA keeps — 0.382 here.
   *  The projection discards nearly two thirds of the structure. Any demo that
   *  leans on distance has to say so. */
  explainedVariance: number;
  retention: Record<RetentionBand, number>;
  byType: Record<MemoryType, number>;
  halfLifeDays: number;
}

export interface ObsData {
  nodes: ObsNode[];
  links: ObsLink[];
  /** Half-width of the cube the PCA was fitted into. 42 on this store. */
  halfExtent: number;
  stats: ObsStats;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface DemoProps {
  data: ObsData;
  /** The visualization box in CSS pixels, measured and resize-tracked. */
  width: number;
  height: number;
  /** True when the viewer has asked for reduced motion. Honour it. */
  reducedMotion: boolean;
  /** The memory the viewer clicked, or null. This is `neuralStore`'s
   *  `selectedNeuronId` — the same value the inspector reads — so it survives
   *  a plate change with the selection intact. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The memories the active search returned (`memoryStore.highlightedIds`),
   *  empty when no search is active. While nothing is hovered or selected, a
   *  plate lights these and recedes the rest. */
  highlightedIds: ReadonlySet<string>;
}

/**
 * A plate module. `Plate` fills the box. Its `caption` and `method` are drawn
 * by the host above the box; anything else the visualization needs to say (its
 * key, its denominator, its controls) it draws inside its own box, positioned
 * however suits it, and never on top of its own marks.
 *
 * Still named `DemoModule` because all five plates export it under that name;
 * `store/viewStore.ts` re-exports the type and holds the five.
 */
export interface DemoModule {
  /** Stable id. It is what the view store persists and resolves, so it
   *  outlives a reload and must not be renamed lightly. */
  id: string;
  /** Shown on the switch. Two or three words, naming the idea, not the tech. */
  name: string;
  /** '2D' | '3D' | 'Hybrid'. */
  dimension: '2D' | '3D' | 'Hybrid';
  /** What the plate shows and how to read it, in plain words, at most two
   *  lines. Shown above the box and in the plate chooser. It must hold for any
   *  store: never state a fact about one particular store's data. */
  caption: string;
  /** How the plate is built — the method behind the caption. Shown when the
   *  reader opens the "?" beside the caption. Same rule: no store facts. */
  method: string;
  Plate: ComponentType<DemoProps>;
}

// ─── Colours ────────────────────────────────────────────────────────────────

/**
 * Resolved values of the token layer, for canvas and WebGL where a CSS
 * variable cannot be used. In DOM and SVG use `var(--agrees)` and friends.
 *
 * Read from the stylesheet at first use, so they cannot drift from
 * `styles/plate.css`. Every value is measured — see that file's header.
 *
 * Cached, because resolving fourteen custom properties off the root element is
 * a forced style recalculation and canvas code asks for them inside draw
 * loops. The cache has to be droppable, which it did not in the harness: that
 * page loaded once and never changed its stylesheet, while this one lives for
 * hours and the template switcher rewrites custom properties under it. See
 * `resetPlateColors`.
 */
let resolved: Record<string, string> | null = null;

function vars(): Record<string, string> {
  if (resolved) return resolved;
  const fallback: Record<string, string> = {
    '--plate': '#0b1315',
    '--margin': '#101a1c',
    '--rule': '#1f2b2c',
    '--ink': '#e9efed',
    '--ink-2': '#a6b7b4',
    '--ink-3': '#7d8f8c',
    '--memory': '#7f8d8b',
    '--memory-live': '#e9efed',
    '--agrees-weak': '#355fc0',
    '--agrees-mid': '#4a76da',
    '--agrees-strong': '#6291f7',
    '--contradicts-weak': '#a5431a',
    '--contradicts-mid': '#bf5a33',
    '--contradicts-strong': '#dc744d',
  };
  if (typeof document === 'undefined') return (resolved = fallback);
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const key of Object.keys(fallback)) {
    out[key] = style.getPropertyValue(key).trim() || fallback[key]!;
  }
  return (resolved = out);
}

export const PLATE_COLORS = {
  get plate() {
    return vars()['--plate']!;
  },
  get rule() {
    return vars()['--rule']!;
  },
  get ink() {
    return vars()['--ink']!;
  },
  get ink2() {
    return vars()['--ink-2']!;
  },
  get ink3() {
    return vars()['--ink-3']!;
  },
  get memory() {
    return vars()['--memory']!;
  },
  get memoryLive() {
    return vars()['--memory-live']!;
  },
  get agrees(): readonly [string, string, string] {
    const v = vars();
    return [v['--agrees-weak']!, v['--agrees-mid']!, v['--agrees-strong']!];
  },
  get contradicts(): readonly [string, string, string] {
    const v = vars();
    return [v['--contradicts-weak']!, v['--contradicts-mid']!, v['--contradicts-strong']!];
  },
};

/**
 * Drop the resolved-colour cache, so the next read re-reads the stylesheet.
 *
 * Two things in the app can invalidate it and neither existed in the harness:
 * a plate that mounts before `styles/plate.css` has applied would otherwise
 * freeze the hardcoded fallbacks above in place permanently, and
 * `useThemeVars` rewrites custom properties on every template switch while
 * canvas and WebGL colours stay frozen at whatever was resolved first.
 */
export function resetPlateColors(): void {
  resolved = null;
}

/** The colour a link paints with: kind picks the hue, step picks the level. */
export function linkColor(link: Pick<ObsLink, 'kind' | 'step'>): string {
  return PLATE_COLORS[link.kind][link.step]!;
}

/** Same, as a 0xrrggbb integer, for three.js materials. */
export function linkColorInt(link: Pick<ObsLink, 'kind' | 'step'>): number {
  return parseInt(linkColor(link).slice(1), 16);
}

/** `highlightedIds` as indices into `nodes` — the form every plate's bead
 *  colouring already works in. */
export function highlightIndices(
  nodes: readonly Pick<ObsNode, 'id'>[],
  ids: ReadonlySet<string>
): ReadonlySet<number> {
  const out = new Set<number>();
  if (ids.size === 0) return out;
  nodes.forEach((node, i) => {
    if (ids.has(node.id)) out.add(i);
  });
  return out;
}
