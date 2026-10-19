import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import Shell from '../Shell.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useRouteStore, parseHash } from '../routeStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { useViewStore, VIEWS, DEFAULT_VIEW_ID } from '../../store/viewStore.js';
import { api } from '../../lib/api.js';
import type { LayoutResponse, EdgeSummary } from '../../lib/api.js';
import type { ObsData } from '../../lib/plate/contract.js';

/**
 * The plate itself is stubbed. This file asserts what the shell PASSES and
 * when it fetches; what a plate does with a measured box belongs to
 * plates/__tests__/PlateSurface.test.tsx, and what each plate draws is not a
 * jsdom question at all — two of the five want a WebGL context.
 */
vi.mock('../../components/plates/PlateSurface.js', () => ({
  default: (p: { data: ObsData | null; error: string | null; onRetry: () => void }) => (
    <div data-testid="plate" onClick={p.onRetry}>
      {JSON.stringify({
        memories: p.data?.stats.memories ?? null,
        links: p.data?.links.length ?? null,
        error: p.error,
      })}
    </div>
  ),
}));
vi.mock('../../hooks/useWebSocket.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWebSocket.js')>()),
  useWebSocket: () => {},
}));
// Timeline and Insights have their own tests; stub them so this file asserts
// which screen each route mounts rather than what they happen to render.
vi.mock('../../features/timeline/TimelineView.js', () => ({
  default: () => <div data-testid="timeline" />,
}));
vi.mock('../../features/insights/InsightsView.js', () => ({
  default: (p: { tab: string }) => <div data-testid="insights">{p.tab}</div>,
}));
vi.mock('../../lib/api.js', () => ({
  api: {
    listMemories: vi.fn(),
    getContradictions: vi.fn(),
    stats: vi.fn().mockResolvedValue({ total: 0, byType: {}, bySource: {} }),
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.5.0', uptime: 1 }),
    deleteMemory: vi.fn(),
    storeMemory: vi.fn(),
    search: vi.fn(),
    recall: vi.fn(),
    // The plate data layer's three calls. They are `api` methods, so they are
    // stubbed alongside every other call the layout makes — there is no second
    // entry point that could carry a different key or a different timeout.
    getGraphLayout: vi.fn(),
    getGraphEdges: vi.fn(),
    getDecayPolicy: vi.fn(),
    // The memory sheet fetches the selected memory's neighbourhood, and these
    // tests select memories.
    getGraph: vi.fn().mockResolvedValue({ node: null, connections: [], neighbors: [] }),
    // Settings and health reads.
    getSyncStatus: vi.fn().mockResolvedValue({ enabled: false }),
    getEmbeddingStatus: vi.fn().mockRejectedValue(new Error('not stubbed')),
    getIndexStatus: vi.fn().mockRejectedValue(new Error('not stubbed')),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const getGraphLayout = vi.mocked(api.getGraphLayout);
const getGraphEdges = vi.mocked(api.getGraphEdges);
const getDecayPolicy = vi.mocked(api.getDecayPolicy);

function plateProps(): { memories: number | null; links: number | null; error: string | null } {
  return JSON.parse(screen.getByTestId('plate').textContent ?? '{}');
}

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'hello world',
    summary: null,
    importance: 0.9,
    source: null,
    concept: null,
    tags: '[]',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function layoutResponse(ids: string[], overrides: Partial<LayoutResponse> = {}): LayoutResponse {
  return {
    method: 'pca3',
    fingerprint: `m:${ids.length}`,
    generatedAt: '2026-09-04T00:00:00.000Z',
    halfExtent: 42,
    count: ids.length,
    projected: ids.length,
    unprojected: 0,
    explainedVariance: [0.24, 0.09, 0.05],
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    computeMs: 12,
    nodes: ids.map((id, i) => ({
      id,
      type: 'semantic' as const,
      label: `label ${id}`,
      importance: 0.8,
      source: null,
      accessCount: i,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastAccessedAt: null,
      x: i, y: i, z: i,
      projected: true,
    })),
    ...overrides,
  };
}

function edgeResponse(overrides: Partial<EdgeSummary> = {}): EdgeSummary {
  return {
    total: 0,
    stored: 0,
    matching: 0,
    returned: 0,
    truncated: false,
    minStrength: 0,
    limit: 20000,
    edges: [],
    ...overrides,
  };
}

/** Routes the way a link or the rail does. */
function go(to: string) {
  useRouteStore.getState().navigate(to);
}

function resetAll() {
  window.location.hash = '';
  useRouteStore.setState({ route: parseHash('') });
  useMemoryStore.setState({
    records: [], loadedCount: 0, projectFilter: undefined, searchQuery: '', searchResults: [], weakerResults: [], hiddenIds: new Set(),
  });
  useNeuralStore.setState({
    neurons: [], connections: [], contradictionPairs: [], contradictionIds: new Set(),
    selectedNeuronId: null, hoveredNeuronId: null, isConnected: false,
  });
  go('/plates');
  useAuthStore.setState({ locked: false, hadKey: false });
  useViewStore.getState().setView(DEFAULT_VIEW_ID);
  vi.mocked(api.listMemories).mockReset();
  vi.mocked(api.getContradictions).mockReset();
  getGraphLayout.mockReset();
  getGraphEdges.mockReset();
  getDecayPolicy.mockReset();
  vi.mocked(api.getContradictions).mockResolvedValue({ count: 0, contradictions: [] });
  getGraphLayout.mockResolvedValue(layoutResponse(['a']));
  getGraphEdges.mockResolvedValue(edgeResponse());
  getDecayPolicy.mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05 });
}

describe('Shell effect wiring (W12)', () => {
  beforeEach(resetAll);

  it('refetches contradictions, the projection and the edge set when new memories arrive', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getGraphLayout).toHaveBeenCalled());

    const layoutCalls = getGraphLayout.mock.calls.length;
    const edgeCalls = getGraphEdges.mock.calls.length;

    // Simulates a socket 'memory:stored' broadcast adding a new record.
    act(() => {
      useMemoryStore.getState().addRecord(record({ id: 'b' }));
    });

    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getGraphLayout).toHaveBeenCalledTimes(layoutCalls + 1));
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalledTimes(edgeCalls + 1));
  });

  /** The effect used to key on the loaded record count, which went 0 -> N
   *  when the first page landed: every cold load asked for all three twice. */
  it('loads the plate data exactly once on a cold load', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 3,
      memories: [record({ id: 'a' }), record({ id: 'b' }), record({ id: 'c' })],
    });

    render(<Shell />);
    await waitFor(() => expect(useMemoryStore.getState().records).toHaveLength(3));
    await waitFor(() => expect(plateProps().memories).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getGraphLayout).toHaveBeenCalledTimes(1);
    expect(getGraphEdges).toHaveBeenCalledTimes(1);
    expect(getDecayPolicy).toHaveBeenCalledTimes(1);
  });

  it('pages the list with the server offset, without refetching the plate data', async () => {
    vi.mocked(api.stats).mockResolvedValue({ total: 3, byType: { semantic: 3 }, bySource: {} });
    vi.mocked(api.listMemories)
      .mockResolvedValueOnce({ count: 2, memories: [record({ id: 'a' }), record({ id: 'b' })] })
      .mockResolvedValueOnce({ count: 1, memories: [record({ id: 'c' })] });

    render(<Shell />);
    await waitFor(() => expect(plateProps().memories).toBe(1));
    act(() => go('/'));
    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));

    await waitFor(() => expect(useMemoryStore.getState().records.map((r) => r.id)).toEqual(['a', 'b', 'c']));
    expect(api.listMemories).toHaveBeenLastCalledWith({ limit: 200, offset: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getGraphLayout).toHaveBeenCalledTimes(1);
    vi.mocked(api.stats).mockResolvedValue({ total: 0, byType: {}, bySource: {} });
  });

  it('reloads the list for the picked project, and keeps the scope on leaving the map', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalledTimes(1));

    act(() => useMemoryStore.getState().setProjectFilter('/code/api'));
    await waitFor(() => expect(api.listMemories).toHaveBeenCalledTimes(2));
    expect(api.listMemories).toHaveBeenLastCalledWith({ limit: 200, namespace: '/code/api' });

    // The scope is global now: the timeline lists the same project.
    act(() => go('/timeline'));
    await screen.findByTestId('timeline');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useMemoryStore.getState().projectFilter).toBe('/code/api');
    expect(api.listMemories).toHaveBeenCalledTimes(2);
  });

  it('asks the server for a fresh census when a memory arrives instead of waiting for the poll', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(api.getGraphLayout).toHaveBeenCalled());
    const before = vi.mocked(api.stats).mock.calls.length;

    act(() => {
      useMemoryStore.getState().addRecord(record({ id: 'b' }));
    });
    await waitFor(() => expect(vi.mocked(api.stats).mock.calls.length).toBe(before + 1));
  });

  it('asks for the whole edge set once, not one graph request per important memory', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 3,
      memories: [record({ id: 'a' }), record({ id: 'b' }), record({ id: 'c' })],
    });

    render(<Shell />);
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The old implementation fired thirty GET /graph/:id requests here.
    expect(getGraphEdges.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('does not refire the plate fetches on every return to the plate surface when nothing changed', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalled());
    const before = getGraphEdges.mock.calls.length;

    for (let i = 0; i < 5; i++) {
      act(() => go('/timeline'));
      act(() => go('/plates'));
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getGraphEdges.mock.calls.length).toBe(before);
  });

  it('does not refetch contradictions merely because an existing record was edited', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(1));

    act(() => {
      useMemoryStore.getState().updateRecordTags('a', ['new-tag']);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.getContradictions).toHaveBeenCalledTimes(1);
  });
});

