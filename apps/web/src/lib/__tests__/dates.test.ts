import { describe, it, expect } from 'vitest';
import {
  safeParseISO,
  formatShortDate,
  formatDayHeading,
  formatTimeOfDay,
  formatDateTime,
  UNKNOWN_DATE_LABEL,
  UNKNOWN_TIME_LABEL,
} from '../dates.js';

describe('safeParseISO (W10)', () => {
  it('parses a well-formed ISO date string', () => {
    const result = safeParseISO('2026-01-01T00:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null instead of throwing for garbage input', () => {
    expect(safeParseISO('not a date')).toBeNull();
    expect(safeParseISO('')).toBeNull();
  });

  it('returns null for a string that parses but is out of range', () => {
    // date-fns's parseISO happily returns an Invalid Date object for some
    // malformed-but-ISO-shaped strings rather than throwing — isValid()
    // catches that case too.
    expect(safeParseISO('2026-99-99T00:00:00.000Z')).toBeNull();
  });

  it('returns null instead of throwing when parseISO itself throws on a non-string value', () => {
    // A REST/socket payload isn't guaranteed to actually be a string even
    // when the type says it should be — this is the `catch` path, distinct
    // from parseISO returning an Invalid Date.
    expect(safeParseISO(null as unknown as string)).toBeNull();
  });
});

describe('display formatters (M13 — one field, four formats, in four files)', () => {
  const iso = '2026-01-07T14:05:00.000Z';

  it('formatShortDate is the sidebar row form', () => {
    expect(formatShortDate(iso)).toMatch(/^Jan \d{1,2}$/);
  });

  it('formatDayHeading is the timeline day heading form', () => {
    expect(formatDayHeading(iso)).toMatch(/^Jan \d{1,2}, 2026$/);
  });

  it('formatTimeOfDay is a zero-padded 24h time', () => {
    expect(formatTimeOfDay(iso)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatDateTime is the standalone timestamp — no raw toLocaleString anywhere', () => {
    expect(formatDateTime(iso)).toMatch(/^Jan \d{1,2}, 2026 · \d{2}:\d{2}$/);
  });

  it('every formatter degrades to the same labels instead of throwing or printing "Invalid Date"', () => {
    expect(formatShortDate('not-a-date')).toBe(UNKNOWN_DATE_LABEL);
    expect(formatDayHeading('not-a-date')).toBe(UNKNOWN_DATE_LABEL);
    expect(formatDateTime('not-a-date')).toBe(UNKNOWN_DATE_LABEL);
    expect(formatTimeOfDay('not-a-date')).toBe(UNKNOWN_TIME_LABEL);
  });

  it('the unparsable-time placeholder is the same width as a real time, so a column does not jump', () => {
    expect(UNKNOWN_TIME_LABEL).toHaveLength(formatTimeOfDay(iso).length);
  });
});
