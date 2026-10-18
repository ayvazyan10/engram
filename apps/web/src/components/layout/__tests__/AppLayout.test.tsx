import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import AppLayout from '../AppLayout.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useDashboardStore } from '../../../store/dashboardStore.js';
import { useAuthStore } from '../../../store/authStore.js';
import { useViewStore, VIEWS, DEFAULT_VIEW_ID } from '../../../store/viewStore.js';
import { api } from '../../../lib/api.js';
import type { LayoutResponse, EdgeSummary } from '../../../lib/api.js';
import type { ObsData } from '../../../lib/plate/contract.js';

/**
 * The plate itself is stubbed. This file asserts what AppLayout PASSES and
 * when it fetches; what a plate does with a measured box belongs to
 * plates/__tests__/PlateSurface.test.tsx, and what each plate draws is not a
 * jsdom question at all — two of the five want a WebGL context.
 */
vi.mock('../../plates/PlateSurface.js', () => ({
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
vi.mock('../../../hooks/useWebSocket.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useWebSocket.js')>()),
  useWebSocket: () => {},
}));
// The three non-plate views belong to a different change; stub them so this
// file asserts what AppLayout PASSES rather than what they happen to render.
vi.mock('../../views/TimelineView.js', () => ({
  default: (p: ViewProps) => <div data-testid="timeline">{describeProps(p)}</div>,
}));
vi.mock('../../views/AnalyticsView.js', () => ({
  default: (p: ViewProps) => <div data-testid="analytics">{describeProps(p)}</div>,
}));
vi.mock('../../views/ReflectionView.js', () => ({
  default: (p: ViewProps) => <div data-testid="reflections">{describeProps(p)}</div>,
}));
vi.mock('../../../lib/api.js', () => ({
  api: {
    listMemories: vi.fn(),
    getContradictions: vi.fn(),
    stats: vi.fn().mockResolvedValue({ total: 0, byType: {}, bySource: {} }),
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.5.0', uptime: 1 }),
    deleteMemory: vi.fn(),
    // The plate data layer's three calls. They are `api` methods, so they are
    // stubbed alongside every other call the layout makes — there is no second
    // entry point that could carry a different key or a different timeout.
    getGraphLayout: vi.fn(),
    getGraphEdges: vi.fn(),
    getDecayPolicy: vi.fn(),
    // NeuronInspector fetches the selected memory's neighbourhood, and these
    // tests select memories.
    getGraph: vi.fn().mockResolvedValue({ node: null, connections: [], neighbors: [] }),
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

interface ViewProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function describeProps(p: ViewProps): string {
  return JSON.stringify({
    loading: p.loading,
    error: p.error,
    onRetry: typeof p.onRetry,
  });
}

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

function resetAll() {
  useMemoryStore.setState({ records: [], loadedCount: 0 });
  useNeuralStore.setState({
    neurons: [], connections: [], contradictionPairs: [], contradictionIds: new Set(),
    selectedNeuronId: null, hoveredNeuronId: null, isConnected: false,
  });
  useDashboardStore.setState({ viewMode: '3d' });
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

describe('AppLayout effect wiring (W12)', () => {
  beforeEach(resetAll);

  it('refetches contradictions, the projection and the edge set when new memories arrive', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<AppLayout />);
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

    render(<AppLayout />);
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

    render(<AppLayout />);
    fireEvent.click(await screen.findByRole('button', { name: /load more/i }));

    await waitFor(() => expect(useMemoryStore.getState().records.map((r) => r.id)).toEqual(['a', 'b', 'c']));
    expect(api.listMemories).toHaveBeenLastCalledWith({ limit: 200, offset: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getGraphLayout).toHaveBeenCalledTimes(1);
    vi.mocked(api.stats).mockResolvedValue({ total: 0, byType: {}, bySource: {} });
  });

  it('asks the server for a fresh census when a memory arrives instead of waiting for the poll', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<AppLayout />);
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

    render(<AppLayout />);
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The old implementation fired thirty GET /graph/:id requests here.
    expect(getGraphEdges.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('does not refire the plate fetches on every return to the plate surface when nothing changed', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<AppLayout />);
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalled());
    const before = getGraphEdges.mock.calls.length;

    for (let i = 0; i < 5; i++) {
      act(() => useDashboardStore.getState().setViewMode('timeline'));
      act(() => useDashboardStore.getState().setViewMode('3d'));
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getGraphEdges.mock.calls.length).toBe(before);
  });

  it('does not refetch contradictions merely because an existing record was edited', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<AppLayout />);
    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(1));

    act(() => {
      useMemoryStore.getState().updateRecordTags('a', ['new-tag']);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.getContradictions).toHaveBeenCalledTimes(1);
  });
});

