import { useState } from 'react';
import { api } from '../../lib/api.js';
import type { MemoryRecord } from '../../store/memoryStore.js';
import ModalShell from './ModalShell.js';
import './ui.css';

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

  return (
    <ModalShell
      title="Store Memory"
      onClose={onClose}
      footer={
        <>
          <button
            className="ec-hover-tint ui-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="ec-primary ui-primary"
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
        className="ui-input ui-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        // Cmd/Ctrl+Enter stores, as in most compose boxes; a plain Enter
        // still writes a newline.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !saving) {
            e.preventDefault();
            void handleSave();
          }
        }}
        placeholder="What do you want to remember?"
        rows={4}
        autoFocus
      />

      <div className="ui-form-row">
        <div className="ui-field">
          <label htmlFor="store-memory-type" className="ui-label">Type</label>
          <select
            id="store-memory-type"
            className="ec-select ui-input"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="episodic">Episodic</option>
            <option value="semantic">Semantic</option>
            <option value="procedural">Procedural</option>
          </select>
        </div>
        <div className="ui-field">
          <label htmlFor="store-memory-importance" className="ui-label">
            Importance <span className="ec-tabular ui-importance">{Math.round(importance * 100)}%</span>
          </label>
          <input
            id="store-memory-importance"
            type="range" min="0" max="1" step={IMPORTANCE_STEP}
            value={importance}
            onChange={(e) => setImportance(parseFloat(e.target.value))}
            className="ui-range"
          />
        </div>
      </div>

      <div className="ui-field">
        <label htmlFor="store-memory-concept" className="ui-label">Concept (optional)</label>
        <input id="store-memory-concept" className="ui-input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="e.g. TypeScript, User Preference" />
      </div>

      <div className="ui-field">
        <label htmlFor="store-memory-tags" className="ui-label">Tags (comma-separated)</label>
        <input id="store-memory-tags" className="ui-input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. important, project:alpha" />
      </div>

      {error && <div className="ui-form-error">{error}</div>}
    </ModalShell>
  );
}
