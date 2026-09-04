import { describe, it, expect } from 'vitest';
import { toPlainText, memoryRowText, CONTENT_SLICE_LENGTH } from '../plainText.js';

describe('toPlainText (H4 — raw Markdown was printed as literal text)', () => {
  it('strips the ATX heading marker every reflection body opens with', () => {
    expect(toPlainText('# Memory Analysis: contradictions')).toBe('Memory Analysis: contradictions');
    expect(toPlainText('###### Deeply nested')).toBe('Deeply nested');
  });

  it('strips a heading marker on any line, not just the first', () => {
    expect(toPlainText('Intro\n## Section two\nbody')).toBe('Intro Section two body');
  });

  it('leaves a hash that is not a heading marker alone', () => {
    expect(toPlainText('issue #42 is open')).toBe('issue #42 is open');
    expect(toPlainText('#hashtag')).toBe('#hashtag');
  });

  it('unwraps bold, emphasis and inline code', () => {
    expect(toPlainText('**Most Significant Contradiction:** none')).toBe('Most Significant Contradiction: none');
    expect(toPlainText('a *stressed* word')).toBe('a stressed word');
    expect(toPlainText('run `pnpm build` first')).toBe('run pnpm build first');
  });

  it('unwraps a fenced code block without eating its contents', () => {
    expect(toPlainText('before\n```ts\nconst a = 1;\n```\nafter')).toBe('before const a = 1; after');
  });

  it('leaves underscore-flavoured emphasis alone — snake_case identifiers are not italics', () => {
    expect(toPlainText('call some_snake_case_name now')).toBe('call some_snake_case_name now');
    expect(toPlainText('_leading underscore_')).toBe('_leading underscore_');
  });

  it('collapses every run of whitespace to one space and trims', () => {
    expect(toPlainText('  a\n\n\tb   c  ')).toBe('a b c');
  });

  it('is total — empty input and plain prose both come back sensibly', () => {
    expect(toPlainText('')).toBe('');
    expect(toPlainText('just a sentence')).toBe('just a sentence');
  });
});

describe('memoryRowText (H1 — 30% of rendered rows were byte-identical)', () => {
  const base = { concept: null as string | null, content: '', source: null as string | null };

  it('gives two rows that share a concept different second lines', () => {
    const a = memoryRowText({
      ...base,
      concept: 'Trend Analysis',
      content: '# Trend Analysis\nSemantic memory is growing 3x faster than episodic.',
    });
    const b = memoryRowText({
      ...base,
      concept: 'Trend Analysis',
      content: '# Trend Analysis\nReflection storage now dominates the store.',
    });

    expect(a.primary).toBe('Trend Analysis');
    expect(b.primary).toBe(a.primary);
    expect(a.secondary).not.toBe(b.secondary);
    expect(a.secondary).toBe('Semantic memory is growing 3x faster than episodic.');
  });

  it('strips the concept off the front of the excerpt, separators included', () => {
    expect(
      memoryRowText({ ...base, concept: 'Pattern Analysis', content: 'Pattern Analysis — the store repeats itself' }).secondary
    ).toBe('the store repeats itself');
  });

  it('matches the concept case-insensitively — the heading is often title-cased', () => {
    expect(
      memoryRowText({ ...base, concept: 'typescript', content: '## TypeScript: strict mode is on' }).secondary
    ).toBe('strict mode is on');
  });

  it('falls back to source when the body says nothing the concept did not', () => {
    expect(
      memoryRowText({ concept: 'Trend Analysis', content: '# Trend Analysis', source: 'reflection' }).secondary
    ).toBe('reflection');
  });

  it('keeps the content slice on line one when there is no concept, and puts source on line two', () => {
    const row = memoryRowText({
      concept: null,
      content: 'x'.repeat(120),
      source: 'claude-code',
    });
    expect(row.primary).toHaveLength(CONTENT_SLICE_LENGTH);
    expect(row.secondary).toBe('claude-code');
  });

  it('never appends its own ellipsis — the row clips with CSS (L3)', () => {
    const row = memoryRowText({ concept: null, content: 'y'.repeat(CONTENT_SLICE_LENGTH), source: null });
    expect(row.primary.endsWith('…')).toBe(false);
    expect(row.secondary).toBe('');
  });
});
