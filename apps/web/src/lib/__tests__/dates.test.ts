import { describe, it, expect } from 'vitest';
import { safeParseISO } from '../dates.js';

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
