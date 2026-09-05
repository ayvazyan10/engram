import type { CSSProperties } from 'react';
import type { UITemplate } from '../../store/templateStore.js';
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../lib/tokens.js';

/**
 * The header's segmented controls — view modes, 3D framings, templates —
 * share one treatment, defined here so the three cannot drift apart.
 *
 * The active segment lifts off the track as a small card: the card surface,
 * a hairline, and a shadow under it. Every other segment sits flat in muted
 * ink. Selection reads as a switch position rather than as a coloured tab,
 * which leaves the accent free to mean focus, and "selected" in the data.
 *
 * The inactive state deliberately sets no `boxShadow`: `.ec-hover-tint`
 * paints its hover as an inset shadow, and an inline value here — even
 * `'none'` — would out-rank that rule and silently swallow the hover.
 */
export function trackStyle(t: UITemplate, ghost = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE['3xs'],
    padding: SPACE['3xs'],
    borderRadius: RADIUS.md,
    background: ghost ? 'transparent' : t.inputBg,
    border: `1px solid ${ghost ? 'transparent' : t.panelBorder}`,
  };
}

export const segmentBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: SPACE.xs,
  // M6: 24px is the WCAG 2.2 target minimum; the padding takes it to 26.
  minHeight: 24,
  padding: `${SPACE['2xs']} ${SPACE.md}`,
  border: 'none',
  borderRadius: RADIUS.sm,
  fontSize: TYPE.sm,
  fontWeight: WEIGHT.medium,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};

export function segmentState(t: UITemplate, active: boolean): CSSProperties {
  return active
    ? {
        background: t.cardBg,
        color: t.textPrimary,
        boxShadow: `inset 0 0 0 1px ${t.panelBorder}, 0 1px 2px rgba(0, 0, 0, 0.35)`,
      }
    : { background: 'transparent', color: t.textMuted };
}
