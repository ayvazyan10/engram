import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, ApiError, type ReviewItem, type ReviewMemory, type ReviewQueue } from '../../../lib/api.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { useRouteStore } from '../../../shell/routeStore.js';
import Toasts, { useToasts } from '../../../shell/Toasts.js';
import ReviewView from '../ReviewView.js';
import { PAGE_SIZE, useReviewStore } from '../queues.js';

vi.mock('../../../lib/api.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/api.js')>();
  return {
    ...real,
    api: {
      getReviewSummary: vi.fn(),
      getReviewQueue: vi.fn(),
      dismissReview: vi.fn(),
      redactMemory: vi.fn(),
      resolveContradiction: vi.fn(),
      addTag: vi.fn(),
      bulkTag: vi.fn(),
      bulkArchive: vi.fn(),
      getDecayPolicy: vi.fn(),
      // Nothing in Review may read a memory's full record: that is where an
      // unmasked secret would come from.
      listMemories: vi.fn(),
      getGraph: vi.fn(),
    },
  };
});

function memory(id: string, content: string, extra: Partial<ReviewMemory> = {}): ReviewMemory {
  return { id, type: 'semantic', content, concept: null, summary: null, importance: 0.7, createdAt: '2026-10-01T10:00:00.000Z', ...extra };
}

function pair(n: number, a = `The app uses Postgres ${n}`, b = `The app uses MongoDB ${n}`): ReviewItem {
  return {
    kind: 'pair',
    a: memory(`a${n}`, a, { createdAt: '2026-10-02T10:00:00.000Z' }),
    b: memory(`b${n}`, b, { createdAt: '2026-10-01T10:00:00.000Z' }),
    edgeId: `e${n}`,
    strength: 0.82,
    sharedWordRatio: 0.4,
  };
}

function fading(n: number): ReviewItem {
  return { kind: 'single', memory: memory(`f${n}`, `Deploy runbook ${n}`, { importance: 0.9 }), retention: 0.07, reason: 'fading-but-important' };
}

/** A real-looking token the server would never send: it must not reach the screen. */
const RAW = 'ghp_' + 'Q7'.repeat(18);

function secret(n: number): ReviewItem {
  return {
    kind: 'single',
    memory: memory(`s${n}`, 'CI deploy token: [REDACTED] with repo scope', { concept: 'Token [REDACTED]' }),
    retention: 0.5,
    reason: 'possible-secret',
    findings: [
      { rule: 'github-token', field: 'content', start: 18, end: 58, length: 40, preview: 'ghp_****Q7Q7' },
      { rule: 'keyword-assignment', field: 'concept', start: 6, end: 30, length: 24, preview: '****ab12' },
    ],
  };
}

const SUMMARY = { contradictions: 3, duplicates: 2, fading: 1, secrets: 1, fingerprint: 'f' };

function serve(queues: Partial<Record<ReviewQueue, ReviewItem[]>>, totals: Partial<Record<ReviewQueue, number>> = {}) {
  vi.mocked(api.getReviewQueue).mockImplementation(async (queue, params = {}) => {
    const all = queues[queue] ?? [];
    const offset = params.offset ?? 0;
    return { total: totals[queue] ?? all.length, items: all.slice(offset, offset + (params.limit ?? PAGE_SIZE)) };
  });
}

function go(hash: string) {
  act(() => useRouteStore.getState().navigate(hash));
}

function press(key: string, target: Element | Window = window) {
  act(() => {
    fireEvent.keyDown(target, { key });
  });
}

function view() {
  return render(
    <>
      <ReviewView />
      <Toasts />
    </>
  );
}

const toast = () => useToasts.getState().toast?.message;