describe('Shell plate sourcing', () => {
  beforeEach(resetAll);

  it('builds the node set from the projection, not from the 200-row memory page', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b', 'c', 'd', 'e']));

    render(<Shell />);
    await waitFor(() => expect(useNeuralStore.getState().neurons).toHaveLength(5));
    expect(useMemoryStore.getState().records).toHaveLength(1);
  });

  /** One response set, two consumers: the plate and `neuralStore.neurons`. If
   *  these ever split, the inspector and the plate stop describing the same
   *  store. */
  it('derives the plate data from the same responses that fill the inspector', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b', 'c']));
    getGraphEdges.mockResolvedValue(
      edgeResponse({
        total: 1,
        stored: 4,
        matching: 1,
        returned: 1,
        edges: [{ id: 'e1', sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.95 }],
      })
    );

    render(<Shell />);
    await waitFor(() => expect(plateProps().memories).toBe(3));
    expect(plateProps().links).toBe(1);
    expect(useNeuralStore.getState().neurons).toHaveLength(3);
    expect(useNeuralStore.getState().connections).toHaveLength(1);
  });

  /**
   * The fallback sphere is gone with the scene key that used to confess it. A
   * plate is an argument about this store's real shape, so a failed load says
   * so — it must not read as "the store is empty".
   */
  it('states a failed load on the plate instead of drawing an id-derived sphere', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 2, memories: [record({ id: 'a' }), record({ id: 'b' })] });
    getGraphLayout.mockRejectedValue(new Error('offline'));

    render(<Shell />);
    await waitFor(() => expect(plateProps().error).toBe('offline'));
    expect(plateProps().memories).toBeNull();
    expect(useNeuralStore.getState().neurons).toHaveLength(0);
  });

  /**
   * The dev server renders under StrictMode, which runs every effect, cleans
   * it up, and runs it again. The first run's fetch is discarded by its
   * cleanup; the "already fetched" guard used to be set before the fetch, so
   * the second run skipped and the plates sat on "Reading the store" forever.
   */
  it('loads the plates under StrictMode, where the first effect run is thrown away', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b']));

    render(
      <StrictMode>
        <Shell />
      </StrictMode>
    );

    await waitFor(() => expect(plateProps().memories).toBe(2));
    expect(useNeuralStore.getState().neurons).toHaveLength(2);
  });

  it('retries the load when the plate asks it to', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockRejectedValue(new Error('offline'));

    render(<Shell />);
    await waitFor(() => expect(plateProps().error).toBe('offline'));

    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b']));
    fireEvent.click(screen.getByTestId('plate'));

    await waitFor(() => expect(plateProps().memories).toBe(2));
    expect(plateProps().error).toBeNull();
  });

  /** The whole point of loading the plate data once: five plates, one store. */
  it('switching plates neither refetches nor drops the selection', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b', 'c']));

    render(<Shell />);
    await waitFor(() => expect(plateProps().memories).toBe(3));
    act(() => useNeuralStore.getState().selectNeuron('b'));
    const calls = getGraphLayout.mock.calls.length;

    for (const view of VIEWS) act(() => useViewStore.getState().setView(view.id));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getGraphLayout.mock.calls.length).toBe(calls);
    expect(useNeuralStore.getState().selectedNeuronId).toBe('b');
    expect(plateProps().memories).toBe(3);
  });
});

