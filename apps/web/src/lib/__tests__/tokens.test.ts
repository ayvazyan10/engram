import { describe, it, expect } from 'vitest';
import {
  contrastRatio, deltaE, hexToInt, oklchChroma, oklchLightness, relativeLuminance,
  ACTIVITY_RAMP, CHROMA_FLOOR, DARK_LIGHTNESS_BAND, EDGE_RAMP, GLYPH,
  NORMAL_VISION_DELTA_E_FLOOR, ON_STATUS, SERIES, STATUS, TYPE_COLORS, TYPE_ICONS, withAlpha,
} from '../tokens.js';
import { TEMPLATES } from '../../store/templateStore.js';

// The same honest proof templateStore.contrast.test.ts runs for template text
// roles, applied to the template-independent colour roles this module owns.
const SURFACES = ['rootBg', 'panelBg', 'cardBg', 'inputBg', 'statusBg', 'headerBg'] as const;

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
    expect(hexToInt('#7e6cf8')).toBe(0x7e6cf8);
    expect(hexToInt(TYPE_COLORS.episodic)).toBe(0x7e6cf8);
  });
});

// Every surface any of these colours is painted on, in every skin.
const ALL_SURFACES = TEMPLATES.flatMap((t) => SURFACES.map((k) => ({ id: `${t.id}.${k}`, hex: t[k] })));

