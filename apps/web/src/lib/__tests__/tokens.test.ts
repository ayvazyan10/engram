import { describe, it, expect } from 'vitest';
import { contrastRatio, hexToInt, relativeLuminance, TYPE_COLORS, withAlpha } from '../tokens.js';

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