beforeEach(() => {
  vi.clearAllMocks();
  // Reduced motion: a settled card leaves at once, so no test waits on the exit.
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList);
  useReviewStore.setState({ scope: undefined, summary: null, summaryLoading: false, summaryFailed: false, queues: {}, cleared: 0 });
  useMemoryStore.setState({ projectFilter: undefined });
  useToasts.setState({ toast: null, visible: false });
  vi.mocked(api.getReviewSummary).mockResolvedValue(SUMMARY);
  vi.mocked(api.getDecayPolicy).mockResolvedValue({ halfLifeDays: 7, archiveThreshold: 0.05 });
  vi.mocked(api.bulkArchive).mockResolvedValue({ archived: 1, total: 1 });
  vi.mocked(api.bulkTag).mockResolvedValue({ modified: 1, total: 1 });
  vi.mocked(api.dismissReview).mockResolvedValue(undefined);
  vi.mocked(api.resolveContradiction).mockResolvedValue({ resolved: true });
  vi.mocked(api.addTag).mockResolvedValue({ id: 'f1', tags: ['pinned'] });
  serve({ contradictions: [pair(1), pair(2), pair(3)], duplicates: [pair(4), pair(5)], fading: [fading(1)], secrets: [secret(1)] });
  go('/review/contradictions');
});