/**
 * Escape is the host's. Three components used to want it — the search field,
 * the modal, and two plates each with their own window listener — and a plate's
 * listener quietly wiped the reader's selection every time the search field
 * was cleared.
 */
describe('Shell owns Escape', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  function pressEscape(target: EventTarget = window) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it('clears the selection', async () => {
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    act(() => useNeuralStore.getState().selectNeuron('a'));

    pressEscape();
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
  });

  it('leaves the selection alone when Escape came from a text field', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    act(() => useNeuralStore.getState().selectNeuron('a'));

    pressEscape(screen.getByLabelText(/search memories/i));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
  });

  it('leaves the selection alone while a modal is open — that Escape belongs to the modal', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Store a memory' }));
    act(() => useNeuralStore.getState().selectNeuron('a'));

    pressEscape();
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
  });

  it('lets the open memory sheet take its own Escape, which closes it once', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    render(<Shell />);
    await waitFor(() => expect(useMemoryStore.getState().records).toHaveLength(1));
    act(() => useNeuralStore.getState().selectNeuron('a'));

    const sheet = await screen.findByRole('dialog', { name: /semantic memory/i });
    pressEscape(sheet);
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
  });

  it('stands down for anything a nearer component already handled', async () => {
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    act(() => useNeuralStore.getState().selectNeuron('a'));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
  });
});

