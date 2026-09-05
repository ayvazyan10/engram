import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two silent failure modes, and one that is merely invisible.
 *
 * The plate token layer has the unusual property that getting it wrong
 * produces no error anywhere — the plates keep drawing, in the wrong colours,
 * at the wrong width, over the wrong part of the app. There is no component to
 * render that would show it, so this asserts the stylesheet itself, the way
 * globalCss.test.ts already does for global.css.
 */
const CSS_PATH = join(__dirname, '../plate.css');
const css = readFileSync(CSS_PATH, 'utf-8');
/** Declarations only — the comments deliberately quote what is not here. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The block a selector introduces, comments stripped. */
function block(selector: string): string {
  const at = rules.indexOf(selector + ' {');
  if (at === -1) return '';
  return rules.slice(at, rules.indexOf('}', at));
}

/** The properties `contract.ts`'s `vars()` reads off the root element. Its
 *  fallback map is the list; keeping them in step is the point. */
const RESOLVED_BY_CONTRACT = [
  '--plate',
  '--margin',
  '--rule',
  '--ink',
  '--ink-2',
  '--ink-3',
  '--memory',
  '--memory-live',
  '--agrees-weak',
  '--agrees-mid',
  '--agrees-strong',
  '--contradicts-weak',
  '--contradicts-mid',
  '--contradicts-strong',
];

describe('the plate tokens are on :root', () => {
  /**
   * `vars()` resolves these with getComputedStyle(document.documentElement),
   * because canvas and WebGL cannot read a CSS variable. Scoped anywhere else,
   * every one of them falls through to that file's hardcoded fallback map and
   * the plates keep drawing while quietly ignoring this stylesheet — no error,
   * no warning, just colours that no longer track the token layer.
   */
  it('declares every custom property the contract resolves off the root element', () => {
    const root = block(':root');
    expect(root).not.toBe('');
    for (const name of RESOLVED_BY_CONTRACT) {
      expect(root, `${name} is not on :root`).toContain(`${name}:`);
    }
  });

  it('declares the type scale, rhythm and motion tokens the plates read as var()', () => {
    const root = block(':root');
    for (const name of [
      '--font-instrument',
      '--font-note',
      '--t-label',
      '--t-body',
      '--t-figure',
      '--t-claim',
      '--t-stat',
      '--t-mast',
      '--lead-tight',
      '--lead-body',
      '--gap-row',
      '--gap-block',
      '--gap-section',
      '--dur',
      '--ease',
    ]) {
      expect(root, `${name} is not on :root`).toContain(`${name}:`);
    }
  });

  it('keeps the two link hues, and only those two, as the chromatic values', () => {
    const root = block(':root');
    expect(root).toContain('--agrees:');
    expect(root).toContain('--contradicts:');
  });

  it('does not collide with the app\'s own --ec-* namespace', () => {
    expect(block(':root')).not.toContain('--ec-');
  });

  it('collapses --dur under reduced motion, which is the half global.css cannot express', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(reduced).toContain('--dur: 0ms');
    // …and does NOT re-declare the app-wide universal collapse, which
    // global.css already owns.
    expect(reduced).not.toMatch(/\*,\s*\*::before/);
  });
});

describe('the plate paint is scoped to the plate box', () => {
  /**
   * The app keeps its own three templates and its own chrome. Only the
   * visualization box is plate material.
   */
  it('never paints body or html', () => {
    expect(rules).not.toMatch(/(^|\n)\s*body\s*[,{]/);
    expect(rules).not.toMatch(/(^|\n)\s*html\s*[,{]/);
  });

  /**
   * Four of the five plates root themselves `position: absolute; inset: 0`. In
   * an unpositioned parent that resolves against the viewport: the plate
   * covers the header, the memory list and the inspector, and one of those
   * roots is also its pointer surface, so it swallows every click over them.
   */
  it('makes the plate box a containing block that fills its slot', () => {
    const box = block('.ec-plate');
    expect(box).toContain('position: relative');
    // …and actually has a size. The slot is a flex child with no intrinsic
    // height, so a box that only positions itself measures 0 x 0 and no plate
    // is ever drawn.
    expect(box).toContain('width: 100%');
    expect(box).toContain('height: 100%');
    expect(box).toContain('overflow: hidden');
    expect(box).toContain('background: var(--plate)');
    expect(box).toContain('font-family: var(--font-instrument)');
  });

  it('scopes the plates\' bare-button reset so the app keeps its own buttons', () => {
    expect(rules).toContain('.ec-plate button');
    expect(rules).not.toMatch(/(^|\n)button\s*\{/);
  });

  it('ports the utility classes the plates and the chooser set type with', () => {
    for (const cls of ['.obs-label', '.obs-figure', '.obs-stat', '.obs-note']) {
      expect(block(cls), `${cls} is missing`).not.toBe('');
    }
    // Register is width, not capitals — the reason Archivo is loaded at all.
    expect(block('.obs-label')).toContain('font-stretch: 78%');
    expect(rules).not.toContain('text-transform: uppercase');
  });
});

describe('the faces are self-hosted and complete', () => {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];

  it('loads nothing over the network — this dashboard is often offline', () => {
    expect(faces.length).toBeGreaterThan(0);
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    expect(css).not.toContain('@import');
  });

  /**
   * Without both axis ranges the browser clamps the variation and
   * `.obs-label`'s narrow cut renders at the normal width — silently, with the
   * right family and the wrong shape.
   */
  it('declares Archivo\'s weight AND width axes, or the narrow label cut collapses', () => {
    const archivo = faces.find((f) => f.includes("font-family: 'Archivo'")) ?? '';
    expect(archivo).toContain('font-weight: 100 900');
    expect(archivo).toContain('font-stretch: 62% 125%');
  });

  it('gives every face font-display: swap and an explicit unicode-range', () => {
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
      expect(face).toContain('unicode-range:');
    }
  });

  it('points every src at a file that is actually staged in public/fonts', () => {
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(urls.length).toBe(faces.length);
    for (const url of urls) {
      const file = join(__dirname, '../../../public', url);
      expect(existsSync(file), `${url} is declared but not staged`).toBe(true);
    }
  });
});
