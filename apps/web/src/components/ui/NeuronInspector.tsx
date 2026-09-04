import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { asMemoryRecord } from '../../hooks/useWebSocket.js';
import { RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, TYPE_LABELS, withAlpha } from '../../lib/tokens.js';

type GraphConn = { id: string; targetId: string; relationship: string; strength: number };

export default function NeuronInspector() {
  const { selectedNeuronId, selectNeuron, contradictionPairs, removeNeuron, setContradictionPairs } = useNeuralStore();
  const { records, removeRecord, updateRecordTags } = useMemoryStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const [conns, setConns] = useState<GraphConn[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [resolving, setResolving] = useState(false);
  // W8: a search hit outside the first 200 loaded memories (the server caps
  // listMemories there) selects an id `records` has never heard of.
  // getGraph's `node` field already carries the full row for this id — reuse
  // it instead of leaving the inspector on "Select a neuron to inspect".
  const [fallbackMemory, setFallbackMemory] = useState<MemoryRecord | null>(null);

  const memory: MemoryRecord | undefined =
    records.find((r) => r.id === selectedNeuronId) ?? fallbackMemory ?? undefined;

  useEffect(() => {
    setConns([]);
    setFallbackMemory(null);
    if (!selectedNeuronId) return;
    // W5: no id check on resolve meant a slow response for a previously
    // selected neuron could arrive after a newer selection and overwrite its
    // connections. `cancelled` (set on cleanup, which fires the instant
    // `selectedNeuronId` changes again) makes a stale resolution a no-op.
    let cancelled = false;
    api.getGraph(selectedNeuronId)
      .then((g) => {
        if (cancelled) return;
        setConns(g.connections ?? []);
        const node = asMemoryRecord(g.node);
        if (node) setFallbackMemory(node);
      })
      .catch(() => {
        if (!cancelled) setConns([]);
      });
    return () => {
      cancelled = true;
    };
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
      // Also write through to the store: the sync effect re-derives localTags
      // from the record, so without this the edit reverted on reselect.
      updateRecordTags(selectedNeuronId, res.tags);
      setTagInput('');
    } catch (err) {
      console.error('Add tag failed:', err);
    }
  }, [selectedNeuronId, tagInput, updateRecordTags]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    if (!selectedNeuronId) return;
    try {
      const res = await api.removeTag(selectedNeuronId, tag);
      setLocalTags(res.tags);
      updateRecordTags(selectedNeuronId, res.tags);
    } catch (err) {
      console.error('Remove tag failed:', err);
    }
  }, [selectedNeuronId, updateRecordTags]);

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
        {/* Decorative glyph — stays dim on purpose, it carries no information
         * a screen reader or a sighted user needs; the instructional copy
         * below it (emptyText) is what had to clear 4.5:1 (V4). */}
        <div style={{ ...styles.emptyGlyph, color: t.panelBorder }}>⬡</div>
        <div style={{ ...styles.emptyText, color: t.textSecondary }}>Select a neuron<br />to inspect</div>
      </div>
    );
  }

  const color = TYPE_COLORS[memory.type] ?? t.textSecondary;
  const label = TYPE_LABELS[memory.type] ?? memory.type;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerMeta}>
          <span style={{ ...styles.badge, background: withAlpha(color, 0.15), color }}>{label}</span>
          {memory.source && <span style={{ ...styles.source, color: t.textMuted }}>{memory.source}</span>}
        </div>
        <div style={{ display: 'flex', gap: SPACE['2xs'] }}>
          <button
            className="ec-hover-tint"
            style={{ ...styles.iconBtn, background: t.inputBg, color: STATUS.danger, opacity: deleting ? 0.4 : 1 }}
            onClick={handleDelete}
            disabled={deleting}
            title="Archive memory"
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }}>
              <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="ec-hover-tint"
            style={{ ...styles.iconBtn, background: t.inputBg }}
            onClick={() => selectNeuron(null)}
            title="Close"
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }}>
              <path d="M3 3l10 10M13 3L3 13" stroke={t.textMuted} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Importance bar */}
      <div style={styles.importanceRow}>
        <span style={{ ...styles.dimLabel, color: t.textMuted }}>Importance</span>
        <div style={{ ...styles.importanceTrack, background: t.inputBg }}>
          <div style={{ ...styles.importanceFill, width: `${Math.round(memory.importance * 100)}%`, background: color }} />
        </div>
        <span style={{ color, fontSize: TYPE.sm, fontWeight: 600, minWidth: '32px', textAlign: 'right' as const }}>{Math.round(memory.importance * 100)}%</span>
      </div>

      <div style={{ ...styles.divider, background: t.panelBorder }} />

      <div style={styles.body}>
        {/* Concept */}
        {memory.concept && (
          <Section label="Concept" t={t}>
            <div style={{ ...styles.conceptChip, borderColor: color, color }}>{memory.concept}</div>
          </Section>
        )}

        {/* Content */}
        <Section label="Content" t={t}>
          <div style={{ ...styles.content, color: t.textSecondary }}>{memory.content}</div>
        </Section>

        {/* Summary */}
        {memory.summary && (
          <Section label="Summary" t={t}>
            <div style={{ ...styles.summary, color: t.textMuted }}>{memory.summary}</div>
          </Section>
        )}

        {/* Tags — editable */}
        <TagsSection
          t={t}
          tags={localTags}
          tagInput={tagInput}
          onTagInputChange={setTagInput}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
        />

        {/* Date */}
        <Section label="Stored" t={t}>
          <div style={{ ...styles.meta, color: t.textMuted }}>{new Date(memory.createdAt).toLocaleString()}</div>
        </Section>

        {contradictions.length > 0 && (
          <ContradictionsSection
            contradictions={contradictions}
            records={records}
            selectedNeuronId={selectedNeuronId}
            resolving={resolving}
            onResolve={handleResolve}
            t={t}
          />
        )}

        {conns.length > 0 && <ConnectionsSection conns={conns} color={color} t={t} />}
      </div>
    </div>
  );
}

