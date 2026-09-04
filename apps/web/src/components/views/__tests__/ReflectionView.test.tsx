import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import ReflectionView from '../ReflectionView.js';
import { useReflectionStore } from '../../../store/reflectionStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    getReflections: vi.fn(),
    getReflectionStatus: vi.fn(),
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
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function insight(overrides: Partial<{ id: string; type: string; content: string; createdAt: string }> = {}) {
  return {
    id: 'i1',
    type: 'pattern',
    content: 'default insight',
    importance: 0.5,
    confidence: 0.5,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useReflectionStore.setState({
    insights: [], status: null, loading: false, filterType: null, error: null,
  });
}

describe('ReflectionView filter race (W6)', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(api.getReflections).mockReset();
    vi.mocked(api.getReflectionStatus).mockReset();
    vi.mocked(api.getReflectionStatus).mockResolvedValue({ enabled: true, due: false, counter: 1, threshold: 10 });
  });

  it('does not let a slow "Pattern" response overwrite the "Trend" tab it was superseded by', async () => {
    const patternRes = deferred<{ count: number; reflections: ReturnType<typeof insight>[] }>();
    const trendRes = deferred<{ count: number; reflections: ReturnType<typeof insight>[] }>();
    // Call #1 is the initial mount's fetch (filterType starts at null/"All").
    vi.mocked(api.getReflections)
      .mockResolvedValueOnce({ count: 0, reflections: [] })
      .mockReturnValueOnce(patternRes.promise)
      .mockReturnValueOnce(trendRes.promise);

    render(<ReflectionView />);
    await waitFor(() => expect(api.getReflections).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /pattern/i }));
    fireEvent.click(screen.getByRole('button', { name: /trend/i }));

    await act(async () => {
      trendRes.resolve({ count: 1, reflections: [insight({ id: 'trend-1', type: 'trend', content: 'trend insight' })] });
      await trendRes.promise;
    });
    await waitFor(() => expect(screen.getByText('trend insight')).toBeInTheDocument());

    await act(async () => {
      patternRes.resolve({ count: 1, reflections: [insight({ id: 'pattern-1', type: 'pattern', content: 'pattern insight' })] });
      await patternRes.promise;
    });

    expect(screen.getByText('trend insight')).toBeInTheDocument();
    expect(screen.queryByText('pattern insight')).not.toBeInTheDocument();
  });
});

describe('ReflectionView unparsable insight date (W10)', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(api.getReflections).mockReset();
    vi.mocked(api.getReflectionStatus).mockReset();
    vi.mocked(api.getReflectionStatus).mockResolvedValue({ enabled: true, due: false, counter: 1, threshold: 10 });
  });

  it('does not crash rendering an insight with an unparsable createdAt', async () => {
    vi.mocked(api.getReflections).mockResolvedValueOnce({
      count: 1,
      reflections: [insight({ id: 'bad', content: 'corrupted insight', createdAt: 'not-a-real-date' })],
    });

    render(<ReflectionView />);

    await waitFor(() => expect(screen.getByText('corrupted insight')).toBeInTheDocument());
  });
});

describe('ReflectionView stale error banner (W6)', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(api.getReflections).mockReset();
    vi.mocked(api.getReflectionStatus).mockReset();
    vi.mocked(api.getReflectionStatus).mockResolvedValue({ enabled: true, due: false, counter: 1, threshold: 10 });
  });

  it('clears an old error banner once a later reload succeeds, without the user dismissing it', async () => {
    vi.mocked(api.getReflections).mockRejectedValueOnce(new Error('boom'));
    const { rerender } = render(<ReflectionView />);
    await waitFor(() => expect(screen.getByText(/could not reach engram api/i)).toBeInTheDocument());

    vi.mocked(api.getReflections).mockResolvedValueOnce({ count: 1, reflections: [insight({ content: 'fresh insight' })] });
    // A later successful reload — e.g. the user switches the filter — must
    // clear the stale banner on its own.
    fireEvent.click(screen.getByRole('button', { name: /pattern/i }));
    rerender(<ReflectionView />);

    await waitFor(() => expect(screen.getByText('fresh insight')).toBeInTheDocument());
    expect(screen.queryByText(/could not reach engram api/i)).not.toBeInTheDocument();
  });
});

describe('ReflectionView card body (H3, H4)', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(api.getReflections).mockReset();
    vi.mocked(api.getReflectionStatus).mockReset();
    vi.mocked(api.getReflectionStatus).mockResolvedValue({ enabled: true, due: false, counter: 1, threshold: 10 });
  });

  it('caps the running text at a readable measure — it ran ~205 characters per line', async () => {
    vi.mocked(api.getReflections).mockResolvedValue({
      count: 1,
      reflections: [insight({ id: 'r1', content: 'A long reflection body.' })],
    });
    render(<ReflectionView />);

    const body = await screen.findByText('A long reflection body.');
    expect(body.style.maxWidth).toBe('68ch');
  });

  it('leaves the card itself full width — only the paragraph is capped', async () => {
    vi.mocked(api.getReflections).mockResolvedValue({
      count: 1,
      reflections: [insight({ id: 'r1', content: 'Body' })],
    });
    render(<ReflectionView />);

    const card = (await screen.findByText('Body')).parentElement!;
    expect(card.style.maxWidth).toBe('');
  });

  it('strips the Markdown the body used to print literally', async () => {
    vi.mocked(api.getReflections).mockResolvedValue({
      count: 1,
      reflections: [insight({ id: 'r1', content: '# Memory Analysis\n**Most Significant Contradiction:** none' })],
    });
    render(<ReflectionView />);

    expect(await screen.findByText('Memory Analysis Most Significant Contradiction: none')).toBeInTheDocument();
  });

  it('keeps the empty state copy the review called the best-designed surface in the product', async () => {
    vi.mocked(api.getReflections).mockResolvedValue({ count: 0, reflections: [] });
    render(<ReflectionView />);

    expect(await screen.findByText('No reflections yet')).toBeInTheDocument();
    expect(screen.getByText(/Reflections are generated by the AI connected to Engram via MCP/)).toBeInTheDocument();
  });
});
