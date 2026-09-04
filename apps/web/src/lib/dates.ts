import { parseISO, isValid, format } from 'date-fns';

/**
 * Parses an ISO date string defensively — returns `null` instead of
 * throwing/producing an Invalid Date on an unparsable `createdAt` (W10).
 *
 * TimelineView and ReflectionView both fed a REST/socket-sourced
 * `createdAt` straight into `parseISO` and then `startOfDay`/`format`,
 * which throw `RangeError` on a genuinely invalid date — and there was no
 * error boundary anywhere to contain that, so one bad row blanked the whole
 * app permanently. Centralised here so every caller degrades the same way
 * (fall back to an "unknown date" grouping/label) instead of crashing.
 */
export function safeParseISO(value: string): Date | null {
  try {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * ─── Display formats (M13) ──────────────────────────────────────────────────
 *
 * One field — a memory's `createdAt` — was rendered four different ways in
 * four files: `MMM d, yyyy` and `HH:mm` (TimelineView), `MMM d, HH:mm`
 * (ReflectionView), `MMM d` (MemoryPanel), and a raw `toLocaleString()`
 * (NeuronInspector), which is the only one of the four that also changes
 * shape with the viewer's locale. They are named here instead, so a surface
 * picks a format rather than inventing one, and so "unparsable" degrades
 * identically everywhere.
 */

/** Shown in place of a date that could not be parsed. Also the label of
 *  TimelineView's own grouping bucket for such rows — same words, so a bad
 *  row reads the same wherever it surfaces. */
export const UNKNOWN_DATE_LABEL = 'Unknown date';

/** Shown in place of a time that could not be parsed. Same width as a real
 *  `HH:mm`, so a column of times does not jump. */
export const UNKNOWN_TIME_LABEL = '--:--';

/** `Jan 7` — a row in a list that is already grouped or sorted by date. */
export function formatShortDate(value: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, 'MMM d') : UNKNOWN_DATE_LABEL;
}

/** `Jan 7, 2026` — a day heading. */
export function formatDayHeading(value: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, 'MMM d, yyyy') : UNKNOWN_DATE_LABEL;
}

/** `14:05` — the time within a day that is already labelled. */
export function formatTimeOfDay(value: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, 'HH:mm') : UNKNOWN_TIME_LABEL;
}

/** `Jan 7, 2026 · 14:05` — a standalone timestamp with no surrounding date
 *  context (the inspector's "Stored", a reflection card). */
export function formatDateTime(value: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, "MMM d, yyyy · HH:mm") : UNKNOWN_DATE_LABEL;
}
