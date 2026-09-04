import type { CSSProperties } from 'react';
import { useTemplateStore } from '../../store/templateStore.js';
import {
  RADIUS, SPACE, TYPE, TYPE_COLORS, TYPE_LABELS, WEIGHT, withAlpha, type MemoryType,
} from '../../lib/tokens.js';

/**
 * The one way this app puts a data colour on screen next to words (F2).
 *
 * The mark rules are blunt about it: "Text never wears the data color… Identity
 * comes from the colored mark beside the text — a dot, a short line-key, a
 * swatch — never from coloring the text itself." Four surfaces broke that —
 * the timeline's type badge, the status bar's E/S/P letters, every 3D label,
 * and the sidebar's 11px type glyph — each with its own hand-rolled markup.
 *
 * The donut legend in AnalyticsView was already doing it correctly (coloured
 * dot, `textSecondary` text, value alongside), so this is that pattern lifted
 * out rather than a second one invented beside it. Every site now composes
 * `DataDot` + ink text, and the legend itself uses `DataDot` too, so there is
 * exactly one implementation to keep honest.
 */

/** Legend/mark dot diameter, in px — the size the donut legend already used. */
export const DATA_DOT_SIZE = 8;

/**
 * A colour-carrying mark. `aria-hidden` on purpose: it is a swatch, and the
 * text beside it is what a screen reader should read.
 */
export function DataDot({ color, size = DATA_DOT_SIZE }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * The badge that names a memory's type: a dot in the type hue, the label in
 * ink. The pill's tint is a second non-text mark, not the identity channel —
 * the dot is.
 *
 * Before this, the badge set `color: typeColor` on the label over a 12.5% tint
 * of itself: 5.08:1 with the old palette, and 4.03:1 under the re-stepped one.
 * The label wears `textPrimary` now — 12.3:1 at worst across all three types
 * and all three templates, asserted in DataMark.test.tsx. `textSecondary`, the
 * legend's ink, is what the dot's neighbour uses on a plain surface; a badge
 * sits on its own tint, which lightens the ground under it, and that costs
 * Mono's secondary ink enough to land at 4.26:1.
 */
export function TypeTag({ type, style }: { type: MemoryType; style?: CSSProperties }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const color = TYPE_COLORS[type];
  return (
    <span style={{ ...tagStyle, background: withAlpha(color, 0.125), color: t.textPrimary, ...style }}>
      <DataDot color={color} size={7} />
      {TYPE_LABELS[type]}
    </span>
  );
}

const tagStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: SPACE['2xs'],
  fontSize: TYPE.xs,
  fontWeight: WEIGHT.semibold,
  padding: `${SPACE['3xs']} ${SPACE.sm}`,
  borderRadius: RADIUS.tight,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};
