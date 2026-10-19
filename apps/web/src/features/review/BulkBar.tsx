import { useState, type FormEvent } from 'react';
import type { ReviewQueue } from '../../lib/api.js';
import type { BulkAction } from './triage.js';

const LEAVE: Record<ReviewQueue, string> = {
  contradictions: 'Not contradictions',
  duplicates: 'Keep both',
  fading: 'Let them fade',
  secrets: 'Not secrets',
};

/**
 * What can be done to every selected item at once: the queue's leave-be,
 * Pin (fading), a tag, and archive. For pairs, archive keeps the newer of
 * each and archives the older.
 */
export default function BulkBar({
  queue,
  count,
  allSelected,
  busy,
  onSelectAll,
  onClear,
  onRun,
}: {
  queue: ReviewQueue;
  count: number;
  allSelected: boolean;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onRun: (action: BulkAction, tag?: string) => void;
}) {
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState('');
  const pairs = queue === 'contradictions' || queue === 'duplicates';

  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    const value = tag.trim();
    if (!value) return;
    onRun('tag', value);
    setTagging(false);
    setTag('');
  };

  return (
    <div className="rv-bulk" role="toolbar" aria-label={`${count} selected`}>
      <div className="rv-bulk-head">
        <strong className="rv-num">{count.toLocaleString('en-US')} selected</strong>
        {!allSelected && (
          <button type="button" className="rv-link" onClick={onSelectAll}>
            Select all loaded
          </button>
        )}
        <button type="button" className="rv-link" onClick={onClear}>
          Clear
        </button>
      </div>
      {tagging ? (
        <form className="rv-bulk-tag" onSubmit={submitTag}>
          <label className="at-sr" htmlFor="rv-bulk-tag">
            Tag
          </label>
          <input
            id="rv-bulk-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="Tag name"
            autoFocus
            maxLength={100}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setTagging(false);
              }
            }}
          />
          <button type="submit" className="rv-btn pri" disabled={busy || !tag.trim()}>
            Add tag
          </button>
          <button type="button" className="rv-btn quiet" onClick={() => setTagging(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="rv-bulk-row">
          {queue === 'fading' && (
            <button type="button" className="rv-btn pri" disabled={busy} onClick={() => onRun('pin')}>
              Pin
            </button>
          )}
          <button type="button" className={`rv-btn ${queue === 'fading' ? 'sec' : 'pri'}`} disabled={busy} onClick={() => onRun('dismiss')}>
            {LEAVE[queue]}
          </button>
          <button type="button" className="rv-btn sec" disabled={busy} onClick={() => setTagging(true)}>
            Tag…
          </button>
          <button type="button" className="rv-btn quiet" disabled={busy} onClick={() => onRun('archive')}>
            {pairs ? 'Archive older' : 'Archive'}
          </button>
        </div>
      )}
    </div>
  );
}
