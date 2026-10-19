import { useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecallView from '../RecallView.js';
import { api, type RecallExplanation, type RecallItem } from '../../../lib/api.js';
import { parseHash, useRouteStore } from '../../../shell/routeStore.js';
import { useMapStore } from '../../map/mapStore.js';
import { buildModel } from '../../map/lib/model.js';
import { payload } from '../../map/__tests__/payload.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import type { RouteStop } from '../routeLayout.js';

const camera = { reveal: vi.fn(), fit: vi.fn(), zoomBy: vi.fn() };
let drawn: Record<string, unknown> = {};
vi.mock('../../map/MapCanvas.js', () => ({ default: (props: Record<string, unknown> & { ref?: unknown }) => {
  drawn = props;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useImperativeHandle(props.ref as never, () => camera);
  return <canvas data-testid="shared-map" />;
} }));
const base: RecallItem = { id: 'a', rank: 3, position: 1, offset: 0, section: 'knowledge', type: 'semantic', source: null,
  via: 'graph', similarity: 0.5, score: 0.8, chars: 0, tokens: 12, included: true };
function explanation(): RecallExplanation {
  const first = 'Use encryption 🧠\nKeep keys local.';
  const second = 'Ship by pushing a tag.';
  const header = '[KNOWLEDGE]\n';
  const a = `• [aaaaaaaa · 2026-10-19] ${first}`;
  const middle = '\n\n[PATTERNS & SKILLS]\n';
  const d = `• [dddddddd · 2026-10-19] ${second}`;
  return { context: header + a + middle + d, latencyMs: 7, candidates: 3, budget: { maxTokens: 2000, usedTokens: 14 }, items: [
    { ...base, offset: header.length, chars: first.length },
    { ...base, id: 'd', rank: 1, position: 2, offset: header.length + a.length + middle.length, chars: second.length, tokens: 6, via: 'vector', section: 'patterns', type: 'procedural' },
    { ...base, id: 'b', rank: 2, position: null, offset: null, included: false, reason: 'over_budget', chars: 10000, tokens: 2500 },
  ] };
}
const onStore = vi.fn();
const map = () => screen.getByRole('region', { name: 'Recall route on the memory map' });
const row = (text: RegExp) => within(screen.getByRole('list', { name: 'Memories in rank order' })).getByRole('button', { name: text });
function go(hash: string) {
  window.history.replaceState(null, '', hash);
  useRouteStore.setState({ route: parseHash(hash) });
}
beforeEach(() => {
  drawn = {};
  camera.zoomBy.mockReset(); camera.reveal.mockReset(); camera.fit.mockReset(); onStore.mockReset();
  go('#/recall?q=deploy');
  const p = payload();
  useMapStore.setState({ status: 'ready', model: buildModel(p), payload: p, scopeKey: '*', error: null, focusId: null, hoverId: null });
  useMemoryStore.setState({ projectFilter: undefined, records: [] });
  useNeuralStore.setState({ selectedNeuronId: null });
  vi.spyOn(api, 'explainRecall').mockResolvedValue(explanation());
  vi.spyOn(api, 'recall');
  vi.spyOn(api, 'getMap').mockResolvedValue(p);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Recall view', () => {
  it('uses explain, draws included ranks on the shared map, lists omissions and opens memory links', async () => {
    render(<RecallView onStore={onStore} />);
    const first = await screen.findByRole('button', { name: /1 Ship by pushing/ });
    expect(api.explainRecall).toHaveBeenCalledWith('deploy', 2000, undefined);
    expect(api.recall).not.toHaveBeenCalled();
    expect((drawn.route as RouteStop[]).map((s) => [s.id, s.rank, s.via])).toEqual([['d', 1, 'vector'], ['a', 3, 'graph']]);
    expect(within(screen.getByRole('list')).getAllByRole('button').map((b) => b.textContent?.slice(0, 1))).toEqual(['1', '2', '3']);
    expect(row(/Trend analysis/)).toHaveTextContent('Over budget');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '14 of 2000 tokens');
    fireEvent.click(first);
    expect(useNeuralStore.getState().selectedNeuronId).toBe('d');
    expect(window.location.hash).toContain('q=deploy&m=d');
    act(() => (drawn.onPick as (id: string | null) => void)('a'));
    expect(useRouteStore.getState().route.params.m).toBe('a');
    act(() => (drawn.onPick as (id: null) => void)(null));
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    expect(camera.fit).toHaveBeenCalled();
  });

  it('keeps Exact verbatim and shares hover/focus between spans, list and canvas', async () => {
    render(<RecallView onStore={onStore} />);
    await screen.findByRole('button', { name: /1 Ship/ });
    fireEvent.mouseEnter(row(/Use encryption/));
    expect(drawn.hoverId).toBe('a');
    fireEvent.mouseLeave(row(/Use encryption/));
    expect(drawn.hoverId).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Exact' }));
    expect(screen.getByLabelText('Exact context').textContent).toBe(explanation().context);
    const span = screen.getByRole('button', { name: 'Open memory a' });
    fireEvent.mouseEnter(span);
    expect(drawn.hoverId).toBe('a');
    fireEvent.mouseLeave(span);
    fireEvent.focus(span);
    expect(drawn.focusId).toBe('a');
    act(() => (drawn.onHover as (id: string) => void)('d'));
    expect(screen.getByRole('button', { name: 'Open memory d' })).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(span, { key: ' ' });
    expect(useRouteStore.getState().route.params.m).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: 'Open memory d' }));
    expect(useRouteStore.getState().route.params.m).toBe('d');
    fireEvent.click(screen.getByRole('tab', { name: 'Route' }));
    expect(row(/Ship by pushing/)).toHaveAttribute('data-active', 'true');
  });

  it('syncs query submission, hash navigation, budgets and project scope; ignores stale responses', async () => {
    let resolveOld!: (data: RecallExplanation) => void;
    vi.mocked(api.explainRecall).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<RecallView onStore={onStore} />);
    expect(screen.getByLabelText('Question for recall')).toHaveValue('deploy');
    expect(screen.getByRole('status')).toHaveTextContent('Finding');
    fireEvent.change(screen.getByLabelText('Question for recall'), { target: { value: '  encryption  ' } });
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByRole('button', { name: /1 Ship/ });
    expect(window.location.hash).toBe('#/recall?q=encryption');
    await act(async () => resolveOld({ ...explanation(), context: 'Stale', items: [] }));
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Token budget'), { target: { value: '500' } });
    await waitFor(() => expect(api.explainRecall).toHaveBeenLastCalledWith('encryption', 500, undefined));
    act(() => useMemoryStore.setState({ projectFilter: '/project' }));
    await waitFor(() => expect(api.explainRecall).toHaveBeenLastCalledWith('encryption', 500, '/project'));
    act(() => { window.history.replaceState(null, '', '#/recall?q=back'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(screen.getByLabelText('Question for recall')).toHaveValue('back'));
    await waitFor(() => expect(api.explainRecall).toHaveBeenLastCalledWith('back', 500, '/project'));
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(api.explainRecall).toHaveBeenCalledTimes(6));
    fireEvent.change(screen.getByLabelText('Question for recall'), { target: { value: '' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(window.location.hash).toBe('#/recall');
    expect(screen.getByText('Ask a question. Follow the context.')).toBeInTheDocument();
  });

  it('steps included ranks with j/k, opens with Enter, copies with c, and switches tabs with arrows', async () => {
    render(<RecallView onStore={onStore} />);
    await screen.findByRole('button', { name: /1 Ship/ });
    fireEvent.keyDown(map(), { key: 'k' });
    expect(drawn.focusId).toBe('a');
    fireEvent.keyDown(screen.getByRole('tabpanel'), { key: 'j' });
    expect(drawn.focusId).toBe('d');
    expect(camera.reveal).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(screen.getByRole('tabpanel'), { key: 'Enter' });
    expect(useRouteStore.getState().route.params.m).toBe('d');
    fireEvent.keyDown(map(), { key: 'j', ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText('Question for recall'), { key: 'j' });
    expect(drawn.focusId).toBe('d');
    fireEvent.keyDown(map(), { key: 'c' });
    await screen.findByRole('button', { name: 'Copied' });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(explanation().context);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Route' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Exact' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Exact' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Route' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Route' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Exact' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Exact' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Route' })).toHaveFocus();
  });

  it.each(['missing', 'blocked'])('provides a selectable Exact fallback when clipboard is %s', async (mode) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<RecallView onStore={onStore} />);
    await screen.findByRole('button', { name: /1 Ship/ });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select the exact text below and copy it.');
    expect(screen.getByLabelText('Exact context').textContent).toBe(explanation().context);
    expect(screen.getByRole('tab', { name: 'Exact' })).toHaveAttribute('aria-selected', 'true');
    const span = screen.getByRole('button', { name: 'Open memory a' });
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.click(span);
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
    window.getSelection()!.removeAllRanges();
  });

  it('shows idle, no-results, loading, errors and retry without writing recall', async () => {
    go('#/recall');
    render(<RecallView onStore={onStore} />);
    expect(screen.getByText('Ask a question. Follow the context.')).toBeInTheDocument();
    expect(api.explainRecall).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    fireEvent.keyDown(map(), { key: 'c' });
    vi.mocked(api.explainRecall).mockRejectedValueOnce(new Error('Offline'));
    act(() => go('#/recall?q=none'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Recall failed: Offline');
    vi.mocked(api.explainRecall).mockResolvedValueOnce({ context: '', items: [], candidates: 0, latencyMs: 0, budget: { maxTokens: 2000, usedTokens: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No memories to hand back');
    fireEvent.click(screen.getByRole('button', { name: 'Store a memory' }));
    expect(onStore).toHaveBeenCalled();
    expect(api.recall).not.toHaveBeenCalled();
  });

  it('reports uncharted items and budget overflow; honors reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const data = explanation();
    data.budget = { usedTokens: 600, maxTokens: 500 };
    data.items[0]!.id = 'off-map';
    data.items[2]!.reason = undefined;
    vi.mocked(api.explainRecall).mockResolvedValue(data);
    render(<RecallView onStore={onStore} />);
    await screen.findByRole('button', { name: /1 Ship/ });
    expect(drawn.reduced).toBe(true);
    expect(screen.getByText(/1 included memories have no position/)).toBeInTheDocument();
    expect(screen.getByText(/top memory is always included/)).toBeInTheDocument();
    expect(row(/Trend analysis/)).toHaveTextContent('Not included');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '500');
  });

  it('keeps the explanation usable when the map fails, retries map, and reports charting/empty states', async () => {
    useMapStore.setState({ model: null, payload: null, status: 'error', error: 'Map offline' });
    render(<RecallView onStore={onStore} />);
    await screen.findByRole('button', { name: /1 Ship/ });
    expect(screen.getByRole('alert')).toHaveTextContent('Map offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry map' }));
    await screen.findByTestId('shared-map');
    act(() => useMapStore.setState({ model: null, status: 'pending' }));
    expect(screen.getByText('The map is being charted…')).toBeInTheDocument();
    act(() => useMapStore.setState({ status: 'ready' }));
    expect(screen.getByText('No memories charted yet.')).toBeInTheDocument();
  });
});


it('zooms the Recall map by keyboard without intercepting form input, and limits announcements', async () => {
  const data = explanation();
  data.context = 'x'.repeat(300);
  data.items = [{ ...base, offset: 0, chars: 300 }];
  vi.mocked(api.explainRecall).mockResolvedValue(data);
  const { container } = render(<RecallView onStore={onStore} />);
  await screen.findByRole('button', { name: /3 xxx/ });
  fireEvent.keyDown(map(), { key: '+' });
  fireEvent.keyDown(map(), { key: '-' });
  fireEvent.keyDown(map(), { key: '0' });
  expect(camera.zoomBy.mock.calls).toEqual([[1.5], [1 / 1.5]]);
  expect(camera.fit).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByLabelText('Question for recall'), { key: '+' });
  expect(camera.zoomBy).toHaveBeenCalledTimes(2);
  fireEvent.focus(row(/xxx/));
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toHaveLength(80);
});
