import { describe, expect, it } from 'vitest';
import { DIFF_WORD_CAP, wordDiff, type DiffRun } from '../diff.js';

const marked = (runs: DiffRun[]) => runs.filter((r) => r.changed).map((r) => r.text);
const text = (runs: DiffRun[]) => runs.map((r) => r.text).join('');

describe('wordDiff', () => {
  it('marks nothing when the two texts are the same', () => {
    const d = wordDiff('Release 0.8.0 is out', 'Release 0.8.0 is out');
    expect(d.changed).toBe(0);
    expect(d.a).toEqual([{ text: 'Release 0.8.0 is out', changed: false }]);
  });

  it('marks only the words each side does not share, and keeps every character', () => {
    const a = 'The app uses Postgres as its database';
    const b = 'The app uses MongoDB as its main database';
    const d = wordDiff(a, b);
    expect(marked(d.a)).toEqual(['Postgres']);
    expect(marked(d.b)).toEqual(['MongoDB', 'main']);
    expect(d.changed).toBe(3);
    expect(text(d.a)).toBe(a);
    expect(text(d.b)).toBe(b);
  });

  it('lays one stroke over a changed phrase, not one per word', () => {
    const d = wordDiff('keep the old plan today', 'keep a brand new plan today');
    expect(marked(d.a)).toEqual(['the old']);
    expect(marked(d.b)).toEqual(['a brand new']);
  });

  it('handles empty text on either side', () => {
    const d = wordDiff('', 'only here');
    expect(d.a).toEqual([]);
    expect(marked(d.b)).toEqual(['only here']);
    expect(d.changed).toBe(2);
  });

  it('compares at most the cap and shows the rest unmarked', () => {
    const long = (word: string) => Array.from({ length: DIFF_WORD_CAP + 5 }, (_, i) => `${word}${i}`).join(' ');
    const d = wordDiff(long('a'), long('b'));
    expect(d.changed).toBe(DIFF_WORD_CAP * 2);
    expect(d.a[d.a.length - 1]).toEqual({ text: expect.stringContaining(`a${DIFF_WORD_CAP + 4}`), changed: false });
    expect(text(d.a)).toBe(long('a'));
  });
});
