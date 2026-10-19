import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scrollbar, the switcher-label breakpoint and the numeral utility are
 * CSS-only findings (L4, M12, M13) — there is no component to render that
 * would prove them. These assert the stylesheet itself.
 */
const css = readFileSync(join(__dirname, '../global.css'), 'utf-8');
/** Declarations only — the comments deliberately quote the old values. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('global.css scrollbars (L4)', () => {
  it('is no longer 4px wide', () => {
    const rule = css.match(/::-webkit-scrollbar\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/width:\s*10px/);
    expect(rule).not.toMatch(/width:\s*4px/);
  });

  it('no longer hardcodes the slate thumb that stayed slate in both colour modes', () => {
    expect(rules).not.toContain('#1e293b');
    expect(rules).not.toContain('#334155');
  });

  it('tints the thumb from the Atlas ink variable', () => {
    const rule = css.match(/::-webkit-scrollbar-thumb\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('--ink');
  });

  it('gives Firefox, which has no ::-webkit-scrollbar, the same treatment', () => {
    expect(css).toMatch(/scrollbar-color:/);
  });
});

describe('global.css utilities', () => {
  it('provides tabular numerals (M13) — nothing in the app set font-variant-numeric', () => {
    expect(css).toMatch(/\.ec-tabular\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it('provides an anywhere-wrap for version strings and paths (H10)', () => {
    expect(css).toMatch(/\.ec-wrap-anywhere\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it('provides the line clamp the inspector content uses (H10)', () => {
    expect(css).toMatch(/\.ec-clamp\s*\{[^}]*-webkit-line-clamp/);
  });

  it('strips the native select chrome (M5)', () => {
    expect(css).toMatch(/\.ec-select\s*\{[^}]*appearance:\s*none/);
  });
});

const tokens = readFileSync(join(__dirname, '../tokens.css'), 'utf8');
const shellCss = readFileSync(join(__dirname, '../../shell/shell.css'), 'utf8');
const reviewCss = readFileSync(join(__dirname, '../../features/review/review.css'), 'utf8');
const colourBlocks = [...tokens.matchAll(/:root(?:[^{}]*)\{([^}]+)\}/g)]
  .map((match) => Object.fromEntries([...match[1]!.matchAll(/--([\w-]+):\s*(#[\da-f]{6}|rgba\([^)]+\))/gi)].map((m) => [m[1]!, m[2]!])) )
  .filter((block) => block.paper);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function contrast(a: number[], b: number[]) {
  const luminance = (c: number[]) => c.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1]! + 0.05) / (values[0]! + 0.05);
}

describe('Atlas text contrast', () => {
  it('keeps normal, muted and warning text above 4.5:1 on all surfaces and washes in both themes', () => {
    expect(colourBlocks).toHaveLength(3); // Light, system dark, explicit dark.
    expect(colourBlocks[1]).toEqual(colourBlocks[2]);
    for (const t of colourBlocks) {
      for (const bg of ['paper', 'surface', 'raised']) {
        const backgrounds = [rgb(t[bg]!)];
        for (const wash of ['wash', 'wash-2']) {
          const channels = t[wash]!.match(/[\d.]+/g)!.map(Number);
          backgrounds.push(rgb(t[bg]!).map((v, i) => v * (1 - channels[3]!) + channels[i]! / 255 * channels[3]!));
        }
        for (const ink of ['ink', 'ink-2', 'ink-3', 'fault-text']) {
          for (const background of backgrounds) expect(contrast(rgb(t[ink]!), background), `${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(rgb(t['on-ink']!), rgb(t.ink!))).toBeGreaterThanOrEqual(4.5);
      for (const [stylesheet, selector] of [[shellCss, '.at-badge'], [reviewCss, '.rv-btn.danger']]) {
        const block = stylesheet!.split(`${selector} {`)[1]!.split('}')[0]!;
        const foreground = block.match(/color:\s*(#[\da-f]{6})/i)![1]!;
        expect(block).toContain('background: var(--fault)');
        expect(contrast(rgb(foreground), rgb(t.fault!))).toBeGreaterThanOrEqual(4.5);
      }
      for (let n = 1; n <= 4; n++) expect(contrast(rgb(t[`heat-ink-${n}`]!), rgb(t[`heat-${n}`]!))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('fault graphics and text roles', () => {
  it('restores vivid orange graphics in all three token blocks', () => {
    expect(colourBlocks.map((t) => t.fault)).toEqual(['#DF500C', '#E86518', '#E86518']);
    expect(colourBlocks.map((t) => t['fault-text'])).toEqual(['#A43808', '#FF975E', '#FF975E']);
    for (const t of colourBlocks) {
      for (const bg of ['paper', 'surface', 'raised']) expect(contrast(rgb(t.fault!), rgb(t[bg]!))).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses fault-text for text, retaining fault for graphics and the decorative warning glyph', () => {
    for (const file of ['features/map/map.css', 'features/memory/memory.css', 'features/onboarding/onboarding.css',
      'features/timeline/timeline.css', 'features/recall/recall.css', 'shell/shell.css', 'features/insights/insights.css']) {
      const source = readFileSync(join(__dirname, '../..', file), 'utf8');
      expect(source, file).toContain('color: var(--fault-text)');
      expect(source, file).not.toMatch(/(?:^|[;{\s])color:\s*var\(--fault\)/);
      expect(source.match(/[\w-]+:\s*[^;{}]*var\(--fault-text\)[^;{}]*/g), file)
        .toEqual(['color: var(--fault-text)']);
    }
    expect(reviewCss).toContain('--q-contradictions: var(--fault)');
    const mapCss = readFileSync(join(__dirname, '../../features/map/map.css'), 'utf8');
    expect(mapCss).toContain('stroke: var(--fault)');
    const uiCss = readFileSync(join(__dirname, '../../components/ui/ui.css'), 'utf8');
    expect(uiCss).toMatch(/\.ui-error-icon\s*\{[^}]*color: var\(--fault\)/);
  });
});

describe('route announcement focus', () => {
  it('suppresses the main container ring while retaining keyboard focus on controls and roving tabs', () => {
    expect(shellCss).toMatch(/\.at-shell \.at-main\[tabindex="-1"\]:focus\s*\{\s*outline: none;/);
    expect(shellCss).toMatch(/\.at-shell :focus-visible\s*\{\s*outline: 2px solid var\(--focus\)/);
    expect(css).toMatch(/button:focus-visible,[\s\S]*\[tabindex\]:focus-visible\s*\{\s*outline: 2px solid var\(--focus\)/);
  });
});
