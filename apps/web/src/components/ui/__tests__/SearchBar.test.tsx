import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchBar from '../SearchBar.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    search: vi.fn(),
    recall: vi.fn(),
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resetStore() {
  useMemoryStore.setState({
    records: [],
    searchResults: [],
    searchQuery: '',
    isSearching: false,
    totalCount: 0,
    currentContext: '',
    recallLatencyMs: null,
    highlightedIds: new Set(),
  });
}

describe('SearchBar race conditions and error handling (W4)', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(api.search).mockReset();
    vi.mocked(api.recall).mockReset();
  });

  it('ignores a second Enter while the first search is still in flight — the guard the button already had', async () => {
    const first = deferred<{ count: number; results: unknown[] }>();
    const firstRecall = deferred<{ context: string; memories: unknown[]; latencyMs: number }>();
    vi.mocked(api.search).mockReturnValueOnce(first.promise);
    vi.mocked(api.recall).mockReturnValueOnce(firstRecall.promise);

    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/ask your memory/i);

    fireEvent.change(input, { target: { value: 'auth' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Original bug: onKeyDown never checked `loading`, so this second Enter
    // (while the first search is still pending) fired a second api.search
    // call — exactly what the button's disabled={loading} already prevented
    // on click.
    fireEvent.change(input, { target: { value: 'auth token' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(api.search).toHaveBeenCalledTimes(1);

    first.resolve({ count: 0, results: [] });
    firstRecall.resolve({ context: '', memories: [], latencyMs: 1 });
    await waitFor(() => expect(screen.queryByTitle('Search (Enter)')).not.toBeDisabled());
  });

  it('does not let a stale, slow-to-resolve search overwrite a newer one', async () => {
    const first = deferred<{ count: number; results: unknown[] }>();
    const firstRecall = deferred<{ context: string; memories: unknown[]; latencyMs: number }>();

    vi.mocked(api.search).mockReturnValueOnce(first.promise);
    vi.mocked(api.recall).mockReturnValueOnce(firstRecall.promise);

    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/ask your memory/i);

    fireEvent.change(input, { target: { value: 'auth' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // First search's finally() unblocks the guard by resolving both legs...
    first.resolve({ count: 1, results: [{ id: 'auth-result', type: 'semantic', content: 'auth', summary: null, importance: 0.5, source: null, concept: null, tags: '[]', createdAt: '2026-01-01T00:00:00.000Z' }] });
    firstRecall.resolve({ context: 'auth context', memories: [], latencyMs: 5 });
    await waitFor(() => expect(useMemoryStore.getState().searchQuery).toBe('auth'));

    // Now the second, superseding search — its response must win even if a
    // slow duplicate/retry of the first somehow resolved again afterwards.
    const second = deferred<{ count: number; results: unknown[] }>();
    const secondRecall = deferred<{ context: string; memories: unknown[]; latencyMs: number }>();
    vi.mocked(api.search).mockReturnValueOnce(second.promise);
    vi.mocked(api.recall).mockReturnValueOnce(secondRecall.promise);

    fireEvent.change(input, { target: { value: 'auth token' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    second.resolve({ count: 1, results: [{ id: 'auth-token-result', type: 'semantic', content: 'auth token', summary: null, importance: 0.5, source: null, concept: null, tags: '[]', createdAt: '2026-01-01T00:00:00.000Z' }] });
    secondRecall.resolve({ context: 'auth token context', memories: [], latencyMs: 5 });

    await waitFor(() => expect(useMemoryStore.getState().searchQuery).toBe('auth token'));
    expect(useMemoryStore.getState().searchResults).toEqual([
      expect.objectContaining({ id: 'auth-token-result' }),
    ]);
  });

  it('surfaces a failed search to the user instead of only logging it, and does not relabel stale results under the failed query', async () => {
    resetStore();
    const failing = deferred<{ count: number; results: unknown[] }>();
    vi.mocked(api.search).mockReturnValueOnce(failing.promise);
    vi.mocked(api.recall).mockReturnValueOnce(
      deferred<{ context: string; memories: unknown[]; latencyMs: number }>().promise
    );

    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/ask your memory/i);
    fireEvent.change(input, { target: { value: 'auth' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    failing.reject(new Error('network down'));

    // console.error alone is not user-facing error handling.
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    // The query never committed — no stale "semantic recall active" label
    // pointing at a query whose results never arrived.
    expect(useMemoryStore.getState().searchQuery).toBe('');
  });
});

describe('SearchBar controls (M5, M6)', () => {
  it('makes the search input inherit the body font — it computed to Arial while the body was Inter', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/ask your memory anything/i).style.fontFamily).toBe('inherit');
  });

  it('keeps the clear button at the 24px minimum target', () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByPlaceholderText(/ask your memory anything/i), { target: { value: 'auth' } });

    const clear = screen.getByTitle(/clear/i);
    expect(clear.style.width).toBe('24px');
    expect(clear.style.height).toBe('24px');
  });
});
