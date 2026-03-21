import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';

const TYPE_COLORS: Record<string, string> = {
  episodic: '#6366f1',
  semantic: '#06b6d4',
  procedural: '#f59e0b',
};

const TYPE_ICONS: Record<string, string> = {
  episodic: '🕐',
  semantic: '💡',
  procedural: '⚙️',
};

const TYPE_LABELS: Record<string, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
};

interface Props {
  loading?: boolean;
}

export default function MemoryPanel({ loading }: Props) {
  const { records, searchResults, searchQuery, isSearching, setRecords } = useMemoryStore();
  const { selectNeuron, selectedNeuronId } = useNeuralStore();

  // Intentionally kept empty — data is loaded by AppLayout directly
  void setRecords;

  const displayList = searchQuery ? searchResults : records;

  // Group by type for display
  const grouped = displayList.reduce<Record<string, MemoryRecord[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type]!.push(r);
    return acc;
  }, {});

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Memory Graph</span>
        <span style={styles.count}>{displayList.length}</span>
      </div>

      {/* Type filter pills */}
      <div style={styles.typeSummary}>
        {(['episodic', 'semantic', 'procedural'] as const).map((t) => (
          <div key={t} style={{ ...styles.typePill, borderColor: TYPE_COLORS[t] }}>
            <span style={{ color: TYPE_COLORS[t], fontSize: '11px' }}>{TYPE_ICONS[t]}</span>
            <span style={{ color: '#64748b', fontSize: '10px' }}>{grouped[t]?.length ?? 0}</span>
          </div>
        ))}
      </div>

      {(isSearching || loading) && (
        <div style={styles.loadingRow}>
          <span style={styles.loadingDot} />
          {isSearching ? 'Searching…' : 'Loading…'}
        </div>
      )}

      <div style={styles.list}>
        {searchQuery
          ? displayList.map((r) => (
              <MemoryItem key={r.id} record={r} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} />
            ))
          : (['episodic', 'semantic', 'procedural'] as const).map((type) =>
              grouped[type] && grouped[type]!.length > 0 ? (
                <div key={type}>
                  <div style={styles.groupLabel}>
                    <span style={{ color: TYPE_COLORS[type] }}>{TYPE_ICONS[type]}</span>
                    {TYPE_LABELS[type]}
                    <span style={styles.groupCount}>{grouped[type]!.length}</span>
                  </div>
                  {grouped[type]!.map((r) => (
                    <MemoryItem key={r.id} record={r} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} />
                  ))}
                </div>
              ) : null
            )}

        {displayList.length === 0 && !isSearching && !loading && (
          <div style={styles.empty}>
            {searchQuery ? '⊘ No results found' : '⊘ No memories yet'}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryItem({ record, selected, onClick }: { record: MemoryRecord; selected: boolean; onClick: () => void }) {
  const color = TYPE_COLORS[record.type] ?? '#94a3b8';
  const date = new Date(record.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const label = record.concept ?? record.content.slice(0, 40);
  const importancePct = Math.round(record.importance * 100);

  return (
    <button
      style={{ ...styles.item, ...(selected ? styles.itemSelected : {}) }}
      onClick={onClick}
    >
      <div style={{ ...styles.typeBar, background: color }} />
      <div style={styles.itemBody}>
        <div style={styles.itemLabel}>{label}{label.length >= 40 ? '…' : ''}</div>
        <div style={styles.itemFooter}>
          <span style={{ color: '#334155' }}>{date}</span>
          <div style={styles.importanceBar}>
            <div style={{ ...styles.importanceFill, width: `${importancePct}%`, background: color }} />
          </div>
        </div>
      </div>
    </button>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px 10px',
  },
  title: { fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  count: { fontSize: '11px', color: '#334155', background: '#0f172a', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 },
  typeSummary: {
    display: 'flex',
    gap: '6px',
    padding: '0 16px 10px',
  },
  typePill: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 8px',
    borderRadius: '6px',
    border: '1px solid',
    background: 'rgba(255,255,255,0.02)',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 16px',
    fontSize: '11px',
    color: '#475569',
  },
  loadingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#6366f1',
    flexShrink: 0,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    paddingBottom: '8px',
  },
  groupLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px 4px',
    fontSize: '10px',
    fontWeight: 700,
    color: '#334155',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  groupCount: {
    marginLeft: 'auto',
    background: '#0f172a',
    color: '#334155',
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '8px',
  },
  item: {
    display: 'flex',
    width: '100%',
    padding: '0',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.1s',
    alignItems: 'stretch',
  },
  itemSelected: {
    background: 'rgba(99, 102, 241, 0.08)',
  },
  typeBar: {
    width: '3px',
    flexShrink: 0,
    borderRadius: '0 2px 2px 0',
    opacity: 0.7,
  },
  itemBody: {
    flex: 1,
    padding: '8px 14px 8px 10px',
    minWidth: 0,
  },
  itemLabel: {
    fontSize: '12px',
    color: '#cbd5e1',
    marginBottom: '5px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.3,
  },
  itemFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '10px',
  },
  importanceBar: {
    flex: 1,
    height: '2px',
    background: '#0f172a',
    borderRadius: '1px',
    overflow: 'hidden',
  },
  importanceFill: {
    height: '100%',
    borderRadius: '1px',
    opacity: 0.7,
  },
  empty: {
    padding: '32px 16px',
    fontSize: '12px',
    color: '#334155',
    textAlign: 'center' as const,
  },
} as const;
