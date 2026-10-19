import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InsightsView from '../InsightsView.js';
import NumbersTab from '../NumbersTab.js';
import ActivityHeatmap, { bucketIndex, bucketRanges } from '../ActivityHeatmap.js';
import { GrowthTip, SourcePanel, sourceRows, TypePanel, typeRows, HeatmapPanel, GrowthPanel, ConceptPanel } from '../AnalyticsPanels.js';
import { describeCoverage, describeWindow, percent, truncateSourceLabel, typeLabel } from '../format.js';
import { api } from '../../../lib/api.js';
import { useAnalyticsStore } from '../../../store/analyticsStore.js';
import { useReflectionStore } from '../../../store/reflectionStore.js';
import { analyticsPayload, analyticsWindow, windowedAnalytics } from '../../../test/analyticsFixture.js';

vi.mock('../../../lib/api.js', () => ({
  api: {
    getAnalytics: vi.fn(),
    getReflections: vi.fn(),
    getReflectionStatus: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

/** The table twin of the panel titled `title`. */
function openTable(title: string): HTMLTableElement {
  const panel = screen.getByRole('region', { name: title });
  fireEvent.click(within(panel).getByRole('button', { name: 'Table' }));
  return within(panel).getByRole('table');
}

function rowsOf(table: HTMLTableElement): string[][] {
  return [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));
}

beforeEach(() => {
  useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
  useReflectionStore.setState({ insights: [], status: null, loading: false, filterType: null, error: null });
  vi.mocked(api.getAnalytics).mockReset().mockResolvedValue(analyticsPayload());
  vi.mocked(api.getReflections).mockResolvedValue({ count: 0, reflections: [] });
  vi.mocked(api.getReflectionStatus).mockResolvedValue({ enabled: true, due: false, counter: 2, threshold: 12 });
});

describe('Insights wording', () => {
  it('states the window the server reports, in words', () => {
    expect(describeWindow(analyticsWindow())).toBe('Last 30 days, 6 Aug to 4 Sep 2026, UTC');
    expect(describeWindow(analyticsWindow({ days: 1, start: '2026-09-04', end: '2026-09-04' }))).toBe('Last 1 day, 4 Sep 2026, UTC');
    expect(describeWindow(analyticsWindow({ start: '2025-12-20', end: '2026-01-18' }))).toBe('Last 30 days, 20 Dec 2025 to 18 Jan 2026, UTC');
  });

  it('says how unevenly the weekdays fell', () => {
    expect(describeCoverage({ total: 42, weekdayCoverage: [4, 4, 4, 4, 5, 5, 4] })).toBe('42 memories; each weekday fell 4 to 5 times');
    expect(describeCoverage({ total: 1, weekdayCoverage: [1, 1, 1, 1, 1, 1, 1] })).toBe('1 memory; each weekday fell 1 times');
    expect(describeCoverage({ total: 3 })).toBe('3 memories by hour of the week');
  });

  it('prints a ratio, an empty value, a cut label and a type name', () => {
    expect(percent(0.564)).toBe('56%');
    expect(percent(null)).toBe('—');
    expect(truncateSourceLabel('claude-code-research-agent')).toHaveLength(20);
    expect(typeLabel('episodic')).toBe('Episodic');
    expect(typeLabel('other')).toBe('other');
  });
});

describe('chart data', () => {
  it('orders types the Atlas way and leaves out empty ones', () => {
    expect(typeRows(windowedAnalytics({ byType: { procedural: 2, semantic: 5, episodic: 0 } }))).toEqual([
      { type: 'semantic', count: 5 },
      { type: 'procedural', count: 2 },
    ]);
  });

  it('ranks sources by count, then by name', () => {
    expect(sourceRows(windowedAnalytics({ bySource: { b: 2, a: 2, c: 9 } }))).toEqual([
      { name: 'c', value: 9 },
      { name: 'a', value: 2 },
      { name: 'b', value: 2 },
    ]);
  });

  it('puts every source in the table though the chart plots the top eight', () => {
    const bySource = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, 10 - i]));
    render(<SourcePanel w={windowedAnalytics({ bySource })} />);
    expect(screen.getByText('Top 8 of 10 sources')).toBeInTheDocument();
    expect(rowsOf(openTable('Who writes your memories'))).toHaveLength(10);
  });

  it('draws the type split as shares, with a word and a shape for each type', () => {
    render(<TypePanel w={windowedAnalytics({ byType: { semantic: 3, episodic: 1, procedural: 0 } })} />);
    expect(screen.getByRole('img', { name: 'Semantic 3, Episodic 1' })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(rowsOf(openTable('By type'))).toEqual([
      ['Semantic', '3', '75%'],
      ['Episodic', '1', '25%'],
    ]);
  });

  it('tables the daily series with its running total, and the concepts with importance', () => {
    render(<GrowthPanel w={windowedAnalytics()} days={30} />);
    expect(rowsOf(openTable('Memories per day'))).toEqual([['2026-09-04', '3', '567']]);
    render(<ConceptPanel w={windowedAnalytics({ topConcepts: [{ concept: '**TypeScript**', count: 4, avgImportance: 0.7 }] })} />);
    expect(rowsOf(openTable('Top concepts'))).toEqual([['TypeScript', '4', '70%']]);
  });

  it('tables the busiest hours first, with how often each weekday fell', () => {
    render(
      <HeatmapPanel
        w={windowedAnalytics({ hourlyActivity: [{ hour: 9, dayOfWeek: 1, count: 2 }, { hour: 22, dayOfWeek: 0, count: 5 }, { hour: 3, dayOfWeek: 2, count: 0 }] })}
      />
    );
    const table = openTable('When memories arrive');
    expect(rowsOf(table)).toEqual([
      ['Sunday', '22:00', '5', '4'],
      ['Monday', '09:00', '2', '4'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('leads the tooltip with the value', () => {
    const { container } = render(<GrowthTip active payload={[{ value: 1 }]} label="2026-09-04" />);
    expect(container).toHaveTextContent('1 memory4 Sep');
    const { container: none } = render(<GrowthTip active={false} />);
    expect(none).toBeEmptyDOMElement();
  });
});

describe('ActivityHeatmap', () => {
  it('puts the busiest hour on the top step and leaves an empty hour unstepped', () => {
    expect(bucketIndex(0, 6)).toBe(-1);
    expect(bucketIndex(6, 6)).toBe(3);
    expect(bucketIndex(1, 6)).toBe(0);
    expect(bucketIndex(1, 1)).toBe(3);
    expect(bucketIndex(3, 0)).toBe(3);
    expect(bucketRanges(6)).toEqual([
      { step: 0, lo: 1, hi: 1 },
      { step: 1, lo: 2, hi: 3 },
      { step: 2, lo: 4, hi: 4 },
      { step: 3, lo: 5, hi: 6 },
    ]);
  });

  it('reads out the busiest hour, and any cell reached by the arrow keys', () => {
    render(<ActivityHeatmap data={[{ hour: 9, dayOfWeek: 1, count: 5 }, { hour: 30, dayOfWeek: 1, count: 1 }]} />);
    const readout = () => document.querySelector('[aria-live="polite"]');
    expect(readout()).toHaveTextContent('Busiest: Monday 09:00, 5 memories');
    const first = screen.getByRole('gridcell', { name: 'Sunday 00:00, 0 memories' });
    expect(first).toHaveAttribute('tabindex', '0');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAccessibleName('Monday 01:00, 0 memories');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'Monday 09:00, 5 memories' }));
    expect(readout()).toHaveTextContent(/^Monday 09:00, 5 memories$/);
    fireEvent.mouseLeave(screen.getByRole('gridcell', { name: 'Monday 09:00, 5 memories' }));
    fireEvent.blur(document.activeElement!);
  });
});

describe('NumbersTab', () => {
  it('loads 30 days, states the window and that every project is counted', async () => {
    render(<NumbersTab />);
    expect(await screen.findByText(/Last 30 days, 6 Aug to 4 Sep 2026, UTC/)).toHaveTextContent(
      'Every project is counted, since these numbers cannot be narrowed to one; archived memories are not.'
    );
    expect(api.getAnalytics).toHaveBeenCalledWith(30);
    expect(screen.getByText('of 651 in the store')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked();
  });

  it('switches the range for every panel at once', async () => {
    render(<NumbersTab />);
    await screen.findByText(/Last 30 days/);
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    await waitFor(() => expect(api.getAnalytics).toHaveBeenLastCalledWith(90));
  });

  it('says when the window is empty, and offers a longer one', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValue(analyticsPayload({ window: { days: 7 }, windowed: { total: 0 } }));
    useAnalyticsStore.setState({ days: 7 });
    render(<NumbersTab />);
    expect(await screen.findByRole('heading', { name: 'Nothing stored in the last 7 days' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 90 days' }));
    expect(useAnalyticsStore.getState().days).toBe(90);
  });

  it('on an empty store, offers to connect an AI instead of a row of zeros', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValue(analyticsPayload({ windowed: { total: 0 }, allTime: { total: 0 } }));
    render(<NumbersTab />);
    expect(await screen.findByRole('heading', { name: 'No numbers yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect an AI' })).toHaveAttribute('href', '#/welcome');
    expect(screen.queryByText('Memories stored')).not.toBeInTheDocument();
  });

  it('refuses a payload it does not understand, and Try again reloads', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce({ total: 3 } as never);
    render(<NumbersTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('a shape this dashboard does not understand');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Last 30 days/)).toBeInTheDocument();
  });

  it('keeps the last numbers on screen when a refresh fails', async () => {
    useAnalyticsStore.setState({ data: analyticsPayload() });
    vi.mocked(api.getAnalytics).mockRejectedValueOnce(new Error('offline'));
    render(<NumbersTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh: offline');
    expect(screen.getByText('of 651 in the store')).toBeInTheDocument();
  });
});

describe('InsightsView', () => {
  it('shows the tab the route asks for', async () => {
    const { rerender } = render(<InsightsView tab="numbers" />);
    expect(await screen.findByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    rerender(<InsightsView tab="reflections" />);
    expect(await screen.findByRole('radiogroup', { name: 'Kind of report' })).toBeInTheDocument();
  });
});
