import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query via `matchMedia`, re-rendering on change rather
 * than polling `window.innerWidth` on a scroll/resize handler (V3 — the
 * responsive layout switch between AppLayout's fixed 3-column desktop shell
 * and its mobile tab-bar shell reads this).
 */
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
