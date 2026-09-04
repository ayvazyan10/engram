import { parseISO, isValid } from 'date-fns';

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
