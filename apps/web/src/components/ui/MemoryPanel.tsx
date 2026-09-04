import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, TYPE_ICONS, TYPE_LABELS, withAlpha } from '../../lib/tokens.js';

const TYPES = ['episodic', 'semantic', 'procedural'] as const;

interface Props {
  loading?: boolean;
  /** Set when the initial load failed (e.g. a 401 from a missing/invalid API
   * key). Distinct from an empty store — F2: without this, an auth failure
   * silently cleared to "No memories yet". */
  error?: string | null;
  onRetry?: () => void;
  onStore?: () => void;
}

export default function MemoryPanel({ loading, error, onRetry, onStore }: Props) {
  const { records, searchResults, searchQuery, isSearching } = useMemoryStore();
  const { selectNeuron, selectedNeuronId } = useNeuralStore();
  const t = useTemplateStore((s) => s.activeTemplate);

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
        <span style={{ ...styles.title, color: t.textMuted }}>Memory Graph</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}>
          <span style={{ ...styles.count, color: t.textMuted, background: t.inputBg }}>{displayList.length}</span>
          {onStore && (
            <button
              className="ec-hover-bright"
              onClick={onStore}
              title="Store new memory"
              style={{
                ...styles.storeBtn,
                background: `linear-gradient(135deg, ${t.accent}, ${t.accentStrong})`,
                color: t.onAccent,
              }}
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Type filter pills */}
      <div style={styles.typeSummary}>
        {TYPES.map((type) => (
          <div key={type} style={{ ...styles.typePill, borderColor: TYPE_COLORS[type], background: withAlpha(t.textPrimary, 0.02) }}>
            <span style={{ color: TYPE_COLORS[type], fontSize: TYPE.sm }}>{TYPE_ICONS[type]}</span>
            <span style={{ color: t.textMuted, fontSize: TYPE.xs }}>{grouped[type]?.length ?? 0}</span>
          </div>
        ))}
      </div>

      {(isSearching || loading) && (
        <div style={{ ...styles.loadingRow, color: t.textMuted }}>
          <span style={{ ...styles.loadingDot, background: t.accent }} />
          {isSearching ? 'Searching…' : 'Loading…'}
        </div>
      )}

      {error && !loading && (
        <div style={{ ...styles.errorBanner, border: `1px solid ${withAlpha(STATUS.danger, 0.3)}`, background: withAlpha(STATUS.danger, 0.07) }}>
          <span style={{ ...styles.errorText, color: STATUS.danger }}>⚠ {error}</span>
          {onRetry && (
            <button
              className="ec-hover-tint"
              style={{ ...styles.retryBtn, color: STATUS.danger, borderColor: withAlpha(STATUS.danger, 0.3) }}
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div style={styles.list}>
        {searchQuery
          ? displayList.map((r) => (
              <MemoryItem key={r.id} record={r} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} t={t} />
            ))
          : TYPES.map((type) =>
              grouped[type] && grouped[type]!.length > 0 ? (
                <div key={type}>
                  <div style={{ ...styles.groupLabel, color: t.textMuted }}>
                    <span style={{ color: TYPE_COLORS[type] }}>{TYPE_ICONS[type]}</span>
                    {TYPE_LABELS[type]}
                    <span style={{ ...styles.groupCount, background: t.inputBg, color: t.textMuted }}>{grouped[type]!.length}</span>
                  </div>
                  {grouped[type]!.map((r) => (
                    <MemoryItem key={r.id} record={r} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} t={t} />
                  ))}
                </div>
              ) : null
            )}

        {displayList.length === 0 && !isSearching && !loading && !error && (
          <div style={{ ...styles.empty, color: t.textMuted }}>
            {searchQuery ? '⊘ No results found' : '⊘ No memories yet'}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryItem({ record, selected, onClick, t }: { record: MemoryRecord; selected: boolean; onClick: () => void; t: UITemplate }) {
  const color = TYPE_COLORS[record.type] ?? t.textSecondary;
  const date = new Date(record.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const label = record.concept ?? record.content.slice(0, 40);
  const importancePct = Math.round(record.importance * 100);

  return (
    <button
      className="ec-hover-tint"
      style={{
        ...styles.item,
        ...(selected ? { background: withAlpha(t.accent, 0.08) } : {}),
      }}
      onClick={onClick}
    >
      <div style={{ ...styles.typeBar, background: color }} />
      <div style={styles.itemBody}>
        <div style={{ ...styles.itemLabel, color: t.textPrimary }}>{label}{label.length >= 40 ? '…' : ''}</div>
        <div style={styles.itemFooter}>
          <span style={{ color: t.textMuted }}>{date}</span>
          <div style={{ ...styles.importanceBar, background: t.inputBg }}>
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
    padding: `${SPACE.lg} ${SPACE.lg} ${SPACE.sm}`,
  },
  title: { fontSize: TYPE.sm, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  count: { fontSize: TYPE.sm, padding: '2px 8px', borderRadius: RADIUS.pill, fontWeight: 600 },
  storeBtn: {
    width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: RADIUS.sm, fontSize: TYPE.lg, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
  },
  typeSummary: {
    display: 'flex',
    gap: SPACE.xs,
    padding: `0 ${SPACE.lg} ${SPACE.sm}`,
  },
  typePill: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE['2xs'],
    padding: '3px 8px',
    borderRadius: RADIUS.sm,
    border: '1px solid',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: `${SPACE.xs} ${SPACE.lg}`,
    fontSize: TYPE.sm,
  },
  loadingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    margin: `0 ${SPACE.lg} ${SPACE.sm}`,
    padding: '8px 10px',
    borderRadius: RADIUS.sm,
  },
  errorText: {
    fontSize: TYPE.sm,
    lineHeight: 1.4,
  },
  retryBtn: {
    fontSize: TYPE.xs,
    fontWeight: 600,
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.tight,
    padding: '3px 8px',
    flexShrink: 0,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    paddingBottom: SPACE.sm,
  },
  groupLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.xs,
    padding: `10px ${SPACE.lg} 4px`,
    fontSize: TYPE.xs,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  groupCount: {
    marginLeft: 'auto',
    fontSize: TYPE.xs,
    padding: '1px 6px',
    borderRadius: RADIUS.pill,
  },
  item: {
    display: 'flex',
    width: '100%',
    padding: '0',
    background: 'transparent',
    border: 'none',
    textAlign: 'left' as const,
    alignItems: 'stretch',
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
    fontSize: TYPE.base,
    marginBottom: '5px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.3,
  },
  itemFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    fontSize: TYPE.xs,
  },
  importanceBar: {
    flex: 1,
    height: '2px',
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
    fontSize: TYPE.base,
    textAlign: 'center' as const,
  },
} as const;
