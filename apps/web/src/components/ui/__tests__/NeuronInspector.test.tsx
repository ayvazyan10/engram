import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import NeuronInspector from '../NeuronInspector.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    getGraph: vi.fn(),
    getContradictions: vi.fn(),
    deleteMemory: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    resolveContradiction: vi.fn(),
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type GraphResponse = Awaited<ReturnType<typeof api.getGraph>>;

function graphResponse(connections: GraphResponse['connections']): GraphResponse {
  return { node: null, connections, neighbors: [] };
}

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'hello world',
    summary: null,
    importance: 0.5,
    source: null,
    concept: null,
    tags: '[]',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function resetStores() {
  useNeuralStore.setState({
    selectedNeuronId: null,
    contradictionPairs: [],
    neurons: [],
    connections: [],
  });
  useMemoryStore.setState({ records: [] });
}

describe('NeuronInspector graph-fetch race (W5)', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getContradictions).mockReset();
  });

  it('discards a slower response for a previously-selected neuron when the selection has moved on', async () => {
    useMemoryStore.setState({
      records: [makeRecord({ id: 'a', content: 'Neuron A' }), makeRecord({ id: 'b', content: 'Neuron B' })],
    });

    const forA = deferred<GraphResponse>();
    const forB = deferred<GraphResponse>();
    vi.mocked(api.getGraph).mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);

    act(() => useNeuralStore.getState().selectNeuron('a'));
    const { rerender } = render(<NeuronInspector />);
    rerender(<NeuronInspector />);

    // User moves on to B before A's (slow) response arrives.
    act(() => useNeuralStore.getState().selectNeuron('b'));
    rerender(<NeuronInspector />);

    // B's fast response arrives first...
    await act(async () => {
      forB.resolve(graphResponse([{ id: 'c-b', sourceId: 'b', targetId: 'x', relationship: 'related', strength: 0.9 }]));
      await forB.promise;
    });
    await waitFor(() => expect(screen.getByText('related')).toBeInTheDocument());

    // ...then A's slow, stale response finally resolves. It must not
    // overwrite B's connections with A's.
    await act(async () => {
      forA.resolve(graphResponse([{ id: 'c-a', sourceId: 'a', targetId: 'y', relationship: 'contradicts', strength: 0.5 }]));
      await forA.promise;
    });

    expect(screen.getByText('related')).toBeInTheDocument();
    expect(screen.queryByText('contradicts')).not.toBeInTheDocument();
  });
});

describe('NeuronInspector selection beyond the loaded record window (W8)', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getContradictions).mockReset();
  });

  it('falls back to the graph endpoint\'s node data when the selected id is not in `records`', async () => {
    // Simulates a search hit outside the first 200 loaded memories: the id
    // is a valid, selectable neuron but `records` (capped at 200) has never
    // heard of it.
    vi.mocked(api.getGraph).mockResolvedValueOnce({
      node: {
        id: 'far-away',
        type: 'semantic',
        content: 'A memory beyond the 200-record window',
        summary: null,
        importance: 0.6,
        source: null,
        concept: null,
        tags: '[]',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      connections: [],
      neighbors: [],
    });

    act(() => useNeuralStore.getState().selectNeuron('far-away'));
    render(<NeuronInspector />);

    await waitFor(() =>
      expect(screen.getByText('A memory beyond the 200-record window')).toBeInTheDocument()
    );
    expect(screen.queryByText(/select a neuron/i)).not.toBeInTheDocument();
  });
});

describe('NeuronInspector list keys survive a list replacement (W14)', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getContradictions).mockReset();
    vi.mocked(api.getGraph).mockResolvedValue(graphResponse([]));
  });

  it('does not silently keep DOM focus pinned to a stale card\'s position after a contradiction is resolved away', async () => {
    useMemoryStore.setState({
      records: [
        makeRecord({ id: 'sel', content: 'Selected memory' }),
        makeRecord({ id: 'other-a', content: 'Other A' }),
        makeRecord({ id: 'other-b', content: 'Other B' }),
      ],
    });
    useNeuralStore.setState({
      contradictionPairs: [
        { sourceId: 'sel', targetId: 'other-a', confidence: 0.9 },
        { sourceId: 'sel', targetId: 'other-b', confidence: 0.8 },
      ],
    });
    act(() => useNeuralStore.getState().selectNeuron('sel'));

    render(<NeuronInspector />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'newest' })).toHaveLength(2));

    const buttons = screen.getAllByRole('button', { name: 'newest' });
    buttons[0]!.focus();
    expect(document.activeElement).toBe(buttons[0]);

    // Simulate the first contradiction (index 0) being resolved away — the
    // same state shape handleResolve produces via setContradictionPairs.
    act(() => {
      useNeuralStore.getState().setContradictionPairs([
        { sourceId: 'sel', targetId: 'other-b', confidence: 0.8 },
      ]);
    });

    // With index keys, React reuses the position-0 DOM node in place —
    // focus silently stays "on" a button that now belongs to a different
    // card. A stable, content-derived key correctly discards that node
    // (its identity is genuinely gone) so focus moves off it instead of
    // masquerading as still being on the resolved card.
    expect(document.activeElement).not.toBe(buttons[0]);
  });
});
