import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MapSheet, { foldStreams, streamOf } from '../MapSheet.js';
import SearchBar, { searchWithFallback } from '../SearchBar.js';
import { highlight } from '../../memory/MemoryRow.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { resetServerStats } from '../../../lib/serverStats.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
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

let seq = 0;
function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  seq += 1;
  return {
    id: `m${seq}`,
    type: 'semantic',
    content: `A memory, number ${seq}.`,
    summary: null,
    importance: 0.5,
    source: 'claude-code',
    concept: null,
    tags: '[]',
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...overrides,
  };
}

const mc = (status: string, overrides: Partial<MemoryRecord> = {}) =>
  memory({ type: 'episodic', source: 'mission-control', content: `[Mission Control] ${status} — task "x" finished.`, ...overrides });
const reflection = (kind: string) => memory({ source: 'reflection', content: '# Trend Analysis', tags: `["reflection","reflection:${kind}"]` });

const props = { loading: false, error: null, onRetry: vi.fn(), onLoadMore: vi.fn(), loadingMore: false, onStore: vi.fn(), onRegion: vi.fn() };

beforeEach(() => {
  seq = 0;
  resetServerStats();
  vi.mocked(api.stats).mockReset().mockResolvedValue({ total: 2, byType: {}, bySource: {} });
  vi.mocked(api.search).mockReset();
  useNeuralStore.setState({ selectedNeuronId: null });
  useMemoryStore.setState({
    records: [],
    searchResults: [],
    weakerResults: [],
    searchQuery: '',
    isSearching: false,
    projectFilter: undefined,
    hiddenIds: new Set(),
    highlightedIds: new Set(),
  });
});

describe('foldStreams', () => {
  it('folds a run of three or more Mission Control reports into one line, counting by status', () => {
    const people = memory();
    const items = foldStreams([people, mc('DONE'), mc('DONE'), mc('BLOCKED'), mc('REVIEW'), memory()]);
    expect(items.map((i) => i.kind)).toEqual(['memory', 'stream', 'memory']);
    const stream = items[1]!;
    if (stream.kind !== 'stream') throw new Error('expected a stream');
    expect(stream.title).toBe('Mission Control reported 4 tasks');
    expect(stream.detail).toMatch(/^2 done, 1 blocked, 1 in review, /);
    expect(stream.records).toHaveLength(4);
  });

  it('leaves runs shorter than three alone', () => {
    const items = foldStreams([mc('DONE'), mc('DONE'), memory(), mc('DONE')]);
    expect(items.every((i) => i.kind === 'memory')).toBe(true);
  });

  it('knows a Mission Control report by its text when another source wrote it', () => {
    expect(streamOf({ source: 'consolidation', content: '[Mission Control] DONE — task' })).toBe('mission-control');
    expect(streamOf({ source: 'consolidation', content: 'Claude Code session summary' })).toBeNull();
  });

  it('folds reflection bursts by kind and task outcomes by result', () => {
    const items = foldStreams([
      reflection('pattern'),
      reflection('trend'),
      reflection('trend'),
      memory(),
      memory({ source: 'autopilot-learning', content: "Task outcome: 'a'. Success: True." }),
      memory({ source: 'autopilot-learning', content: "Task outcome: 'b'. Success: False." }),
      memory({ source: 'autopilot-learning', content: "Task outcome: 'c'. Success: False." }),
    ]);
    const streams = items.filter((i) => i.kind === 'stream');
    expect(streams.map((s) => s.title)).toEqual(['The reflection engine wrote 3 reports', '3 task outcomes']);
    expect(streams[0]!.detail).toMatch(/^1 pattern, 2 trends, /);
    expect(streams[1]!.detail).toMatch(/^1 succeeded, 2 failed, /);
  });

  it('does not join two different streams that touch', () => {
    const items = foldStreams([mc('DONE'), mc('DONE'), mc('DONE'), reflection('trend'), reflection('trend'), reflection('trend')]);
    expect(items.map((i) => i.kind)).toEqual(['stream', 'stream']);
  });
});

describe('highlight', () => {
  function marks(text: string, query: string): string[] {
    const { container } = render(<p>{highlight(text, query)}</p>);
    return [...container.querySelectorAll('mark')].map((m) => m.textContent ?? '');
  }

  it('marks the typed words where a word starts, skipping short and common ones', () => {
    expect(marks('How do I deploy the server on Windows', 'how do I deploy the server')).toEqual(['deploy', 'server']);
    expect(marks('Cloud sync and SyncEngine', 'sync')).toEqual(['sync', 'Sync']);
  });
});

