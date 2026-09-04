import { describe, it, expect } from 'vitest';
import {
  contrastRatio, hexToInt, relativeLuminance,
  GLYPH, ON_STATUS, REFLECTION_COLORS, STATUS, TYPE_COLORS, TYPE_ICONS, withAlpha,
} from '../tokens.js';
import { TEMPLATES } from '../../store/templateStore.js';

describe('relativeLuminance / contrastRatio (V4 — the honest proof)', () => {
  it('black vs white is the maximum WCAG ratio, 21:1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is symmetric — argument order does not change the ratio', () => {
    expect(contrastRatio('#6366f1', '#020817')).toBeCloseTo(contrastRatio('#020817', '#6366f1'), 6);
  });

  it('identical colours have a ratio of 1', () => {
    expect(contrastRatio('#334155', '#334155')).toBeCloseTo(1, 5);
  });

  it('reproduces the audit-reported failure for the old Neural textMuted (#334155 on #020817), ~1.9:1', () => {
    expect(contrastRatio('#334155', '#020817')).toBeLessThan(2.2);
    expect(contrastRatio('#334155', '#020817')).toBeGreaterThan(1.5);
  });

  it('reproduces the audit-reported failure for the old Midnight textMuted (#3d2d5c on #080010), ~1.7:1', () => {
    expect(contrastRatio('#3d2d5c', '#080010')).toBeLessThan(2);
  });

  it('accepts 3-digit hex shorthand', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });
});

describe('withAlpha', () => {
  it('converts a 6-digit hex + alpha to an rgba() string', () => {
    expect(withAlpha('#6366f1', 0.2)).toBe('rgba(99, 102, 241, 0.2)');
  });

  it('handles 3-digit hex shorthand', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('handles a leading-# and no-# input the same way', () => {
    expect(withAlpha('6366f1', 0.2)).toBe(withAlpha('#6366f1', 0.2));
  });
});

describe('hexToInt', () => {
  it('matches the numeric literals three.js materials expect', () => {
    expect(hexToInt('#818cf8')).toBe(0x818cf8);
    expect(hexToInt(TYPE_COLORS.episodic)).toBe(0x818cf8);
  });
});

describe('TYPE_COLORS (V5 — single source of truth)', () => {
  it('has exactly the three memory types, each a valid 6-digit hex', () => {
    expect(Object.keys(TYPE_COLORS).sort()).toEqual(['episodic', 'procedural', 'semantic']);
    for (const hex of Object.values(TYPE_COLORS)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('picked the higher-contrast episodic shade — #818cf8 clears 4.5:1 on the darkest surfaces, #6366f1 does not', () => {
    expect(TYPE_COLORS.episodic).toBe('#818cf8');
    expect(contrastRatio(TYPE_COLORS.episodic, '#020817')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#6366f1', '#020817')).toBeLessThan(4.5);
  });
});

// The same honest proof templateStore.contrast.test.ts runs for template text
// roles, applied to the template-independent colour roles this module owns.
// REFLECTION_COLORS and ON_STATUS are text; a reader has to be able to read
// them on every surface they land on, in every skin.
const SURFACES = ['rootBg', 'panelBg', 'cardBg', 'inputBg', 'statusBg', 'headerBg'] as const;

describe('REFLECTION_COLORS (M8/H4 — four hex literals that lived inline in ReflectionView)', () => {
  it('has exactly the four reflection types, each a valid 6-digit hex', () => {
    expect(Object.keys(REFLECTION_COLORS).sort()).toEqual([
      'contradiction_summary', 'knowledge_gap', 'pattern', 'trend',
    ]);
    for (const hex of Object.values(REFLECTION_COLORS)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('every one clears 4.5:1 against every surface of every template', () => {
    for (const t of TEMPLATES) {
      for (const surface of SURFACES) {
        for (const [name, hex] of Object.entries(REFLECTION_COLORS)) {
          expect(contrastRatio(hex, t[surface]), `${name} on ${t.id}.${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('ON_STATUS (H8 — text on a solid STATUS fill)', () => {
  it('danger text clears 4.5:1 against the danger fill it sits on', () => {
    expect(contrastRatio(ON_STATUS.danger, STATUS.danger)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('GLYPH (L6 — one glyph per meaning, no colour emoji)', () => {
  it('never reuses a glyph for two meanings', () => {
    const values = Object.values(GLYPH);
    expect(new Set(values).size).toBe(values.length);
  });

  it('contains no colour emoji or variation selectors — the app mixed 🕐/💡/⚙️ with monochrome line glyphs', () => {
    for (const [name, glyph] of Object.entries(GLYPH)) {
      expect(glyph, `${name} carries a VS16 emoji presentation selector`).not.toContain('️');
      // Emoji live above U+1F000; every glyph here is a BMP symbol.
      expect([...glyph].every((c) => c.codePointAt(0)! < 0x1f000), `${name} is an emoji`).toBe(true);
    }
  });

  it('the memory-type icons are drawn from that registry rather than re-typed', () => {
    expect(TYPE_ICONS.episodic).toBe(GLYPH.episodic);
    expect(TYPE_ICONS.semantic).toBe(GLYPH.semantic);
    expect(TYPE_ICONS.procedural).toBe(GLYPH.procedural);
  });
});
