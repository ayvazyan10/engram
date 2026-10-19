import { useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRouteStore } from '../../../shell/routeStore.js';
import MapView from '../MapView.js';
import { useMapStore } from '../mapStore.js';
import { buildModel } from '../lib/model.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { resetServerStats } from '../../../lib/serverStats.js';
import { resetPolicyCache } from '../../memory/MemorySheet.js';
import { api } from '../../../lib/api.js';
import { NOW, node, payload } from './payload.js';

/** The canvas is drawing only (and jsdom cannot draw): a stand-in records
 *  what MapView hands it and answers its camera calls. */
vi.mock('../views/SkyView.js', () => ({ default: () => <div>Sky scene</div> }));
vi.mock('../views/LandscapeView.js', () => ({ default: () => <div>Landscape scene</div> }));
const camera = { zoomBy: vi.fn(), fit: vi.fn(), reveal: vi.fn(), showRegion: vi.fn() };
let drawn: Record<string, unknown> = {};
vi.mock('../MapCanvas.js', () => ({
  default: (props: Record<string, unknown> & { ref?: unknown }) => {
    drawn = props;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useImperativeHandle(props.ref as never, () => camera);
    return <canvas data-testid="canvas" />;
  },
}));
vi.mock('../../../lib/api.js', () => ({
  api: {
    getMap: vi.fn(),
    getGraphEdges: vi.fn(),
    getDecayPolicy: vi.fn(),
    search: vi.fn(),
    stats: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const props = { loading: false, error: null, onRetry: vi.fn(), onLoadMore: vi.fn(), loadingMore: false, onStore: vi.fn(), onCommands: vi.fn() };

function ready(p = payload()) {
  useMapStore.setState({ status: 'ready', error: null, payload: p, model: buildModel(p), scopeKey: '*' });
}

function record(id: string): MemoryRecord {
  return { id, type: 'semantic', content: `Memory ${id}`, summary: null, importance: 0.5, source: null, concept: null, tags: '[]', createdAt: '2026-10-18T00:00:00.000Z' };
}

const map = () => screen.getByRole('application');
const live = () => document.querySelector('[aria-live="polite"].at-sr')!;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // The fixture's dates are relative to NOW; the Time lens counts from the clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '#/');
  useRouteStore.setState({ route: { name: 'map', sub: null, params: {} } });
  drawn = {};
  Object.values(camera).forEach((f) => f.mockReset());
  resetServerStats();
  resetPolicyCache();
  vi.mocked(api.stats).mockReset().mockResolvedValue({ total: 5, byType: {}, bySource: {} });
  vi.mocked(api.getDecayPolicy).mockReset().mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05 });
  vi.mocked(api.getGraphEdges).mockReset();
  vi.mocked(api.getMap).mockReset();
  useNeuralStore.setState({ selectedNeuronId: null });
  useMemoryStore.setState({ records: [], searchQuery: '', searchResults: [], weakerResults: [], projectFilter: undefined, hiddenIds: new Set() });
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
    cutDays: 30,
    regionId: null,
    panel: 'recent',
    focusId: null,
    hoverId: null,
    names: {},
  });
});

describe('MapView before the map can be drawn', () => {
  it('says the map is being charted while the server computes it', () => {
    useMapStore.setState({ status: 'pending' });
    render(<MapView {...props} />);
    expect(screen.getByText(/The map is being charted/)).toBeInTheDocument();
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Lens' })).not.toBeInTheDocument();
  });

  it('says why it failed, and charts again on Try again', async () => {
    useMapStore.setState({ status: 'error', error: 'offline', scopeKey: '*' });
    vi.mocked(api.getMap).mockResolvedValue(payload());
    render(<MapView {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not chart the map: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('application')).toBeInTheDocument());
  });

  it('invites the first memory on an empty store', () => {
    ready(payload({ nodes: [], regions: [] }));
    render(<MapView {...props} />);
    expect(screen.getByText(/Nothing charted yet/)).toBeInTheDocument();
  });
});

