import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../../lib/api.js';
import { useMemoryStore } from '../../../../store/memoryStore.js';
import { useNeuralStore } from '../../../../store/neuralStore.js';
import RiverView from '../RiverView.js';
import PulseView from '../PulseView.js';
import type { RiverHit } from '../RiverCanvas.js';
import { graph, item, payload, recall, region } from './fixtures.js';

vi.mock('../../../../lib/api.js', () => ({ api: { getGraphEdges: vi.fn(), explainRecall: vi.fn() } }));
let river: { onHover: (hit: RiverHit | null, point: [number, number]) => void; onPick: (hit: RiverHit | null) => void };
vi.mock('../RiverCanvas.js', () => ({
  default: (props: typeof river) => { river = props; return <canvas aria-label="Streams of memories" />; },
  RiverOverview: () => <svg aria-label="Whole history" />,
}));

beforeEach(() => {
  vi.mocked(api.getGraphEdges).mockReset().mockResolvedValue(graph);
  vi.mocked(api.explainRecall).mockReset().mockResolvedValue(recall());
  useMemoryStore.setState({ projectFilter: undefined });
  useNeuralStore.setState({ selectedNeuronId: null });
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => vi.unstubAllGlobals());
const ask = async () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Question for recall' }), { target: { value: '  release plan  ' } });
  fireEvent.submit(screen.getByRole('search'));
  await screen.findByRole('button', { name: /Inspect rank 1/ });
};

