import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { api, ApiError, type ReviewItem } from '../../../lib/api.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { PAGE_SIZE, itemKey, summaryTotal, useReviewCount, useReviewStore } from '../queues.js';

vi.mock('../../../lib/api.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/api.js')>();
  return { ...real, api: { getReviewSummary: vi.fn(), getReviewQueue: vi.fn() } };
});

const summary = (n: Partial<Record<'contradictions' | 'duplicates' | 'fading' | 'secrets', number>> = {}) => ({
  contradictions: 0,
  duplicates: 0,
  fading: 0,
  secrets: 0,
  fingerprint: 'f',
  ...n,
});

function single(id: string): ReviewItem {
  return {
    kind: 'single',
    memory: { id, type: 'semantic', content: id, concept: null, summary: null, importance: 0.8, createdAt: '2026-10-01T00:00:00Z' },
    retention: 0.07,
    reason: 'fading-but-important',
  };
}

const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => single(`m${from + i}`));

beforeEach(() => {
  vi.mocked(api.getReviewSummary).mockReset();
  vi.mocked(api.getReviewQueue).mockReset();
  useReviewStore.setState({ scope: undefined, summary: null, summaryLoading: false, summaryFailed: false, queues: {}, cleared: 0 });
  useMemoryStore.setState({ projectFilter: undefined });
});