describe('MapView', () => {
  it('names the map for a screen reader and draws the store with the server’s threshold', async () => {
    ready();
    render(<MapView {...props} />);
    expect(map()).toHaveAccessibleName('Memory map, 5 memories in 2 regions');
    expect(map()).toHaveAccessibleDescription(/Arrow keys move between memories/);
    await waitFor(() => expect(drawn.threshold).toBe(0.05));
    expect(screen.getByRole('button', { name: /Sync · encryption/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/two axes keep 31%/)).toBeInTheDocument();
  });

  it('switches lenses: Faults loads its lines and says how many, Time shows the scrubber', async () => {
    ready();
    vi.mocked(api.getGraphEdges).mockResolvedValue({
      total: 1, stored: 1, matching: 1, returned: 1, truncated: false, minStrength: 0, limit: 1,
      edges: [{ id: 'f', sourceId: 'c', targetId: 'd', relationship: 'contradicts', strength: 0.9 }],
    });
    render(<MapView {...props} />);
    const lenses = screen.getByRole('group', { name: 'Lens' });
    fireEvent.click(within(lenses).getByRole('button', { name: 'Faults' }));
    expect(within(lenses).getByRole('button', { name: 'Faults' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByText(/1 fault line on the map/)).toBeInTheDocument());
    expect(drawn.faults).toEqual([[2, 3]]);

    fireEvent.click(within(lenses).getByRole('button', { name: 'Time' }));
    const slider = screen.getByRole('slider', { name: 'Show memories up to this many days old' });
    expect(slider).toHaveValue('30');
    expect(screen.getByText(/from the last/)).toHaveTextContent('4 memories from the last 30 days');
    fireEvent.change(slider, { target: { value: '200' } });
    expect(useMapStore.getState().cutDays).toBe(90);
  });

  it('drops a pin for every search result on the map, weaker ones hollow, and the list holds the same', () => {
    ready();
    useMemoryStore.setState({ searchQuery: 'sync', searchResults: [record('a'), record('off-map')], weakerResults: [record('d')] });
    render(<MapView {...props} />);
    expect(drawn.pins).toEqual(['a', 'd']);
    expect([...(drawn.weak as Set<string>)]).toEqual(['d']);
    const list = screen.getByRole('region', { name: 'Search results' });
    expect(within(list).getAllByRole('button', { name: /Memory (a|off-map|d)/ })).toHaveLength(3);
  });

  it('opens a memory picked on the map, and brings one opened elsewhere into view', () => {
    ready();
    render(<MapView {...props} />);
    act(() => (drawn.onPick as (id: string | null) => void)('d'));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('d');
    expect(camera.reveal).toHaveBeenLastCalledWith(3);
    act(() => (drawn.onPick as (id: string | null) => void)(null));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('d');
  });

  it('shows a summary of the memory under the pointer and marks it in the list', () => {
    ready();
    render(<MapView {...props} />);
    act(() => (drawn.onHover as (id: string, at: [number, number]) => void)('d', [100, 100]));
    expect(screen.getByText('Release by pushing a tag')).toBeInTheDocument();
    expect(useMapStore.getState().hoverId).toBe('d');
    act(() => (drawn.onHover as (id: null, at: null) => void)(null, null));
    expect(screen.queryByText('Release by pushing a tag')).not.toBeInTheDocument();
  });

  it('moves its region labels where the canvas drew them, hiding the ones off the map', () => {
    const box = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('mp-sheet')) return box(600, 0, 400, 800);
      if (this.classList.contains('mp-field')) return box(20, 18, 440, 94);
      return box(0, 0, 1000, 800);
    });
    ready();
    render(<MapView {...props} />);
    act(() => (drawn.onFrame as (v: { k: number; x: number; y: number }) => void)({ k: 0.6, x: 0, y: 0 }));
    const left = screen.getByRole('button', { name: /Sync · encryption/ });
    expect(left.style.visibility).toBe('');
    expect(left.style.transform).toMatch(/^translate\(\d+px, \d+px\) translate\(-50%, -50%\)$/);
    act(() => (drawn.onFrame as (v: { k: number; x: number; y: number }) => void)({ k: 0.6, x: -2000, y: 0 }));
    expect(left.style.visibility).toBe('hidden');
    rect.mockRestore();
  });

  it('flies to a region from its label, and back out from it', () => {
    ready();
    render(<MapView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Release · npm/ }));
    expect(camera.showRegion).toHaveBeenCalledWith('r2');
    expect(useMapStore.getState()).toMatchObject({ regionId: 'r2', panel: 'regions' });
    expect(screen.getByRole('heading', { name: 'Release · npm' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Release · npm/, pressed: true }));
    expect(camera.fit).toHaveBeenCalled();
    expect(useMapStore.getState().regionId).toBeNull();
  });

  it('announces a memory that arrives while the map is open', () => {
    ready();
    render(<MapView {...props} />);
    const grown = payload();
    grown.nodes.push(node('new', { label: 'Fresh from the socket' }));
    act(() => useMapStore.setState({ payload: grown, model: buildModel(grown), arrivals: new Map([['new', 1]]) }));
    expect(live()).toHaveTextContent('New memory on the map. Semantic, Sync · encryption: Fresh from the socket');
    expect(drawn.arrivals).toEqual(new Map([['new', 1]]));
  });
});

