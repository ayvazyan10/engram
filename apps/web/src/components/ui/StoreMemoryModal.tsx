import { useState } from 'react';
import { api } from '../../lib/api.js';
import type { MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, withAlpha } from '../../lib/tokens.js';
import ModalShell from './ModalShell.js';

interface Props {
  onClose: () => void;
  onStored: (record: MemoryRecord) => void;
}

/** M9: the slider read "Importance: 0.7" while every other surface in the app
 *  shows importance as a percentage. 5% steps rather than 10% — 0.1 was too
 *  coarse to express the 0.65/0.75 values the API itself returns. */
const IMPORTANCE_STEP = 0.05;

export default function StoreMemoryModal({ onClose, onStored }: Props) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<'episodic' | 'semantic' | 'procedural'>('semantic');
  const [importance, setImportance] = useState(0.7);
  const [concept, setConcept] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const t = useTemplateStore((s) => s.activeTemplate);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    setError('');
    try {
      const tags = tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean);
      const res = await api.storeMemory({
        content: content.trim(),
        type,
        importance,
        concept: concept.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        source: 'dashboard',
      });
      onStored({
        id: res.memory.id,
        type: res.memory.type as MemoryRecord['type'],
        content: res.memory.content,
        summary: res.memory.summary,
        importance: res.memory.importance,
        source: res.memory.source,
        concept: res.memory.concept,
        tags: res.memory.tags,
        createdAt: res.memory.createdAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store memory');
    } finally {
      setSaving(false);
    }
  }

  // Inputs used to hardcode `outline: 'none'` with nothing standing in for
  // it (V2) — that's simply gone now. The global :focus-visible rule
  // (styles/global.css) supplies the ring; an inline `outline: 'none'` here
  // would out-specificity that rule and silently defeat it again.
  //
  // `backgroundColor`, not the `background` shorthand: the shorthand would
  // reset the select's caret background-image from the .ec-select rule (M5).
  const fieldStyle = { backgroundColor: t.inputBg, borderColor: t.panelBorder, color: t.textPrimary };

  return (
    <ModalShell
      title="Store Memory"
      onClose={onClose}
      footer={
        <>
          <button
            className="ec-hover-tint"
            style={{ ...styles.cancelBtn, background: t.inputBg, borderColor: t.panelBorder, color: t.textSecondary }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="ec-hover-bright"
            style={{
              ...styles.saveBtn,
              background: `linear-gradient(135deg, ${t.accent} 0%, ${t.accentStrong} 100%)`,
              color: t.onAccent,
              boxShadow: `0 2px 8px ${t.accentGlow}`,
              opacity: saving || !content.trim() ? 0.5 : 1,
            }}
            onClick={handleSave}
            disabled={saving || !content.trim()}
          >
            {saving ? 'Storing…' : 'Store Memory'}
          </button>
        </>
      }
    >
      <textarea
        aria-label="What do you want to remember?"
        style={{ ...styles.textarea, ...fieldStyle }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What do you want to remember?"
        rows={4}
        autoFocus
      />

      <div style={styles.row}>
        <div style={styles.field}>
          <label htmlFor="store-memory-type" style={{ ...styles.label, color: t.textMuted }}>Type</label>
          <select
            id="store-memory-type"
            className="ec-select"
            style={{ ...styles.select, ...fieldStyle }}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="episodic">Episodic</option>
            <option value="semantic">Semantic</option>
            <option value="procedural">Procedural</option>
          </select>
        </div>
        <div style={styles.field}>
          <label htmlFor="store-memory-importance" style={{ ...styles.label, color: t.textMuted }}>
            Importance: <span className="ec-tabular">{Math.round(importance * 100)}%</span>
          </label>
          <input
            id="store-memory-importance"
            type="range" min="0" max="1" step={IMPORTANCE_STEP}
            value={importance}
            onChange={(e) => setImportance(parseFloat(e.target.value))}
            style={{ ...styles.range, accentColor: t.accent }}
          />
        </div>
      </div>

      <div style={styles.field}>
        <label htmlFor="store-memory-concept" style={{ ...styles.label, color: t.textMuted }}>Concept (optional)</label>
        <input id="store-memory-concept" style={{ ...styles.input, ...fieldStyle }} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. TypeScript, User Preference" />
      </div>

      <div style={styles.field}>
        <label htmlFor="store-memory-tags" style={{ ...styles.label, color: t.textMuted }}>Tags (comma-separated)</label>
        <input id="store-memory-tags" style={{ ...styles.input, ...fieldStyle }} value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. important, project:alpha" />
      </div>

      {error && <div style={{ ...styles.error, color: STATUS.danger, background: withAlpha(STATUS.danger, 0.1) }}>{error}</div>}
    </ModalShell>
  );
}

const styles = {
  textarea: {
    width: '100%', border: '1px solid', borderRadius: RADIUS.md,
    padding: `${SPACE.sm} ${SPACE.md}`, fontSize: TYPE.md, resize: 'vertical' as const,
    fontFamily: 'inherit', lineHeight: 1.5,
  },
  row: { display: 'flex', gap: SPACE.md },
  field: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: SPACE['2xs'], minWidth: 0 },
  label: { fontSize: TYPE.xs, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  select: {
    border: '1px solid', borderRadius: RADIUS.sm,
    padding: `${SPACE.xs} ${SPACE.sm}`, fontSize: TYPE.base,
    // M5: a select does not inherit font-family, so this one rendered in the
    // UA default while the textarea beside it was Inter.
    fontFamily: 'inherit',
  },
  input: {
    border: '1px solid', borderRadius: RADIUS.sm,
    padding: `${SPACE.xs} ${SPACE.sm}`, fontSize: TYPE.base,
    fontFamily: 'inherit',
    minWidth: 0,
  },
  range: { width: '100%' },
  error: { fontSize: TYPE.base, padding: `${SPACE.xs} ${SPACE.md}`, borderRadius: RADIUS.sm },
  cancelBtn: {
    padding: `${SPACE.sm} ${SPACE.lg}`, border: '1px solid', borderRadius: RADIUS.sm,
    fontSize: TYPE.base, fontWeight: 600, fontFamily: 'inherit',
  },
  saveBtn: {
    padding: `${SPACE.sm} ${SPACE.xl}`, border: 'none', borderRadius: RADIUS.sm,
    fontSize: TYPE.base, fontWeight: 600, fontFamily: 'inherit',
  },
} as const;