describe('TYPE_COLORS (V5 single source of truth, F1 re-stepped)', () => {
  it('has exactly the three memory types, each a valid 6-digit hex', () => {
    expect(Object.keys(TYPE_COLORS).sort()).toEqual(['episodic', 'procedural', 'semantic']);
    for (const hex of Object.values(TYPE_COLORS)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  // V5's assertion, re-pointed rather than deleted: the invariant it bought was
  // "the memory-type palette is legible on the app's near-black surfaces", and
  // that still holds — the minimum is 4.60:1, episodic on Mono's cardBg.
  it('every slot clears 4.5:1 against every surface of every template', () => {
    for (const [name, hex] of Object.entries(TYPE_COLORS)) {
      for (const surface of ALL_SURFACES) {
        expect(contrastRatio(hex, surface.hex), `${name} on ${surface.id}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reproduces the defect that moved them: all three of the V5 values sat ABOVE the dark lightness band', () => {
    for (const hex of ['#818cf8', '#22d3ee', '#fbbf24']) {
      expect(oklchLightness(hex)).toBeGreaterThan(DARK_LIGHTNESS_BAND.max);
    }
    // …spanning 0.157, so amber outranked indigo on brightness alone.
    const oldSpan = Math.max(oklchLightness('#fbbf24'), oklchLightness('#22d3ee'), oklchLightness('#818cf8'))
      - Math.min(oklchLightness('#fbbf24'), oklchLightness('#22d3ee'), oklchLightness('#818cf8'));
    expect(oldSpan).toBeGreaterThan(0.15);
  });

  it('sits inside the dark-mode lightness band, so no slot outranks another on brightness', () => {
    const lightness = Object.values(TYPE_COLORS).map(oklchLightness);
    for (const L of lightness) {
      expect(L).toBeGreaterThanOrEqual(DARK_LIGHTNESS_BAND.min);
      expect(L).toBeLessThanOrEqual(DARK_LIGHTNESS_BAND.max);
    }
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThanOrEqual(0.05);
  });

  it('clears the chroma floor, so each slot still reads as a hue rather than a grey', () => {
    for (const [name, hex] of Object.entries(TYPE_COLORS)) {
      expect(oklchChroma(hex), name).toBeGreaterThanOrEqual(CHROMA_FLOOR);
    }
  });

  it('keeps every pair apart for full-colour readers — this is a scatter, so ALL pairs, not just neighbours', () => {
    const slots = Object.entries(TYPE_COLORS);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        expect(deltaE(slots[i]![1], slots[j]![1]), `${slots[i]![0]} vs ${slots[j]![0]}`)
          .toBeGreaterThanOrEqual(NORMAL_VISION_DELTA_E_FLOOR);
      }
    }
  });
});

describe('data colour has one meaning per slot (F5)', () => {
  // The reflection palette used to be BYTE-IDENTICAL to three of these:
  // pattern === episodic, trend === semantic, contradiction === procedural.
  it('reproduces the collision the reflection palette had with the memory types', () => {
    expect(deltaE('#818cf8', '#818cf8')).toBe(0);
    expect(deltaE('#22d3ee', '#22d3ee')).toBe(0);
    expect(deltaE('#fbbf24', '#fbbf24')).toBe(0);
  });

  it('no data colour that means something else lands within the normal-vision floor of a memory type', () => {
    const others = { 'SERIES.primary': SERIES.primary, ...Object.fromEntries(EDGE_RAMP.map((h, i) => [`EDGE_RAMP[${i}]`, h])) };
    for (const [otherName, other] of Object.entries(others)) {
      for (const [typeName, type] of Object.entries(TYPE_COLORS)) {
        expect(deltaE(other, type), `${otherName} vs ${typeName}`).toBeGreaterThanOrEqual(NORMAL_VISION_DELTA_E_FLOOR);
      }
    }
  });

  it('reproduces the old edge ramp sitting under that floor from the episodic hue', () => {
    expect(deltaE('#4a63d6', TYPE_COLORS.episodic)).toBeLessThan(NORMAL_VISION_DELTA_E_FLOOR);
  });

  it('the series slot is a real categorical slot — in band, over the chroma floor, 3:1 on every surface', () => {
    expect(oklchLightness(SERIES.primary)).toBeGreaterThanOrEqual(DARK_LIGHTNESS_BAND.min);
    expect(oklchLightness(SERIES.primary)).toBeLessThanOrEqual(DARK_LIGHTNESS_BAND.max);
    expect(oklchChroma(SERIES.primary)).toBeGreaterThanOrEqual(CHROMA_FLOOR);
    for (const surface of ALL_SURFACES) {
      expect(contrastRatio(SERIES.primary, surface.hex), surface.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('sequential ramps (F4, F5) — one hue, monotone lightness, a legible low end', () => {
  const CARD_SURFACES = TEMPLATES.map((t) => t.cardBg);
  const SCENE_SURFACES = ['#03060f', '#04090c', '#07070d'];

  for (const [name, ramp, surfaces, lowFloor] of [
    ['ACTIVITY_RAMP', ACTIVITY_RAMP, CARD_SURFACES, 2],
    ['EDGE_RAMP', EDGE_RAMP, SCENE_SURFACES, 2],
  ] as const) {
    it(`${name} steps rise monotonically with a visible gap between each`, () => {
      const lightness = ramp.map(oklchLightness);
      for (let i = 1; i < lightness.length; i++) {
        expect(lightness[i]! - lightness[i - 1]!, `${name} step ${i}`).toBeGreaterThanOrEqual(0.06);
      }
    });

    it(`${name} keeps its low end legible against every surface it is drawn on`, () => {
      for (const surface of surfaces) {
        expect(contrastRatio(ramp[0]!, surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(lowFloor);
      }
    });
  }

  it('reproduces the old heatmap ramp being invisible at the low end — an opacity ramp over the chrome accent', () => {
    // 0.15 + (1/6) * 0.85 of Neural's #6366f1 composited on its cardBg.
    expect(contrastRatio('#242d63', '#0a1628')).toBeLessThan(2);
    // …and Midnight's, which was worse.
    expect(contrastRatio('#401964', '#150028')).toBeLessThan(2);
  });

  it('ACTIVITY_RAMP is the series hue, so the flat series and the magnitude ramp read as one family', () => {
    expect(ACTIVITY_RAMP).toContain(SERIES.primary);
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
