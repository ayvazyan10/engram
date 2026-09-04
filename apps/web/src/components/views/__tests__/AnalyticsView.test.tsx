import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import AnalyticsView, {
  describeCoverage, describeWindow, percent, truncateSourceLabel,
  SOURCE_AXIS_WIDTH, SOURCE_LABEL_MAX,
} from '../AnalyticsView.js';
import { bucketIndex, bucketRanges } from '../analytics/ActivityHeatmap.js';
import { ACTIVITY_RAMP, SERIES } from '../../../lib/tokens.js';
import { useAnalyticsStore } from '../../../store/analyticsStore.js';
import { analyticsPayload } from '../../../test/analyticsFixture.js';
import { useTemplateStore, TEMPLATES } from '../../../store/templateStore.js';
import { api } from '../../../lib/api.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../lib/api.js', () => ({
  api: { getAnalytics: vi.fn() },
}));

/** Every fixture goes through the shared payload builder so this file cannot
 *  drift from the shape the server serves. */
const analyticsData = analyticsPayload;

/** '#rrggbb' as the `rgb(r, g, b)` string jsdom reports back from a style. */
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
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
    expect(screen.getByTitle(/Monday 09:00 — 5 memories/)).toBeInTheDocument();
  });

  // Re-pointed: `data === null` after a successful fetch is unreachable now
  // that the payload is checked, so the third branch means an empty WINDOW —
  // which is worth telling apart from a failure, because the store may hold
  // plenty and just hold nothing in these 30 days.
  it('tells an empty window apart from a failed load, and says what the store does hold', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({
        windowed: {
          total: 0, avgImportance: null, byType: {}, bySource: {}, sourceCount: 0,
          conceptCount: 0, topConcepts: [], dailyGrowth: [], hourlyActivity: [],
        },
      })
    );
    render(<AnalyticsView />);

    expect(await screen.findByText(/No memories were stored in this window/)).toBeInTheDocument();
    expect(screen.getByText(/The store holds 651/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not load analytics/)).not.toBeInTheDocument();
    expect(screen.queryByText('Activity Heatmap')).not.toBeInTheDocument();
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

  // H5 came back in the live render at 24 characters: recharts drew
  // ':laude-code-research-ag…', clipping the leading 'c' off the axis. The
  // truncation has to fit the axis it is drawn on, not just be short.
  it('truncates to a length that actually FITS the axis at fontSize 10', () => {
    const CHAR_WIDTH_AT_10PX = 5.5;
    const TICK_PADDING = 12;
    expect(SOURCE_LABEL_MAX * CHAR_WIDTH_AT_10PX + TICK_PADDING).toBeLessThanOrEqual(SOURCE_AXIS_WIDTH);
  });
});

describe('AnalyticsView panel honesty (M1, M2)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  // M1's assertion was "the Concepts tile is gone", because its value read
  // `topConcepts.length` — the API's page size, always 20, sitting beside three
  // real numbers with equal authority. The server reports a genuine
  // `conceptCount` now, so the tile is back with the real statistic: the
  // invariant is that the tile never shows the page size again.
  it('never shows the API page size as a concept count', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({ windowed: { conceptCount: 79, topConceptsLimit: 20, topConcepts: [{ concept: 'TypeScript', count: 4, avgImportance: 0.7 }] } })
    );
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    const tile = screen.getByText('Concepts').parentElement!;
    expect(tile.textContent).toContain('79');
    expect(tile.textContent).not.toContain('20');
    // …and the panel below says how many of the real count it lists.
    expect(screen.getByText('1 of 79')).toBeInTheDocument();
  });

  it('titles the source chart "Top Sources" and says how many of how many it plots', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({
        windowed: {
          sourceCount: 15,
          bySource: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`source-${i}`, 15 - i])),
        },
      })
    );
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.getByText('Top Sources')).toBeInTheDocument();
    expect(screen.getByText('8 of 15')).toBeInTheDocument();
    expect(screen.queryByText('By Source')).not.toBeInTheDocument();
  });
});

