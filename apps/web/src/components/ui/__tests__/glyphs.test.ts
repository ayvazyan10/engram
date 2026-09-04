import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * L6 regression guard.
 *
 * The interface drew its icons from six Unicode repertoires at once, with
 * colour emoji (🕐 💡 ⚙️ 🔒) sitting beside monochrome line glyphs. Replacing
 * an icon set is a bundle decision this app cannot afford right now — two
 * components hand-roll ~100-byte inline SVG paths instead — but "no colour
 * emoji, one glyph per meaning" is free, and this keeps it free.
 *
 * (GLYPH's own per-meaning uniqueness is asserted in lib/__tests__/tokens.test.ts.)
 */
const PANEL_DIRS = [join(__dirname, '../..', 'ui'), join(__dirname, '../..', 'views')];

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