describe('Shell REST payload validation (W10)', () => {
  beforeEach(resetAll);

  it('drops a malformed row instead of crashing the whole dashboard', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 2,
      memories: [record({ id: 'good' }), { id: 'bad' /* missing content/type */ }],
    });

    render(<Shell />);
    await waitFor(() => expect(useMemoryStore.getState().records).toHaveLength(1));
    expect(useMemoryStore.getState().records[0]?.id).toBe('good');
  });
});

describe('Shell screens', () => {
  beforeEach(resetAll);

  it.each([
    ['timeline', '/timeline', ''],
    ['insights', '/insights', 'numbers'],
    ['insights', '/insights/reflections', 'reflections'],
  ] as const)('mounts the %s screen for %s', async (view, to, tab) => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

    act(() => go(to));
    expect(await screen.findByTestId(view)).toHaveTextContent(tab);
  });
});

describe('Shell store-memory modal integration', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  it('opens the store-memory modal, and closing it removes the dialog', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Store a memory' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Shell unlock gate', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  it('shows UnlockGate over the dashboard when locked', async () => {
    useAuthStore.setState({ locked: true, hadKey: false });
    render(<Shell />);
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
  });
});

describe('Shell on a phone', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '',
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows the plate on a phone', async () => {
    render(<Shell />);
    expect(await screen.findByTestId('plate')).toBeInTheDocument();
  });
});

describe('Shell Home', () => {
  beforeEach(resetAll);

  it('opens on the map: search and the recent memories, not a plate', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    expect(await screen.findByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    expect(screen.queryByTestId('plate')).not.toBeInTheDocument();
  });

  it('opens on the first-run onboarding when the store is empty, once', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });

    render(<Shell />);
    expect(await screen.findByRole('heading', { name: 'Nothing charted yet' })).toBeInTheDocument();
    expect(useRouteStore.getState().route.name).toBe('welcome');

    act(() => go('/'));
    expect(await screen.findByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    expect(useRouteStore.getState().route.name).toBe('map');
  });

  it('does not send a filtered empty list to the onboarding', async () => {
    go('/');
    useMemoryStore.setState({ projectFilter: '/code/api' });
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });

    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    expect(await screen.findByText('No memories in api yet.')).toBeInTheDocument();
    expect(useRouteStore.getState().route.name).toBe('map');
  });
});