function Section({ label, t, children }: { label: string; t: UITemplate; children: ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, color: t.textMuted }}>{label}</div>
      {children}
    </div>
  );
}

function TagsSection({ t, tags, tagInput, onTagInputChange, onAddTag, onRemoveTag }: {
  t: UITemplate;
  tags: string[];
  tagInput: string;
  onTagInputChange: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}) {
  return (
    <Section label="Tags" t={t}>
      <div style={styles.tagRow}>
        {tags.map((tag) => (
          <span key={tag} style={{ ...styles.tag, background: t.inputBg, color: t.textSecondary }}>
            {tag}
            <button className="ec-hover-bright" style={{ ...styles.tagRemove, color: t.textMuted }} onClick={() => onRemoveTag(tag)} title="Remove tag">×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: SPACE['2xs'], marginTop: SPACE['2xs'] }}>
        <input
          style={{ ...styles.tagInput, background: t.inputBg, borderColor: t.panelBorder, color: t.textPrimary }}
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddTag()}
          placeholder="Add tag…"
        />
        {tagInput && (
          <button className="ec-hover-bright" style={{ ...styles.tagAddBtn, background: t.accentStrong, color: t.onAccent }} onClick={onAddTag}>+</button>
        )}
      </div>
    </Section>
  );
}