describe('AnalyticsView heatmap (M3, M4, F4)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  // M3's assertion was "the cell tint tracks the active template accent",
  // because the heatmap was the one surface the theme switcher provably did
  // not reach. F4 re-points it: `t.accent` is a CHROME token, and using it as
  // a data ramp is what made legibility an accident of which template was on
  // (count 1 landed at 1.41:1 in Neural, 1.45:1 in Midnight, and Mono passed
  // only because its accent is white). The ramp is a documented, validated
  // one-hue scale now — so the invariant is that it is the same real scale in
  // every template, and never the chrome accent.
  it('paints cells from the documented sequential ramp, in every template — never the chrome accent', async () => {
    for (const template of TEMPLATES) {
      useTemplateStore.setState({ activeTemplate: template });
      vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
      const { unmount } = render(<AnalyticsView />);

      const cell = await screen.findByTitle(/Monday 09:00 — 5 memories/);
      expect(cell.style.background, template.id).toBe(hexToRgb(ACTIVITY_RAMP[ACTIVITY_RAMP.length - 1]!));
      expect(cell.style.background, template.id).not.toContain(hexToRgb(template.accent));
      unmount();
    }
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

  // Was: "gives the intensity ramp a key". The key existed but read
  // "Less ▪▪▪▪ More", from which a reader could not learn what the maximum is.
  it('states the real counts in the key, not "Less … More"', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.getByText('Memories per hour')).toBeInTheDocument();
    expect(screen.queryByText('Less')).not.toBeInTheDocument();
    expect(screen.queryByText('More')).not.toBeInTheDocument();
    // The one non-empty hour in the fixture holds 5, so the key's top step
    // has to say so — the reader can read the maximum off it.
    expect(screen.getByText('4–5')).toBeInTheDocument();
  });

  it('puts the number in the cell, because colour cannot resolve 1-vs-2 at this range', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);

    const cell = await screen.findByTitle(/Monday 09:00 — 5 memories/);
    expect(cell.textContent).toBe('5');
  });

  it('makes every cell reachable by keyboard — 0 of 168 were focusable', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(7 * 24);
    // Roving tabindex: exactly one tab stop, arrows move within the grid.
    expect(cells.filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(1);
    for (const cell of cells) expect(cell).toHaveAttribute('aria-label');

    fireEvent.keyDown(cells[0]!, { key: 'ArrowRight' });
    expect(cells[1]!.getAttribute('tabindex')).toBe('0');
    expect(cells[0]!.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps the Sun–Sat axis out of the horizontal scroller, so scrolling right cannot remove it', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    const dayLabel = screen.getByText('Sun');
    const grid = screen.getByRole('grid');
    expect(grid.contains(dayLabel)).toBe(false);
  });

  it('reads out the hovered cell without a tooltip, and says what the busiest hour is by default', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);

    const cell = await screen.findByTitle(/Monday 09:00 — 5 memories/);
    expect(screen.getByText(/Busiest:/)).toBeInTheDocument();

    fireEvent.focus(cell);
    expect(screen.queryByText(/Busiest:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Monday 09:00/)).toBeInTheDocument();
  });
});

describe('activity ramp bucketing (F4)', () => {
  it('spreads 1..max across the ramp steps and names the real range of each', () => {
    expect(bucketRanges(6)).toEqual([
      { step: 0, lo: 1, hi: 1 },
      { step: 1, lo: 2, hi: 3 },
      { step: 2, lo: 4, hi: 4 },
      { step: 3, lo: 5, hi: 6 },
    ]);
  });

  it('never puts an empty hour on the ramp — zero is an empty slot, not a faint mark', () => {
    expect(bucketIndex(0, 6)).toBe(-1);
    expect(bucketIndex(-1, 6)).toBe(-1);
  });

  it('puts the maximum on the top step whatever the maximum is', () => {
    expect(bucketIndex(6, 6)).toBe(ACTIVITY_RAMP.length - 1);
    expect(bucketIndex(1, 1)).toBe(ACTIVITY_RAMP.length - 1);
    expect(bucketIndex(2, 2)).toBe(ACTIVITY_RAMP.length - 1);
    expect(bucketRanges(1)).toEqual([{ step: ACTIVITY_RAMP.length - 1, lo: 1, hi: 1 }]);
  });
});