describe('AppLayout plate sourcing', () => {
  beforeEach(resetAll);

  it('builds the node set from the projection, not from the 200-row memory page', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b', 'c', 'd', 'e']));

    render(<AppLayout />);
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

    render(<AppLayout />);
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

    render(<AppLayout />);
    await waitFor(() => expect(plateProps().error).toBe('offline'));
    expect(plateProps().memories).toBeNull();
    expect(useNeuralStore.getState().neurons).toHaveLength(0);
  });

  it('retries the load when the plate asks it to', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockRejectedValue(new Error('offline'));

    render(<AppLayout />);
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

    render(<AppLayout />);
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
describe('AppLayout owns Escape', () => {
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
    render(<AppLayout />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    act(() => useNeuralStore.getState().selectNeuron('a'));

    pressEscape();
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
  });

  it('leaves the selection alone when Escape came from a text field', async () => {
    render(<AppLayout />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    act(() => useNeuralStore.getState().selectNeuron('a'));

    pressEscape(screen.getByLabelText(/search memories/i));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
  });

  it('leaves the selection alone while a modal is open — that Escape belongs to the modal', async () => {
    render(<AppLayout />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle(/store new memory/i));
    act(() => useNeuralStore.getState().selectNeuron('a'));

    pressEscape();
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
  });

  it('closes only the archive confirmation, keeping the memory it was confirming selected', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    render(<AppLayout />);
    await waitFor(() => expect(useMemoryStore.getState().records).toHaveLength(1));
    act(() => useNeuralStore.getState().selectNeuron('a'));

    fireEvent.click(await screen.findByRole('button', { name: /archive memory/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    pressEscape(document);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
  });

  it('stands down for anything a nearer component already handled', async () => {
    render(<AppLayout />);
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

describe('AppLayout REST payload validation (W10)', () => {
  beforeEach(resetAll);

  it('drops a malformed row instead of crashing the whole dashboard', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 2,
      memories: [record({ id: 'good' }), { id: 'bad' /* missing content/type */ }],
    });

    render(<AppLayout />);
    await waitFor(() => expect(useMemoryStore.getState().records).toHaveLength(1));
    expect(useMemoryStore.getState().records[0]?.id).toBe('good');
  });
});

describe('AppLayout data-view props (coordination point)', () => {
  beforeEach(resetAll);

  it.each(['timeline', 'analytics', 'reflections'] as const)(
    'threads loading / error / onRetry into the %s view',
    async (mode) => {
      vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
      render(<AppLayout />);
      await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

      act(() => useDashboardStore.getState().setViewMode(mode));
      const node = await screen.findByTestId(mode);
      expect(JSON.parse(node.textContent ?? '{}')).toEqual({
        loading: false,
        error: null,
        onRetry: 'function',
      });
    }
  );
});

describe('AppLayout store-memory modal integration', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  it('opens the store-memory modal, and closing it removes the dialog', async () => {
    render(<AppLayout />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle(/store new memory/i));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AppLayout version badge', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  it("shows the running server's version, not the web package's", async () => {
    render(<AppLayout />);
    expect(await screen.findByText('v0.5.0')).toBeInTheDocument();
  });

  it('shows no version at all until the server has said which one it is', async () => {
    vi.mocked(api.health).mockRejectedValueOnce(new Error('offline'));
    const { container } = render(<AppLayout />);
    await waitFor(() => expect(api.health).toHaveBeenCalled());
    expect(container.querySelector('.ec-logo-badge')).toBeNull();
  });
});

describe('AppLayout unlock gate', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  it('shows UnlockGate over the dashboard when locked', async () => {
    useAuthStore.setState({ locked: true, hadKey: false });
    render(<AppLayout />);
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
  });
});

describe('AppLayout compact (mobile) layout', () => {
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

  it('renders the mobile tab bar and switches panes instead of the 3-column desktop layout', async () => {
    render(<AppLayout />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

    expect(screen.getByRole('navigation', { name: /panel switcher/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /memories/i }));
    fireEvent.click(screen.getByRole('button', { name: /inspect/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Plate' }));
  });

  it('gives the compact pane the same plate the desktop layout shows', async () => {
    render(<AppLayout />);
    await waitFor(() => expect(screen.getByTestId('plate')).toBeInTheDocument());
  });
});

describe('AppLayout Home', () => {
  beforeEach(resetAll);

  it('opens on Home: search and the recent memories, not a plate', async () => {
    useDashboardStore.setState(useDashboardStore.getInitialState());
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<AppLayout />);
    expect(await screen.findByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    expect(screen.queryByTestId('plate')).not.toBeInTheDocument();
  });

  it('opens on the first-run onboarding when the store is empty', async () => {
    useDashboardStore.setState(useDashboardStore.getInitialState());
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 0, memories: [] });

    render(<AppLayout />);
    expect(await screen.findByRole('heading', { name: 'Connect your AI in 30 seconds' })).toBeInTheDocument();
  });
});