describe('Review: queues and counts', () => {
  it('counts what waits in each queue and opens the first pair with its differences highlighted', async () => {
    view();
    expect(await screen.findByRole('heading', { name: 'Do these really disagree?' })).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    const queues = screen.getByRole('navigation', { name: 'Review queues' });
    expect(within(queues).getByRole('link', { name: /Contradictions\s*3/ })).toHaveAttribute('aria-current', 'page');
    expect(within(queues).getByRole('link', { name: /Near-duplicates\s*2/ })).toHaveAttribute('href', '#/review/duplicates');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    const first = screen.getByRole('region', { name: 'First memory' });
    expect(within(first).getByText('Postgres').tagName).toBe('MARK');
    expect(within(screen.getByRole('region', { name: 'Second memory' })).getByText('MongoDB').tagName).toBe('MARK');
    expect(within(first).getByRole('link', { name: 'Open the first memory' })).toHaveAttribute('href', '#/review/contradictions?m=a1');
  });

  it('says when the two texts are identical, with nothing to highlight', async () => {
    serve({ contradictions: [pair(1, 'Same words here', 'Same words here')], duplicates: [pair(2, 'x y', 'x y')] });
    view();
    expect(await screen.findByRole('heading', { name: 'The same note, stored twice' })).toBeInTheDocument();
    expect(screen.getByText(/but the text is identical/)).toBeInTheDocument();
    expect(document.querySelector('mark')).toBeNull();
    go('/review/duplicates');
    expect(await screen.findByText(/near-duplicates \(similarity 0.82\)\. The text is identical/)).toBeInTheDocument();
  });

  it('opens the first queue with something waiting when no queue is named', async () => {
    vi.mocked(api.getReviewSummary).mockResolvedValue({ ...SUMMARY, contradictions: 0 });
    serve({ duplicates: [pair(4)] });
    go('/review');
    view();
    expect(await screen.findByRole('heading', { name: 'Nearly the same note' })).toBeInTheDocument();
  });

  it('asks for the queue in the current project scope', async () => {
    useMemoryStore.setState({ projectFilter: null });
    view();
    await screen.findByRole('heading', { name: 'Do these really disagree?' });
    expect(api.getReviewSummary).toHaveBeenCalledWith(null);
    expect(api.getReviewQueue).toHaveBeenCalledWith('contradictions', { namespace: null, limit: PAGE_SIZE, offset: 0 });
  });

  it('loads the next page as the reader nears the end of this one, and on Show more', async () => {
    const many = Array.from({ length: PAGE_SIZE + 4 }, (_, i) => pair(i + 1));
    serve({ contradictions: many });
    view();
    await screen.findByText(`1 of ${PAGE_SIZE + 4}`);
    expect(screen.getByRole('button', { name: 'Show 4 more' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 4 more' }));
    await waitFor(() => expect(api.getReviewQueue).toHaveBeenLastCalledWith('contradictions', { namespace: undefined, limit: PAGE_SIZE, offset: PAGE_SIZE }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument());
    expect(within(screen.getByRole('list', { name: /Contradictions/ })).getAllByRole('listitem')).toHaveLength(PAGE_SIZE + 4);
  });

  it('prefetches when j reaches the last loaded items', async () => {
    serve({ contradictions: [pair(1), pair(2), pair(3), pair(4), pair(5)] }, { contradictions: 9 });
    vi.mocked(api.getReviewQueue).mockResolvedValueOnce({ total: 9, items: [pair(1), pair(2), pair(3), pair(4), pair(5)] });
    view();
    await screen.findByText('1 of 9');
    expect(api.getReviewQueue).toHaveBeenCalledTimes(1);
    press('j');
    press('j');
    await waitFor(() => expect(api.getReviewQueue).toHaveBeenCalledWith('contradictions', { namespace: undefined, limit: PAGE_SIZE, offset: 5 }));
  });

  it('states a failed load and tries again', async () => {
    vi.mocked(api.getReviewQueue).mockRejectedValueOnce(new ApiError(429, 'Rate limit exceeded. Retry in 60s.'));
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load contradictions');
    expect(screen.getByRole('alert')).toHaveTextContent('Retry in 60s.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Do these really disagree?' })).toBeInTheDocument();
  });

  it('shows the load in progress, then says all clear and points at the next queue', async () => {
    let answer: (v: { total: number; items: ReviewItem[] }) => void = () => {};
    vi.mocked(api.getReviewQueue).mockImplementationOnce(() => new Promise((r) => (answer = r)));
    view();
    expect(await screen.findByText('Loading contradictions…')).toBeInTheDocument();
    await act(async () => answer({ total: 0, items: [] }));
    expect(await screen.findByRole('heading', { name: 'All clear' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next: Near-duplicates (2)' })).toHaveAttribute('href', '#/review/duplicates');
  });
});

describe('Review: keyboard triage', () => {
  it('moves with j and k, and selects with x', async () => {
    view();
    await screen.findByText('1 of 3');
    press('j');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    press('j');
    press('j');
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    press('k');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    press('x');
    expect(screen.getByRole('toolbar', { name: '1 selected' })).toBeInTheDocument();
    press('Escape');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('keeps the first with 1: the second is archived and the count goes down', async () => {
    view();
    await screen.findByText('1 of 3');
    press('1');
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeInTheDocument());
    expect(api.bulkArchive).toHaveBeenCalledWith(['b1']);
    expect(toast()).toBe('Kept the first memory. The other is archived.');
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/cleared/)).toHaveTextContent('1 cleared');
  });

  it('hands focus to the next card, and drops a settled item from the selection', async () => {
    view();
    await screen.findByText('1 of 3');
    press('x');
    screen.getAllByRole('button', { name: /Keep this one/ })[0]!.focus();
    press('1');
    await waitFor(() => expect(document.activeElement).toHaveClass('rv-card'));
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('keeps the second with 2', async () => {
    view();
    await screen.findByText('1 of 3');
    press('2');
    await waitFor(() => expect(api.bulkArchive).toHaveBeenCalledWith(['a1']));
    await waitFor(() => expect(toast()).toBe('Kept the second memory. The other is archived.'));
  });

  it('resolves "not a contradiction" with d as keep-both', async () => {
    view();
    await screen.findByText('1 of 3');
    press('d');
    await waitFor(() => expect(api.resolveContradiction).toHaveBeenCalledWith('a1', 'b1', 'keep_both'));
    await waitFor(() => expect(toast()).toBe('Marked as not a contradiction.'));
  });

  it('dismisses a near-duplicate pair with d, both ids', async () => {
    go('/review/duplicates');
    view();
    await screen.findByText('1 of 2');
    press('d');
    await waitFor(() => expect(api.dismissReview).toHaveBeenCalledWith('duplicates', ['a4', 'b4']));
    await waitFor(() => expect(toast()).toBe('Kept both.'));
  });

  it('pins a fading memory with p, and lets one fade with d', async () => {
    serve({ fading: [fading(1), fading(2)] });
    go('/review/fading');
    view();
    expect(await screen.findByRole('heading', { name: 'Important, but fading' })).toBeInTheDocument();
    expect(await screen.findByText(/Below 5% the decay sweep archives it/)).toBeInTheDocument();
    press('p');
    await waitFor(() => expect(api.addTag).toHaveBeenCalledWith('f1', 'pinned'));
    await screen.findByText('1 of 1');
    press('d');
    await waitFor(() => expect(api.dismissReview).toHaveBeenCalledWith('fading', ['f2']));
    await waitFor(() => expect(toast()).toBe('Left to fade.'));
  });

  it('opens the memory with o, over the current route', async () => {
    view();
    await screen.findByText('1 of 3');
    press('o');
    expect(useRouteStore.getState().route.params.m).toBe('a1');
    expect(useRouteStore.getState().route.name).toBe('review');
  });

  it('switches queues with [ and ]', async () => {
    view();
    await screen.findByText('1 of 3');
    press(']');
    expect(useRouteStore.getState().route.sub).toBe('duplicates');
    press('[');
    press('[');
    expect(useRouteStore.getState().route.sub).toBe('secrets');
  });

  it('ignores keys while typing, with a modifier, or as the second key of a g jump', async () => {
    view();
    await screen.findByText('1 of 3');
    press('x');
    const input = screen.getByRole('button', { name: 'Tag…' });
    fireEvent.click(input);
    press('j', screen.getByRole('textbox', { name: 'Tag' }));
    act(() => {
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    });
    press('g');
    press('j');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('says so when the action fails, and keeps the item', async () => {
    vi.mocked(api.resolveContradiction).mockRejectedValueOnce(new ApiError(500, 'Database is locked'));
    view();
    await screen.findByText('1 of 3');
    press('d');
    await waitFor(() => expect(toast()).toBe('Could not do that: Database is locked'));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('drops an item whose memory is already gone', async () => {
    vi.mocked(api.resolveContradiction).mockRejectedValueOnce(new ApiError(404, 'Memory not found'));
    view();
    await screen.findByText('1 of 3');
    fireEvent.click(screen.getByRole('button', { name: /Not a contradiction/ }));
    await waitFor(() => expect(toast()).toBe('That memory is no longer there.'));
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });
});

describe('Review: redact', () => {
  it('asks first, showing only masked previews, and never puts a secret on screen', async () => {
    vi.mocked(api.redactMemory).mockResolvedValue({ id: 's1', redacted: 2 });
    go('/review/secrets');
    view();
    expect(await screen.findByRole('heading', { name: 'This looks like a secret' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'hidden value' })).toHaveLength(2);
    expect(screen.getAllByText('ghp_****Q7Q7')).toHaveLength(1);

    press('r');
    const confirm = screen.getByRole('group', { name: 'Confirm redaction' });
    expect(confirm).toHaveTextContent('Replace these 2 values with [REDACTED]?');
    expect(within(confirm).getByText('ghp_****Q7Q7')).toBeInTheDocument();
    expect(within(confirm).getByText('****ab12')).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Redact 2 values' })).toHaveFocus();
    expect(api.redactMemory).not.toHaveBeenCalled();

    // Whatever is on screen, the raw value never is, and nothing fetched a full memory.
    expect(document.body.textContent).not.toContain(RAW);
    expect(document.body.textContent).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(api.listMemories).not.toHaveBeenCalled();
    expect(api.getGraph).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Redact 2 values' }));
    await waitFor(() => expect(api.redactMemory).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(toast()).toBe('Redacted 2 values. The memory stays.'));
    expect(await screen.findByRole('heading', { name: 'All clear' })).toBeInTheDocument();
  });

  it('cancels with Escape or Cancel and sends nothing', async () => {
    go('/review/secrets');
    view();
    await screen.findByRole('heading', { name: 'This looks like a secret' });
    fireEvent.click(screen.getByRole('button', { name: /^Redact/ }));
    press('Escape', screen.getByRole('group', { name: 'Confirm redaction' }));
    expect(screen.queryByRole('group', { name: 'Confirm redaction' })).not.toBeInTheDocument();
    press('r');
    // Keys other than the dialog's own do nothing while it is open.
    press('d');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(api.redactMemory).not.toHaveBeenCalled();
    expect(api.dismissReview).not.toHaveBeenCalled();
  });

  it('drops the item when there is nothing left to redact', async () => {
    vi.mocked(api.redactMemory).mockRejectedValue(new ApiError(409, 'Nothing to redact'));
    go('/review/secrets');
    view();
    await screen.findByRole('heading', { name: 'This looks like a secret' });
    press('r');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 2 values' }));
    await waitFor(() => expect(toast()).toBe('Nothing left to redact.'));
  });

  it('marks not a secret with d, and archives with a', async () => {
    serve({ secrets: [secret(1), secret(2)] });
    go('/review/secrets');
    view();
    await screen.findByText('1 of 2');
    press('d');
    await waitFor(() => expect(api.dismissReview).toHaveBeenCalledWith('secrets', ['s1']));
    await screen.findByText('1 of 1');
    press('a');
    await waitFor(() => expect(api.bulkArchive).toHaveBeenCalledWith(['s2']));
    await waitFor(() => expect(toast()).toBe('Archived.'));
  });
});

describe('Review: bulk', () => {
  it('tags both sides of every selected pair', async () => {
    view();
    await screen.findByText('1 of 3');
    fireEvent.click(screen.getByRole('checkbox', { name: /Select The app uses Postgres 1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select The app uses Postgres 2/ }));
    const bar = screen.getByRole('toolbar', { name: '2 selected' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Tag…' }));
    fireEvent.change(within(bar).getByRole('textbox', { name: 'Tag' }), { target: { value: 'checked' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Add tag' }));
    await waitFor(() => expect(api.bulkTag).toHaveBeenCalledWith(['a1', 'b1', 'a2', 'b2'], 'checked'));
    await waitFor(() => expect(toast()).toBe('Tagged 4 memories “checked”.'));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('archives the older of each selected pair', async () => {
    view();
    await screen.findByText('1 of 3');
    fireEvent.click(screen.getByRole('checkbox', { name: /Postgres 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all loaded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive older' }));
    await waitFor(() => expect(api.bulkArchive).toHaveBeenCalledWith(['b1', 'b2', 'b3']));
    expect(await screen.findByRole('heading', { name: 'All clear' })).toBeInTheDocument();
    expect(toast()).toBe('Kept the newer of 3 pairs; the older ones are archived.');
  });

  it('marks many as not contradictions, one at a time, and reports any that failed', async () => {
    vi.mocked(api.resolveContradiction).mockResolvedValueOnce({ resolved: true }).mockRejectedValueOnce(new Error('busy'));
    view();
    await screen.findByText('1 of 3');
    fireEvent.click(screen.getByRole('checkbox', { name: /Postgres 1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Postgres 2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Not contradictions' }));
    await waitFor(() => expect(toast()).toBe('Marked as not a contradiction: 1 pair. 1 could not be changed: busy'));
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('pins and archives selected fading memories', async () => {
    serve({ fading: [fading(1), fading(2), fading(3)] });
    go('/review/fading');
    view();
    await screen.findByText('1 of 3');
    press('x');
    press('j');
    press('x');
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(api.bulkTag).toHaveBeenCalledWith(['f1', 'f2'], 'pinned'));
    await waitFor(() => expect(toast()).toBe('Pinned 2 memories.'));
    press('x');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.bulkArchive).toHaveBeenCalledWith(['f3']));
    await waitFor(() => expect(toast()).toBe('Archived 1 memory.'));
  });

  it('says so when a bulk call fails', async () => {
    vi.mocked(api.bulkArchive).mockRejectedValueOnce(new Error('Too many'));
    view();
    await screen.findByText('1 of 3');
    press('x');
    fireEvent.click(screen.getByRole('button', { name: 'Archive older' }));
    await waitFor(() => expect(toast()).toBe('Could not do that: Too many'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});
