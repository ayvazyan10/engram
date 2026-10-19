import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MemorySheet, { predictLoser, resetPolicyCache, retentionOf } from '../MemorySheet.js';
import Toasts, { useToasts } from '../../../shell/Toasts.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { api } from '../../../lib/api.js';
import { flushDeferred, UNDO_MS } from '../deferredAction.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    getGraph: vi.fn(),
    getDecayPolicy: vi.fn(),
    deleteMemory: vi.fn(),
    resolveContradiction: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    updateMemory: vi.fn(),
    stats: vi.fn().mockResolvedValue({ total: 3, byType: {}, bySource: {} }),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const DAY = 86_400_000;

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'a',
    type: 'semantic',
    content: 'Sync encryption is optional and off by default in the cloud.',
    summary: null,
    importance: 0.75,
    source: 'claude-code',
    concept: 'sync encryption',
    tags: '["sync","cloud"]',
    createdAt: '2026-10-01T10:00:00.000Z',
    accessCount: 3,
    lastAccessedAt: '2026-10-10T10:00:00.000Z',
    ...overrides,
  };
}

const other = record({
  id: 'b',
  type: 'episodic',
  content: 'Sync encryption is on by default in the cloud.',
  importance: 0.5,
  createdAt: '2026-10-05T10:00:00.000Z',
});
const neighbour = record({ id: 'c', type: 'procedural', content: 'Rotate the sync key every quarter.' });

function graph(node: MemoryRecord = record()) {
  return {
    node,
    connections: [
      { id: 'e1', sourceId: 'a', targetId: 'b', relationship: 'contradicts', strength: 0.9 },
      { id: 'e2', sourceId: 'c', targetId: 'a', relationship: 'relates_to', strength: 0.7 },
    ],
    neighbors: [other, neighbour],
  };
}

function open(id = 'a') {
  act(() => useNeuralStore.getState().selectNeuron(id));
}

function renderSheet() {
  return render(
    <>
      <button type="button">opener</button>
      <MemorySheet />
      <Toasts />
    </>
  );
}

beforeEach(() => {
  resetPolicyCache();
  useNeuralStore.setState({ selectedNeuronId: null, contradictionPairs: [{ sourceId: 'a', targetId: 'b', confidence: 0.9 }] });
  useMemoryStore.setState({ records: [record(), other, neighbour], searchResults: [], weakerResults: [], hiddenIds: new Set() });
  useToasts.setState({ toast: null, visible: false });
  vi.mocked(api.getGraph).mockReset().mockResolvedValue(graph() as never);
  vi.mocked(api.getDecayPolicy).mockReset().mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05 });
  vi.mocked(api.deleteMemory).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.resolveContradiction).mockReset().mockResolvedValue({ resolved: true, archivedId: 'b', keptId: 'a' });
  vi.mocked(api.updateMemory).mockReset();
  vi.mocked(api.addTag).mockReset();
  vi.mocked(api.removeTag).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  flushDeferred();
});

describe('retentionOf', () => {
  const policy = { halfLifeDays: 7, archiveThreshold: 0.05 };
  const now = Date.parse('2026-10-15T00:00:00.000Z');

  it('is importance × recency × access, the server formula', () => {
    const fresh = retentionOf({ importance: 0.8, createdAt: '2026-10-15T00:00:00.000Z', lastAccessedAt: null, accessCount: 0 }, policy, now);
    expect(fresh.retention).toBeCloseTo(0.8 * 0.3, 5);
    const week = retentionOf({ importance: 0.8, createdAt: '2026-10-08T00:00:00.000Z', lastAccessedAt: null, accessCount: 0 }, policy, now);
    expect(week.retention).toBeCloseTo(0.8 * 0.3 * 0.5, 5);
  });

  it('counts from the last recall when there is one, and recalls raise the access factor', () => {
    const r = retentionOf(
      { importance: 1, createdAt: '2026-01-01T00:00:00.000Z', lastAccessedAt: '2026-10-15T00:00:00.000Z', accessCount: 9 },
      policy,
      now
    );
    expect(r.retention).toBeCloseTo(0.3 + (0.7 * 1) / 3, 5);
  });

  it('says how many days are left before the archive threshold, negative once past it', () => {
    const r = retentionOf({ importance: 0.8, createdAt: '2026-10-15T00:00:00.000Z', lastAccessedAt: null, accessCount: 0 }, policy, now);
    // 0.24 · 2^(-t/7) = 0.05  →  t = 7 · log2(4.8)
    expect(r.daysLeft).toBeCloseTo(7 * Math.log2(4.8), 5);
    const old = retentionOf({ importance: 0.8, createdAt: new Date(now - 60 * DAY).toISOString(), lastAccessedAt: null, accessCount: 0 }, policy, now);
    expect(old.daysLeft).toBeLessThan(0);
  });
});

