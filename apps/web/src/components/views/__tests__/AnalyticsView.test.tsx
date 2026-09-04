import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AnalyticsView, { truncateSourceLabel, SOURCE_AXIS_WIDTH, SOURCE_LABEL_MAX } from '../AnalyticsView.js';
import { useAnalyticsStore, type AnalyticsData } from '../../../store/analyticsStore.js';
import { useTemplateStore, TEMPLATES } from '../../../store/templateStore.js';
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

describe('AnalyticsView source axis (H5 — labels were clipped from the LEFT, inventing words)', () => {
  it('gives the axis room for a real source name at fontSize 10', () => {
    // 'claude-code-research-agent' is 26 characters; 80px held about 14.
    expect(SOURCE_AXIS_WIDTH).toBeGreaterThanOrEqual(130);
  });

  it('truncates at the END, so the label still starts on the word the source is called', () => {
    const truncated = truncateSourceLabel('claude-code-research-agent');
    expect(truncated.startsWith('claude-code')).toBe(true);
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(SOURCE_LABEL_MAX);
  });

  it('leaves the real source names that fit completely alone', () => {
    expect(truncateSourceLabel('autopilot-learning')).toBe('autopilot-learning');
    expect(truncateSourceLabel('claude-code')).toBe('claude-code');
  });
});

describe('AnalyticsView panel honesty (M1, M2)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  it('no longer shows a "Concepts" tile whose value is the API page size', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.queryByText('Concepts')).not.toBeInTheDocument();
  });

  it('titles the source chart "Top Sources" and says how many of how many it plots', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({ bySource: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`source-${i}`, 15 - i])) })
    );
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.getByText('Top Sources')).toBeInTheDocument();
    expect(screen.getByText('8 of 15')).toBeInTheDocument();
    expect(screen.queryByText('By Source')).not.toBeInTheDocument();
  });
});

describe('AnalyticsView heatmap (M3, M4)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  it('tints cells from the active template accent, not a hardcoded indigo', async () => {
    useTemplateStore.setState({ activeTemplate: TEMPLATES[1]! }); // Mono — accent #ffffff
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);

    const cell = await screen.findByTitle(/Mon 9:00 — 5 memories/);
    expect(cell.style.background).toContain('255, 255, 255');
    expect(cell.style.background).not.toContain('99, 102, 241');
    useTemplateStore.setState({ activeTemplate: TEMPLATES[0]! });
  });

  it('labels the hour axis, which did not exist — the only affordance was a title', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    for (const tick of ['0', '6', '12', '18']) {
      expect(screen.getAllByText(tick).length).toBeGreaterThan(0);
    }
  });

  it('gives the intensity ramp a key, which touch users had no way to read', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });
});

describe('AnalyticsView top concepts (M10, H4)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  it('lays the chips out on a grid and truncates instead of running ragged', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('TypeScript')).toBeInTheDocument());

    const chip = screen.getByText('TypeScript');
    expect(chip.style.textOverflow).toBe('ellipsis');
    const grid = chip.closest('div')!.parentElement!;
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toContain('minmax(200px');
  });

  it('keeps the full value reachable on the chip and strips its Markdown', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({ topConcepts: [{ concept: '**Retrieval Augmented Generation**', count: 9, avgImportance: 0.8 }] })
    );
    render(<AnalyticsView />);

    expect(await screen.findByTitle('Retrieval Augmented Generation')).toBeInTheDocument();
  });
});