describe('review queues', () => {
  it('loads the first page for the scope, then the next one from where the list ends', async () => {
    vi.mocked(api.getReviewQueue)
      .mockResolvedValueOnce({ total: 60, items: page(0, PAGE_SIZE) })
      .mockResolvedValueOnce({ total: 60, items: page(PAGE_SIZE, 10) });
    const { loadQueue } = useReviewStore.getState();

    await loadQueue('fading', 'neuralCore');
    expect(api.getReviewQueue).toHaveBeenLastCalledWith('fading', { namespace: 'neuralCore', limit: PAGE_SIZE, offset: 0 });
    await loadQueue('fading', 'neuralCore', { more: true });
    expect(api.getReviewQueue).toHaveBeenLastCalledWith('fading', { namespace: 'neuralCore', limit: PAGE_SIZE, offset: PAGE_SIZE });

    const state = useReviewStore.getState().queues.fading!;
    expect(state.items.map(itemKey)).toEqual(page(0, 60).map(itemKey));
    expect(state.total).toBe(60);
  });

  it('keeps a loaded queue rather than spending another rate-limited read on it', async () => {
    vi.mocked(api.getReviewQueue).mockResolvedValue({ total: 1, items: page(0, 1) });
    const { loadQueue } = useReviewStore.getState();
    await loadQueue('fading', undefined);
    await loadQueue('fading', undefined);
    expect(api.getReviewQueue).toHaveBeenCalledTimes(1);
    await loadQueue('fading', undefined, { retry: true });
    expect(api.getReviewQueue).toHaveBeenCalledTimes(2);
  });

  it('stops paging when a page past the end comes back empty', async () => {
    vi.mocked(api.getReviewQueue)
      .mockResolvedValueOnce({ total: 5, items: page(0, 2) })
      .mockResolvedValueOnce({ total: 5, items: [] });
    const { loadQueue } = useReviewStore.getState();
    await loadQueue('fading', undefined);
    await loadQueue('fading', undefined, { more: true });
    expect(useReviewStore.getState().queues.fading!.total).toBe(2);
  });

  it('starts over when the scope changes, and drops a reply for the old scope', async () => {
    let answer: (v: { total: number; items: ReviewItem[] }) => void = () => {};
    vi.mocked(api.getReviewQueue).mockImplementationOnce(() => new Promise((r) => (answer = r)));
    vi.mocked(api.getReviewQueue).mockResolvedValueOnce({ total: 1, items: page(9, 1) });
    const { loadQueue } = useReviewStore.getState();

    const first = loadQueue('fading', 'a');
    await loadQueue('fading', null);
    answer({ total: 3, items: page(0, 3) });
    await first;

    const s = useReviewStore.getState();
    expect(s.scope).toBeNull();
    expect(s.queues.fading!.items.map(itemKey)).toEqual(['m9']);
    expect(api.getReviewQueue).toHaveBeenLastCalledWith('fading', { namespace: null, limit: PAGE_SIZE, offset: 0 });
  });

  it('states a failed load, and leaves a 401 to the unlock gate', async () => {
    vi.mocked(api.getReviewQueue).mockRejectedValueOnce(new ApiError(429, "Rate limit exceeded for the 'whole-store' tier. Retry in 60s."));
    await useReviewStore.getState().loadQueue('secrets', undefined);
    expect(useReviewStore.getState().queues.secrets!.error).toMatch(/Retry in 60s/);

    vi.mocked(api.getReviewQueue).mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    await useReviewStore.getState().loadQueue('secrets', undefined, { retry: true });
    expect(useReviewStore.getState().queues.secrets!.error).toBeNull();
  });

  it('takes settled items out of the list, the total, the summary, and counts them cleared', async () => {
    vi.mocked(api.getReviewSummary).mockResolvedValue(summary({ fading: 3, duplicates: 4 }));
    vi.mocked(api.getReviewQueue).mockResolvedValue({ total: 3, items: page(0, 3) });
    const s = useReviewStore.getState();
    await s.loadSummary(undefined);
    await s.loadQueue('fading', undefined);
    s.remove('fading', ['m1', 'nope']);

    const after = useReviewStore.getState();
    expect(after.queues.fading!.items.map(itemKey)).toEqual(['m0', 'm2']);
    expect(after.queues.fading!.total).toBe(2);
    expect(after.summary!.fading).toBe(2);
    expect(summaryTotal(after.summary)).toBe(6);
    expect(after.cleared).toBe(1);
  });

  it('undo restores only its own rows and counts, preserving later actions', async () => {
    vi.mocked(api.getReviewSummary).mockResolvedValue(summary({ fading: 3 }));
    vi.mocked(api.getReviewQueue).mockResolvedValue({ total: 3, items: page(0, 3) });
    const s = useReviewStore.getState();
    await s.loadSummary(undefined);
    await s.loadQueue('fading', undefined);
    const undo = s.remove('fading', ['m0']);
    s.remove('fading', ['m2']);
    undo();
    undo();
    expect(useReviewStore.getState().queues.fading!.items.map(itemKey)).toEqual(['m0', 'm1']);
    expect(useReviewStore.getState().summary!.fading).toBe(2);
    expect(useReviewStore.getState().cleared).toBe(1);
  });

  it('undo never inserts rows from an old project into the current queue', async () => {
    vi.mocked(api.getReviewQueue).mockResolvedValueOnce({ total: 1, items: page(0, 1) }).mockResolvedValueOnce({ total: 1, items: page(9, 1) });
    const s = useReviewStore.getState();
    await s.loadQueue('fading', 'old');
    const undo = s.remove('fading', ['m0']);
    await s.loadQueue('fading', 'new');
    undo();
    expect(useReviewStore.getState().queues.fading!.items.map(itemKey)).toEqual(['m9']);
  });

  it('syncs a tab count with the list it just loaded', async () => {
    vi.mocked(api.getReviewSummary).mockResolvedValue(summary({ secrets: 4 }));
    vi.mocked(api.getReviewQueue).mockResolvedValue({ total: 2, items: page(0, 2) });
    await useReviewStore.getState().loadSummary(undefined);
    await useReviewStore.getState().loadQueue('secrets', undefined);
    expect(useReviewStore.getState().summary!.secrets).toBe(2);
  });
});

describe('useReviewCount (the rail badge)', () => {
  it('counts every queue for the current scope and asks again when the scope changes', async () => {
    vi.mocked(api.getReviewSummary)
      .mockResolvedValueOnce(summary({ contradictions: 1400, duplicates: 98 }))
      .mockResolvedValueOnce(summary({ fading: 2 }));
    const { result } = renderHook(() => useReviewCount());
    await waitFor(() => expect(result.current).toBe(1498));
    expect(api.getReviewSummary).toHaveBeenLastCalledWith(undefined);

    act(() => useMemoryStore.setState({ projectFilter: 'neuralCore' }));
    await waitFor(() => expect(result.current).toBe(2));
    expect(api.getReviewSummary).toHaveBeenLastCalledWith('neuralCore');
  });

  it('stays empty when the summary cannot load', async () => {
    vi.mocked(api.getReviewSummary).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useReviewCount());
    await waitFor(() => expect(api.getReviewSummary).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });
});
