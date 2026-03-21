import { useEffect, useState } from 'react';
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

type GraphConn = { id: string; targetId?: string; relationship: string; strength: number };

export default function NeuronInspector() {
  const { selectedNeuronId, selectNeuron } = useNeuralStore();
  const { records } = useMemoryStore();
  const [conns, setConns] = useState<GraphConn[]>([]);

  const memory: MemoryRecord | undefined = records.find((r) => r.id === selectedNeuronId);

  useEffect(() => {
    if (!selectedNeuronId) { setConns([]); return; }
    api.getGraph(selectedNeuronId)
      .then((g) => {
        const data = g as { connections?: GraphConn[] };
        setConns(data.connections ?? []);
      })
      .catch(() => setConns([]));
  }, [selectedNeuronId]);

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
  const tags: string[] = JSON.parse(memory.tags ?? '[]');

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerMeta}>
          <span style={{ ...styles.badge, background: color + '22', color }}>{label}</span>
          {memory.source && <span style={styles.source}>{memory.source}</span>}
        </div>
        <button style={styles.closeBtn} onClick={() => selectNeuron(null)}>✕</button>
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

        {/* Tags */}
        {tags.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Tags</div>
            <div style={styles.tagRow}>
              {tags.map((t) => (
                <span key={t} style={styles.tag}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Date */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Stored</div>
          <div style={styles.meta}>{new Date(memory.createdAt).toLocaleString()}</div>
        </div>

        {/* Connections */}
        {conns.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Connections · {conns.length}</div>
            <div style={styles.connList}>
              {conns.map((c, i) => (
                <div key={i} style={styles.connRow}>
                  <span style={styles.relBadge}>{c.relationship}</span>
                  <div style={styles.strengthTrack}>
                    <div style={{ ...styles.strengthFill, width: `${Math.round(c.strength * 100)}%`, background: color }} />
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
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '10px',
  },
  emptyGlyph: { fontSize: '36px', color: '#0f2040', lineHeight: 1 },
  emptyText: { fontSize: '12px', color: '#1e3050', textAlign: 'center' as const, lineHeight: 1.6 },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '14px 16px 10px',
  },
  headerMeta: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  badge: {
    display: 'inline-block',
    fontSize: '10px',
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  source: { fontSize: '10px', color: '#334155' },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#1e3050',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '2px 4px',
    lineHeight: 1,
    flexShrink: 0,
  },
  importanceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 16px 12px',
  },
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
  tag: { fontSize: '10px', color: '#475569', background: '#0f172a', padding: '2px 7px', borderRadius: '4px' },
  meta: { fontSize: '11px', color: '#475569' },
  connList: { display: 'flex', flexDirection: 'column' as const, gap: '5px' },
  connRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  relBadge: { fontSize: '10px', color: '#475569', background: '#0a1628', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap' as const, minWidth: '80px' },
  strengthTrack: { flex: 1, height: '3px', background: '#0f172a', borderRadius: '2px', overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: '2px', opacity: 0.7 },
} as const;
