import { useMemo, type CSSProperties } from 'react';
import type { ReviewPair } from '../../lib/api.js';
import { toPlainText } from '../../lib/plainText.js';
import { wordDiff, type DiffRun } from './diff.js';
import { ActButton, Keys, MemoryMeta, percent, type Action } from './parts.js';

/** The highlighter strokes go down one after another, all down by this. */
const STROKE_STAGGER_MS = 30;
const STROKE_CAP_MS = 400;

function headline(queue: 'contradictions' | 'duplicates', ratio: number, changed: number): string {
  if (changed === 0) return 'The same note, stored twice';
  if (queue === 'duplicates') return 'Nearly the same note';
  return ratio >= 0.6 ? 'These look like the same note' : 'Do these really disagree?';
}

function why(queue: 'contradictions' | 'duplicates', item: ReviewPair, changed: number): string {
  const strength = item.strength.toFixed(2);
  if (changed === 0) {
    return queue === 'contradictions'
      ? `Engram linked these as contradicting (strength ${strength}), but the text is identical. Keep one and the other is archived.`
      : `Engram linked these as near-duplicates (similarity ${strength}). The text is identical. Keep one and the other is archived.`;
  }
  return queue === 'contradictions'
    ? `Engram linked these as contradicting (strength ${strength}). ${percent(item.sharedWordRatio)} of their words are shared; the highlighted words are where they differ. Keeping one archives the other.`
    : `Engram linked these as near-duplicates (similarity ${strength}). Only the highlighted words differ. Keeping one archives the other.`;
}

function Body({ runs }: { runs: DiffRun[] }) {
  let stroke = 0;
  return (
    <p className="rv-body">
      {runs.map((run, i) => {
        if (!run.changed) return <span key={i}>{run.text}</span>;
        const delay = Math.min(stroke++ * STROKE_STAGGER_MS, STROKE_CAP_MS);
        return (
          <mark key={i} className="rv-hl" style={{ '--d': `${delay}ms` } as CSSProperties}>
            {run.text}
          </mark>
        );
      })}
    </p>
  );
}

/**
 * Two memories side by side, the words that differ under the highlighter.
 * Keep one (the other is archived), or leave both.
 */
export default function PairCard({
  queue,
  item,
  position,
  busy,
  onAct,
}: {
  queue: 'contradictions' | 'duplicates';
  item: ReviewPair;
  position: string;
  busy: boolean;
  onAct: (action: Action) => void;
}) {
  const diff = useMemo(
    () => wordDiff(toPlainText(item.a.content), toPlainText(item.b.content)),
    [item.a.content, item.b.content]
  );
  const leave = queue === 'contradictions' ? 'Not a contradiction' : 'Keep both';

  return (
    <>
      <div className="rv-card-head">
        <h2 className="rv-h">{headline(queue, item.sharedWordRatio, diff.changed)}</h2>
        <span className="rv-pos">{position}</span>
      </div>
      <p className="rv-why">{why(queue, item, diff.changed)}</p>

      <div className="rv-pair">
        <section className="rv-col" data-side="a" aria-label="First memory">
          <MemoryMeta memory={item.a} label="the first memory" />
          <Body runs={diff.a} />
          <ActButton label="Keep this one" keyName="1" onClick={() => onAct('keepA')} disabled={busy} />
        </section>
        <section className="rv-col" data-side="b" aria-label="Second memory">
          <MemoryMeta memory={item.b} label="the second memory" />
          <Body runs={diff.b} />
          <ActButton label="Keep this one" keyName="2" onClick={() => onAct('keepB')} disabled={busy} />
        </section>
      </div>

      <div className="rv-actions">
        <ActButton label={leave} keyName="d" kind={queue === 'contradictions' ? 'pri' : 'sec'} onClick={() => onAct('dismiss')} disabled={busy} />
        <Keys keys={[['j', 'next'], ['k', 'back'], ['o', 'open'], ['x', 'select']]} />
      </div>
    </>
  );
}
