/** One run of text in a pair card: `changed` runs get the highlighter. */
export interface DiffRun {
  text: string;
  changed: boolean;
}

/**
 * Words compared per side. The LCS table is words × words, so this keeps the
 * worst case at 360k cells; text past the cap is shown unmarked.
 */
export const DIFF_WORD_CAP = 600;

/**
 * A word-level diff of two memories: each side's text as runs, where a
 * changed run is a stretch of words the other side does not share (by longest
 * common subsequence). Whitespace between two changed words joins their run,
 * so the highlighter lays one stroke over a phrase rather than one per word.
 */
export function wordDiff(a: string, b: string): { a: DiffRun[]; b: DiffRun[]; changed: number } {
  const A = tokens(a);
  const B = tokens(b);
  const wa = A.head.filter(isWord);
  const wb = B.head.filter(isWord);
  const n = wa.length;
  const m = wb.length;

  // Suffix LCS lengths, one flat array.
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = wa[i] === wb[j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }

  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (wa[i] === wb[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (dp[at(i + 1, j)]! >= dp[at(i, j + 1)]!) i++;
    else j++;
  }

  const changed = keepA.filter((k) => !k).length + keepB.filter((k) => !k).length;
  return { a: runs(A, keepA), b: runs(B, keepB), changed };
}

function isWord(token: string): boolean {
  return !/^\s+$/.test(token);
}

/** Words and the whitespace between them, the first DIFF_WORD_CAP words in
 *  `head` and everything after as one plain `tail`. */
function tokens(text: string): { head: string[]; tail: string } {
  const all = text.split(/(\s+)/).filter((t) => t !== '');
  const head: string[] = [];
  let words = 0;
  let k = 0;
  for (; k < all.length; k++) {
    if (isWord(all[k]!) && words++ === DIFF_WORD_CAP) break;
    head.push(all[k]!);
  }
  return { head, tail: all.slice(k).join('') };
}

function runs({ head, tail }: { head: string[]; tail: string }, keep: boolean[]): DiffRun[] {
  const out: DiffRun[] = [];
  const push = (text: string, changed: boolean) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed) out[out.length - 1] = { text: last.text + text, changed };
    else out.push({ text, changed });
  };
  let w = 0;
  head.forEach((token, k) => {
    if (isWord(token)) {
      push(token, !keep[w++]);
      return;
    }
    // Space inside a changed phrase stays highlighted; at its edges it does not.
    const prevChanged = w > 0 && !keep[w - 1];
    const nextChanged = w < keep.length && !keep[w] && k < head.length - 1;
    push(token, prevChanged && nextChanged);
  });
  if (tail) push(tail, false);
  return out;
}
