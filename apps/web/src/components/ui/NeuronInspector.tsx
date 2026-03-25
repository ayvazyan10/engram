import { useEffect, useState, useCallback } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { api } from '../../lib/api.js';

const TYPE_COLORS: Record<string, string> = {
  episodic: '#6366f1',
  semantic: '#06b6d4',
  procedural: '#f59e0b',
};

const TYPE_LABELS: Record<string, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
};

type GraphConn = { id: string; targetId: string; relationship: string; strength: number };

export default function NeuronInspector() {
  const { selectedNeuronId, selectNeuron, contradictionPairs, removeNeuron, setContradictionPairs } = useNeuralStore();
  const { records, removeRecord } = useMemoryStore();
  const [conns, setConns] = useState<GraphConn[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [resolving, setResolving] = useState(false);

  const memory: MemoryRecord | undefined = records.find((r) => r.id === selectedNeuronId);

  useEffect(() => {
    if (!selectedNeuronId) { setConns([]); return; }
    api.getGraph(selectedNeuronId)
      .then((g) => setConns(g.connections ?? []))
      .catch(() => setConns([]));
  }, [selectedNeuronId]);

  // Sync local tags when memory changes
  useEffect(() => {
    if (memory) {
      try { setLocalTags(JSON.parse(memory.tags ?? '[]')); } catch { setLocalTags([]); }
    }
  }, [memory]);

  const contradictions = contradictionPairs.filter(
    (p) => p.sourceId === selectedNeuronId || p.targetId === selectedNeuronId
  );

  const handleDelete = useCallback(async () => {
    if (!selectedNeuronId || !confirm('Archive this memory?')) return;
    setDeleting(true);
    try {
      await api.deleteMemory(selectedNeuronId);
      removeRecord(selectedNeuronId);
      removeNeuron(selectedNeuronId);
      selectNeuron(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleting(false);
  }, [selectedNeuronId, removeRecord, removeNeuron, selectNeuron]);

  const handleAddTag = useCallback(async () => {
    if (!selectedNeuronId || !tagInput.trim()) return;
    try {
      const res = await api.addTag(selectedNeuronId, tagInput.trim());
      setLocalTags(res.tags);
      setTagInput('');
    } catch (err) {
      console.error('Add tag failed:', err);
    }
  }, [selectedNeuronId, tagInput]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    if (!selectedNeuronId) return;
    try {
      const res = await api.removeTag(selectedNeuronId, tag);
      setLocalTags(res.tags);
    } catch (err) {
      console.error('Remove tag failed:', err);
    }
  }, [selectedNeuronId]);

  const handleResolve = useCallback(async (sourceId: string, targetId: string, strategy: string) => {
    setResolving(true);
    try {
      const res = await api.resolveContradiction(sourceId, targetId, strategy);
      if (res.resolved) {
        // Refresh contradictions
        const updated = await api.getContradictions();
        setContradictionPairs(
          updated.contradictions.map((c) => ({
            sourceId: c.source.id,
            targetId: c.target.id,
            confidence: c.confidence,
          }))
        );
        if (res.archivedId) {
          removeRecord(res.archivedId);
          removeNeuron(res.archivedId);
        }
      }
    } catch (err) {
      console.error('Resolve failed:', err);
    }
    setResolving(false);
  }, [setContradictionPairs, removeRecord, removeNeuron]);

  if (!selectedNeuronId || !memory) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyGlyph}>⬡</div>
        <div style={styles.emptyText}>Select a neuron<br />to inspect</div>
      </div>
    );
  }

  const color = TYPE_COLORS[memory.type] ?? '#94a3b8';
  const label = TYPE_LABELS[memory.type] ?? memory.type;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerMeta}>
          <span style={{ ...styles.badge, background: color + '22', color }}>{label}</span>
          {memory.source && <span style={styles.source}>{memory.source}</span>}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            style={{ ...styles.iconBtn, color: '#f87171', opacity: deleting ? 0.4 : 1 }}
            onClick={handleDelete}
            disabled={deleting}
            title="Archive memory"
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }}>
              <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button style={styles.iconBtn} onClick={() => selectNeuron(null)} title="Close">
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }}>
              <path d="M3 3l10 10M13 3L3 13" stroke="#475569" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Importance bar */}
      <div style={styles.importanceRow}>
        <span style={styles.dimLabel}>Importance</span>
        <div style={styles.importanceTrack}>
          <div style={{ ...styles.importanceFill, width: `${Math.round(memory.importance * 100)}%`, background: color }} />
        </div>
        <span style={{ color, fontSize: '11px', fontWeight: 600, minWidth: '32px', textAlign: 'right' as const }}>{Math.round(memory.importance * 100)}%</span>
      </div>

      <div style={styles.divider} />

      <div style={styles.body}>
        {/* Concept */}
        {memory.concept && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Concept</div>
            <div style={{ ...styles.conceptChip, borderColor: color, color }}>{memory.concept}</div>
          </div>
        )}

        {/* Content */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Content</div>
          <div style={styles.content}>{memory.content}</div>
        </div>

        {/* Summary */}
        {memory.summary && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Summary</div>
            <div style={styles.summary}>{memory.summary}</div>
          </div>
        )}

        {/* Tags — editable */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Tags</div>
          <div style={styles.tagRow}>
            {localTags.map((t) => (
              <span key={t} style={styles.tag}>
                {t}
                <button style={styles.tagRemove} onClick={() => handleRemoveTag(t)} title="Remove tag">×</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <input
              style={styles.tagInput}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              placeholder="Add tag…"
            />
            {tagInput && (
              <button style={styles.tagAddBtn} onClick={handleAddTag}>+</button>
            )}
          </div>
        </div>

        {/* Date */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Stored</div>
          <div style={styles.meta}>{new Date(memory.createdAt).toLocaleString()}</div>
        </div>

        {/* Contradictions */}
        {contradictions.length > 0 && (
          <div style={styles.section}>
            <div style={{ ...styles.sectionLabel, color: '#f97316' }}>Contradictions · {contradictions.length}</div>
            {contradictions.map((c, i) => {
              const otherId = c.sourceId === selectedNeuronId ? c.targetId : c.sourceId;
              const other = records.find((r) => r.id === otherId);
              return (
                <div key={i} style={styles.contradictionCard}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    {other?.content.slice(0, 100) ?? otherId.slice(0, 8)}
                    {(other?.content.length ?? 0) > 100 ? '…' : ''}
                  </div>
                  <div style={{ fontSize: '10px', color: '#f97316', marginTop: '4px' }}>
                    Confidence: {Math.round(c.confidence * 100)}%
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {['keep_newest', 'keep_oldest', 'keep_important', 'keep_both'].map((s) => (
                      <button
                        key={s}
                        style={styles.resolveBtn}
                        onClick={() => handleResolve(c.sourceId, c.targetId, s)}
                        disabled={resolving}
                      >
                        {s.replace('keep_', '')}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Connections */}
        {conns.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Connections · {conns.length}</div>
            <div style={styles.connList}>
              {conns.map((c, i) => (
                <div key={i} style={styles.connRow}>
                  <span style={{ ...styles.relBadge, color: c.relationship === 'contradicts' ? '#f97316' : '#475569' }}>{c.relationship}</span>
                  <div style={styles.strengthTrack}>
                    <div style={{ ...styles.strengthFill, width: `${Math.round(c.strength * 100)}%`, background: c.relationship === 'contradicts' ? '#f97316' : color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' },
  empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', height: '100%', gap: '10px' },
  emptyGlyph: { fontSize: '36px', color: '#0f2040', lineHeight: 1 },
  emptyText: { fontSize: '12px', color: '#1e3050', textAlign: 'center' as const, lineHeight: 1.6 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 16px 10px' },
  headerMeta: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  badge: { display: 'inline-block', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  source: { fontSize: '10px', color: '#334155' },
  iconBtn: {
    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0f1e35', border: 'none', borderRadius: '5px', cursor: 'pointer', color: '#475569', flexShrink: 0,
  },
  importanceRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px 12px' },
  dimLabel: { fontSize: '10px', color: '#334155', minWidth: '60px' },
  importanceTrack: { flex: 1, height: '3px', background: '#0f172a', borderRadius: '2px', overflow: 'hidden' },
  importanceFill: { height: '100%', borderRadius: '2px', opacity: 0.9, transition: 'width 0.3s' },
  divider: { height: '1px', background: '#0f2040', marginBottom: '4px' },
  body: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: '14px' },
  section: { display: 'flex', flexDirection: 'column' as const, gap: '5px' },
  sectionLabel: { fontSize: '10px', fontWeight: 700, color: '#334155', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  conceptChip: { display: 'inline-block', fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', border: '1px solid', width: 'fit-content' },
  content: { fontSize: '12px', color: '#94a3b8', lineHeight: 1.65 },
  summary: { fontSize: '11px', color: '#64748b', lineHeight: 1.6, fontStyle: 'italic' as const },
  tagRow: { display: 'flex', flexWrap: 'wrap' as const, gap: '4px' },
  tag: { fontSize: '10px', color: '#475569', background: '#0f172a', padding: '2px 7px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' },
  tagRemove: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px', padding: 0, lineHeight: 1 },
  tagInput: {
    flex: 1, background: '#07101f', border: '1px solid #1e293b', borderRadius: '5px',
    padding: '4px 8px', color: '#e2e8f0', fontSize: '10px', outline: 'none', minWidth: 0,
  },
  tagAddBtn: {
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#6366f1', border: 'none', borderRadius: '5px', color: '#fff', fontSize: '14px',
    fontWeight: 700, cursor: 'pointer', lineHeight: 1,
  },
  meta: { fontSize: '11px', color: '#475569' },
  contradictionCard: {
    background: '#1a0a00', border: '1px solid #f9731630', borderRadius: '8px', padding: '10px',
  },
  resolveBtn: {
    fontSize: '9px', fontWeight: 600, color: '#f97316', background: '#1a0a0020', border: '1px solid #f9731630',
    borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', textTransform: 'capitalize' as const,
  },
  connList: { display: 'flex', flexDirection: 'column' as const, gap: '5px' },
  connRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  relBadge: { fontSize: '10px', color: '#475569', background: '#0a1628', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap' as const, minWidth: '80px' },
  strengthTrack: { flex: 1, height: '3px', background: '#0f172a', borderRadius: '2px', overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: '2px', opacity: 0.7 },
} as const;
