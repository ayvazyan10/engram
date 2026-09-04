import { TYPE_COLORS, TYPE_LABELS } from '../../../lib/tokens.js';
import { truncateLabel } from '../../../lib/plainText.js';
import type { AnalyticsWindow } from '../../../store/analyticsStore.js';

/** How many sources the bar chart plots. The panel says so out loud now
 *  (M2) instead of silently dropping the rest. */
export const SOURCE_CHART_LIMIT = 8;

/** H5: the Y axis was 80px wide, so recharts clipped every label from the
 *  LEFT — 'autopilot-learning' rendered as 'utopilot-learning' and
 *  'claude-code-file-memory' as 'de-file-memory', which are not truncations,
 *  they are different words. */
export const SOURCE_AXIS_WIDTH = 140;

/** 20, not 24: at fontSize 10 a 24-character label still overran the 140px
 *  axis and recharts clipped it from the LEFT again — the live render showed
 *  ':laude-code-research-ag…', which is H5's exact defect with an ellipsis
 *  stuck on the end. 20 characters measure ~104px and leave real headroom. */
export const SOURCE_LABEL_MAX = 20;

/** Bar thickness cap — the mark spec is <= 24px, never "fill the slot". */
export const BAR_SIZE = 14;

/** Highlight step for the hovered bar — the next step up the same ramp, so a
 *  hover reads as "this one", never as a different value. */
export const ACTIVE_BAR_FILL = '#d35bb1';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Fill for a memory-type slice. Marks wear the data colour; text does not. */
export function typeFill(name: string): string {
  return TYPE_COLORS[name as keyof typeof TYPE_COLORS] ?? '#64748b';
}

export function typeLabel(name: string): string {
  return TYPE_LABELS[name as keyof typeof TYPE_LABELS] ?? name;
}

/** Truncate at the END, with an ellipsis, so the label still starts on the
 *  word the source is actually called (H5). */
export function truncateSourceLabel(value: string): string {
  return truncateLabel(value, SOURCE_LABEL_MAX);
}

/**
 * The page's scope, in words, from the window the server states.
 *
 * This used to be derived from the rows that came back, because the payload
 * said nothing about what it covered. It is machine-readable now, so the page
 * quotes it rather than inferring it — including the timezone, which decides
 * which calendar day a memory lands on and was never on screen before.
 */
export function describeWindow(window: AnalyticsWindow): string {
  const span = window.start === window.end ? window.start : `${window.start} – ${window.end}`;
  return `Last ${window.days} ${window.days === 1 ? 'day' : 'days'} · ${span} ${window.timezone}`;
}

/**
 * The heatmap's denominator, including how unevenly the weekdays fell.
 *
 * A 30-day window does not contain the same number of each weekday — this one
 * holds five Thursdays and Fridays and four of everything else — so a raw
 * per-weekday count is not directly comparable across rows. The counts stay
 * raw (at a maximum of six, a per-occurrence rate would read as 0.2–1.5 and
 * lose more than it gains), and the caption says the thing that makes them
 * readable instead.
 */
export function describeCoverage(w: { total: number; weekdayCoverage?: number[] }): string {
  const coverage = w.weekdayCoverage ?? [];
  if (coverage.length === 0) return `${w.total} memories by hour of the week`;
  const lo = Math.min(...coverage);
  const hi = Math.max(...coverage);
  const spread = lo === hi ? `each weekday fell ${lo}x` : `each weekday fell ${lo}–${hi}x`;
  return `${w.total} memories · ${spread}`;
}

/** A 0-1 ratio as a percentage, or an em dash when there is no value.
 *  `avgImportance` is null for an empty window — "no data", never 0%. */
export function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : '—';
}
