import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import type { MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, withAlpha } from '../../lib/tokens.js';

interface Props {
  onClose: () => void;
  onStored: (record: MemoryRecord) => void;
}

const TITLE_ID = 'store-memory-title';
const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function StoreMemoryModal({ onClose, onStored }: Props) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<'episodic' | 'semantic' | 'procedural'>('semantic');
  const [importance, setImportance] = useState(0.7);
  const [concept, setConcept] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const t = useTemplateStore((s) => s.activeTemplate);
  const dialogRef = useRef<HTMLDivElement>(null);
  // W7: a click on the overlay only means "click outside the modal" if the
  // drag that produced it ALSO started on the overlay. Without this, a text
  // selection dragged inside the textarea and released outside the modal
  // fired a click whose event target is the overlay (the browser resolves
  // click to the nearest common ancestor of mousedown/mouseup, not either
  // endpoint) — closing the modal and losing whatever had been typed.
  const overlayMouseDownRef = useRef(false);

  // W7: Escape closes the dialog, and Tab is trapped inside it instead of
  // reaching the background (which stayed fully tabbable before this).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    setError('');
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
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
  const fieldStyle = { background: t.inputBg, borderColor: t.panelBorder, color: t.textPrimary };

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => { overlayMouseDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // Only a click that BOTH started and ended on the overlay itself
        // counts as "outside" — a drag that started inside the modal (e.g.
        // selecting text in the textarea) and released over the overlay
        // must not close it. See overlayMouseDownRef above.
        if (e.target === e.currentTarget && overlayMouseDownRef.current) onClose();
        overlayMouseDownRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        style={{ ...styles.modal, background: t.cardBg, borderColor: t.panelBorder }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ ...styles.header, borderBottomColor: t.panelBorder }}>
          <span id={TITLE_ID} style={{ ...styles.title, color: t.textPrimary }}>Store Memory</span>
          <button className="ec-hover-tint" style={{ ...styles.closeBtn, background: t.inputBg }} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }}>
              <path d="M3 3l10 10M13 3L3 13" stroke={t.textMuted} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={styles.body}>
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
              <select id="store-memory-type" style={{ ...styles.select, ...fieldStyle }} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="episodic">Episodic</option>
                <option value="semantic">Semantic</option>
                <option value="procedural">Procedural</option>
              </select>
            </div>
            <div style={styles.field}>
              <label htmlFor="store-memory-importance" style={{ ...styles.label, color: t.textMuted }}>Importance: {importance.toFixed(1)}</label>
              <input
                id="store-memory-importance"
                type="range" min="0" max="1" step="0.1"
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
        </div>

        <div style={{ ...styles.footer, borderTopColor: t.panelBorder }}>
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
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    width: '480px', maxWidth: '90vw', maxHeight: '90vh',
    border: '1px solid', borderRadius: RADIUS.xl,
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${SPACE.lg} ${SPACE.xl}`, borderBottom: '1px solid',
  },
  title: { fontSize: TYPE.lg, fontWeight: 700 },
  closeBtn: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: RADIUS.sm,
  },
  body: { padding: SPACE.xl, display: 'flex', flexDirection: 'column' as const, gap: SPACE.lg, overflowY: 'auto' as const },
  textarea: {
    width: '100%', border: '1px solid', borderRadius: RADIUS.md,
    padding: '10px 12px', fontSize: TYPE.md, resize: 'vertical' as const,
    fontFamily: 'inherit', lineHeight: 1.5,
  },
  row: { display: 'flex', gap: SPACE.md },
  field: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: SPACE['2xs'] },
  label: { fontSize: TYPE.xs, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  select: {
    border: '1px solid', borderRadius: RADIUS.sm,
    padding: '7px 10px', fontSize: TYPE.base,
  },
  input: {
    border: '1px solid', borderRadius: RADIUS.sm,
    padding: '7px 10px', fontSize: TYPE.base,
  },
  range: { width: '100%' },
  error: { fontSize: TYPE.base, padding: '6px 10px', borderRadius: RADIUS.sm },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm,
    padding: `${SPACE.md} ${SPACE.xl}`, borderTop: '1px solid',
  },
  cancelBtn: {
    padding: '8px 16px', border: '1px solid', borderRadius: RADIUS.sm,
    fontSize: TYPE.base, fontWeight: 600,
  },
  saveBtn: {
    padding: '8px 20px', border: 'none', borderRadius: RADIUS.sm,
    fontSize: TYPE.base, fontWeight: 600,
  },
} as const;
