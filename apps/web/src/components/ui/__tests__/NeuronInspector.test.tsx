import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// ─── Tag row ────────────────────────────────────────────────────────────────
// The project owner pasted what he saw and it was this:
//
//   mc×
//   mc:task:cmtkeuc21004uuomwb6wai65r×
//   mc:outcome:DONE×
//
// — chips running past a 252px panel that clips instead of scrolling, and a
// remove glyph rendered LARGER than the label it deletes, glued to the end
// of the identifier with no separation. These are his real tags.
const REAL_TAGS = [
  'mc',
  'mc:task:cmtkeuc21004uuomwb6wai65r',
  'mc:outcome:DONE',
  'mc:project:cmtkdlvnh000f14i65csjhm2r',
  'mc:agent:shizu',
  'pinned',
];

describe('NeuronInspector tag chips', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.removeTag).mockReset();
    vi.mocked(api.getGraph).mockResolvedValue(graphResponse([]));
    useMemoryStore.setState({
      records: [makeRecord({ id: 'mem-1', tags: JSON.stringify(REAL_TAGS) })],
    });
    act(() => useNeuralStore.getState().selectNeuron('mem-1'));
  });

  it('gives every remove control an accessible name that says which tag it removes', async () => {
    render(<NeuronInspector />);
    await waitFor(() => expect(screen.getByTitle('mc:agent:shizu')).toBeInTheDocument());

    // Not six buttons all called "Remove tag" — each names its own tag.
    for (const tag of REAL_TAGS) {
      expect(screen.getByRole('button', { name: `Remove tag ${tag}` })).toBeInTheDocument();
    }
  });

  it('removes the full, unshortened tag — display truncation never leaks into the request', async () => {
    const long = 'mc:task:cmtkeuc21004uuomwb6wai65r';
    vi.mocked(api.removeTag).mockResolvedValue({ id: 'mem-1', tags: [] });
    render(<NeuronInspector />);
    await waitFor(() => expect(screen.getByTitle(long)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: `Remove tag ${long}` }));

    await waitFor(() => expect(api.removeTag).toHaveBeenCalledWith('mem-1', long));
  });

  it('keeps the whole tag reachable on the chip itself', async () => {
    render(<NeuronInspector />);
    await waitFor(() => expect(screen.getByTitle('mc:project:cmtkdlvnh000f14i65csjhm2r')).toBeInTheDocument());
    for (const tag of REAL_TAGS) {
      expect(screen.getByTitle(tag)).toBeInTheDocument();
    }
  });

  it('shows a task tag as a task tag — the namespace survives, the cuid does not', async () => {
    const { container } = render(<NeuronInspector />);
    await waitFor(() => expect(screen.getByTitle('mc:task:cmtkeuc21004uuomwb6wai65r')).toBeInTheDocument());

    const text = container.textContent ?? '';
    expect(text).toContain('mc:task:');
    expect(text).toContain('cmtkeu…');
    expect(text).not.toContain('cmtkeuc21004uuomwb6wai65r');
    // A readable value is never stubbed.
    expect(text).toContain('DONE');
    expect(text).toContain('shizu');
  });

  it('renders the remove control smaller than the label it deletes', async () => {
    render(<NeuronInspector />);
    const chip = await screen.findByTitle('mc:outcome:DONE');
    const remove = screen.getByRole('button', { name: 'Remove tag mc:outcome:DONE' });

    const labelSize = parseFloat(chip.style.fontSize);
    const removeSize = parseFloat(remove.style.fontSize);
    expect(labelSize).toBeGreaterThan(0);
    expect(removeSize).toBeLessThan(labelSize);
  });

  it('is keyboard reachable and does not suppress the global focus ring', async () => {
    render(<NeuronInspector />);
    const remove = await screen.findByRole('button', { name: 'Remove tag pinned' });
    remove.focus();
    expect(document.activeElement).toBe(remove);
    // styles/global.css owns :focus-visible; an inline `outline` would beat
    // it silently, which is exactly the bug that rule was written to end.
    expect(remove.style.outline).toBe('');
  });

  it('caps every chip at its container and truncates instead of overflowing', async () => {
    render(<NeuronInspector />);
    const chip = await screen.findByTitle('mc:task:cmtkeuc21004uuomwb6wai65r');
    // The label is the chip's first inner span; the remove button follows it.
    const label = chip.querySelector('span');

    expect(chip.style.maxWidth).toBe('100%');
    expect(chip.style.minWidth).toBe('0');
    expect(label?.style.overflow).toBe('hidden');
    expect(label?.style.textOverflow).toBe('ellipsis');
    expect(label?.style.whiteSpace).toBe('nowrap');
  });

  it('still shows — and can still remove — a tag that is nothing but whitespace', async () => {
    // The add-tag field trims, so this UI cannot create one; another client
    // can. A chip rendered as pure padding is a chip nobody can see to
    // delete, so it gets a visible placeholder instead of disappearing.
    useMemoryStore.setState({
      records: [makeRecord({ id: 'mem-1', tags: JSON.stringify(['pinned', '   ']) })],
    });
    vi.mocked(api.removeTag).mockResolvedValue({ id: 'mem-1', tags: ['pinned'] });
    render(<NeuronInspector />);

    const placeholder = await screen.findByText('(empty)');
    const chip = placeholder.closest('span[title]');
    const remove = chip?.querySelector('button');
    expect(remove?.getAttribute('aria-label')).toBe('Remove tag    ');

    fireEvent.click(remove!);
    await waitFor(() => expect(api.removeTag).toHaveBeenCalledWith('mem-1', '   '));
  });

  it('leaves a short tag as a short chip — no stretch, no explicit width', async () => {
    render(<NeuronInspector />);
    const short = await screen.findByTitle('mc');
    const long = screen.getByTitle('mc:project:cmtkdlvnh000f14i65csjhm2r');

    for (const chip of [short, long]) {
      expect(chip.style.width).toBe('');
      expect(chip.style.flexGrow).toBe('');
    }
    // Both chips are styled by one rule, so 'mc' cannot pick up padding
    // that was tuned only for the long ones.
    expect(short.style.padding).toBe(long.style.padding);
  });
});

