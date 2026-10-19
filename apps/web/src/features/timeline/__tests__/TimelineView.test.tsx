import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TimelineView, { dayLabel, endOfPickedDay, groupByDay, PAGE_SIZE } from '../TimelineView.js';
import { foldStreams } from '../../map/MapSheet.js';
import { api } from '../../../lib/api.js';
import { resetServerStats } from '../../../lib/serverStats.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useRouteStore } from '../../../shell/routeStore.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    listMemories: vi.fn(),
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

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm1',
    type: 'semantic',
    content: 'Sync encryption is optional',
    summary: null,
    importance: 0.5,
    source: 'claude-code',
    concept: null,
    tags: '[]',
    createdAt: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

/** `n` memories a minute apart, newest first, ending at `newest`. */
function page(n: number, newest = Date.parse('2026-10-19T12:00:00.000Z'), prefix = 'p'): MemoryRecord[] {
  return Array.from({ length: n }, (_, i) =>
    record({ id: `${prefix}${i}`, content: `memory ${prefix}${i}`, createdAt: new Date(newest - i * 60_000).toISOString() })
  );
}

function go(hash: string) {
  window.history.replaceState(null, '', hash);
  useRouteStore.setState({ route: { name: 'timeline', sub: null, params: Object.fromEntries(new URLSearchParams(hash.split('?')[1] ?? '')) } });
}

beforeEach(() => {
  vi.mocked(api.listMemories).mockReset();
  vi.mocked(api.stats).mockResolvedValue({ total: 3, byType: {}, bySource: {}, byNamespace: [{ namespace: null, count: 3 }] });
  resetServerStats();
  useMemoryStore.setState({ records: [], hiddenIds: new Set(), projectFilter: undefined });
  useNeuralStore.setState({ selectedNeuronId: null });
  go('#/timeline');
});

describe('day grouping', () => {
  const now = new Date(2026, 9, 19, 15, 0);

  it('names today, yesterday and older days, with the year only when it differs', () => {
    expect(dayLabel(new Date(2026, 9, 19, 1), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 18, 23), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 17, 9), now)).toBe('Saturday 17 October');
    expect(dayLabel(new Date(2025, 11, 31, 9), now)).toBe('Wednesday 31 December 2025');
  });

  it('groups by local calendar day, newest first, and keeps an unparsable date visible', () => {
    const days = groupByDay(
      [
        record({ id: 'a', createdAt: new Date(2026, 9, 19, 10).toISOString() }),
        record({ id: 'b', createdAt: new Date(2026, 9, 19, 0, 5).toISOString() }),
        record({ id: 'c', createdAt: new Date(2026, 9, 18, 23, 55).toISOString() }),
        record({ id: 'bad', createdAt: 'not a date' }),
      ],
      now
    );
    expect(days.map((d) => [d.label, d.records.map((r) => r.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Unknown date', ['bad']],
    ]);
  });

  it("folds each day's machine streams with the Map list's own fold", () => {
    const stream = [0, 1, 2].map((i) =>
      record({ id: `mc${i}`, source: 'mission-control', content: `[Mission Control] DONE task ${i}`, createdAt: new Date(2026, 9, 19, 10, 30 - i).toISOString() })
    );
    const records = [record({ id: 'own', createdAt: new Date(2026, 9, 19, 11).toISOString() }), ...stream];
    const [today] = groupByDay(records, now);
    expect(today!.items).toEqual(foldStreams(records));
    expect(today!.items[1]).toMatchObject({ kind: 'stream', title: 'Mission Control reported 3 tasks' });
  });

  it('reads a picked day as the instant it ends', () => {
    expect(endOfPickedDay('2026-10-01')).toBe(new Date(2026, 9, 2).toISOString());
    expect(endOfPickedDay('nonsense')).toBeNull();
  });
});

