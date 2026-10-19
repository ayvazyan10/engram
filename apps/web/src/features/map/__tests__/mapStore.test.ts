import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, ApiError } from '../../../lib/api.js';
import { NAMES_KEY, loadFaults, loadMap, readNames, useMapStore } from '../mapStore.js';
import { node, payload } from './payload.js';

vi.mock('../../../lib/api.js', () => ({
  api: { getMap: vi.fn(), getGraphEdges: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

const getMap = vi.mocked(api.getMap);
const notReady = () => new ApiError(503, 'map not ready', { error: 'map not ready', retryAfterMs: 250 });

beforeEach(() => {
  getMap.mockReset();
  vi.mocked(api.getGraphEdges).mockReset();
  localStorage.clear();
  useMapStore.setState({
    status: 'loading',
    error: null,
    payload: null,
    model: null,
    scopeKey: null,
    arrivals: new Map(),
    faults: null,
    faultError: null,
    lens: 'meaning',
    regionId: null,
    panel: 'recent',
    focusId: null,
    hoverId: null,
    names: {},
  });
});

describe('loadMap', () => {
  it('is pending while the server charts the first map, then ready, asking again after its delay', async () => {
    const waits: number[] = [];
    const statuses: string[] = [];
    getMap.mockRejectedValueOnce(notReady()).mockRejectedValueOnce(notReady()).mockResolvedValueOnce(payload());
    await loadMap(undefined, async (ms) => {
      waits.push(ms);
      statuses.push(useMapStore.getState().status);
    });
    expect(statuses).toEqual(['pending', 'pending']);
    expect(waits[0]).toBe(250);
    expect(waits[1]).toBeGreaterThan(250);
    expect(useMapStore.getState()).toMatchObject({ status: 'ready', error: null });
    expect(useMapStore.getState().model!.nodes).toHaveLength(5);
  });

  it('asks for the scope: every memory, one project or the global ones', async () => {
    getMap.mockResolvedValue(payload());
    await loadMap(undefined);
    await loadMap('/repo/a');
    await loadMap(null);
    expect(getMap.mock.calls).toEqual([[undefined], ['/repo/a'], [null]]);
  });

  it('keeps the map while it refreshes, and notes the memories that arrived', async () => {
    getMap.mockResolvedValueOnce(payload());
    await loadMap(undefined);
    expect(useMapStore.getState().arrivals.size).toBe(0);
    const grown = payload({ fingerprint: 'm:6' });
    grown.nodes.push(node('new', { x: 0.1 }));
    let during: string | undefined;
    getMap.mockImplementationOnce(async () => {
      during = useMapStore.getState().status;
      return grown;
    });
    await loadMap(undefined);
    expect(during).toBe('ready');
    expect([...useMapStore.getState().arrivals.keys()]).toEqual(['new']);
  });

  it('starts over on a new scope: no arrivals, no open region', async () => {
    getMap.mockResolvedValueOnce(payload());
    await loadMap(undefined);
    useMapStore.setState({ regionId: 'r1', focusId: 'a' });
    let during: string | undefined;
    getMap.mockImplementationOnce(async () => {
      during = useMapStore.getState().status;
      return payload({ nodes: [node('z')] });
    });
    await loadMap('/repo/b');
    expect(during).toBe('loading');
    expect(useMapStore.getState()).toMatchObject({ regionId: null, focusId: null, status: 'ready' });
    expect(useMapStore.getState().arrivals.size).toBe(0);
  });

  it('says why it failed, and leaves a 401 to the unlock gate', async () => {
    getMap.mockRejectedValueOnce(new Error('offline'));
    await loadMap(undefined);
    expect(useMapStore.getState()).toMatchObject({ status: 'error', error: 'offline' });
    useMapStore.setState({ status: 'loading', error: null, scopeKey: null });
    getMap.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    await loadMap(undefined);
    expect(useMapStore.getState().status).toBe('loading');
  });

  it('gives up waiting after a while', async () => {
    getMap.mockRejectedValue(notReady());
    await loadMap(undefined, async () => {});
    expect(useMapStore.getState().status).toBe('error');
    expect(useMapStore.getState().error).toMatch(/taking too long/);
  });

  it('drops a reply that a newer load has overtaken', async () => {
    let release!: (p: ReturnType<typeof payload>) => void;
    getMap.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = loadMap(undefined);
    getMap.mockResolvedValueOnce(payload({ fingerprint: 'newer' }));
    await loadMap(undefined);
    release(payload({ fingerprint: 'older' }));
    await first;
    expect(useMapStore.getState().payload!.fingerprint).toBe('newer');
  });
});

describe('loadFaults', () => {
  it('keeps the contradiction edges, ids only', async () => {
    vi.mocked(api.getGraphEdges).mockResolvedValueOnce({
      total: 2,
      stored: 2,
      matching: 2,
      returned: 2,
      truncated: false,
      minStrength: 0,
      limit: 20000,
      edges: [
        { id: '1', sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.6 },
        { id: '2', sourceId: 'c', targetId: 'd', relationship: 'contradicts', strength: 0.8 },
      ],
    });
    await loadFaults();
    expect(useMapStore.getState().faults).toEqual([['c', 'd']]);
  });

  it('says when they could not be loaded', async () => {
    vi.mocked(api.getGraphEdges).mockRejectedValueOnce(new Error('offline'));
    await loadFaults();
    expect(useMapStore.getState()).toMatchObject({ faults: [], faultError: 'offline' });
  });
});

describe('region names on this device', () => {
  it('keeps a rename in localStorage, trimmed, and an empty one gives the automatic name back', () => {
    useMapStore.getState().rename('r1', '  Cloud sync  ');
    expect(useMapStore.getState().names).toEqual({ r1: 'Cloud sync' });
    expect(JSON.parse(localStorage.getItem(NAMES_KEY)!)).toEqual({ r1: 'Cloud sync' });
    expect(readNames()).toEqual({ r1: 'Cloud sync' });
    useMapStore.getState().rename('r1', ' ');
    expect(readNames()).toEqual({});
  });

  it('reads nothing from a broken or blocked store, and a blocked write still renames for this visit', () => {
    localStorage.setItem(NAMES_KEY, '[1,2]');
    expect(readNames()).toEqual({});
    localStorage.setItem(NAMES_KEY, '{"r1":"ok","r2":5}');
    expect(readNames()).toEqual({ r1: 'ok' });
    localStorage.setItem(NAMES_KEY, 'not json');
    expect(readNames()).toEqual({});
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    useMapStore.getState().rename('r2', 'Releases');
    expect(useMapStore.getState().names.r2).toBe('Releases');
    set.mockRestore();
  });

  it('opens a region in the sheet, and closes it again', () => {
    useMapStore.getState().setRegion('r1');
    expect(useMapStore.getState()).toMatchObject({ regionId: 'r1', panel: 'regions' });
    useMapStore.getState().setRegion(null);
    expect(useMapStore.getState()).toMatchObject({ regionId: null, panel: 'regions' });
  });
});
