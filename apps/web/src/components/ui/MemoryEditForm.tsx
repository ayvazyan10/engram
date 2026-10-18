import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { GLYPH, RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, WEIGHT, withAlpha } from '../../lib/tokens.js';

interface Draft {
  content: string;
  concept: string;
  /** 0-100, what the slider moves in. */
  importance: number;
  /** As typed: comma-separated. */
  tags: string;
}

type Changes = { content?: string; importance?: number; tags?: string[]; concept?: string };

function parseTagInput(raw: string): string[] {
  return [...new Set(raw.split(',').map((tag) => tag.trim()).filter(Boolean))];
}

/** Only the fields the reader actually changed: PATCH re-embeds the memory
 *  when its content or concept moves, and an untouched field must not look
 *  like a change. */
function changesFrom(memory: MemoryRecord, tags: string[], draft: Draft): Changes {
  const changes: Changes = {};
  if (draft.content !== memory.content) changes.content = draft.content;
  if (draft.concept !== (memory.concept ?? '')) changes.concept = draft.concept;
  if (draft.importance !== Math.round(memory.importance * 100)) changes.importance = draft.importance / 100;
  const nextTags = parseTagInput(draft.tags);
  if (JSON.stringify(nextTags) !== JSON.stringify(tags)) changes.tags = nextTags;
  return changes;
}

/**
 * The inspector's edit mode: content, concept, importance and tags in one
 * form, saved with one PATCH /api/memory/:id. It owns the saving and error
 * states; the inspector owns what happens once the server has the new
 * version (`onSaved`).
 */
export default function MemoryEditForm({ memory, tags, onCancel, onSaved }: {
  memory: MemoryRecord;
  tags: string[];
  onCancel: () => void;
  onSaved: (record: MemoryRecord, reindexed: boolean) => void;
}) {
  const t = useTemplateStore((s) => s.activeTemplate);
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
  const color = TYPE_COLORS[memory.type] ?? t.textSecondary;

  const edit = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateMemory(memory.id, changes);
      setSaving(false);
      onSaved(
        { ...memory, content: res.content, importance: res.importance, tags: res.tags, concept: res.concept },
        changes.content !== undefined || changes.concept !== undefined
      );
    } catch (err) {
      setSaving(false);
      const reason = err instanceof Error ? err.message : '';
      setError(reason ? `Could not save your changes: ${reason}` : 'Could not save your changes');
    }
  };

  // Cmd/Ctrl+Enter saves from any field, the textarea included.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save();
  };

  const field = { ...s.field, background: t.inputBg, borderColor: t.panelBorder, color: t.textPrimary };

  return (
    <form aria-label="Edit memory" onSubmit={save} onKeyDown={onKeyDown} style={s.form}>
      <fieldset disabled={saving} style={s.fields}>
        {/* Hints sit outside the <label>: inside, they became part of the
            field's accessible name. */}
        <div style={s.group}>
          <label style={s.group}>
            <span style={{ ...s.label, color: t.textMuted }}>Content</span>
            <textarea
              autoFocus
              rows={8}
              value={draft.content}
              onChange={(e) => edit({ content: e.target.value })}
              style={{ ...field, ...s.textarea }}
            />
          </label>
          {emptyContent && <span style={{ ...s.hint, color: STATUS.danger }}>A memory needs some content.</span>}
        </div>

        <label style={s.group}>
          <span style={{ ...s.label, color: t.textMuted }}>Concept</span>
          <input
            value={draft.concept}
            onChange={(e) => edit({ concept: e.target.value })}
            placeholder="A few words naming what this is about"
            style={field}
          />
        </label>

        <label style={s.group}>
          <span style={{ ...s.labelRow, color: t.textMuted }}>
            Importance
            <span className="ec-tabular" style={{ color: t.textPrimary, fontWeight: WEIGHT.semibold }}>{draft.importance}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={draft.importance}
            onChange={(e) => edit({ importance: Number(e.target.value) })}
            style={{ ...s.range, accentColor: color }}
          />
        </label>

        <div style={s.group}>
          <label style={s.group}>
            <span style={{ ...s.label, color: t.textMuted }}>Tags</span>
            <input
              value={draft.tags}
              onChange={(e) => edit({ tags: e.target.value })}
              placeholder="deploy, ci"
              style={field}
            />
          </label>
          <span style={{ ...s.hint, color: t.textMuted }}>Separate tags with commas.</span>
        </div>
      </fieldset>

      <div style={{ ...s.footer, borderTopColor: t.panelBorder, background: t.panelBg }}>
        {error ? (
          <p role="alert" style={{ ...s.error, color: STATUS.danger, borderColor: withAlpha(STATUS.danger, 0.3), background: withAlpha(STATUS.danger, 0.07) }}>
            {GLYPH.warning} {error}
          </p>
        ) : (
          <p style={{ ...s.note, color: t.textMuted }}>
            {changes.content !== undefined || changes.concept !== undefined
              ? 'Saving re-indexes this memory, so search and recall find it by the new wording.'
              : changed
                ? 'Your AI sees the change the next time it recalls this memory.'
                : 'Nothing changed yet.'}
          </p>
        )}
        <div style={s.buttons}>
          <button
            type="button"
            className="ec-hover-tint"
            onClick={onCancel}
            disabled={saving}
            style={{ ...s.button, background: 'transparent', color: t.textSecondary, borderColor: t.panelBorder }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="ec-primary"
            disabled={!canSave}
            style={{ ...s.button, background: t.accentStrong, color: t.onAccent, borderColor: 'transparent', opacity: canSave || saving ? 1 : 0.45 }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  );
}

const s = {
  form: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const },
  fields: {
    flex: 1, minHeight: 0, overflowY: 'auto' as const, margin: 0, border: 'none',
    padding: SPACE.lg, display: 'flex', flexDirection: 'column' as const, gap: SPACE.lg,
  },
  group: { display: 'flex', flexDirection: 'column' as const, gap: SPACE.xs },
  label: { fontSize: TYPE.sm, fontWeight: WEIGHT.medium, lineHeight: 1.3 },
  labelRow: { display: 'flex', justifyContent: 'space-between', fontSize: TYPE.sm, fontWeight: WEIGHT.medium, lineHeight: 1.3 },
  field: {
    width: '100%', minWidth: 0, minHeight: 32, border: '1px solid', borderRadius: RADIUS.sm,
    padding: `${SPACE.xs} ${SPACE.sm}`, fontSize: TYPE.base, lineHeight: 1.5,
  },
  textarea: { resize: 'vertical' as const, minHeight: 140, lineHeight: 1.6 },
  range: { width: '100%', margin: 0 },
  hint: { fontSize: TYPE.sm, lineHeight: 1.4 },
  footer: {
    flexShrink: 0, borderTop: '1px solid', padding: `${SPACE.md} ${SPACE.lg}`,
    display: 'flex', flexDirection: 'column' as const, gap: SPACE.sm,
  },
  note: { margin: 0, fontSize: TYPE.sm, lineHeight: 1.45 },
  error: {
    margin: 0, fontSize: TYPE.sm, lineHeight: 1.45, overflowWrap: 'anywhere' as const,
    padding: `${SPACE.xs} ${SPACE.sm}`, border: '1px solid', borderRadius: RADIUS.sm,
  },
  buttons: { display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm },
  button: {
    minHeight: 32, padding: `0 ${SPACE.md}`, border: '1px solid', borderRadius: RADIUS.sm,
    fontSize: TYPE.sm, fontWeight: WEIGHT.medium, fontFamily: 'inherit',
  },
} as const;
