import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TimelineView from '../TimelineView.js';
import { useMemoryStore, type MemoryRecord } from '../../../store/memoryStore.js';

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
