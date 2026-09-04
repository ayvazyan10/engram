import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineView from '../TimelineView.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';

// H6: the timeline's "N of M" caption reads the server census.
vi.mock('../../../lib/serverStats.js', () => ({
  useServerStats: () => ({ total: 653, byType: {}, bySource: {} }),
}));

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

describe('TimelineView', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [] });
  });

  it('shows the empty state with no records', () => {
    render(<TimelineView />);
    expect(screen.getByText(/no memories yet/i)).toBeInTheDocument();
  });

  it('groups records by day and renders them', () => {
    useMemoryStore.setState({
      records: [
        makeRecord({ id: 'a', content: 'First memory', createdAt: '2026-01-01T10:00:00.000Z' }),
        makeRecord({ id: 'b', content: 'Second memory', createdAt: '2026-01-02T10:00:00.000Z' }),
      ],
    });
    render(<TimelineView />);
    expect(screen.getByText('First memory')).toBeInTheDocument();
    expect(screen.getByText('Second memory')).toBeInTheDocument();
  });

  it('does not crash on an unparsable createdAt — one bad row must not blank the view (W10)', () => {
    useMemoryStore.setState({
      records: [
        makeRecord({ id: 'bad', content: 'Corrupted row', createdAt: 'not-a-real-date' }),
        makeRecord({ id: 'good', content: 'Fine row', createdAt: '2026-01-01T10:00:00.000Z' }),
      ],
    });
    expect(() => render(<TimelineView />)).not.toThrow();
    expect(screen.getByText('Corrupted row')).toBeInTheDocument();
    expect(screen.getByText('Fine row')).toBeInTheDocument();
  });
});

describe('TimelineView load states (H2 — a failed load read as an empty store)', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [] });
  });

  it('says it is loading rather than claiming there are no memories', () => {
    render(<TimelineView loading error={null} onRetry={() => {}} />);
    expect(screen.getByText(/loading memories/i)).toBeInTheDocument();
    expect(screen.queryByText(/no memories yet/i)).not.toBeInTheDocument();
  });

  it('shows a distinct, retryable error state — not "No memories yet"', () => {
    const onRetry = vi.fn();
    render(<TimelineView loading={false} error="Unauthorized" onRetry={onRetry} />);

    expect(screen.getByText(/could not load memories/i)).toBeInTheDocument();
    expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
    expect(screen.queryByText(/no memories yet/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the genuinely-empty copy for a genuinely empty store', () => {
    render(<TimelineView loading={false} error={null} />);
    expect(screen.getByText(/no memories yet\. store something to see the timeline\./i)).toBeInTheDocument();
  });

  it('keeps showing the memories it has when a later refresh fails', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', content: 'Still here' })] });
    render(<TimelineView loading={false} error="network down" />);
    expect(screen.getByText('Still here')).toBeInTheDocument();
  });
});

describe('TimelineView card content', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [] });
  });

  it('says how much of the store it is showing (H6) — it rendered 200 cards silently', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a' })] });
    render(<TimelineView />);
    expect(screen.getByText(/showing the 1 most recent of 653 memories/i)).toBeInTheDocument();
  });

  it('strips the Markdown the card used to print literally (H4)', () => {
    useMemoryStore.setState({
      records: [makeRecord({ id: 'a', content: '# Memory Analysis\n**Most Significant Contradiction:** none' })],
    });
    render(<TimelineView />);

    expect(screen.getByText('Memory Analysis Most Significant Contradiction: none')).toBeInTheDocument();
  });

  it('builds the type badge tint with withAlpha, not by concatenating onto a hex string (M8)', () => {
    useMemoryStore.setState({ records: [makeRecord({ id: 'a', type: 'semantic' })] });
    render(<TimelineView />);

    const badge = screen.getByText('semantic');
    expect(badge.style.background).toMatch(/^rgba\(/);
  });
});
