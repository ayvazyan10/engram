import { useMemo, useState } from 'react';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import {
  GLYPH, RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, TYPE_LABELS, WEIGHT, withAlpha,
  type MemoryType,
} from '../../lib/tokens.js';
import { DataDot, ProjectTag } from './DataMark.js';
import { memoryRowText } from '../../lib/plainText.js';
import { formatShortDate } from '../../lib/dates.js';
import { useServerStats } from '../../lib/serverStats.js';
import { projectLabel } from '../../lib/projects.js';

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
  /** Fetches the next page; offered while the store holds more than is listed. */
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export default function MemoryPanel({ loading, error, onRetry, onStore, onLoadMore, loadingMore }: Props) {
  const { records, searchResults, searchQuery, isSearching } = useMemoryStore();
  const { selectNeuron, selectedNeuronId } = useNeuralStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const stats = useServerStats();
  // Rows name their project once the store has any, as Home's cards do; a
  // store of global memories alone gets no extra label.
  const known = stats?.byNamespace.map((b) => b.namespace) ?? [];
  const showProject = known.some((ns) => ns !== null);
  const projectOf = (r: MemoryRecord) => (showProject ? projectLabel(r.namespace, known) : undefined);
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

  // The pills count the whole store (the same /stats census the status bar
  // shows) — they used to count only the loaded page. Search results are
  // counted as listed, since there the list IS the whole answer.
  const typeCount = (type: MemoryType): number =>
    !searchQuery && stats ? (stats.byType[type] ?? 0) : (grouped[type]?.length ?? 0);

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
        {/* "Memories", the same word the mobile tab bar and the status bar
            use for this list — it was "MEMORY GRAPH", which is the canvas. */}
        <div style={styles.headerLeft}>
          <span style={{ ...styles.title, color: t.textPrimary }}>{searchQuery ? 'Results' : 'Memories'}</span>
          <span className="ec-tabular" title={countTitle} style={{ ...styles.count, color: t.textMuted, borderColor: t.panelBorder }}>
            {countLabel}
          </span>
        </div>
        {onStore && (
          <button
            className="ec-primary"
            onClick={onStore}
            title="Store new memory"
            aria-label="Store new memory"
            style={{ ...styles.storeBtn, background: t.accentStrong, color: t.onAccent }}
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }} aria-hidden="true">
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Type filter pills — real filters (L1). The dot is the mark that
          wears the type colour (F2); the count is ink. Pressed: the pill
          takes a tint of its type and its hairline turns to the type colour.
          Dimmed: another type is pressed and this one is filtered out. */}
      <div style={styles.typeSummary}>
        {TYPES.map((type) => {
          const active = activeTypes.has(type);
          const dimmed = activeTypes.size > 0 && !active;
          return (
            <button
              key={type}
              className="ec-hover-tint"
              aria-pressed={active}
              aria-label={`${TYPE_LABELS[type]} memories: ${typeCount(type)}`}
              title={`${active ? 'Clear the' : 'Filter to'} ${TYPE_LABELS[type].toLowerCase()} memories`}
              onClick={() => toggleType(type)}
              style={{
                ...styles.typePill,
                borderColor: active ? TYPE_COLORS[type] : t.panelBorder,
                background: active ? withAlpha(TYPE_COLORS[type], 0.14) : t.inputBg,
                opacity: dimmed ? 0.5 : 1,
              }}
            >
              <DataDot color={TYPE_COLORS[type]} size={7} />
              <span aria-hidden="true" className="ec-tabular" style={{ color: active ? t.textPrimary : t.textSecondary, fontSize: TYPE.sm, fontWeight: WEIGHT.medium }}>
                {typeCount(type)}
              </span>
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
              <MemoryItem key={r.id} record={r} project={projectOf(r)} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} t={t} />
            ))
          : TYPES.map((type) =>
              (activeTypes.size === 0 || activeTypes.has(type)) && grouped[type] && grouped[type]!.length > 0 ? (
                <div key={type}>
                  <div style={{ ...styles.groupLabel, color: t.textSecondary }}>
                    {/* F2: was the glyph painted in the type colour at 11px.
                        The dot is the mark; the word is ink. */}
                    <DataDot color={TYPE_COLORS[type]} size={7} />
                    {TYPE_LABELS[type]}
                    <span className="ec-tabular" style={{ ...styles.groupCount, color: t.textMuted }}>{grouped[type]!.length}</span>
                  </div>
                  {grouped[type]!.map((r) => (
                    <MemoryItem key={r.id} record={r} project={projectOf(r)} selected={selectedNeuronId === r.id} onClick={() => selectNeuron(r.id)} t={t} />
                  ))}
                </div>
              ) : null
            )}

        {capped && onLoadMore && !loading && (
          <button
            className="ec-hover-tint"
            style={{ ...styles.loadMoreBtn, color: t.textSecondary, borderColor: t.panelBorder }}
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : `Load more · ${total - loaded} not shown`}
          </button>
        )}

        {displayList.length === 0 && !isSearching && !loading && !error && (
          <div style={{ ...styles.empty, color: t.textMuted }}>
            <span aria-hidden="true" style={{ ...styles.emptyGlyph, color: t.panelBorder }}>{GLYPH.empty}</span>
            <span style={{ ...styles.emptyTitle, color: t.textSecondary }}>
              {searchQuery ? 'No results found' : activeTypes.size > 0 ? 'No memories of this type' : 'No memories yet'}
            </span>
            <span style={styles.emptyHint}>
              {searchQuery
                ? 'Try different words, or clear the search to see everything.'
                : activeTypes.size > 0
                  ? 'Press the pill again to clear the filter.'
                  : 'Store one with the + button above, or through any connected AI.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryItem({ record, project, selected, onClick, t }: { record: MemoryRecord; project?: string; selected: boolean; onClick: () => void; t: UITemplate }) {
  const color = TYPE_COLORS[record.type] ?? t.textSecondary;
  const { primary, secondary } = memoryRowText(record);
  const importancePct = Math.round(record.importance * 100);

  return (
    <button
      className="ec-hover-tint"
      aria-current={selected || undefined}
      style={{
        ...styles.item,
        // 8%, not more: Mono's accent is white, and at 10% the tint lifted
        // the ground under the row's muted date to 4.32:1.
        ...(selected ? { background: withAlpha(t.accent, 0.08) } : {}),
      }}
      onClick={onClick}
    >
      {/* The bar is the row's type mark. It comes up to full strength on the
          selected row, so the selection reads in the mark as well as in the
          tint behind it. */}
      <div style={{ ...styles.typeBar, background: color, opacity: selected ? 1 : 0.55 }} />
      <div style={styles.itemBody}>
        {/* H1/L3: the concept alone made 30% of rows byte-identical to
            another row, and the manual '…' fired on any label >= 40 chars
            whether or not anything had been cut. The excerpt distinguishes
            the row; the CSS ellipsis handles the cutting. */}
        <div style={{ ...styles.itemLabel, color: t.textPrimary, fontWeight: selected ? WEIGHT.medium : WEIGHT.regular }}>{primary}</div>
        {secondary && <div style={{ ...styles.itemExcerpt, color: t.textMuted }}>{secondary}</div>}
        <div style={styles.itemFooter}>
          <span className="ec-tabular" style={{ color: t.textMuted }}>{formatShortDate(record.createdAt)}</span>
          {project && <ProjectTag namespace={record.namespace} label={project} style={styles.itemProject} />}
          <div style={{ ...styles.importanceBar, background: t.inputBg }} title={`Importance ${importancePct}%`}>
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
    gap: SPACE.sm,
    padding: `${SPACE.md} ${SPACE.lg} ${SPACE.sm}`,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0 },
  title: { fontSize: TYPE.base, fontWeight: WEIGHT.semibold, letterSpacing: '-0.005em' },
  count: {
    fontSize: TYPE.xs,
    padding: `1px ${SPACE.xs}`,
    borderRadius: RADIUS.pill,
    border: '1px solid',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.4,
  },
  storeBtn: {
    // M6: was 22x22, under the 24x24 WCAG 2.2 target minimum.
    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: RADIUS.sm, flexShrink: 0,
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
    gap: SPACE.xs,
    flex: 1,
    minHeight: 26,
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
  loadMoreBtn: {
    display: 'block',
    margin: `${SPACE.sm} ${SPACE.lg} ${SPACE.lg}`,
    width: `calc(100% - 2 * ${SPACE.lg})`,
    padding: `${SPACE.xs} ${SPACE.sm}`,
    fontSize: TYPE.xs,
    fontWeight: WEIGHT.medium,
    fontFamily: 'inherit',
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    minHeight: 28,
  },
  retryBtn: {
    fontSize: TYPE.xs,
    fontWeight: WEIGHT.medium,
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
    fontWeight: WEIGHT.medium,
    letterSpacing: '0.01em',
  },
  groupCount: {
    marginLeft: 'auto',
    fontSize: TYPE.xs,
    fontWeight: WEIGHT.regular,
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
  },
  itemBody: {
    flex: 1,
    // L5: text starts at SPACE.lg from the panel edge, exactly like the
    // header, the pills and the group labels — the bar eats the first 3px.
    padding: `${SPACE.sm} ${SPACE.lg} 9px calc(${SPACE.lg} - ${TYPE_BAR_WIDTH}px)`,
    minWidth: 0,
  },
  itemLabel: {
    fontSize: TYPE.base,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.35,
  },
  itemExcerpt: {
    fontSize: TYPE.xs,
    marginTop: '1px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.4,
  },
  itemFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
    fontSize: TYPE.xs,
    lineHeight: 1,
  },
  // Line height of its own: the footer's 1 would clip the name's descenders
  // under the ellipsis' overflow.
  itemProject: { maxWidth: '50%', flexShrink: 1, lineHeight: 1.3 },
  importanceBar: {
    flex: 1,
    height: '2px',
    borderRadius: '1px',
    overflow: 'hidden',
  },
  importanceFill: {
    height: '100%',
    borderRadius: '1px',
    opacity: 0.75,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: SPACE['2xs'],
    padding: `${SPACE['3xl']} ${SPACE.xl}`,
    textAlign: 'center' as const,
  },
  emptyGlyph: { fontSize: TYPE.glyph, lineHeight: 1, marginBottom: SPACE.xs },
  emptyTitle: { fontSize: TYPE.base, fontWeight: WEIGHT.medium },
  emptyHint: { fontSize: TYPE.xs, lineHeight: 1.5, maxWidth: 220 },
} as const;
