import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { GLYPH } from '../../../lib/tokens.js';

/**
 * L6 regression guard.
 *
 * The interface drew its icons from six Unicode repertoires at once, with
 * colour emoji (🕐 💡 ⚙️ 🔒) sitting beside monochrome line glyphs. Replacing
 * an icon set is a bundle decision this app cannot afford right now — two
 * components hand-roll ~100-byte inline SVG paths instead — but "no colour
 * emoji, one glyph per meaning" is free, and this keeps it free.
 *
 * (GLYPH's own per-meaning uniqueness is asserted in lib/__tests__/tokens.test.ts;
 * that a panel actually draws from GLYPH rather than re-typing one of its
 * glyphs for a second meaning is asserted below.)
 *
 * `layout` joins the sweep here: it was left out of the original pass only
 * because it was another change's directory, and MobileTabBar promptly took
 * '⬡' (concept) for its Graph tab and '◈' (pattern) for its Inspect tab.
 */
const COMPONENTS_DIR = join(__dirname, '../..');
const PANEL_DIRS = [
  join(COMPONENTS_DIR, 'ui'),
  join(COMPONENTS_DIR, 'views'),
  join(COMPONENTS_DIR, 'layout'),
];

/** Emoji-presentation-by-default characters that live below the astral
 *  planes, plus the VS16 selector that forces emoji presentation. */
const EMOJI_PRESENTATION =
  /[\u{FE0F}\u{231A}\u{231B}\u{23E9}-\u{23EC}\u{23F0}\u{23F3}\u{25FD}\u{25FE}\u{2614}\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}\u{26AB}\u{26BD}\u{26BE}\u{26C4}\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2705}\u{270A}\u{270B}\u{2728}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2795}-\u{2797}\u{27B0}\u{27BF}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{1F000}-\u{1FAFF}]/u;

/** Comments deliberately quote the emoji that were removed. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('panel glyphs (L6)', () => {
  it('no panel renders a colour emoji', () => {
    const offenders: string[] = [];
    for (const dir of PANEL_DIRS) {
      for (const file of sources(dir)) {
        const content = stripComments(readFileSync(file, 'utf-8'));
        for (const [i, line] of content.split('\n').entries()) {
          if (EMOJI_PRESENTATION.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Surfaces that still spell out a glyph the registry owns, and why. This is an
 * exact list rather than a ceiling: adding an offender fails, and so does
 * fixing one without deleting its line here, which keeps the list honest about
 * what is actually left.
 */
const KNOWN_LITERALS = [
  // The wordmark, not an icon — it predates the registry and changing the
  // brand mark is not a glyph-hygiene decision.
  'layout/AppLayout.tsx: ⬡',
  // The two view-mode tabs. Same collision MobileTabBar had ('◈' is
  // GLYPH.pattern, '◎' is GLYPH.confidence), but picking replacements is a
  // visible change to the primary navigation and belongs with a design pass.
  'ui/ViewSwitcher.tsx: ◈',
  'ui/ViewSwitcher.tsx: ◎',
  // Deliberate and protected: the reflections empty state is the
  // best-composed surface in the product, and its 32px '◈' is decorative
  // rather than the "pattern" badge that sits a few lines above it.
  'views/ReflectionView.tsx: ◈',
];

describe('panel glyphs draw from the registry (L6)', () => {
  it('no panel re-types a registry glyph for a second meaning', () => {
    const registry = Object.values(GLYPH) as string[];
    const offenders: string[] = [];

    for (const dir of PANEL_DIRS) {
      for (const file of sources(dir)) {
        const content = stripComments(readFileSync(file, 'utf-8'));
        const rel = relative(COMPONENTS_DIR, file).split(sep).join('/');
        for (const glyph of registry) {
          if (content.includes(glyph)) offenders.push(`${rel}: ${glyph}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([...KNOWN_LITERALS].sort());
  });

  it('the mobile tab bar is covered by that list — it is what this guard was added for', () => {
    const file = join(COMPONENTS_DIR, 'layout', 'MobileTabBar.tsx');
    const content = stripComments(readFileSync(file, 'utf-8'));

    for (const [name, glyph] of Object.entries(GLYPH)) {
      expect(content, `MobileTabBar hard-codes GLYPH.${name}`).not.toContain(glyph);
    }
    expect(content).toContain('GLYPH.paneMemories');
    expect(content).toContain('GLYPH.paneGraph');
    expect(content).toContain('GLYPH.paneInspect');
  });
});
