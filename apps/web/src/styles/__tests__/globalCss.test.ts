import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scrollbar, the switcher-label breakpoint and the numeral utility are
 * CSS-only findings (L4, M12, M13) — there is no component to render that
 * would prove them. These assert the stylesheet itself, the same way
 * typeColorsSingleSource.test.ts asserts the source tree.
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

  it('no longer hardcodes the slate thumb that stayed slate in every template', () => {
    expect(rules).not.toContain('#1e293b');
    expect(rules).not.toContain('#334155');
  });

  it('tints the thumb from the live template accent variable', () => {
    const rule = css.match(/::-webkit-scrollbar-thumb\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('--ec-accent');
  });

  it('gives Firefox, which has no ::-webkit-scrollbar, the same treatment', () => {
    expect(css).toMatch(/scrollbar-color:/);
  });
});

describe('global.css responsive labels (M12)', () => {
  it('still collapses the view switcher label below 860px', () => {
    expect(css).toMatch(/@media \(max-width: 860px\)\s*\{\s*\.ec-switcher-label/);
  });

  it('never hides the template switcher label — its "icon" is an unlabelled colour dot', () => {
    expect(rules).not.toContain('.ec-template-label');
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
