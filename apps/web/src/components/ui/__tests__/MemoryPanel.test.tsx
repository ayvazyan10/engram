import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MemoryPanel from '../MemoryPanel.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';

// The panel reads the server census for its "N of M" count (H6). Mocked so
// the count is a fact of the test rather than of the network.
vi.mock('../../../lib/serverStats.js', () => ({
  useServerStats: () => ({ total: 653, byType: {}, bySource: {} }),
}));

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    type: 'semantic',
    content: 'hello world',
    summary: null,
    importance: 0.5,
    source: null,
    concept: null,
    tags: '[]',
    createdAt: '2026-01-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('MemoryPanel auth-error vs empty-store (F2)', () => {
  beforeEach(() => {
    useMemoryStore.setState({
      records: [],
      searchResults: [],
      searchQuery: '',
      isSearching: false,
      totalCount: 0,
    });
  });

  it('shows the "No memories yet" empty state when the store genuinely has none', () => {
    render(<MemoryPanel loading={false} />);
    expect(screen.getByText(/no memories yet/i)).toBeInTheDocument();
  });

  it('does NOT show "No memories yet" when a load error is present — a 401 must not look like an empty brain', () => {
    render(<MemoryPanel loading={false} error="Unauthorized" />);
    expect(screen.queryByText(/no memories yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<MemoryPanel loading={false} error="Unauthorized" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show an error banner when there is no error', () => {
    render(<MemoryPanel loading={false} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe('MemoryPanel rows (H1 — 30% of 200 rendered rows were byte-identical)', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [], searchResults: [], searchQuery: '', isSearching: false, totalCount: 0 });
  });

  it('distinguishes two rows that share a concept AND a date', () => {
    useMemoryStore.setState({
      records: [
        record({ id: 'a', concept: 'Trend Analysis', content: '# Trend Analysis\nSemantic memory outgrows episodic 3x.' }),
        record({ id: 'b', concept: 'Trend Analysis', content: '# Trend Analysis\nReflections now dominate the store.' }),
      ],
    });
    render(<MemoryPanel loading={false} />);

    expect(screen.getAllByText('Trend Analysis')).toHaveLength(2);
    expect(screen.getByText('Semantic memory outgrows episodic 3x.')).toBeInTheDocument();
    expect(screen.getByText('Reflections now dominate the store.')).toBeInTheDocument();
  });

  it('never prints the Markdown heading marker the concept arrived wrapped in (H4)', () => {
    useMemoryStore.setState({ records: [record({ id: 'a', concept: '# Pattern Analysis', content: 'body text' })] });
    render(<MemoryPanel loading={false} />);

    expect(screen.getByText('Pattern Analysis')).toBeInTheDocument();
    expect(screen.queryByText('# Pattern Analysis')).not.toBeInTheDocument();
  });

  it('falls back to source on line two when the record has no concept', () => {
    useMemoryStore.setState({ records: [record({ id: 'a', concept: null, source: 'autopilot-learning' })] });
    render(<MemoryPanel loading={false} />);

    expect(screen.getByText('autopilot-learning')).toBeInTheDocument();
  });

  it('appends no manual ellipsis to a label that was not truncated (L3)', () => {
    useMemoryStore.setState({ records: [record({ id: 'a', concept: 'x'.repeat(40) })] });
    render(<MemoryPanel loading={false} />);

    expect(screen.getByText('x'.repeat(40))).toBeInTheDocument();
  });
});

describe('MemoryPanel count (H6 — "MEMORY GRAPH 200" beside "653 memories")', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [], searchResults: [], searchQuery: '', isSearching: false, totalCount: 0 });
  });

  it('says how many of the store the loaded page actually is', () => {
    useMemoryStore.setState({ records: [record({ id: 'a' }), record({ id: 'b' })] });
    render(<MemoryPanel loading={false} />);

    expect(screen.getByText('2 of 653')).toBeInTheDocument();
    expect(screen.getByTitle(/most recent of 653 stored memories/i)).toBeInTheDocument();
  });
});

describe('MemoryPanel type pills (L1 — they looked like filters and did nothing)', () => {
  beforeEach(() => {
    useMemoryStore.setState({ records: [], searchResults: [], searchQuery: '', isSearching: false, totalCount: 0 });
    useMemoryStore.setState({
      records: [
        record({ id: 'a', type: 'semantic', concept: 'Semantic one' }),
        record({ id: 'b', type: 'procedural', concept: 'Procedural one' }),
      ],
    });
  });

  it('renders them as pressable controls, not decoration', () => {
    render(<MemoryPanel loading={false} />);
    const pill = screen.getByRole('button', { name: /semantic memories: 1/i });
    expect(pill).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters the list to one type and back', () => {
    render(<MemoryPanel loading={false} />);
    expect(screen.getByText('Procedural one')).toBeInTheDocument();

    const pill = screen.getByRole('button', { name: /semantic memories: 1/i });
    fireEvent.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Semantic one')).toBeInTheDocument();
    expect(screen.queryByText('Procedural one')).not.toBeInTheDocument();

    fireEvent.click(pill);
    expect(screen.getByText('Procedural one')).toBeInTheDocument();
  });

  it('keeps showing every type count while filtered, so the filter can be undone', () => {
    render(<MemoryPanel loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /semantic memories: 1/i }));
    expect(screen.getByRole('button', { name: /procedural memories: 1/i })).toBeInTheDocument();
  });
});

describe('MemoryPanel loading indicator (L2)', () => {
  it('animates — it was a static dot that read as a bullet', () => {
    useMemoryStore.setState({ records: [], searchResults: [], searchQuery: '', isSearching: false, totalCount: 0 });
    const { container } = render(<MemoryPanel loading />);
    const spinner = container.querySelector('svg');
    expect(spinner).not.toBeNull();
    expect(spinner!.style.animation).toContain('ec-spin');
  });
});
