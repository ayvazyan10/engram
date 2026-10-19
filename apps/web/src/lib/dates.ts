import { parseISO, isValid, format, formatDistanceToNowStrict } from 'date-fns';

/** Parses API dates without throwing; invalid dates share the same fallback
 * label across the timeline, memory sheet and review cards. */
export function safeParseISO(value: string): Date | null {
  try {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Shared label for an invalid date, including the timeline's grouping bucket. */
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
 *  context (the memory sheet's "Stored", a reflection card). */
export function formatDateTime(value: string): string {
  const parsed = safeParseISO(value);
  return parsed ? format(parsed, "MMM d, yyyy · HH:mm") : UNKNOWN_DATE_LABEL;
}

/** `3 hours ago` — a card's age at a glance. Under a minute reads "just now". */
export function formatRelative(value: string): string {
  const parsed = safeParseISO(value);
  if (!parsed) return UNKNOWN_DATE_LABEL;
  if (Date.now() - parsed.getTime() < 60_000) return 'just now';
  return formatDistanceToNowStrict(parsed, { addSuffix: true });
}
