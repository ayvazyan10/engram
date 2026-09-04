import { useEffect } from 'react';
import type { UITemplate } from '../store/templateStore.js';

/**
 * Mirrors the active template's interaction-state colours onto
 * `document.documentElement` as CSS custom properties, so the real
 * `:hover` / `:focus-visible` rules in styles/global.css (V1/V2) stay in
 * sync with the active template (V5) without every component threading
 * `t.hoverOverlay` etc. into a `style` prop by hand.
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
  }, [template]);
}
