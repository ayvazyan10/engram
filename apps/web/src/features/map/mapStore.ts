import { create } from 'zustand';
import { api, ApiError, type MapPayload } from '../../lib/api.js';
import type { ProjectFilter } from '../../store/memoryStore.js';
import { buildModel, type MapModel } from './lib/model.js';
import type { Lens } from './lenses.js';

/** Region renames live on this device only (owner decision 2026-10-19). */
export const NAMES_KEY = 'engram.map.regionNames.v1';
/** How long the client keeps asking while the server charts the first map. */
const PENDING_TRIES = 120;
const PENDING_MAX_WAIT_MS = 2000;
/** The Time lens opens on the last month. */
export const DEFAULT_CUT_DAYS = 30;

export type MapStatus = 'loading' | 'pending' | 'ready' | 'error';
export type SheetPanel = 'recent' | 'regions';

export function readNames(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

function writeNames(names: Record<string, string>): void {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // Storage is blocked (private window): the rename lasts this visit.
  }
}

interface MapState {
  status: MapStatus;
  error: string | null;
  payload: MapPayload | null;
  model: MapModel | null;
  /** Which scope the payload is for, so a refresh can tell arrivals from a new scope. */
  scopeKey: string | null;
  /** Memories that appeared since the page opened, with when they did
   *  (performance.now), for the arrival highlight. */
  arrivals: ReadonlyMap<string, number>;
  /** The `contradicts` edges, fetched the first time the Faults lens opens. */
  faults: [string, string][] | null;
  /** Why the fault lines could not be loaded, said in the Faults legend. */
  faultError: string | null;
  lens: Lens;
  cutDays: number;
  regionId: string | null;
  panel: SheetPanel;
  /** The memory the arrow keys are on (not the same as the open one). */
  focusId: string | null;
  /** The memory under the pointer, on the map or in the list. */
  hoverId: string | null;
  names: Record<string, string>;

  setLens: (lens: Lens) => void;
  setCut: (days: number) => void;
  /** Opens a region (the sheet shows it) or closes it with null. */
  setRegion: (id: string | null) => void;
  setPanel: (panel: SheetPanel) => void;
  setFocus: (id: string | null) => void;
  setHover: (id: string | null) => void;
  /** An empty name gives the region its automatic name back. */
  rename: (regionId: string, name: string) => void;
}

export const useMapStore = create<MapState>((set) => ({
  status: 'loading',
  error: null,
  payload: null,
  model: null,
  scopeKey: null,
  arrivals: new Map(),
  faults: null,
  faultError: null,
  lens: 'meaning',
  cutDays: DEFAULT_CUT_DAYS,
  regionId: null,
  panel: 'recent',
  focusId: null,
  hoverId: null,
  names: readNames(),

  setLens: (lens) => set({ lens }),
  setCut: (days) => set({ cutDays: days }),
  setRegion: (id) => set(id ? { regionId: id, panel: 'regions' } : { regionId: null }),
  setPanel: (panel) => set({ panel }),
  setFocus: (id) => set({ focusId: id }),
  setHover: (id) => set((s) => (s.hoverId === id ? s : { hoverId: id })),
  rename: (regionId, name) =>
    set((s) => {
      const names = { ...s.names };
      const clean = name.trim().slice(0, 60);
      if (clean) names[regionId] = clean;
      else delete names[regionId];
      writeNames(names);
      return { names };
    }),
}));

function keyOf(scope: ProjectFilter): string {
  return scope === undefined ? '*' : scope === null ? 'global' : `ns:${scope}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let generation = 0;

/**
 * Loads the map for a scope. While the server is still charting it (503 with
 * `retryAfterMs`) the status is `pending` and the call asks again after that
 * delay. A later call supersedes an earlier one. A refresh of the same scope
 * keeps the map on screen and notes which memories are new; a new scope
 * starts over.
 */
export async function loadMap(scope: ProjectFilter, sleep: (ms: number) => Promise<void> = wait): Promise<void> {
  const mine = ++generation;
  const key = keyOf(scope);
  const before = useMapStore.getState();
  if (before.scopeKey !== key) {
    useMapStore.setState({ status: 'loading', error: null, payload: null, model: null, scopeKey: key, arrivals: new Map(), regionId: null, focusId: null });
  }
  for (let attempt = 0; attempt < PENDING_TRIES; attempt++) {
    try {
      const payload = await api.getMap(scope);
      if (mine !== generation) return;
      const prev = useMapStore.getState().payload;
      const arrivals = new Map(useMapStore.getState().arrivals);
      if (prev) {
        const known = new Set(prev.nodes.map((n) => n.id));
        const now = performance.now();
        for (const node of payload.nodes) if (!known.has(node.id)) arrivals.set(node.id, now);
      }
      useMapStore.setState({
        status: 'ready',
        error: null,
        payload,
        model: buildModel(payload),
        arrivals,
        faults: prev?.fingerprint === payload.fingerprint ? useMapStore.getState().faults : null,
      });
      return;
    } catch (err) {
      if (mine !== generation) return;
      if (err instanceof ApiError && err.status === 503) {
        if (!useMapStore.getState().payload) useMapStore.setState({ status: 'pending' });
        const body = err.body as { retryAfterMs?: unknown } | undefined;
        const after = typeof body?.retryAfterMs === 'number' ? body.retryAfterMs : 250;
        await sleep(Math.min(PENDING_MAX_WAIT_MS, Math.max(100, after) * (1 + attempt / 10)));
        if (mine !== generation) return;
        continue;
      }
      // A 401 is the unlock gate's; anything else is said on the map.
      if (err instanceof ApiError && err.status === 401) return;
      if (!useMapStore.getState().payload) {
        useMapStore.setState({ status: 'error', error: err instanceof Error ? err.message : 'Could not reach Engram API' });
      }
      return;
    }
  }
  if (mine === generation && !useMapStore.getState().payload) {
    useMapStore.setState({ status: 'error', error: 'The map is taking too long to chart. Try again in a minute.' });
  }
}

/** The Faults lens's lines: every `contradicts` edge, ids only. */
export async function loadFaults(): Promise<void> {
  try {
    const res = await api.getGraphEdges();
    const faults = res.edges.filter((e) => e.relationship === 'contradicts').map((e): [string, string] => [e.sourceId, e.targetId]);
    useMapStore.setState({ faults, faultError: null });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    useMapStore.setState({ faults: [], faultError: err instanceof Error ? err.message : 'Could not reach Engram API' });
  }
}
