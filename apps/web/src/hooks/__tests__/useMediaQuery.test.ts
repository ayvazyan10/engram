import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaQuery } from '../useMediaQuery.js';

/**
 * jsdom doesn't implement matchMedia — a fake MediaQueryList stands in,
 * matching how AppLayout's V3 desktop/compact split
 * (`useMediaQuery('(max-width: 900px)')`) actually gets its answer.
 */
function fakeMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return matches; },
    media: '',
    addEventListener: (_: 'change', cb: () => void) => listeners.add(cb),
    removeEventListener: (_: 'change', cb: () => void) => listeners.delete(cb),
  };
  return {
    mql,
    setMatches: (next: boolean) => {
      matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

describe('useMediaQuery (V3 — desktop vs compact layout switch)', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns the current match state on mount', () => {
    const { mql } = fakeMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useMediaQuery('(max-width: 900px)'));
    expect(result.current).toBe(true);
  });

  it('re-renders when the query starts/stops matching (a viewport resize)', () => {
    const { mql, setMatches } = fakeMatchMedia(false);
    window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useMediaQuery('(max-width: 900px)'));
    expect(result.current).toBe(false);

    act(() => setMatches(true));
    expect(result.current).toBe(true);
  });
});
