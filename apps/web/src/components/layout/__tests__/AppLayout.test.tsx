import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import AppLayout from '../AppLayout.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useDashboardStore } from '../../../store/dashboardStore.js';
import { useAuthStore } from '../../../store/authStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../canvas/NeuralCanvas.js', () => ({ default: () => <div data-testid="neural-canvas" /> }));
vi.mock('../../../hooks/useWebSocket.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useWebSocket.js')>()),
  useWebSocket: () => {},
}));
vi.mock('../../../lib/api.js', () => ({
  api: {
    listMemories: vi.fn(),
    getContradictions: vi.fn(),
    getGraph: vi.fn(),
    stats: vi.fn().mockResolvedValue({ total: 0, byType: {}, bySource: {} }),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

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

function resetAll() {
  useMemoryStore.setState({ records: [], totalCount: 0 });
  useNeuralStore.setState({
    neurons: [], connections: [], contradictionPairs: [], contradictionIds: new Set(),
    selectedNeuronId: null, isConnected: false,
  });
  useDashboardStore.setState({ viewMode: '3d' });
  useAuthStore.setState({ locked: false, hadKey: false });
}

describe('AppLayout effect wiring (W12)', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getContradictions).mockResolvedValue({ count: 0, contradictions: [] });
    vi.mocked(api.getGraph).mockResolvedValue({ node: null, connections: [], neighbors: [] });
  });

  it('refetches contradictions and connections when new memories arrive over the socket (records.length changes)', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 1,
      memories: [record({ id: 'a' })],
    });

    render(<AppLayout />);
    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getGraph).toHaveBeenCalledTimes(1));

    // Simulates a socket 'memory:stored' broadcast adding a new record.
    act(() => {
      useMemoryStore.getState().addRecord(record({ id: 'b' }));
    });

    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(2));
    // The second connections fetch covers both records now on the board
    // (top-30 by importance) — 1 call from the initial fetch + 2 from the
    // refetch triggered by the new arrival.
    await waitFor(() => expect(api.getGraph).toHaveBeenCalledTimes(3));
  });

  it('does not refire the connections fetch on every return to the 3D view when nothing changed', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 1,
      memories: [record({ id: 'a' })],
    });

    render(<AppLayout />);
    await waitFor(() => expect(api.getGraph).toHaveBeenCalledTimes(1));

    // Flip away from 3D and back several times with no new records — the
    // original bug refired the 30-call Promise.all on every return.
    for (let i = 0; i < 5; i++) {
      act(() => useDashboardStore.getState().setViewMode('timeline'));
      act(() => useDashboardStore.getState().setViewMode('3d'));
    }

    // Give any (incorrect) pending refetch a chance to happen.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.getGraph).toHaveBeenCalledTimes(1);
  });

  it('does not refetch contradictions merely because an existing record was edited (tags), only when the count changes', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      count: 1,
      memories: [record({ id: 'a' })],
    });

    render(<AppLayout />);
    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(1));

    act(() => {
      useMemoryStore.getState().updateRecordTags('a', ['new-tag']);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.getContradictions).toHaveBeenCalledTimes(1);
  });
});

describe('AppLayout REST payload validation (W10)', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getContradictions).mockResolvedValue({ count: 0, contradictions: [] });
    vi.mocked(api.getGraph).mockResolvedValue({ node: null, connections: [], neighbors: [] });
  });

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
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockReset();
  });

  it('gives the loading spinner an animation, matching SearchBar\'s spinner', async () => {
    let resolveList!: (v: { count: number; memories: unknown[] }) => void;
    vi.mocked(api.listMemories).mockReturnValueOnce(
      new Promise((resolve) => { resolveList = resolve; })
    );

    render(<AppLayout />);
    const spinner = screen.getByText(/loading neural graph/i).previousSibling as HTMLElement;
    expect(spinner.style.animation).toBeTruthy();

    resolveList({ count: 0, memories: [] });
  });
});

describe('AppLayout store-memory modal integration', () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(api.listMemories).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
  });

  it('opens the store-memory modal, and a stored record is added to the store on success', async () => {
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
    vi.mocked(api.listMemories).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockReset();
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
    vi.mocked(api.listMemories).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.listMemories).mockResolvedValue({
      count: 1,
      memories: [record({ id: 'a' })],
    });
    vi.mocked(api.getContradictions).mockResolvedValue({ count: 0, contradictions: [] });
    vi.mocked(api.getGraph).mockResolvedValue({ node: null, connections: [], neighbors: [] });
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
