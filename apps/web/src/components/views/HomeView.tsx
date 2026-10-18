import { useEffect, useState } from 'react';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { useServerStats } from '../../lib/serverStats.js';
import { COMPACT_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { GLYPH, RADIUS, SPACE, STATUS, TYPE, WEIGHT, withAlpha } from '../../lib/tokens.js';
import SearchBar from '../ui/SearchBar.js';
import MemoryCard from '../ui/MemoryCard.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import Onboarding from './Onboarding.js';

interface Props {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  onStore: () => void;
}

/**
 * The landing view: search front and centre, the newest memories under it as
 * cards, and the inspector beside them for the one that is clicked. An empty
 * store gets the first-run onboarding instead, which stays up — showing the
 * first memory as it lands — until the reader moves on from it.
 */
export default function HomeView({ loading, error, onRetry, onLoadMore, loadingMore, onStore }: Props) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const { records, searchResults, searchQuery, isSearching } = useMemoryStore();
  const { selectedNeuronId, selectNeuron } = useNeuralStore();
  const stats = useServerStats();
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const [onboarding, setOnboarding] = useState(false);

  const empty = !loading && !error && records.length === 0 && !searchQuery;
  useEffect(() => {
    if (empty) setOnboarding(true);
  }, [empty]);

  if (onboarding) {
    return (
      <div style={{ ...s.scroll, background: t.rootBg }}>
        <Onboarding onRefresh={onRetry} onDone={() => setOnboarding(false)} />
      </div>
    );
  }

  const list = searchQuery ? searchResults : records;
  const total = stats?.total ?? records.length;
  const more = !searchQuery && total > records.length;
  const inspecting = Boolean(selectedNeuronId);

  // Compact: one pane at a time, like the plate surface's shell. The
  // inspector's own close button brings the cards back.
  if (isCompact && inspecting) {
    return (
      <div style={{ ...s.scroll, background: t.panelBg }}>
        <NeuronInspector />
      </div>
    );
  }

  return (
    <div style={s.row}>
      <div style={{ ...s.scroll, background: t.rootBg }}>
        <div style={s.column}>
          <SearchBar large />

          <div style={s.heading}>
            <h1 style={{ ...s.title, color: t.textPrimary }}>
              {searchQuery ? 'Results' : 'Recent memories'}
            </h1>
            <span className="ec-tabular" style={{ ...s.count, color: t.textMuted }}>
              {searchQuery
                ? `${list.length} found`
                : more
                  ? `${records.length} of ${total}`
                  : `${records.length}`}
            </span>
            <button
              type="button"
              className="ec-hover-tint"
              onClick={onStore}
              style={{ ...s.storeBtn, color: t.textSecondary, borderColor: t.panelBorder }}
            >
              Store a memory
            </button>
          </div>

          {(loading || isSearching) && (
            <p style={{ ...s.state, color: t.textMuted }}>{isSearching ? 'Searching…' : 'Loading…'}</p>
          )}

          {error && !loading && (
            <div role="alert" style={{ ...s.error, borderColor: withAlpha(STATUS.danger, 0.3), background: withAlpha(STATUS.danger, 0.07) }}>
              <span style={{ color: STATUS.danger }}>{GLYPH.warning} {error}</span>
              <button type="button" className="ec-hover-tint" onClick={onRetry} style={{ ...s.retryBtn, color: STATUS.danger, borderColor: withAlpha(STATUS.danger, 0.3) }}>
                Retry
              </button>
            </div>
          )}

          {searchQuery && list.length === 0 && !isSearching && (
            <p style={{ ...s.state, color: t.textMuted }}>
              Nothing matched. Try other words, or clear the search to see your recent memories.
            </p>
          )}

          <div style={s.grid}>
            {list.map((record) => (
              <MemoryCard
                key={record.id}
                record={record}
                selected={record.id === selectedNeuronId}
                onSelect={(id) => selectNeuron(id === selectedNeuronId ? null : id)}
              />
            ))}
          </div>

          {more && !loading && (
            <button
              type="button"
              className="ec-hover-tint"
              onClick={onLoadMore}
              disabled={loadingMore}
              style={{ ...s.moreBtn, color: t.textSecondary, borderColor: t.panelBorder }}
            >
              {loadingMore ? 'Loading…' : `Show more (${total - records.length} older)`}
            </button>
          )}
        </div>
      </div>

      {inspecting && (
        <aside aria-label="Memory details" style={{ ...s.inspector, background: t.panelBg, borderLeftColor: t.panelBorder }}>
          <NeuronInspector />
        </aside>
      )}
    </div>
  );
}

const s = {
  row: { flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden' },
  scroll: { flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto' as const },
  column: {
    maxWidth: 920,
    margin: '0 auto',
    padding: `${SPACE['2xl']} ${SPACE.lg} ${SPACE['3xl']}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: SPACE.lg,
  },
  heading: { display: 'flex', alignItems: 'baseline', gap: SPACE.sm, marginTop: SPACE.sm },
  title: { margin: 0, fontSize: TYPE.xl, fontWeight: WEIGHT.semibold, letterSpacing: '-0.01em' },
  count: { fontSize: TYPE.sm },
  storeBtn: {
    marginLeft: 'auto',
    alignSelf: 'center',
    minHeight: 28,
    padding: `0 ${SPACE.md}`,
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.medium,
    fontFamily: 'inherit',
  },
  state: { margin: 0, fontSize: TYPE.base },
  error: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    padding: `${SPACE.sm} ${SPACE.md}`,
    border: '1px solid',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.sm,
  },
  retryBtn: {
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.tight,
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
    fontSize: TYPE.sm,
    fontFamily: 'inherit',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
    gap: SPACE.md,
  },
  moreBtn: {
    alignSelf: 'center',
    minHeight: 32,
    padding: `0 ${SPACE.lg}`,
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.medium,
    fontFamily: 'inherit',
  },
  inspector: {
    width: 340,
    flexShrink: 0,
    borderLeft: '1px solid',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
} as const;
