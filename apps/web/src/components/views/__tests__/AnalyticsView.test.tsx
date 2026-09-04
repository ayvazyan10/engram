import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AnalyticsView from '../AnalyticsView.js';
import { useAnalyticsStore, type AnalyticsData } from '../../../store/analyticsStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: { getAnalytics: vi.fn() },
}));

function analyticsData(overrides: Partial<AnalyticsData> = {}): AnalyticsData {
  return {
    total: 42,
    avgImportance: 0.6,
    byType: { semantic: 20, episodic: 15, procedural: 7 },
    bySource: { dashboard: 30, mcp: 12 },
    dailyGrowth: [{ date: '2026-01-01', count: 3 }],
    hourlyActivity: [{ hour: 9, dayOfWeek: 1, count: 5 }],
    topConcepts: [{ concept: 'TypeScript', count: 4, avgImportance: 0.7 }],
    ...overrides,
  };
}

describe('AnalyticsView', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  it('shows a loading state while the first fetch is pending', () => {
    vi.mocked(api.getAnalytics).mockReturnValue(new Promise(() => {}));
    render(<AnalyticsView />);
    expect(screen.getByText(/loading analytics/i)).toBeInTheDocument();
  });

  it('shows a distinct, retryable error state on failure — not an empty dataset', async () => {
    vi.mocked(api.getAnalytics).mockRejectedValueOnce(new Error('network down'));
    render(<AnalyticsView />);

    await waitFor(() => expect(screen.getByText(/could not load analytics/i)).toBeInTheDocument());
    expect(screen.getByText(/network down/i)).toBeInTheDocument();

    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
  });

  it('renders stats, top concepts, and the activity heatmap once data loads', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('60%')).toBeInTheDocument(); // avgImportance
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText(/4 memories/)).toBeInTheDocument();
    expect(screen.getByTitle(/Mon 9:00 — 5 memories/)).toBeInTheDocument();
  });

  it('shows the empty state when the load succeeds with no data at all', async () => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null });
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(undefined as unknown as AnalyticsData);
    render(<AnalyticsView />);

    await waitFor(() => expect(screen.getByText(/no analytics data available/i)).toBeInTheDocument());
  });
});
