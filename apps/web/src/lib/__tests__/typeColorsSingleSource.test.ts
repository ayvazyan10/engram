import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// V5 root-cause regression guard: TYPE_COLORS used to be re-declared with
// disagreeing values in MemoryPanel.tsx, NeuronInspector.tsx, AnalyticsView.tsx
// and TimelineView.tsx. A unit test can't observe "the audit is fixed" from
// the outside, but it CAN keep it fixed — this scans every source file
// outside lib/tokens.ts for a re-declared TYPE_COLORS map and fails the
// build the moment one reappears.
const SRC_DIR = join(__dirname, '../../');

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('TYPE_COLORS single source of truth (V5)', () => {
  it('is declared exactly once, in lib/tokens.ts', () => {
    const files = collectFiles(SRC_DIR);
    const declaringFiles = files.filter((f) => {
      const content = readFileSync(f, 'utf-8');
      return /(?:const|let)\s+TYPE_COLORS\s*[:=]/.test(content);
    });

    const relative = declaringFiles.map((f) => f.replace(SRC_DIR, ''));
    expect(relative).toEqual(['lib/tokens.ts']);
  });

  it('every other file that uses TYPE_COLORS imports it rather than re-typing the hex values', () => {
    const files = collectFiles(SRC_DIR).filter((f) => !f.endsWith('lib/tokens.ts'));
    for (const f of files) {
      const content = readFileSync(f, 'utf-8');
      if (!content.includes('TYPE_COLORS')) continue;
      expect(content, `${f} uses TYPE_COLORS but doesn't import it`).toMatch(
        /import\s+\{[^}]*\bTYPE_COLORS\b[^}]*\}\s+from\s+['"].*tokens\.js['"]/
      );
    }
  });
});