describe('MapView keyboard', () => {
  it('starts on the memory nearest the middle, steps with the arrows and says where it is', () => {
    ready();
    render(<MapView {...props} />);
    fireEvent.keyDown(map(), { key: 'ArrowRight' });
    const first = useMapStore.getState().focusId!;
    expect(first).not.toBeNull();
    expect(live().textContent).toMatch(/: /);
    useMapStore.setState({ focusId: 'a' });
    fireEvent.keyDown(map(), { key: 'ArrowRight' });
    expect(useMapStore.getState().focusId).toBe('d');
    expect(live()).toHaveTextContent('Procedural, Release · npm: Release by pushing a tag. 1 contradiction.');
    expect(camera.reveal).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(map(), { key: 'ArrowRight' });
    fireEvent.keyDown(map(), { key: 'ArrowRight' });
    expect(live()).toHaveTextContent('No memory further that way.');
  });

  it('starts on the open memory when there is one, and opens the focused one with Enter', () => {
    ready();
    useNeuralStore.setState({ selectedNeuronId: 'c' });
    render(<MapView {...props} />);
    fireEvent.keyDown(map(), { key: 'ArrowDown' });
    expect(useMapStore.getState().focusId).toBe('c');
    fireEvent.keyDown(map(), { key: 'ArrowRight' });
    fireEvent.keyDown(map(), { key: 'Enter' });
    expect(useNeuralStore.getState().selectedNeuronId).toBe(useMapStore.getState().focusId);
  });

  it('zooms with + and -, fits with 0, and leaves modified keys alone', () => {
    ready();
    render(<MapView {...props} />);
    fireEvent.keyDown(map(), { key: '+' });
    fireEvent.keyDown(map(), { key: '-' });
    fireEvent.keyDown(map(), { key: '0' });
    fireEvent.keyDown(map(), { key: 'ArrowRight', ctrlKey: true });
    expect(camera.zoomBy.mock.calls).toEqual([[1.5], [1 / 1.5]]);
    expect(camera.fit).toHaveBeenCalledTimes(1);
    expect(useMapStore.getState().focusId).toBeNull();
  });

  it('steps through the regions with R and leaves them with Escape', () => {
    ready();
    render(<MapView {...props} />);
    fireEvent.keyDown(map(), { key: 'r' });
    expect(useMapStore.getState().regionId).toBe('r1');
    expect(live()).toHaveTextContent('Sync · encryption, 3 memories. Region 1 of 2.');
    fireEvent.keyDown(map(), { key: 'R' });
    expect(live()).toHaveTextContent('Release · npm, 2 memories. Region 2 of 2.');
    fireEvent.keyDown(map(), { key: 'r' });
    expect(useMapStore.getState().regionId).toBe('r1');
    fireEvent.keyDown(map(), { key: 'Escape' });
    expect(useMapStore.getState().regionId).toBeNull();
    expect(live()).toHaveTextContent('All regions.');
  });

  it('does not step onto what the Time lens has faded', () => {
    ready();
    useMapStore.setState({ lens: 'time', cutDays: 30, focusId: 'a' });
    render(<MapView {...props} />);
    fireEvent.keyDown(map(), { key: 'ArrowDown' });
    expect(useMapStore.getState().focusId).not.toBe('c');
  });
});

describe('view switcher', () => {
  it('pushes the view route, preserves the memory param, and shows only installed views', async () => {
    ready();
    useRouteStore.setState({ route: { name: 'map', sub: null, params: { m: 'a' } } });
    render(<MapView {...props} />);
    const views = within(screen.getByRole('group', { name: 'View' }));
    expect(views.getAllByRole('button').map((b) => b.textContent)).toEqual(['Map', 'Sky', 'Landscape']);
    fireEvent.click(views.getByRole('button', { name: 'Sky' }));
    expect(await screen.findByText('Sky scene')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/?m=a&view=sky');
    expect(views.getByRole('button', { name: 'Sky' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Lens' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
    expect(document.querySelector('.mp-field')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Zoom' })).not.toBeInTheDocument();
    fireEvent.click(views.getByRole('button', { name: 'Map' }));
    expect(window.location.hash).toBe('#/?m=a');
    expect(screen.getByRole('group', { name: 'Lens' })).toBeInTheDocument();
  });
  it('loads a direct landscape link and follows history hash changes', async () => {
    ready();
    useMapStore.setState({ lens: 'time' });
    window.history.replaceState(null, '', '#/?view=landscape');
    useRouteStore.setState({ route: { name: 'map', sub: null, params: { view: 'landscape' } } });
    render(<MapView {...props} />);
    expect(await screen.findByText('Landscape scene')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, '', '#/?view=sky');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByText('Sky scene')).toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, '', '#/');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });
  it('falls back to Map for an uninstalled view', () => {
    ready();
    useRouteStore.setState({ route: { name: 'map', sub: null, params: { view: 'river' } } });
    render(<MapView {...props} />);
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
  });
});
