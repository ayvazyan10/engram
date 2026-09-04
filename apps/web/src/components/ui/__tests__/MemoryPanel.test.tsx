import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MemoryPanel from '../MemoryPanel.js';
import { useMemoryStore } from '../../../store/memoryStore.js';

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
