import type { ReactElement } from 'react';

/**
 * The Atlas icon set: 1.6px strokes on a 24px grid, drawn from survey
 * instruments (a folded map, a route, a compass, a flag) rather than generic
 * UI. Decorative: every use sits next to a word or carries its own label.
 */
const PATHS = {
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  map: (<><path d="M3 6.5l5.5-2 7 2 5.5-2v13l-5.5 2-7-2-5.5 2z" /><path d="M8.5 4.5v13M15.5 6.5v13" /></>),
  route: (<><circle cx="5.5" cy="18" r="2" /><circle cx="18.5" cy="6" r="2" /><path d="M7.5 18h5a3 3 0 000-6h-2a3 3 0 010-6h6" /></>),
  time: (<><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>),
  insight: (<><path d="M4.5 19.5h15" /><path d="M7 16v-5M11 16V7M15 16v-7M19 16v-3" /></>),
  review: (<><path d="M5.5 20.5V4" /><path d="M5.5 4.5h11l-2.2 4 2.2 4h-11" /></>),
  settings: (<><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" /><circle cx="15" cy="7.5" r="2" /><circle cx="9" cy="16.5" r="2" /></>),
  layers: (<><path d="M12 4l8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5L12 17l8.5-4.5" /></>),
  compass: (<><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.2l-1.6 4-4 1.6 1.6-4z" /></>),
  plus: (<path d="M12 5v14M5 12h14" />),
  moon: (<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z" />),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>),
  contrast: (<><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none" /></>),
  more: (<><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></>),
  chev: (<path d="M7 10l5 5 5-5" />),
  check: (<path d="M5 12.5l4.5 4.5L19 7.5" />),
  plug: (<><path d="M9 3.5v4M15 3.5v4" /><path d="M6.5 7.5h11v3a5.5 5.5 0 01-11 0z" /><path d="M12 16v4.5" /></>),
  plates: (<><path d="M3.5 8.5L12 4l8.5 4.5L12 13z" /><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" opacity=".55" /></>),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The Engram mark: contour rings around a summit, the map's own figure. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 26c2-9 9-15 17-15s12 6 11 12-7 11-15 11S5 32 6 26z" />
        <path d="M12 25c1-5 5-9 10-9s8 3 7 7-5 7-9 7-9-1-8-5z" />
      </g>
      <circle cx="21" cy="23" r="2.6" fill="currentColor" />
    </svg>
  );
}

/** "1,498" as "1.5k": a badge has room for four characters. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
}
