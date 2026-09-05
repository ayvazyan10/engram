import { useEffect } from 'react';
import type { UITemplate } from '../store/templateStore.js';
import { resetPlateColors } from '../lib/plate/contract.js';

/**
 * Mirrors the active template's colours onto `document.documentElement` as
 * CSS custom properties, so the real `:hover` / `:focus-visible` /
 * `::placeholder` rules in styles/global.css (V1/V2) stay in sync with the
 * active template (V5) without every component threading `t.hoverOverlay`
 * etc. into a `style` prop by hand. The surface and text roles are mirrored
 * too: a keycap or a placeholder drawn purely in CSS still has to sit on the
 * right ground in every template.
 *
 * It also drops the plate contract's resolved-colour cache on every run. That
 * cache reads custom properties off this same element once and keeps them, for
 * canvas and WebGL which cannot read a variable — so a template switch that
 * rewrites properties under it would leave every mark on the plate painted in
 * whatever was resolved first. The plate tokens are not template-dependent
 * today, but this hook is the one place that rewrites root custom properties,
 * and it is also the earliest point at which the stylesheet is known to have
 * applied; making it the invalidation point costs one call and removes a whole
 * class of stale-colour bug.
 */
export function useThemeVars(template: UITemplate): void {
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--ec-accent', template.accent);
    root.setProperty('--ec-accent-strong', template.accentStrong);
    root.setProperty('--ec-on-accent', template.onAccent);
    root.setProperty('--ec-focus', template.focusRing);
    root.setProperty('--ec-hover-overlay', template.hoverOverlay);
    root.setProperty('--ec-active-overlay', template.activeOverlay);
    root.setProperty('--ec-text-primary', template.textPrimary);
    root.setProperty('--ec-text-secondary', template.textSecondary);
    root.setProperty('--ec-text-muted', template.textMuted);
    root.setProperty('--ec-panel-border', template.panelBorder);
    root.setProperty('--ec-panel-bg', template.panelBg);
    root.setProperty('--ec-card-bg', template.cardBg);
    root.setProperty('--ec-input-bg', template.inputBg);
    resetPlateColors();
  }, [template]);
}
