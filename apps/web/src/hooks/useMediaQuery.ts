import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query via `matchMedia`, re-rendering on change rather
 * than polling `window.innerWidth` on a scroll/resize handler (V3 — the
 * responsive layout switch between AppLayout's fixed 3-column desktop shell
 * and its mobile tab-bar shell reads this).
 */
/** Below this AppLayout switches to its one-pane shell, the plate chooser
 *  moves out of the header onto the plate surface, and Home shows the
 *  inspector in place of the cards. */
export const COMPACT_QUERY = '(max-width: 900px)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
