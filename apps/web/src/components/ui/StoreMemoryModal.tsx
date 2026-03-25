import { useState } from 'react';
import { api } from '../../lib/api.js';
import type { MemoryRecord } from '../../store/memoryStore.js';

interface Props {
  onClose: () => void;
  onStored: (record: MemoryRecord) => void;
}

export default function StoreMemoryModal({ onClose, onStored }: Props) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<'episodic' | 'semantic' | 'procedural'>('semantic');
  const [importance, setImportance] = useState(0.7);
  const [concept, setConcept] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Store Memory</span>
          <button style={styles.closeBtn} onClick={onClose}>
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }}>
              <path d="M3 3l10 10M13 3L3 13" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={styles.body}>
          <textarea
            style={styles.textarea}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What do you want to remember?"
            rows={4}
            autoFocus
          />

          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>Type</label>
              <select style={styles.select} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="episodic">Episodic</option>
                <option value="semantic">Semantic</option>
                <option value="procedural">Procedural</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Importance: {importance.toFixed(1)}</label>
              <input
                type="range" min="0" max="1" step="0.1"
                value={importance}
                onChange={(e) => setImportance(parseFloat(e.target.value))}
                style={styles.range}
              />
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Concept (optional)</label>
            <input style={styles.input} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. TypeScript, User Preference" />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Tags (comma-separated)</label>
            <input style={styles.input} value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. important, project:alpha" />
          </div>

          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.saveBtn, opacity: saving || !content.trim() ? 0.5 : 1 }}
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
    background: '#0a1020', border: '1px solid #1e293b', borderRadius: '14px',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid #1e293b',
  },
  title: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0' },
  closeBtn: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0f1e35', border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  body: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '14px', overflowY: 'auto' as const },
  textarea: {
    width: '100%', background: '#07101f', border: '1px solid #1e293b', borderRadius: '8px',
    padding: '10px 12px', color: '#e2e8f0', fontSize: '13px', resize: 'vertical' as const,
    outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
  },
  row: { display: 'flex', gap: '12px' },
  field: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  select: {
    background: '#07101f', border: '1px solid #1e293b', borderRadius: '6px',
    padding: '7px 10px', color: '#e2e8f0', fontSize: '12px', outline: 'none',
  },
  input: {
    background: '#07101f', border: '1px solid #1e293b', borderRadius: '6px',
    padding: '7px 10px', color: '#e2e8f0', fontSize: '12px', outline: 'none',
  },
  range: { width: '100%', accentColor: '#6366f1' },
  error: { fontSize: '12px', color: '#f87171', padding: '6px 10px', background: '#1c0a0a', borderRadius: '6px' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '8px',
    padding: '14px 20px', borderTop: '1px solid #1e293b',
  },
  cancelBtn: {
    padding: '8px 16px', background: '#0f1e35', border: '1px solid #1e293b', borderRadius: '7px',
    color: '#94a3b8', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  },
  saveBtn: {
    padding: '8px 20px', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    border: 'none', borderRadius: '7px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(99,102,241,0.35)',
  },
} as const;