function ContradictionsSection({ contradictions, records, selectedNeuronId, resolving, onResolve, t }: {
  contradictions: { sourceId: string; targetId: string; confidence: number }[];
  records: MemoryRecord[];
  selectedNeuronId: string;
  resolving: boolean;
  onResolve: (sourceId: string, targetId: string, strategy: string) => void;
  t: UITemplate;
}) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, color: STATUS.contradiction }}>Contradictions · {contradictions.length}</div>
      {contradictions.map((c) => {
        const otherId = c.sourceId === selectedNeuronId ? c.targetId : c.sourceId;
        const other = records.find((r) => r.id === otherId);
        return (
          // W14: sourceId+targetId (not array index) — handleResolve replaces
          // this list, and an index key made React reuse a resolved card's
          // DOM node in place for whatever now sits at that position, which
          // silently carried over stray DOM-owned state (e.g. focus) from
          // the card that was just resolved away onto an unrelated one.
          <div key={`${c.sourceId}:${c.targetId}`} style={{ ...styles.contradictionCard, background: withAlpha(STATUS.contradiction, 0.08), borderColor: withAlpha(STATUS.contradiction, 0.3) }}>
            <div style={{ fontSize: TYPE.sm, color: t.textSecondary, lineHeight: 1.5 }}>
              {other?.content.slice(0, 100) ?? otherId.slice(0, 8)}
              {(other?.content.length ?? 0) > 100 ? '…' : ''}
            </div>
            <div style={{ fontSize: TYPE.xs, color: STATUS.contradiction, marginTop: SPACE['2xs'] }}>
              Confidence: {Math.round(c.confidence * 100)}%
            </div>
            <div style={{ display: 'flex', gap: SPACE['2xs'], marginTop: SPACE.xs, flexWrap: 'wrap' }}>
              {['keep_newest', 'keep_oldest', 'keep_important', 'keep_both'].map((s) => (
                <button
                  key={s}
                  className="ec-hover-tint"
                  style={{ ...styles.resolveBtn, color: STATUS.contradiction, borderColor: withAlpha(STATUS.contradiction, 0.3) }}
                  onClick={() => onResolve(c.sourceId, c.targetId, s)}
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
  );
}

function ConnectionsSection({ conns, color, t }: { conns: GraphConn[]; color: string; t: UITemplate }) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, color: t.textMuted }}>Connections · {conns.length}</div>
      <div style={styles.connList}>
        {conns.map((c) => {
          const isContradiction = c.relationship === 'contradicts';
          return (
            <div key={c.id} style={styles.connRow}>
              <span style={{ ...styles.relBadge, background: t.inputBg, color: isContradiction ? STATUS.contradiction : t.textMuted }}>
                {c.relationship}
              </span>
              <div style={{ ...styles.strengthTrack, background: t.inputBg }}>
                <div style={{ ...styles.strengthFill, width: `${Math.round(c.strength * 100)}%`, background: isContradiction ? STATUS.contradiction : color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' },
  empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', height: '100%', gap: SPACE.sm },
  emptyGlyph: { fontSize: '36px', lineHeight: 1 },
  emptyText: { fontSize: TYPE.base, textAlign: 'center' as const, lineHeight: 1.6 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: `${SPACE.lg} ${SPACE.lg} ${SPACE.sm}` },
  headerMeta: { display: 'flex', flexDirection: 'column' as const, gap: SPACE['2xs'] },
  badge: { display: 'inline-block', fontSize: TYPE.xs, fontWeight: 700, padding: '3px 8px', borderRadius: RADIUS.sm, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  source: { fontSize: TYPE.xs },
  iconBtn: {
    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: RADIUS.sm, flexShrink: 0,
  },
  importanceRow: { display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: `0 ${SPACE.lg} 12px` },
  dimLabel: { fontSize: TYPE.xs, minWidth: '60px' },
  importanceTrack: { flex: 1, height: '3px', borderRadius: '2px', overflow: 'hidden' },
  importanceFill: { height: '100%', borderRadius: '2px', opacity: 0.9, transition: 'width 0.3s' },
  divider: { height: '1px', marginBottom: SPACE['2xs'] },
  body: { flex: 1, overflowY: 'auto' as const, padding: SPACE.lg, display: 'flex', flexDirection: 'column' as const, gap: SPACE.lg },
  section: { display: 'flex', flexDirection: 'column' as const, gap: '5px' },
  sectionLabel: { fontSize: TYPE.xs, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  conceptChip: { display: 'inline-block', fontSize: TYPE.base, fontWeight: 600, padding: '3px 10px', borderRadius: RADIUS.sm, border: '1px solid', width: 'fit-content' },
  content: { fontSize: TYPE.base, lineHeight: 1.65 },
  summary: { fontSize: TYPE.sm, lineHeight: 1.6, fontStyle: 'italic' as const },
  tagRow: { display: 'flex', flexWrap: 'wrap' as const, gap: SPACE['2xs'] },
  tag: { fontSize: TYPE.xs, padding: '2px 7px', borderRadius: RADIUS.tight, display: 'flex', alignItems: 'center', gap: '3px' },
  tagRemove: { background: 'none', border: 'none', cursor: 'pointer', fontSize: TYPE.base, padding: 0, lineHeight: 1, borderRadius: RADIUS.tight },
  tagInput: {
    flex: 1, border: '1px solid', borderRadius: RADIUS.sm,
    padding: '4px 8px', fontSize: TYPE.xs, minWidth: 0,
  },
  tagAddBtn: {
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: RADIUS.sm, fontSize: TYPE.lg,
    fontWeight: 700, cursor: 'pointer', lineHeight: 1,
  },
  meta: { fontSize: TYPE.sm },
  contradictionCard: {
    border: '1px solid', borderRadius: RADIUS.md, padding: SPACE.md,
  },
  resolveBtn: {
    fontSize: TYPE.micro, fontWeight: 600, background: 'transparent', border: '1px solid',
    borderRadius: RADIUS.tight, padding: '3px 8px', textTransform: 'capitalize' as const,
  },
  connList: { display: 'flex', flexDirection: 'column' as const, gap: '5px' },
  connRow: { display: 'flex', alignItems: 'center', gap: SPACE.sm },
  relBadge: { fontSize: TYPE.xs, padding: '2px 7px', borderRadius: RADIUS.tight, whiteSpace: 'nowrap' as const, minWidth: '80px' },
  strengthTrack: { flex: 1, height: '3px', borderRadius: '2px', overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: '2px', opacity: 0.7 },
} as const;