describe('AnalyticsView series colour (F5) and table twins (F6)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  it('gives every chart a table view, so no value is reachable only by hovering', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    const toggles = screen.getAllByRole('button', { name: 'Table' });
    expect(toggles.length).toBe(5); // growth, by type, top sources, top concepts, heatmap

    fireEvent.click(toggles[0]!);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Memories per day — every value')).toBeInTheDocument();
  });

  it('the table twin carries every source, including the ones the chart does not plot', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({
        windowed: {
          sourceCount: 15,
          bySource: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`source-${i}`, 15 - i])),
        },
      })
    );
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('8 of 15')).toBeInTheDocument());

    // 'source-14' is the 15th by volume — off the end of the 8-bar chart.
    expect(screen.queryByText('source-14')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Table' })[2]!);
    expect(screen.getByText('source-14')).toBeInTheDocument();
  });
});

/**
 * recharts renders nothing under jsdom (ResponsiveContainer measures 0x0), so
 * the marks themselves are asserted the way this repo already asserts CSS and
 * glyph rules — against the source. What is being guarded is specific: the
 * chrome accent must never be a data mark again, and the source bars must keep
 * their direct labels, because those two are the whole of F5 and F6 here.
 */
describe('AnalyticsView chart marks (F5, F6) — source guard', () => {
  // The whole analytics surface, not one file: the panels were split out of
  // AnalyticsView.tsx, and a guard pinned to one path would stop guarding.
  const dir = join(__dirname, '../analytics');
  const source = [join(__dirname, '../AnalyticsView.tsx'), ...readdirSync(dir).map((f) => join(dir, f))]
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(f, 'utf-8'))
    .join('\n');

  it('paints the count series with the data token, never with the chrome accent', () => {
    expect(source).toContain('stroke={SERIES.primary}');
    expect(source).toContain('fill={SERIES.primary}');
    expect(source).not.toMatch(/(?:fill|stroke|stopColor)=\{t\.accent\}/);
    expect(SERIES.primary).not.toBe(TEMPLATES[0]!.accent);
    expect(SERIES.primary).not.toBe(TEMPLATES[1]!.accent);
    expect(SERIES.primary).not.toBe(TEMPLATES[2]!.accent);
  });

  it('direct-labels the source bars, whose three smallest were 12px, 10px and 5px and identical', () => {
    expect(source).toContain('<LabelList dataKey="value" position="right"');
  });

  it('joins the daily points with straight segments — a spline draws values between days that do not exist', () => {
    expect(source).toContain('<Area type="linear"');
    expect(source).not.toContain('type="monotone"');
  });

  it('replaces recharts\' full-width hover band with a hairline crosshair and an active mark', () => {
    expect(source).toContain('cursor={false}');
    expect(source).toContain('activeBar=');
    expect(source).toContain('cursor={{ stroke: t.panelBorder, strokeWidth: 1 }}');
  });
});

