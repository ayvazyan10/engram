import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import Shell from '../Shell.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useRouteStore, parseHash } from '../routeStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { useMapStore } from '../../features/map/mapStore.js';
import { payload } from '../../features/map/__tests__/payload.js';
import { api } from '../../lib/api.js';

/** The map's canvas draws only, and jsdom cannot draw; the map's own tests
 *  cover what it is handed. */
vi.mock('../../features/map/MapCanvas.js', () => ({ default: () => <canvas data-testid="map-canvas" /> }));
vi.mock('../../hooks/useWebSocket.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWebSocket.js')>()),
  useWebSocket: () => {},
}));
// The views F6 replaces belong to a different change; stub them so this
// file asserts what the shell PASSES rather than what they happen to render.
vi.mock('../../components/views/TimelineView.js', () => ({
  default: (p: ViewProps) => <div data-testid="timeline">{describeProps(p)}</div>,
}));
vi.mock('../../components/views/AnalyticsView.js', () => ({
  default: (p: ViewProps) => <div data-testid="analytics">{describeProps(p)}</div>,
}));
vi.mock('../../components/views/ReflectionView.js', () => ({
  default: (p: ViewProps) => <div data-testid="reflections">{describeProps(p)}</div>,
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
    getMap: vi.fn(),
    getGraphEdges: vi.fn(),
    getDecayPolicy: vi.fn(),
    // The memory sheet fetches the selected memory's neighbourhood, and these
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

const getMap = vi.mocked(api.getMap);
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
  useNeuralStore.setState({ contradictionPairs: [], selectedNeuronId: null, isConnected: false });
  useMapStore.setState({ status: 'loading', payload: null, model: null, scopeKey: null, arrivals: new Map(), regionId: null, panel: 'recent' });
  go('/');
  useAuthStore.setState({ locked: false, hadKey: false });
  vi.mocked(api.listMemories).mockReset();
  vi.mocked(api.getContradictions).mockReset();
  getMap.mockReset();
  getDecayPolicy.mockReset();
  vi.mocked(api.getContradictions).mockResolvedValue({ count: 0, contradictions: [] });
  getMap.mockResolvedValue(payload());
  getDecayPolicy.mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05 });
}

describe('Shell effect wiring (W12)', () => {
  beforeEach(resetAll);

  it('refetches contradictions and the map when a memory arrives, so it lands on the map', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getMap).toHaveBeenCalledTimes(1));

    // Simulates a socket 'memory:stored' broadcast adding a new record.
    act(() => {
      useMemoryStore.getState().addRecord(record({ id: 'b' }));
    });

    await waitFor(() => expect(api.getContradictions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));
  });

  it('loads the map once on a cold load, and not again when the list pages', async () => {
    vi.mocked(api.stats).mockResolvedValue({ total: 3, byType: { semantic: 3 }, bySource: {} });
    vi.mocked(api.listMemories)
      .mockResolvedValueOnce({ count: 2, memories: [record({ id: 'a' }), record({ id: 'b' })] })
      .mockResolvedValueOnce({ count: 1, memories: [record({ id: 'c' })] });

    render(<Shell />);
    expect(await screen.findByRole('application', { name: 'Memory map, 5 memories in 2 regions' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));

    await waitFor(() => expect(useMemoryStore.getState().records.map((r) => r.id)).toEqual(['a', 'b', 'c']));
    expect(api.listMemories).toHaveBeenLastCalledWith({ limit: 200, offset: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getMap).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('/code/api'));

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
    await waitFor(() => expect(getMap).toHaveBeenCalled());
    const before = vi.mocked(api.stats).mock.calls.length;

    act(() => {
      useMemoryStore.getState().addRecord(record({ id: 'b' }));
    });
    await waitFor(() => expect(vi.mocked(api.stats).mock.calls.length).toBe(before + 1));
  });

  it('does not reload the map on every return to it when nothing changed', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    await waitFor(() => expect(getMap).toHaveBeenCalled());

    for (let i = 0; i < 5; i++) {
      act(() => go('/timeline'));
      act(() => go('/'));
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getMap).toHaveBeenCalledTimes(1);
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

describe('Shell map loading', () => {
  beforeEach(resetAll);

  it('says a failed map on the map, and charts it again on Try again', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });
    getMap.mockRejectedValueOnce(new Error('offline'));

    render(<Shell />);
    expect(await screen.findByText('Could not chart the map: offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('application', { name: /Memory map/ })).toBeInTheDocument();
  });

  /** StrictMode runs every effect twice; the second load supersedes the first. */
  it('loads the map under StrictMode', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: [record({ id: 'a' })] });

    render(
      <StrictMode>
        <Shell />
      </StrictMode>
    );

    expect(await screen.findByRole('application', { name: 'Memory map, 5 memories in 2 regions' })).toBeInTheDocument();
  });
});

/**
 * Escape is the host's. Several components used to want it — the search
 * field, the modal, and the old plates with their own window listeners — and
 * one of those listeners quietly wiped the reader's selection every time the
 * search field was cleared.
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

describe('Shell data-view props (coordination point)', () => {
  beforeEach(resetAll);

  it.each([
    ['timeline', '/timeline'],
    ['analytics', '/insights'],
    ['reflections', '/insights/reflections'],
  ] as const)('threads loading / error / onRetry into the %s view', async (view, to) => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
    render(<Shell />);
    await waitFor(() => expect(api.listMemories).toHaveBeenCalled());

    act(() => go(to));
    const node = await screen.findByTestId(view);
    expect(JSON.parse(node.textContent ?? '{}')).toEqual({
      loading: false,
      error: null,
      onRetry: 'function',
    });
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

  it('shows the map on a phone, above its bottom sheet', async () => {
    render(<Shell />);
    expect(await screen.findByRole('application', { name: /Memory map/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise or lower the list' })).toBeInTheDocument();
  });
});

describe('Shell Home', () => {
  beforeEach(resetAll);

  it('opens on the map: search, the map and the recent memories', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 1, memories: [record({ id: 'a' })] });

    render(<Shell />);
    expect(await screen.findByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    expect(await screen.findByTestId('map-canvas')).toBeInTheDocument();
  });

  it('opens on the first-run onboarding when the store is empty, once', async () => {
    go('/');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });

    render(<Shell />);
    expect(await screen.findByRole('heading', { name: 'Connect your AI in 30 seconds' })).toBeInTheDocument();
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
