import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import AppLayout from '../AppLayout.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useDashboardStore } from '../../../store/dashboardStore.js';
import { useAuthStore } from '../../../store/authStore.js';
import { api } from '../../../lib/api.js';
import type { LayoutResponse, EdgeSummary } from '../../../lib/api.js';

vi.mock('../../canvas/NeuralCanvas.js', () => ({ default: () => <div data-testid="neural-canvas" /> }));
vi.mock('../../../hooks/useWebSocket.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useWebSocket.js')>()),
  useWebSocket: () => {},
}));
// The three non-3D views belong to a different change; stub them so this file
// asserts what AppLayout PASSES rather than what they happen to render.
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
    // The scene's two fetches had their own copy of the request helper in a
    // canvas-local module, and were mocked as a separate module here. They are
    // `api` methods now, so they are stubbed alongside every other call the
    // layout makes.
    getGraphLayout: vi.fn(),
    getGraphEdges: vi.fn(),
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
  vi.mocked(api.listMemories).mockReset();
  vi.mocked(api.getContradictions).mockReset();
  getGraphLayout.mockReset();
  getGraphEdges.mockReset();
  vi.mocked(api.getContradictions).mockResolvedValue({ count: 0, contradictions: [] });
  getGraphLayout.mockResolvedValue(layoutResponse(['a']));
  getGraphEdges.mockResolvedValue(edgeResponse());
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

  it('does not refire the scene fetches on every return to the 3D view when nothing changed', async () => {
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

describe('AppLayout scene sourcing', () => {
  beforeEach(resetAll);

  it('builds the node set from the projection, not from the 200-row memory page', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b', 'c', 'd', 'e']));

    render(<AppLayout />);
    await waitFor(() => expect(useNeuralStore.getState().neurons).toHaveLength(5));
    expect(useMemoryStore.getState().records).toHaveLength(1);
  });

  it('states what it is showing and what it is not', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(layoutResponse(['a', 'b', 'c']));
    getGraphEdges.mockResolvedValue(
      edgeResponse({ total: 3102, stored: 8495, matching: 3102, returned: 3102 })
    );

    render(<AppLayout />);
    await waitFor(() => expect(screen.getAllByText(/3 nodes/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/3,102 of 3,102 edges/).length).toBeGreaterThan(0);
    // 8,495 - 3,102 connections point at archived memories and must be owned up to.
    expect(screen.getByText(/5,393 more connections/)).toBeInTheDocument();
  });

  it('says so when the projection is unavailable instead of pretending the sphere means something', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 2, memories: [record({ id: 'a' }), record({ id: 'b' })] });
    getGraphLayout.mockRejectedValue(new Error('offline'));

    render(<AppLayout />);
    await waitFor(() => expect(screen.getByText(/positions unavailable/i)).toBeInTheDocument());
    // …and the scene still renders, from an id-derived fallback.
    expect(useNeuralStore.getState().neurons).toHaveLength(2);
  });

  it('passes the server\'s own "fallback" verdict through to the key', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getGraphLayout.mockResolvedValue(
      layoutResponse(['a'], { method: 'fallback', projected: 0, unprojected: 1 })
    );

    render(<AppLayout />);
    await waitFor(() => expect(screen.getByText(/too few embedded memories/i)).toBeInTheDocument());
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

describe('AppLayout loading spinner animates (W13)', () => {
  beforeEach(resetAll);

  it("gives the loading spinner an animation, matching SearchBar's spinner", async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
    // The spinner now covers the projection fetch too — an empty canvas while
    // /api/graph/layout is in flight looked identical to an empty store.
    let resolveLayout!: (v: LayoutResponse) => void;
    getGraphLayout.mockReturnValueOnce(new Promise((resolve) => { resolveLayout = resolve; }));

    render(<AppLayout />);
    const spinner = screen.getByText(/loading neural graph/i).previousSibling as HTMLElement;
    expect(spinner.style.animation).toBeTruthy();

    resolveLayout(layoutResponse([]));
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
    fireEvent.click(screen.getByRole('button', { name: /graph/i }));
  });
});