describe('describeWindow / describeCoverage / percent — the page states its own scope', () => {
  it('quotes the window the server states, including the timezone that decides which day a memory lands on', () => {
    expect(describeWindow(analyticsPayload().window)).toBe('Last 30 days · 2026-08-06 – 2026-09-04 UTC');
  });

  it('does not print a range for a one-day window', () => {
    const w = analyticsPayload({ window: { days: 1, start: '2026-09-04', end: '2026-09-04' } }).window;
    expect(describeWindow(w)).toBe('Last 1 day · 2026-09-04 UTC');
  });

  it('says how unevenly the weekdays fell, because a raw per-weekday count is not comparable without it', () => {
    expect(describeCoverage({ total: 87, weekdayCoverage: [4, 4, 4, 4, 5, 5, 4] })).toBe('87 memories · each weekday fell 4–5x');
    expect(describeCoverage({ total: 28, weekdayCoverage: [4, 4, 4, 4, 4, 4, 4] })).toBe('28 memories · each weekday fell 4x');
    expect(describeCoverage({ total: 0 })).toBe('0 memories by hour of the week');
  });

  it('renders a null average as no data, never as zero percent', () => {
    expect(percent(null)).toBe('—');
    expect(percent(undefined)).toBe('—');
    expect(percent(Number.NaN)).toBe('—');
    expect(percent(0)).toBe('0%');
    expect(percent(0.7005605081875488)).toBe('70%');
  });
});

describe('AnalyticsView scope (the payload restructure)', () => {
  beforeEach(() => {
    useAnalyticsStore.setState({ data: null, loading: false, error: null, days: 30 });
    vi.mocked(api.getAnalytics).mockReset();
  });

  it('prints the window once, above everything it scopes', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);

    expect(await screen.findByText(/Last 30 days · 2026-08-06 – 2026-09-04 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/archived memories excluded/)).toBeInTheDocument();
  });

  it('names the all-time denominator beside every windowed figure — 87 and 651 answer different questions', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.getByText('of 651 stored')).toBeInTheDocument();
    expect(screen.getByText('of 15 all-time')).toBeInTheDocument();
    expect(screen.getByText('of 228 all-time')).toBeInTheDocument();
    expect(screen.getByText('all-time 81%')).toBeInTheDocument();
  });

  it('shows the real concept count, not the page size the old tile reported', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({ windowed: { conceptCount: 79, topConcepts: [], topConceptsLimit: 20 } })
    );
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    expect(screen.getByText('Concepts')).toBeInTheDocument();
    expect(screen.getByText('79')).toBeInTheDocument();
    expect(screen.queryByText('20')).not.toBeInTheDocument();
  });

  it('shows an empty window as no data rather than as zero importance', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({
        windowed: {
          total: 0, avgImportance: null, byType: {}, bySource: {}, sourceCount: 0,
          conceptCount: 0, topConcepts: [], dailyGrowth: [], hourlyActivity: [],
        },
      })
    );
    render(<AnalyticsView />);

    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('rejects a payload whose shape it does not understand instead of rendering undefined', async () => {
    const legacy = {
      total: 651, avgImportance: 0.81, byType: {}, bySource: {},
      dailyGrowth: [], hourlyActivity: [], topConcepts: [],
    };
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(legacy as never);
    render(<AnalyticsView />);

    expect(await screen.findByText(/shape this dashboard does not understand/)).toBeInTheDocument();
  });

  it('holds the previous render, dimmed, while a refetch is in flight — no skeleton flash', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(analyticsData());
    const { container } = render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.opacity).toBe('1');
    expect(root).not.toHaveAttribute('aria-busy');

    act(() => useAnalyticsStore.setState({ loading: true }));
    // The figures are still on screen; only the frame dims.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe('0.55');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });

  it('plots the daily RATE and keeps the cumulative curve in the table beside it', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValueOnce(
      analyticsData({
        windowed: {
          dailyGrowth: [
            { date: '2026-09-03', count: 0, cumulative: 564 },
            { date: '2026-09-04', count: 7, cumulative: 571 },
          ],
        },
      })
    );
    render(<AnalyticsView />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    // Titled for what is drawn: a per-day count is a rate, not growth.
    expect(screen.getByText('Memories per day')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Table' })[0]!);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Stored after')).toBeInTheDocument();
    expect(screen.getByText('571')).toBeInTheDocument();
  });
});