describe('Shell routes', () => {
  beforeEach(() => {
    resetAll();
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
  });

  it('takes a search on to Recall with its words, where the exact text opens its memories', async () => {
    vi.mocked(api.search).mockResolvedValue({ count: 0, results: [] });
    vi.mocked(api.recall).mockResolvedValue({
      context: '## Knowledge\n• [aaaaaaaa · 2026-10-19] Sync encryption is optional.',
      memories: [{ id: 'aaaaaaaa-1111' }],
      latencyMs: 4,
    });
    render(<Shell />);
    const input = await screen.findByLabelText(/search memories/i);
    fireEvent.change(input, { target: { value: 'is sync encrypted' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const link = await screen.findByRole('link', { name: 'Ask what my AI would be told' });
    expect(link).toHaveAttribute('href', '#/recall?q=is+sync+encrypted');
    act(() => go(link.getAttribute('href')!));
    expect(useRouteStore.getState().route).toMatchObject({ name: 'recall', params: { q: 'is sync encrypted' } });
    expect(document.title).toBe('Recall — Engram');
    expect(api.recall).toHaveBeenCalledWith('is sync encrypted', 2000);

    fireEvent.click(await screen.findByRole('button', { name: '[aaaaaaaa · 2026-10-19]' }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('aaaaaaaa-1111');
  });

  it('opens Settings and the onboarding from their routes', async () => {
    render(<Shell />);
    act(() => go('/settings'));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    act(() => go('/welcome'));
    expect(await screen.findByRole('heading', { name: 'Connect your AI in 30 seconds' })).toBeInTheDocument();
  });

  it('says what Review will hold, with the contradictions counted so far, and badges the rail', async () => {
    vi.mocked(api.getContradictions).mockResolvedValue({
      count: 2,
      contradictions: [
        { source: { id: 'a' }, target: { id: 'b' }, confidence: 0.9 },
        { source: { id: 'c' }, target: { id: 'd' }, confidence: 0.8 },
      ],
    } as never);
    render(<Shell />);
    act(() => go('/review'));
    expect(await screen.findByText('2 contradictions found so far.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Review\W+2 waiting$/ })).toHaveLength(2);
  });

  it('shows the Insights tabs, and says Insights count every project instead of offering a scope', async () => {
    vi.mocked(api.stats).mockResolvedValue({
      total: 3,
      byType: {},
      bySource: {},
      byNamespace: [{ namespace: null, count: 1 }, { namespace: '/code/api', count: 2 }],
    } as never);
    render(<Shell />);
    expect(await screen.findByRole('button', { name: 'Project: All projects' })).toBeInTheDocument();

    act(() => go('/insights/reflections'));
    expect(screen.getByRole('link', { name: 'Reflections' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Insights count every project.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Project:/ })).not.toBeInTheDocument();
    vi.mocked(api.stats).mockResolvedValue({ total: 0, byType: {}, bySource: {} });
  });
});

describe('Shell memory links (?m=)', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
  });

  it('opens the memory a link names', async () => {
    window.location.hash = '#/?m=a';
    useRouteStore.setState({ route: parseHash('#/?m=a') });
    render(<Shell />);
    await waitFor(() => expect(useNeuralStore.getState().selectedNeuronId).toBe('a'));
  });

  it('writes the selected memory into the link, and Escape takes it out again', async () => {
    go('/');
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

    act(() => useNeuralStore.getState().selectNeuron('a'));
    expect(window.location.hash).toBe('#/?m=a');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
    expect(window.location.hash).toBe('#/');
  });

  it('closes the memory when the reader goes somewhere else', async () => {
    go('/?m=a');
    render(<Shell />);
    await waitFor(() => expect(useNeuralStore.getState().selectedNeuronId).toBe('a'));
    act(() => go('/timeline'));
    await waitFor(() => expect(useNeuralStore.getState().selectedNeuronId).toBeNull());
  });
});

describe('Shell keyboard', () => {
  beforeEach(() => {
    resetAll();
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
  });

  function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });
  }

  it('opens the command palette with Ctrl+K or ⌘K, even from a text field', async () => {
    render(<Shell />);
    await screen.findByRole('heading', { name: 'Recent memories' });

    press('k', { ctrlKey: true }, screen.getByLabelText(/search memories/i));
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();

    press('Escape', {}, screen.getByRole('combobox'));
    expect(screen.queryByRole('dialog', { name: 'Commands' })).not.toBeInTheDocument();

    press('k', { metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();
  });

  it('opens the palette from the bar button', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: /commands/i }));
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();
  });

  it('focuses search with /, going to the map first from a screen without a search field', async () => {
    render(<Shell />);
    await screen.findByRole('heading', { name: 'Recent memories' });
    press('/');
    expect(screen.getByLabelText(/search memories/i)).toHaveFocus();

    act(() => go('/settings'));
    press('/');
    expect(useRouteStore.getState().route.name).toBe('map');
    expect(screen.getByLabelText(/search memories/i)).toHaveFocus();
  });

  it('goes to a destination with g and a letter, but not while typing', async () => {
    render(<Shell />);
    await screen.findByRole('heading', { name: 'Recent memories' });

    press('g');
    press('t');
    expect(useRouteStore.getState().route.name).toBe('timeline');

    act(() => go('/'));
    const field = await screen.findByLabelText(/search memories/i);
    press('g', {}, field);
    press('s', {}, field);
    expect(useRouteStore.getState().route.name).toBe('map');
  });

  it('says the memory was stored, once the dialog has stored it', async () => {
    vi.mocked(api.storeMemory).mockResolvedValue({
      memory: { ...record({ id: 'n', content: 'A new fact.' }) },
    } as never);
    render(<Shell />);
    await screen.findByRole('heading', { name: 'Recent memories' });
    fireEvent.click(screen.getByRole('button', { name: 'Store a memory' }));
    fireEvent.change(screen.getByPlaceholderText(/what do you want to remember/i), { target: { value: 'A new fact.' } });
    fireEvent.click(screen.getByRole('button', { name: /store memory/i }));
    expect(await screen.findByText('Memory stored')).toBeInTheDocument();
  });
});
