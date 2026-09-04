import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../templateStore.js';
import { contrastRatio } from '../../lib/tokens.js';

// V4's honest proof: assert the ratio against the template's own actual
// backgrounds, don't eyeball a screenshot. Every one of these failed before
// the fix — see the specific "old value" ratios reproduced in
// lib/__tests__/tokens.test.ts.
describe('UITemplate text contrast (V4) — every template, every surface', () => {
  const darkestSurfaces: (keyof (typeof TEMPLATES)[number])[] = ['rootBg', 'panelBg', 'cardBg', 'inputBg', 'statusBg', 'headerBg'];

  for (const t of TEMPLATES) {
    describe(`${t.name} (${t.id})`, () => {
      it('textPrimary clears 4.5:1 against every surface', () => {
        for (const surface of darkestSurfaces) {
          expect(contrastRatio(t.textPrimary, t[surface] as string)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('textSecondary clears 4.5:1 against every surface', () => {
        for (const surface of darkestSurfaces) {
          expect(contrastRatio(t.textSecondary, t[surface] as string)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('textMuted (the field the audit flagged — SearchBar label/hint, StatusBar brand, MemoryPanel counters, Inspector section labels/empty state) clears 4.5:1 against every surface', () => {
        for (const surface of darkestSurfaces) {
          expect(contrastRatio(t.textMuted, t[surface] as string)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('textMuted is visibly a step down from textSecondary — hierarchy via lightness, not just "readable vs not"', () => {
        const secondaryOnRoot = contrastRatio(t.textSecondary, t.rootBg);
        const mutedOnRoot = contrastRatio(t.textMuted, t.rootBg);
        expect(mutedOnRoot).toBeLessThan(secondaryOnRoot);
      });

      it('onAccent clears 4.5:1 against accentStrong — the solid CTA button fill (Save/Unlock/Store)', () => {
        expect(contrastRatio(t.onAccent, t.accentStrong)).toBeGreaterThanOrEqual(4.5);
      });

      it('accent clears the 3:1 non-text/focus-indicator threshold against rootBg', () => {
        expect(contrastRatio(t.accent, t.rootBg)).toBeGreaterThanOrEqual(3);
      });

      it('focusRing clears the 3:1 non-text/focus-indicator threshold against rootBg', () => {
        expect(contrastRatio(t.focusRing, t.rootBg)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
