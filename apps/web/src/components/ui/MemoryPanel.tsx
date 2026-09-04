import { useMemo, useState } from 'react';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import {
  GLYPH, RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, TYPE_ICONS, TYPE_LABELS, withAlpha,
  type MemoryType,
} from '../../lib/tokens.js';
import { DataDot } from './DataMark.js';
import { memoryRowText } from '../../lib/plainText.js';
import { formatShortDate } from '../../lib/dates.js';
import { useServerStats } from '../../lib/serverStats.js';

const TYPES = ['episodic', 'semantic', 'procedural'] as const;

/** The type bar down the left edge of a row. Row text is inset by
 *  SPACE.lg - TYPE_BAR_WIDTH so it lines up with the header, the pills and
 *  the group labels above it (L5 — those started at 16px, rows at 13px). */
const TYPE_BAR_WIDTH = 3;

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
  const stats = useServerStats();
  // L1: these three pills were bordered, coloured and inert — they looked
  // exactly like filter chips and did nothing. At 653 stored records the
  // panel genuinely needs filtering, and the grouping below already had the
  // per-type split, so they became the filter they were pretending to be.
  // Empty set means "no filter", which is also the reset state.
  const [activeTypes, setActiveTypes] = useState<ReadonlySet<MemoryType>>(new Set());

  const sourceList = searchQuery ? searchResults : records;
  const displayList = useMemo(
    () => (activeTypes.size === 0 ? sourceList : sourceList.filter((r) => activeTypes.has(r.type))),
    [sourceList, activeTypes]
  );

  // Grouped from the unfiltered list so the pills keep showing how many of
  // each type there are, including the ones currently filtered out.
  const grouped = useMemo(
    () =>
      sourceList.reduce<Record<string, MemoryRecord[]>>((acc, r) => {
        if (!acc[r.type]) acc[r.type] = [];
        acc[r.type]!.push(r);
        return acc;
      }, {}),
    [sourceList]
  );

  function toggleType(type: MemoryType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // H6: "MEMORY GRAPH 200" sat on the same screen as "653 memories" with
  // nothing saying that 200 is the server's page cap rather than the whole
  // store. Resolved: the real figure comes from the shared /stats census, and
  // the panel labels the two quantities apart ("200 of 651") instead of
  // showing one and calling it the other. The store's own count is named
  // `loadedCount` for the page it counts; this panel reads `records.length`
  // directly, because that is the list it is rendering.
  const loaded = records.length;
  const total = stats?.total ?? loaded;
  const capped = !searchQuery && total > loaded;
  const countLabel = searchQuery ? `${displayList.length}` : capped ? `${loaded} of ${total}` : `${loaded}`;
  const countTitle = searchQuery
    ? `${displayList.length} search result${displayList.length === 1 ? '' : 's'}`
    : capped
      ? `Showing the ${loaded} most recent of ${total} stored memories`
      : `${loaded} stored memories`;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={{ ...styles.title, color: t.textMuted }}>Memory Graph</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}>
          <span className="ec-tabular" title={countTitle} style={{ ...styles.count, color: t.textMuted, background: t.inputBg }}>
            {countLabel}
          </span>
          {onStore && (
            <button
              className="ec-hover-bright"
              onClick={onStore}
              title="Store new memory"
              aria-label="Store new memory"
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

      {/* Type filter pills — real filters (L1) */}
      <div style={styles.typeSummary}>
        {TYPES.map((type) => {
          const active = activeTypes.has(type);
          const dimmed = activeTypes.size > 0 && !active;
          return (
            <button
              key={type}
              className="ec-hover-tint"
              aria-pressed={active}
              aria-label={`${TYPE_LABELS[type]} memories: ${grouped[type]?.length ?? 0}`}
              title={`${active ? 'Clear the' : 'Filter to'} ${TYPE_LABELS[type].toLowerCase()} memories`}
              onClick={() => toggleType(type)}
              style={{
                ...styles.typePill,
                // F2: the type-coloured border is this pill's mark, and it is
                // now unconditional — `opacity` already says "filtered out",
                // so swapping the border to a neutral was throwing away the
                // only non-text carrier of the hue.
                borderColor: TYPE_COLORS[type],
                background: active ? withAlpha(TYPE_COLORS[type], 0.14) : withAlpha(t.textPrimary, 0.02),
                opacity: dimmed ? 0.55 : 1,
              }}
            >
              {/* Glyph + count only: the sidebar is too narrow for three
                  labelled pills. The group header directly below spells the
                  type out, so the legend is on screen rather than hidden in a
                  tooltip. F2: the glyph is ink — the pill's border is the
                  mark that wears the data colour. */}
              <span aria-hidden="true" style={{ color: active ? t.textPrimary : t.textSecondary, fontSize: TYPE.sm }}>{TYPE_ICONS[type]}</span>
              <span aria-hidden="true" className="ec-tabular" style={{ color: active ? t.textPrimary : t.textMuted, fontSize: TYPE.xs }}>{grouped[type]?.length ?? 0}</span>
            </button>
          );
        })}
      </div>

      {(isSearching || loading) && (
        <div style={{ ...styles.loadingRow, color: t.textMuted }}>
          {/* L2: was a static dot, which read as a bullet rather than as
              progress. Same ec-spin arc SearchBar uses. */}
          <svg style={styles.spinner} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke={t.accent} strokeWidth="2.5" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
          </svg>
          {isSearching ? 'Searching…' : 'Loading…'}
        </div>
      )}

      {error && !loading && (
        <div style={{ ...styles.errorBanner, border: `1px solid ${withAlpha(STATUS.danger, 0.3)}`, background: withAlpha(STATUS.danger, 0.07) }}>
          <span style={{ ...styles.errorText, color: STATUS.danger }}>{GLYPH.warning} {error}</span>
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
              (activeTypes.size === 0 || activeTypes.has(type)) && grouped[type] && grouped[type]!.length > 0 ? (
                <div key={type}>
                  <div style={{ ...styles.groupLabel, color: t.textMuted }}>
                    {/* F2: was the glyph painted in the type colour at 11px.
                        The dot is the mark; the glyph and the word are ink. */}
                    <DataDot color={TYPE_COLORS[type]} size={7} />
                    <span aria-hidden="true">{TYPE_ICONS[type]}</span>
                    {TYPE_LABELS[type]}
                    <span className="ec-tabular" style={{ ...styles.groupCount, background: t.inputBg, color: t.textMuted }}>{grouped[type]!.length}</span>
                  </div>
                  {grouped[type]!.map((r) => (
                    <MemoryItem key={r.id} record={r} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} t={t} />
                  ))}
                </div>
              ) : null
            )}

        {displayList.length === 0 && !isSearching && !loading && !error && (
          <div style={{ ...styles.empty, color: t.textMuted }}>
            {searchQuery
              ? `${GLYPH.empty} No results found`
              : activeTypes.size > 0
                ? `${GLYPH.empty} No memories of this type`
                : `${GLYPH.empty} No memories yet`}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryItem({ record, selected, onClick, t }: { record: MemoryRecord; selected: boolean; onClick: () => void; t: UITemplate }) {
  const color = TYPE_COLORS[record.type] ?? t.textSecondary;
  const { primary, secondary } = memoryRowText(record);
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
        {/* H1/L3: the concept alone made 30% of rows byte-identical to
            another row, and the manual '…' fired on any label >= 40 chars
            whether or not anything had been cut. The excerpt distinguishes
            the row; the CSS ellipsis handles the cutting. */}
        <div style={{ ...styles.itemLabel, color: t.textPrimary }}>{primary}</div>
        {secondary && <div style={{ ...styles.itemExcerpt, color: t.textMuted }}>{secondary}</div>}
        <div style={styles.itemFooter}>
          <span className="ec-tabular" style={{ color: t.textMuted }}>{formatShortDate(record.createdAt)}</span>
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
  count: { fontSize: TYPE.sm, padding: `${SPACE['3xs']} ${SPACE.sm}`, borderRadius: RADIUS.pill, fontWeight: 600, whiteSpace: 'nowrap' as const },
  storeBtn: {
    // M6: was 22x22, under the 24x24 WCAG 2.2 target minimum.
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
    justifyContent: 'center',
    gap: SPACE['2xs'],
    flex: 1,
    minHeight: 24,
    padding: `${SPACE['3xs']} ${SPACE.xs}`,
    borderRadius: RADIUS.sm,
    border: '1px solid',
    fontFamily: 'inherit',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: `${SPACE.xs} ${SPACE.lg}`,
    fontSize: TYPE.sm,
  },
  spinner: {
    width: 12,
    height: 12,
    flexShrink: 0,
    animation: 'ec-spin 0.8s linear infinite',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    margin: `0 ${SPACE.lg} ${SPACE.sm}`,
    padding: `${SPACE.sm} ${SPACE.md}`,
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
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
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
    padding: `${SPACE.md} ${SPACE.lg} ${SPACE['2xs']}`,
    fontSize: TYPE.xs,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  groupCount: {
    marginLeft: 'auto',
    fontSize: TYPE.xs,
    padding: `1px ${SPACE.xs}`,
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
    width: `${TYPE_BAR_WIDTH}px`,
    flexShrink: 0,
    borderRadius: `0 ${SPACE['3xs']} ${SPACE['3xs']} 0`,
    opacity: 0.7,
  },
  itemBody: {
    flex: 1,
    // L5: text starts at SPACE.lg from the panel edge, exactly like the
    // header, the pills and the group labels — the bar eats the first 3px.
    padding: `${SPACE.sm} ${SPACE.lg} ${SPACE.sm} calc(${SPACE.lg} - ${TYPE_BAR_WIDTH}px)`,
    minWidth: 0,
  },
  itemLabel: {
    fontSize: TYPE.base,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.3,
  },
  itemExcerpt: {
    fontSize: TYPE.xs,
    marginTop: SPACE['3xs'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.35,
  },
  itemFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
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
    padding: `${SPACE['3xl']} ${SPACE.lg}`,
    fontSize: TYPE.base,
    textAlign: 'center' as const,
  },
} as const;
