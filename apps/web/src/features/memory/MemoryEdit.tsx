import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { MemoryRecord } from '../../store/memoryStore.js';
import { api } from '../../lib/api.js';

export interface Draft {
  content: string;
  concept: string;
  /** 0-100, what the slider moves in. */
  importance: number;
  /** As typed: comma-separated. */
  tags: string;
}

export type Changes = { content?: string; importance?: number; tags?: string[]; concept?: string };

export function parseTagInput(raw: string): string[] {
  return [...new Set(raw.split(',').map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * Only the fields the reader actually changed: PATCH re-embeds the memory
 * when its content or concept moves, so an untouched field must never look
 * like a change. Surrounding whitespace is not a change either.
 */
export function changesFrom(memory: MemoryRecord, tags: string[], draft: Draft): Changes {
  const changes: Changes = {};
  const content = draft.content.trim();
  const concept = draft.concept.trim();
  if (content !== memory.content.trim()) changes.content = content;
  if (concept !== (memory.concept ?? '').trim()) changes.concept = concept;
  if (draft.importance !== Math.round(memory.importance * 100)) changes.importance = draft.importance / 100;
  const nextTags = parseTagInput(draft.tags);
  if (JSON.stringify(nextTags) !== JSON.stringify(tags)) changes.tags = nextTags;
  return changes;
}

/**
 * The sheet's Edit tab: content, concept, importance and tags in one form,
 * saved with one PATCH /api/memory/:id that carries only what changed.
 * ⌘/Ctrl+Enter saves from any field.
 */
export default function MemoryEdit({
  memory,
  tags,
  onCancel,
  onSaved,
}: {
  memory: MemoryRecord;
  tags: string[];
  onCancel: () => void;
  onSaved: (record: MemoryRecord, reindexed: boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>({
    content: memory.content,
    concept: memory.concept ?? '',
    importance: Math.round(memory.importance * 100),
    tags: tags.join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changes = changesFrom(memory, tags, draft);
  const changed = Object.keys(changes).length > 0;
  const emptyContent = draft.content.trim() === '';
  const canSave = changed && !emptyContent && !saving;
  const reindexes = changes.content !== undefined || changes.concept !== undefined;

  const edit = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateMemory(memory.id, changes);
      onSaved({ ...memory, content: res.content, importance: res.importance, tags: res.tags, concept: res.concept }, reindexes);
    } catch (err) {
      setSaving(false);
      const reason = err instanceof Error ? err.message : '';
      setError(reason ? `Could not save your changes: ${reason}` : 'Could not save your changes.');
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  const note = error
    ? error
    : emptyContent
      ? 'A memory needs some content.'
      : !changed
        ? 'Nothing changed yet.'
        : reindexes
          ? 'Saving re-indexes this memory, so search and recall find it by the new wording.'
          : 'Your AI sees the change the next time it recalls this memory.';

  return (
    <form className="mm-form" aria-label="Edit memory" onSubmit={save} onKeyDown={onKeyDown}>
      <fieldset className="mm-body mm-fields" disabled={saving}>
        <div className="mm-f">
          <label htmlFor={`${id}-c`}>Content</label>
          <textarea id={`${id}-c`} autoFocus rows={8} value={draft.content} onChange={(e) => edit({ content: e.target.value })} />
        </div>
        <div className="mm-f">
          <label htmlFor={`${id}-k`}>Concept</label>
          <input
            id={`${id}-k`}
            className="mm-input"
            value={draft.concept}
            onChange={(e) => edit({ concept: e.target.value })}
            placeholder="A few words naming what this is about"
          />
        </div>
        <div className="mm-f">
          <label htmlFor={`${id}-i`} className="mm-f-row">
            Importance <b>{draft.importance}%</b>
          </label>
          <input
            id={`${id}-i`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={draft.importance}
            onChange={(e) => edit({ importance: Number(e.target.value) })}
          />
        </div>
        <div className="mm-f">
          <label htmlFor={`${id}-t`}>Tags</label>
          <input
            id={`${id}-t`}
            className="mm-input"
            value={draft.tags}
            onChange={(e) => edit({ tags: e.target.value })}
            placeholder="deploy, ci"
            aria-describedby={`${id}-th`}
          />
          <p id={`${id}-th`} className="mm-hint">
            Separate tags with commas.
          </p>
        </div>
      </fieldset>
      <div className="mm-foot">
        <p role={error || emptyContent ? 'alert' : undefined} data-tone={error || emptyContent ? 'fault' : undefined}>
          {note}
        </p>
        <button type="button" className="at-btn sec" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="at-btn" disabled={!canSave} aria-keyshortcuts="Control+Enter Meta+Enter">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
