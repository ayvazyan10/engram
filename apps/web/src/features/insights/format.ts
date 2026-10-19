import { format } from 'date-fns';
import { truncateLabel } from '../../lib/plainText.js';
import { safeParseISO } from '../../lib/dates.js';
import type { AnalyticsWindow } from '../../store/analyticsStore.js';
import { TYPE_NAME } from '../memory/MemoryRow.js';

/** How many sources the bar chart plots. The caption says so out loud
 *  instead of silently dropping the rest; the table lists every one. */
export const SOURCE_CHART_LIMIT = 8;

/** The source axis is wide enough that recharts never clips a label from the
 *  LEFT ('autopilot-learning' once read 'utopilot-learning'). */
export const SOURCE_AXIS_WIDTH = 150;

/** 20 characters measure about 120px at 12px, inside the axis with room. */
export const SOURCE_LABEL_MAX = 20;

/** Bar thickness cap: the mark spec is at most 24px, never "fill the slot". */
export const BAR_SIZE = 14;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** The three memory types in the one order every Atlas surface uses. */
export const TYPE_ORDER = ['semantic', 'episodic', 'procedural'] as const;

export function typeLabel(name: string): string {
  return TYPE_NAME[name as keyof typeof TYPE_NAME] ?? name;
}

/** Truncate at the END, with an ellipsis, so the label still starts on the
 *  word the source is actually called. */
export function truncateSourceLabel(value: string): string {
  return truncateLabel(value, SOURCE_LABEL_MAX);
}

function day(value: string, pattern: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, pattern) : value;
}

/**
 * The window in words, quoted from what the server states, including the
 * timezone that decides which calendar day a memory lands on:
 * "Last 30 days, 20 Sep to 19 Oct 2026, UTC".
 */
export function describeWindow(window: AnalyticsWindow): string {
  const sameYear = window.start.slice(0, 4) === window.end.slice(0, 4);
  const span =
    window.start === window.end
      ? day(window.end, 'd MMM yyyy')
      : `${day(window.start, sameYear ? 'd MMM' : 'd MMM yyyy')} to ${day(window.end, 'd MMM yyyy')}`;
  return `Last ${window.days} ${window.days === 1 ? 'day' : 'days'}, ${span}, ${window.timezone}`;
}

/**
 * The heatmap's caption, including how unevenly the weekdays fell: a 30-day
 * window holds five of some weekdays and four of the rest, so raw per-weekday
 * counts are not directly comparable, and the caption says so.
 */
export function describeCoverage(w: { total: number; weekdayCoverage?: number[] }): string {
  const coverage = w.weekdayCoverage ?? [];
  const memories = `${w.total.toLocaleString('en-US')} ${w.total === 1 ? 'memory' : 'memories'}`;
  if (coverage.length === 0) return `${memories} by hour of the week`;
  const lo = Math.min(...coverage);
  const hi = Math.max(...coverage);
  return `${memories}; each weekday fell ${lo === hi ? lo : `${lo} to ${hi}`} times`;
}

/** A 0-1 ratio as a percentage, or an em dash when there is no value.
 *  `avgImportance` is null for an empty window: "no data", never 0%. */
export function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : '—';
}