describe('predictLoser', () => {
  const older = { id: 'old', createdAt: '2026-01-01T00:00:00Z', importance: 0.9 };
  const newer = { id: 'new', createdAt: '2026-02-01T00:00:00Z', importance: 0.4 };

  it('follows the server: newest keeps the newer, oldest the older, important the weightier', () => {
    expect(predictLoser(older, newer, 'keep_newest')).toBe('old');
    expect(predictLoser(newer, older, 'keep_oldest')).toBe('new');
    expect(predictLoser(newer, older, 'keep_important')).toBe('new');
    expect(predictLoser(older, newer, 'keep_both')).toBeNull();
  });

  it('keeps the source on an importance tie', () => {
    expect(predictLoser({ ...older, importance: 0.5 }, { ...newer, importance: 0.5 }, 'keep_important')).toBe('new');
  });
});

describe('MemorySheet: reading', () => {
  it('opens for the selected memory with its text, type, weight and facts', async () => {
    renderSheet();
    open();
    const sheet = await screen.findByRole('dialog', { name: /semantic memory/i });
    expect(within(sheet).getByText(/Sync encryption is optional/)).toBeInTheDocument();
    expect(within(sheet).getByRole('meter', { name: 'Importance' })).toHaveAttribute('aria-valuenow', '75');
    expect(await within(sheet).findByRole('meter', { name: 'Retention' })).toBeInTheDocument();
    expect(within(sheet).getByText(/archive threshold/)).toBeInTheDocument();
    expect(within(sheet).getByText(/^3 times, last/)).toBeInTheDocument();
    expect(within(sheet).getByText('sync encryption')).toBeInTheDocument();
  });

  it('takes focus when it opens and gives it back to what opened it when it closes', async () => {
    renderSheet();
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    open();
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveFocus();

    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the sheet', async () => {
    renderSheet();
    open();
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText(/Connected to 1/);
    const buttons = within(sheet).getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    last.focus();
    fireEvent.keyDown(sheet, { key: 'Tab' });
    expect(within(sheet).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('names the memory at the other end of every link, and opens it', async () => {
    renderSheet();
    open();
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Contradicts 1 memory')).toBeInTheDocument();
    expect(within(sheet).getByText('Connected to 1')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /Rotate the sync key/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('c');
    await waitFor(() => expect(api.getGraph).toHaveBeenLastCalledWith('c', 1));
  });

  it('folds a long memory and shows all of it on request', async () => {
    const long = 'word '.repeat(200).trim();
    useMemoryStore.setState({ records: [record({ content: long })] });
    vi.mocked(api.getGraph).mockResolvedValue({ node: record({ content: long }), connections: [], neighbors: [] } as never);
    renderSheet();
    open();
    const more = await screen.findByRole('button', { name: `Show all ${long.length} characters` });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens a memory the lists never loaded, from its own row', async () => {
    useMemoryStore.setState({ records: [] });
    renderSheet();
    open();
    expect(await screen.findByText(/Sync encryption is optional/)).toBeInTheDocument();
  });

  it('says so when the memory is no longer in the store', async () => {
    useMemoryStore.setState({ records: [] });
    vi.mocked(api.getGraph).mockRejectedValue(Object.assign(new Error('Memory not found'), { status: 404 }));
    renderSheet();
    open('gone');
    expect(await screen.findByText(/not in the store any more/)).toBeInTheDocument();
  });
});

describe('MemorySheet: tags', () => {
  it('adds a tag on Enter and removes one, writing through to the list', async () => {
    vi.mocked(api.addTag).mockResolvedValue({ id: 'a', tags: ['sync', 'cloud', 'crypto'] });
    vi.mocked(api.removeTag).mockResolvedValue({ id: 'a', tags: ['cloud', 'crypto'] });
    renderSheet();
    open();
    const input = await screen.findByLabelText('Add tag');
    fireEvent.change(input, { target: { value: ' crypto ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.addTag).toHaveBeenCalledWith('a', 'crypto'));
    expect(await screen.findByText('crypto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag sync' }));
    await waitFor(() => expect(useMemoryStore.getState().records[0]!.tags).toBe('["cloud","crypto"]'));
    expect(await screen.findByText('Removed the tag “sync”')).toBeInTheDocument();
  });

  it('says when a tag could not be added', async () => {
    vi.mocked(api.addTag).mockRejectedValue(new Error('offline'));
    renderSheet();
    open();
    const input = await screen.findByLabelText('Add tag');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add that tag: offline');
  });
});

describe('MemorySheet: edit', () => {
  it('switches to Edit, saves only what changed, and comes back to Read', async () => {
    vi.mocked(api.updateMemory).mockResolvedValue({
      id: 'a',
      content: record().content,
      importance: 0.9,
      tags: '["sync","cloud"]',
      concept: 'sync encryption',
      updatedAt: 'now',
    });
    renderSheet();
    open();
    fireEvent.click(await screen.findByRole('tab', { name: 'Edit' }));
    const slider = screen.getByLabelText(/Importance/);
    fireEvent.change(slider, { target: { value: '90' } });
    fireEvent.keyDown(slider, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.updateMemory).toHaveBeenCalledWith('a', { importance: 0.9 }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Read' })).toHaveAttribute('aria-selected', 'true');
    expect(useMemoryStore.getState().records[0]!.importance).toBe(0.9);
  });

  it('Escape leaves Edit for Read before it closes the sheet', async () => {
    renderSheet();
    open();
    fireEvent.click(await screen.findByRole('tab', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.keyDown(screen.getByLabelText('Content'), { key: 'Escape' });
    expect(screen.getByRole('tab', { name: 'Read' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
  });
});

describe('MemorySheet: archive with undo', () => {
  it('hides the memory at once, sends the archive after the undo window, then drops it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSheet();
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Archive/ }));

    expect(useMemoryStore.getState().hiddenIds.has('a')).toBe(true);
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
    expect(screen.getByText('Archived. It no longer reaches your AI.')).toBeInTheDocument();
    expect(api.deleteMemory).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(api.deleteMemory).toHaveBeenCalledWith('a', false);
    await waitFor(() => expect(useMemoryStore.getState().records.map((r) => r.id)).not.toContain('a'));
    expect(useMemoryStore.getState().hiddenIds.has('a')).toBe(false);
  });

  it('Undo (the button or Ctrl+Z) puts it back and never sends the call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSheet();
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Archive/ }));
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    expect(useMemoryStore.getState().hiddenIds.has('a')).toBe(false);
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS * 2);
    });
    expect(api.deleteMemory).not.toHaveBeenCalled();
  });

  it('sends a pending archive with keepalive when the page goes away', async () => {
    renderSheet();
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Archive/ }));
    window.dispatchEvent(new Event('pagehide'));
    expect(api.deleteMemory).toHaveBeenCalledWith('a', true);
  });

  it('puts the memory back and says so when the archive fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.deleteMemory).mockRejectedValue(new Error('offline'));
    renderSheet();
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Archive/ }));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(await screen.findByText('Could not archive that memory: offline')).toBeInTheDocument();
    expect(useMemoryStore.getState().hiddenIds.has('a')).toBe(false);
  });
});

describe('MemorySheet: contradictions', () => {
  it('resolves after the undo window and archives the predicted loser', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSheet();
    open();
    const card = (await screen.findByRole('button', { name: /on by default/ })).closest('.mm-fault') as HTMLElement;
    // Keep oldest: this memory (Oct 1) is older than b (Oct 5), so b goes.
    fireEvent.click(within(card).getByRole('button', { name: 'Keep oldest' }));
    expect(useMemoryStore.getState().hiddenIds.has('b')).toBe(true);
    expect(screen.getByText('Kept this memory; the other one is archived.')).toBeInTheDocument();
    expect(api.resolveContradiction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(api.resolveContradiction).toHaveBeenCalledWith('a', 'b', 'keep_oldest', false);
    await waitFor(() => expect(useNeuralStore.getState().contradictionPairs).toEqual([]));
    expect(useMemoryStore.getState().records.map((r) => r.id)).not.toContain('b');
  });

  it('closes the sheet when this memory is the one archived, and Undo reopens it', async () => {
    renderSheet();
    open();
    const card = (await screen.findByRole('button', { name: /on by default/ })).closest('.mm-fault') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Keep newest' }));
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
    expect(useMemoryStore.getState().hiddenIds.size).toBe(0);
  });
});