describe('MapSheet: Recent', () => {
  it('lists recent memories with streams folded, and opens a folded line', () => {
    useMemoryStore.setState({ records: [memory({ content: 'Owner asked for a redesign.' }), mc('DONE'), mc('DONE'), mc('DONE')] });
    render(<MapSheet {...props} />);
    expect(screen.getByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    const fold = screen.getByRole('button', { name: /Mission Control reported 3 tasks/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('button', { name: /\[Mission Control\]/ })).toHaveLength(0);
    fireEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /\[Mission Control\]/ })).toHaveLength(3);
  });

  it('opens a memory from its row, and marks the open one', () => {
    useMemoryStore.setState({ records: [memory({ content: 'First.' }), memory({ content: 'Second.' })] });
    render(<MapSheet {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Second\./ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('m2');
    expect(screen.getByRole('button', { name: /Second\./ })).toHaveAttribute('aria-current', 'true');
  });

  it('leaves out a memory waiting out its archive undo', () => {
    useMemoryStore.setState({ records: [memory({ content: 'Kept.' }), memory({ content: 'Going.' })], hiddenIds: new Set(['m2']) });
    render(<MapSheet {...props} />);
    expect(screen.queryByRole('button', { name: /Going\./ })).not.toBeInTheDocument();
  });

  it('steps through rows with j and k', () => {
    useMemoryStore.setState({ records: [memory({ content: 'One.' }), memory({ content: 'Two.' }), memory({ content: 'Three.' })] });
    render(<MapSheet {...props} />);
    const one = screen.getByRole('button', { name: /One\./ });
    one.focus();
    fireEvent.keyDown(one, { key: 'j' });
    expect(screen.getByRole('button', { name: /Two\./ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Three\./ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'k' });
    expect(screen.getByRole('button', { name: /Two\./ })).toHaveFocus();
  });

  it('says how many are shown of the store, and loads older ones on request', async () => {
    vi.mocked(api.stats).mockResolvedValue({ total: 5, byType: {}, bySource: {} });
    useMemoryStore.setState({ records: [memory(), memory()] });
    const onLoadMore = vi.fn();
    render(<MapSheet {...props} onLoadMore={onLoadMore} />);
    expect(await screen.findByText('Showing 2 of 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('states a failed load with a way to try again', () => {
    const onRetry = vi.fn();
    render(<MapSheet {...props} error="offline" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your memories: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('offers Store a memory', () => {
    const onStore = vi.fn();
    render(<MapSheet {...props} onStore={onStore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Store a memory' }));
    expect(onStore).toHaveBeenCalled();
  });
});

describe('MapSheet: Results', () => {
  it('lists the matches with the words marked, then the way to Recall', () => {
    useMemoryStore.setState({
      searchQuery: 'sync',
      searchResults: [memory({ content: 'Cloud sync is on.' }), memory({ content: 'Sync conflicts resolve by time.' })],
    });
    render(<MapSheet {...props} />);
    expect(screen.getByRole('heading', { name: '2 memories match “sync”' })).toBeInTheDocument();
    expect(screen.queryByText('Weaker matches')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask what my AI would be told' })).toHaveAttribute('href', '#/recall?q=sync');
  });

  it('labels the weaker matches apart from the close ones', () => {
    useMemoryStore.setState({
      searchQuery: 'how do I deploy',
      searchResults: [memory({ content: 'Deploy with the release workflow.' })],
      weakerResults: [memory({ content: 'Servers run under pm2.' })],
    });
    render(<MapSheet {...props} />);
    expect(screen.getByRole('heading', { name: '1 memory matches “how do I deploy”' })).toBeInTheDocument();
    const weak = screen.getByRole('heading', { name: 'Weaker matches' });
    expect(within(weak.parentElement!).getByText(/Only 1 matched closely/)).toBeInTheDocument();
    const close = screen.getByRole('button', { name: /Deploy with/ });
    const looser = screen.getByRole('button', { name: /Servers run/ });
    expect(close.compareDocumentPosition(weak) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(weak.compareDocumentPosition(looser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('with nothing at all, explains, offers Recall first and a wider search when scoped', () => {
    useMemoryStore.setState({ searchQuery: 'kubernetes', projectFilter: '/code/api' });
    render(<MapSheet {...props} />);
    expect(screen.getByRole('heading', { name: 'Nothing matches “kubernetes”' })).toBeInTheDocument();
    expect(screen.getByText(/may still know something about this/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search all projects' }));
    expect(useMemoryStore.getState().projectFilter).toBeUndefined();
  });
});

describe('searchWithFallback (weaker matches)', () => {
  it('does not ask twice when the first search finds three or more', async () => {
    vi.mocked(api.search).mockResolvedValue({ count: 3, results: [memory(), memory(), memory()] });
    const res = await searchWithFallback('sync', undefined);
    expect(res.strong).toHaveLength(3);
    expect(res.weaker).toEqual([]);
    expect(api.search).toHaveBeenCalledTimes(1);
  });

  it('asks once more at a lower threshold when it finds fewer, keeping only the new hits', async () => {
    const hit = memory();
    const loose = memory();
    vi.mocked(api.search)
      .mockResolvedValueOnce({ count: 1, results: [hit] })
      .mockResolvedValueOnce({ count: 2, results: [hit, loose] });
    const res = await searchWithFallback('how do I deploy the server', '/code/api');
    expect(api.search).toHaveBeenNthCalledWith(1, 'how do I deploy the server', 20, undefined, '/code/api');
    expect(api.search).toHaveBeenNthCalledWith(2, 'how do I deploy the server', 10, undefined, '/code/api', 0.15);
    expect(res.strong.map((r) => r.id)).toEqual([hit.id]);
    expect(res.weaker.map((r) => r.id)).toEqual([loose.id]);
  });
});

describe('SearchBar with the sheet', () => {
  function renderBoth() {
    return render(
      <>
        <SearchBar onCommands={vi.fn()} />
        <MapSheet {...props} />
      </>
    );
  }

  it('searches on Enter and shows the weaker matches under their label', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({ count: 0, results: [] })
      .mockResolvedValueOnce({ count: 1, results: [memory({ content: 'Deploy notes.' })] });
    renderBoth();
    const input = screen.getByLabelText('Search memories');
    fireEvent.change(input, { target: { value: 'how do I deploy' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'No close matches for “how do I deploy”' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weaker matches' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing matched closely/)).toBeInTheDocument();
  });

  it('searches by itself after a pause in typing, and Escape goes back to Recent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.search).mockResolvedValue({ count: 3, results: [memory(), memory(), memory()] });
    renderBoth();
    const input = screen.getByLabelText('Search memories');
    fireEvent.change(input, { target: { value: 'sync' } });
    expect(api.search).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(await screen.findByRole('heading', { name: '3 memories match “sync”' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Recent memories' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    vi.useRealTimers();
  });

  it('drops a reply that a newer search overtook', async () => {
    let first!: (v: { count: number; results: unknown[] }) => void;
    vi.mocked(api.search)
      .mockReturnValueOnce(new Promise((r) => (first = r)))
      .mockResolvedValueOnce({ count: 3, results: [memory({ content: 'New A.' }), memory(), memory()] });
    renderBoth();
    const input = screen.getByLabelText('Search memories');
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: '3 memories match “new”' })).toBeInTheDocument();
    await act(async () => first({ count: 3, results: [memory(), memory(), memory()] }));
    expect(useMemoryStore.getState().searchQuery).toBe('new');
  });

  it('runs the search again for a new project scope', async () => {
    vi.mocked(api.search).mockResolvedValue({ count: 3, results: [memory(), memory(), memory()] });
    renderBoth();
    const input = screen.getByLabelText('Search memories');
    fireEvent.change(input, { target: { value: 'sync' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('heading', { name: '3 memories match “sync”' });
    act(() => useMemoryStore.getState().setProjectFilter('/code/api'));
    await waitFor(() => expect(api.search).toHaveBeenLastCalledWith('sync', 20, undefined, '/code/api'));
  });

  it('says when the server cannot be reached', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    vi.mocked(api.search).mockRejectedValue(new ApiError(0, 'Failed to fetch: /search'));
    renderBoth();
    const input = screen.getByLabelText('Search memories');
    fireEvent.change(input, { target: { value: 'sync' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Search failed. Is the Engram server running?');
  });
});