describe('TimelineView', () => {
  it('lists the newest page by day, and a row opens its memory in the sheet', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 2, memories: page(2) });
    render(<TimelineView />);

    fireEvent.click(await screen.findByRole('button', { name: /memory p1/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('p1');
    expect(api.listMemories).toHaveBeenCalledWith({ limit: PAGE_SIZE, offset: 0, before: undefined, namespace: undefined });
    expect(screen.getByText('That is every memory, back to the first.')).toBeInTheDocument();
    expect(await screen.findByText(/^3 memories in All projects, newest first/)).toBeInTheDocument();
  });

  it('pages older memories beneath the first page, pinned to its newest instant', async () => {
    const first = page(PAGE_SIZE);
    vi.mocked(api.listMemories)
      .mockResolvedValueOnce({ count: PAGE_SIZE, memories: first })
      .mockResolvedValueOnce({ count: 1, memories: [...first.slice(-1), ...page(1, Date.parse('2026-10-01T00:00:00.000Z'), 'old')] });
    render(<TimelineView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    await screen.findByRole('button', { name: /memory old0/ });
    expect(api.listMemories).toHaveBeenLastCalledWith({
      limit: PAGE_SIZE,
      offset: PAGE_SIZE,
      before: '2026-10-19T12:00:00.001Z',
      namespace: undefined,
    });
    // The repeated row from the page boundary is listed once.
    expect(screen.getAllByRole('button', { name: new RegExp(`memory ${first.at(-1)!.id}\\b`) })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });

  it('starts on a picked date, and Newest goes back to the top', async () => {
    go('#/timeline?before=2026-10-01');
    vi.mocked(api.listMemories).mockResolvedValue({ count: 1, memories: page(1, Date.parse('2026-09-30T10:00:00.000Z')) });
    render(<TimelineView />);

    expect(await screen.findByText(/^Memories stored on or before 1 October 2026/)).toBeInTheDocument();
    expect(api.listMemories).toHaveBeenCalledWith(expect.objectContaining({ before: new Date(2026, 9, 2).toISOString(), offset: 0 }));

    fireEvent.click(screen.getByRole('button', { name: 'Newest' }));
    expect(useRouteStore.getState().route.params.before).toBeUndefined();
    await waitFor(() => expect(api.listMemories).toHaveBeenLastCalledWith(expect.objectContaining({ before: undefined })));
  });

  it('jumps to a date picked in the field', async () => {
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
    render(<TimelineView />);
    fireEvent.change(screen.getByLabelText('Jump to a date'), { target: { value: '2026-03-02' } });
    expect(useRouteStore.getState().route.params.before).toBe('2026-03-02');
    expect(await screen.findByRole('heading', { name: 'Nothing stored by 2 March 2026' })).toBeInTheDocument();
  });

  it('opens a folded stream to show its memories', async () => {
    const stream = [0, 1, 2].map((i) =>
      record({ id: `mc${i}`, source: 'mission-control', content: `[Mission Control] DONE task ${i}`, createdAt: new Date(Date.parse('2026-10-19T12:00:00Z') - i * 60_000).toISOString() })
    );
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 3, memories: stream });
    render(<TimelineView />);

    const fold = await screen.findByRole('button', { name: /Mission Control reported 3 tasks/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fold);
    fireEvent.click(screen.getByRole('button', { name: /task 2/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('mc2');
  });

  it('steps through rows with j and k', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 2, memories: page(2) });
    render(<TimelineView />);
    const firstRow = await screen.findByRole('button', { name: /memory p0/ });
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: 'j' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /memory p1/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'k' });
    expect(document.activeElement).toBe(firstRow);
  });

  it('shows live arrivals and sheet edits, and drops archived rows', async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 2, memories: page(2) });
    render(<TimelineView />);
    await screen.findByRole('button', { name: /memory p0/ });

    act(() =>
      useMemoryStore.setState({
        records: [record({ id: 'new', content: 'arrived live', createdAt: '2026-10-19T12:30:00.000Z' }), record({ ...page(1)[0]!, content: 'edited text' })],
        hiddenIds: new Set(['p1']),
      })
    );
    expect(screen.getByRole('button', { name: /arrived live/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edited text/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /memory p1/ })).not.toBeInTheDocument();
  });

  it('says why a load failed, and Try again reloads', async () => {
    vi.mocked(api.listMemories).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ count: 1, memories: page(1) });
    render(<TimelineView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the timeline: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /memory p0/ })).toBeInTheDocument();
  });

  it('offers to connect an AI on an empty store, with no date to jump to', async () => {
    vi.mocked(api.stats).mockResolvedValue({ total: 0, byType: {}, bySource: {}, byNamespace: [] });
    vi.mocked(api.listMemories).mockResolvedValueOnce({ count: 0, memories: [] });
    render(<TimelineView />);
    expect(await screen.findByRole('heading', { name: 'Nothing on the timeline yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect an AI' })).toHaveAttribute('href', '#/welcome');
    expect(await screen.findByText('Nothing stored in All projects yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Jump to a date')).not.toBeInTheDocument();
  });

  it('honours the project scope, and an empty project offers every project', async () => {
    useMemoryStore.setState({ projectFilter: '/code/api' });
    vi.mocked(api.listMemories).mockResolvedValue({ count: 0, memories: [] });
    render(<TimelineView />);
    const empty = await screen.findByRole('heading', { name: 'No memories in api yet' });
    expect(api.listMemories).toHaveBeenCalledWith(expect.objectContaining({ namespace: '/code/api' }));
    fireEvent.click(within(empty.parentElement!).getByRole('button', { name: 'Show all projects' }));
    expect(useMemoryStore.getState().projectFilter).toBeUndefined();
  });
});