describe('RiverView', () => {
  it('renders a calm empty state without loading edges', () => {
    render(<RiverView payload={payload({ nodes: [], regions: [] })} />);
    expect(screen.getByText('No memories to carry along the river yet.')).toBeInTheDocument();
    expect(api.getGraphEdges).not.toHaveBeenCalled();
  });
  it('renders the fixture, follows and clears a region, and opens a memory', async () => {
    render(<RiverView payload={payload()} />);
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: 'River of time' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Explore regions and memories'));
    fireEvent.click(screen.getByRole('button', { name: 'sync · encryption' }));
    expect(screen.getByText('Following sync · encryption')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync is end to end encrypted' }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: 'Clear focus' }));
    expect(screen.queryByText('Following sync · encryption')).not.toBeInTheDocument();
    act(() => river.onPick({ kind: 'band', id: 'r2' }));
    act(() => river.onPick({ kind: 'band', id: 'r2' }));
    expect(screen.queryByRole('button', { name: 'Clear focus' })).not.toBeInTheDocument();
    act(() => river.onPick(null));
  });
  it('shows particle, band and dated whirlpool tooltips', async () => {
    render(<RiverView payload={payload()} />);
    await waitFor(() => expect(api.getGraphEdges).toHaveBeenCalledOnce());
    act(() => river.onHover({ kind: 'particle', id: 'e' }, [100, 100]));
    expect(screen.getByRole('tooltip')).toHaveTextContent('protected');
    act(() => river.onHover({ kind: 'particle', id: 'a' }, [100, 100]));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Importance 0.90');
    act(() => river.onHover({ kind: 'band', id: 'r1' }, [100, 100]));
    expect(screen.getByRole('tooltip')).toHaveTextContent('3 of 3 memories');
    act(() => river.onHover({ kind: 'eddy', index: 0 }, [100, 100]));
    expect(screen.getByRole('tooltip')).toHaveTextContent('1 contradiction');
    expect(screen.getByRole('tooltip')).toHaveTextContent('release · npm');
    act(() => river.onHover(null, [0, 0]));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('zooms with keyboard controls, resets, and resets when the payload changes', async () => {
    const view = render(<RiverView payload={payload()} />);
    const start = screen.getByRole('slider', { name: 'Window start' });
    const end = screen.getByRole('slider', { name: 'Window end' });
    const original = (start as HTMLInputElement).value;
    fireEvent.change(start, { target: { value: Date.parse('2026-10-01') } });
    fireEvent.change(end, { target: { value: Date.parse('2026-10-19') } });
    expect(start).not.toHaveValue(original);
    fireEvent.click(screen.getByRole('button', { name: 'Show whole history' }));
    expect(start).toHaveValue(original);
    fireEvent.click(screen.getByText('Explore regions and memories'));
    fireEvent.click(screen.getByRole('button', { name: 'sync · encryption' }));
    view.rerender(<RiverView payload={payload({ fingerprint: 'new' })} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear focus' })).not.toBeInTheDocument());
  });
  it('states graph failures and truncated graph coverage', async () => {
    vi.mocked(api.getGraphEdges).mockRejectedValueOnce(new Error('offline'));
    const view = render(<RiverView payload={payload()} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Memory graph unavailable');
    vi.mocked(api.getGraphEdges).mockResolvedValueOnce({ ...graph, truncated: true });
    view.rerender(<RiverView payload={payload()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Only part of the memory graph'));
  });
});

describe('PulseView', () => {
  it('renders an empty state without querying recall', () => {
    render(<PulseView payload={payload({ nodes: [], regions: [] })} />);
    expect(screen.getByText('No memories to recall yet.')).toBeInTheDocument();
    expect(api.explainRecall).not.toHaveBeenCalled();
  });
  it('shows the idle centre, hint, and three top-region suggestions before any ask', async () => {
    render(<PulseView payload={payload({ regions: [region('small', { name: 'Small', count: 1 }), region('b', { name: 'Second', count: 3 }), region('a', { name: 'First', count: 4 }), region('c', { name: 'Third', count: 2 })] })} />);
    expect(screen.getByText('Your question')).toBeInTheDocument();
    expect(screen.getByText(/Ask a question to see/)).toBeInTheDocument();
    const suggestions = screen.getByLabelText('Suggested questions');
    expect(within(suggestions).getAllByRole('button').map((b) => b.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(api.explainRecall).not.toHaveBeenCalled();
    fireEvent.click(within(suggestions).getByRole('button', { name: 'First' }));
    await waitFor(() => expect(api.explainRecall).toHaveBeenCalledWith('First', 2000, undefined));
  });
  it.each([undefined, null, '/project'])('passes the same scope as Recall for %s', async (scope) => {
    useMemoryStore.setState({ projectFilter: scope });
    render(<PulseView payload={payload()} />); await ask();
    expect(api.explainRecall).toHaveBeenCalledWith('release plan', 2000, scope);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '300');
    expect(screen.getByRole('list', { name: 'Memories in the context' }).querySelectorAll('li')).toHaveLength(3);
  });
  it('pins a dot, shows inferred puller and budget why, and opens the sheet from Open or a row', async () => {
    render(<PulseView payload={payload()} />); await ask();
    fireEvent.click(screen.getByRole('button', { name: /Inspect rank 2/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('inferred link from “Sync is end to end encrypted”');
    fireEvent.click(within(screen.getByRole('tooltip')).getByRole('button', { name: 'Open' }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('d');
    fireEvent.click(within(screen.getByRole('list', { name: 'Memories in the context' })).getByRole('button', { name: /#1/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('a');
    fireEvent.keyDown(screen.getByRole('button', { name: /Inspect rank 4/ }), { key: 'Enter' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('source unknown');
    expect(screen.getByRole('tooltip')).toHaveTextContent('needs 1800 tokens, 1700 left');
    fireEvent.click(screen.getByText('Why candidates were left out'));
    fireEvent.click(screen.getByRole('button', { name: /Rank 4: Memory e/ }));
    expect(useNeuralStore.getState().selectedNeuronId).toBe('e');
  });
  it('highlights on hover and keyboard focus, clears focus on the background, and replays without a request', async () => {
    render(<PulseView payload={payload()} />); await ask();
    const dot = screen.getByRole('button', { name: /Inspect rank 1/ });
    fireEvent.pointerEnter(dot); expect(screen.getByRole('tooltip')).toHaveTextContent('vector match');
    fireEvent.pointerLeave(dot); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(dot); expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(dot); fireEvent.keyDown(dot, { key: ' ' });
    fireEvent.click(screen.getByLabelText('Candidates by rank and region'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(api.explainRecall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '300');
  });
  it('shows loading, errors and retry, and allows asking the same query again', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.explainRecall).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<PulseView payload={payload()} />);
    fireEvent.submit(screen.getByRole('search')); expect(api.explainRecall).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'question' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByText('Finding the memories your AI would receive…')).toBeInTheDocument();
    await act(async () => reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Recall failed: offline');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: /Inspect rank 1/ });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(api.explainRecall).toHaveBeenCalledTimes(3));
  });
  it('ignores a stale response after scope changes and after unmount', async () => {
    let resolve!: (value: ReturnType<typeof recall>) => void;
    vi.mocked(api.explainRecall).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<PulseView payload={payload()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'question' } }); fireEvent.submit(screen.getByRole('search'));
    act(() => useMemoryStore.setState({ projectFilter: null }));
    await screen.findByRole('button', { name: /Inspect rank 1/ });
    await act(async () => resolve(recall({ items: [] })));
    expect(screen.getByRole('button', { name: /Inspect rank 1/ })).toBeInTheDocument();
    vi.mocked(api.explainRecall).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.submit(screen.getByRole('search')); view.unmount();
    await act(async () => resolve(recall()));
  });
  it('handles zero candidates and the forced-over-budget top candidate', async () => {
    vi.mocked(api.explainRecall).mockResolvedValueOnce(recall({ items: [], candidates: 0, budget: { maxTokens: 2000, usedTokens: 0 } }));
    render(<PulseView payload={payload()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'empty' } }); fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByText('No memories to hand back for “empty”.')).toBeInTheDocument();
    vi.mocked(api.explainRecall).mockResolvedValueOnce(recall({ items: [item('outside-map', 1, { tokens: 2100 })], budget: { maxTokens: 2000, usedTokens: 2100 } }));
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByText(/The top memory is always included/)).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '2000');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '2100 of 2000 tokens');
  });
});