describe('NeuronInspector archive confirmation (H8 — was a native confirm())', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getGraph).mockResolvedValue(graphResponse([]));
    vi.mocked(api.deleteMemory).mockReset();
    useMemoryStore.setState({
      records: [makeRecord({ id: 'a', concept: 'Deploy checklist', content: 'Run the migration before the release.' })],
    });
  });

  it('never calls the browser confirm(), which showed OS chrome and named nothing', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    fireEvent.click(screen.getByRole('button', { name: /archive memory/i }));

    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it('shows a themed dialog that names the memory being archived', async () => {
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);
    fireEvent.click(screen.getByRole('button', { name: /archive memory/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Deploy checklist')).toBeInTheDocument();
    expect(within(dialog).getByText(/run the migration before the release/i)).toBeInTheDocument();
    expect(api.deleteMemory).not.toHaveBeenCalled();
  });

  it('archives only once confirmed, and cancelling leaves the memory alone', async () => {
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    fireEvent.click(screen.getByRole('button', { name: /archive memory/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteMemory).not.toHaveBeenCalled();

    vi.mocked(api.deleteMemory).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: /archive memory/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^archive$/i }));

    await waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith('a'));
  });
});

describe('NeuronInspector write failures (H7 — all four caught into console.error)', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getGraph).mockResolvedValue(graphResponse([]));
    vi.mocked(api.deleteMemory).mockReset();
    vi.mocked(api.addTag).mockReset();
    vi.mocked(api.removeTag).mockReset();
    vi.mocked(api.resolveContradiction).mockReset();
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', tags: '["keep"]' })] });
    act(() => useNeuralStore.getState().selectNeuron('a'));
  });

  it('surfaces a failed archive in the UI, with the server reason', async () => {
    vi.mocked(api.deleteMemory).mockRejectedValueOnce(new Error('API 403: forbidden'));
    render(<NeuronInspector />);

    fireEvent.click(screen.getByRole('button', { name: /archive memory/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^archive$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not archive this memory/i);
    expect(alert).toHaveTextContent(/403/);
  });

  it('surfaces a failed add-tag', async () => {
    vi.mocked(api.addTag).mockRejectedValueOnce(new Error('nope'));
    render(<NeuronInspector />);

    fireEvent.change(screen.getByPlaceholderText(/add tag/i), { target: { value: 'new-tag' } });
    fireEvent.click(screen.getByRole('button', { name: '+' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not add that tag/i);
  });

  it('surfaces a failed remove-tag, naming the tag', async () => {
    vi.mocked(api.removeTag).mockRejectedValueOnce(new Error('nope'));
    render(<NeuronInspector />);

    fireEvent.click(await screen.findByRole('button', { name: /remove tag keep/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not remove the tag "keep"/i);
  });

  it('surfaces a failed contradiction resolve', async () => {
    useNeuralStore.setState({ contradictionPairs: [{ sourceId: 'a', targetId: 'b', confidence: 0.9 }] });
    vi.mocked(api.resolveContradiction).mockRejectedValueOnce(new Error('nope'));
    render(<NeuronInspector />);

    fireEvent.click(screen.getByRole('button', { name: /newest/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not resolve this contradiction/i);
  });

  it('clears on the next success', async () => {
    vi.mocked(api.addTag)
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce({ id: 'a', tags: ['keep', 'ok'] });
    render(<NeuronInspector />);

    const input = screen.getByPlaceholderText(/add tag/i);
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    await screen.findByRole('alert');

    fireEvent.change(input, { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('clears when the selection moves to another memory — a failure belongs to its record', async () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', tags: '["keep"]' }), makeRecord({ id: 'b' })] });
    vi.mocked(api.removeTag).mockRejectedValueOnce(new Error('nope'));
    const { rerender } = render(<NeuronInspector />);

    fireEvent.click(await screen.findByRole('button', { name: /remove tag keep/i }));
    await screen.findByRole('alert');

    act(() => useNeuralStore.getState().selectNeuron('b'));
    rerender(<NeuronInspector />);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('NeuronInspector content bounds (H10 — 6201 chars in a 210px column)', () => {
  beforeEach(() => {
    resetStores();
    vi.mocked(api.getGraph).mockReset();
    vi.mocked(api.getGraph).mockResolvedValue(graphResponse([]));
  });

  it('clamps a long body and offers to show the rest', async () => {
    const long = 'sentence about the deploy. '.repeat(300);
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', content: long })] });
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    const toggle = screen.getByRole('button', { name: /show all/i });
    const body = screen.getByText(/sentence about the deploy/i);
    expect(body.className).toContain('ec-clamp');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.getByText(/sentence about the deploy/i).className).not.toContain('ec-clamp');
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
  });

  it('does not offer the toggle for a body that fits', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', content: 'short' })] });
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });

  it('puts Tags and Stored above Content, so the controls are not below the fold', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a' })] });
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    const order = ['Tags', 'Stored', 'Content'].map((label) => screen.getByText(label));
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lets version strings and paths break instead of overflowing the column', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', content: '/very/long/absolute/path/without/break/opportunities@1.2.3' })] });
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    expect(screen.getByText(/very\/long\/absolute/).className).toContain('ec-wrap-anywhere');
  });

  it('strips the Markdown the concept arrived wrapped in (H4)', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', concept: '**Deploy checklist**' })] });
    act(() => useNeuralStore.getState().selectNeuron('a'));
    render(<NeuronInspector />);

    expect(screen.getByText('Deploy checklist')).toBeInTheDocument();
  });
});
