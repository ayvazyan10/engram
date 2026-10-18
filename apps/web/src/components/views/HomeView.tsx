import { useEffect, useState } from 'react';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { useServerStats } from '../../lib/serverStats.js';
import { projectLabel } from '../../lib/projects.js';
import { COMPACT_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { GLYPH, RADIUS, SPACE, STATUS, TYPE, WEIGHT, withAlpha } from '../../lib/tokens.js';
import SearchBar from '../ui/SearchBar.js';
import MemoryCard from '../ui/MemoryCard.js';
import ProjectPicker from '../ui/ProjectPicker.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import Onboarding from './Onboarding.js';
import WhatAiKnows from './WhatAiKnows.js';
import { segmentBase, segmentState, trackStyle } from '../ui/segmented.js';

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
  const { records, searchResults, searchQuery, isSearching, projectFilter } = useMemoryStore();
  const { selectedNeuronId, selectNeuron } = useNeuralStore();
  const stats = useServerStats();
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const [onboarding, setOnboarding] = useState(false);
  /** Two lenses on the one search box: the memories it matches, or the
   *  context block an AI would be handed for the same words. */
  const [lens, setLens] = useState<'memories' | 'ai'>('memories');

  // An empty filtered list is not an empty store: no onboarding for it.
  const empty = !loading && !error && records.length === 0 && !searchQuery && projectFilter === undefined;
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

  // Search follows the picked project too. /api/search takes no project
  // filter, so its answer is narrowed here, the way addRecord narrows
  // arrivals; a pick made while results are up applies to them at once.
  const list = searchQuery
    ? projectFilter === undefined
      ? searchResults
      : searchResults.filter((r) => (r.namespace ?? null) === projectFilter)
    : records;
  // A filtered list counts against its own bucket, not the whole store.
  const buckets = stats?.byNamespace ?? [];
  const known = buckets.map((b) => b.namespace);
  const total =
    projectFilter === undefined
      ? (stats?.total ?? records.length)
      : (buckets.find((b) => b.namespace === projectFilter)?.count ?? records.length);
  // Cards name their project once the store has any (a store of global
  // memories alone gets no extra label), except in a list or search filtered
  // to one project, where every card would repeat the picker.
  const showProject = known.some((ns) => ns !== null) && projectFilter === undefined;
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
          <SearchBar large placeholder={lens === 'ai' ? 'What might your AI be asked?' : undefined} />

          <div style={s.lensRow}>
          <div role="tablist" aria-label="Show" style={trackStyle(t)}>
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={lens === l.id}
                className="ec-hover-tint"
                onClick={() => setLens(l.id)}
                style={{ ...segmentBase, ...segmentState(t, lens === l.id) }}
              >
                {l.label}
              </button>
            ))}
          </div>
          {/* The picker scopes the recent list and the search results alike,
              so it stays up while a search is. */}
          {lens === 'memories' && <ProjectPicker />}
          </div>

          {lens === 'ai' ? (
            <WhatAiKnows onStore={onStore} />
          ) : (
            <>
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
                {projectFilter === undefined
                  ? 'Nothing matched. Try other words, or clear the search to see your recent memories.'
                  : `Nothing matched in ${projectLabel(projectFilter, known)}. Try other words, or pick All projects.`}
              </p>
            )}

            <div style={s.grid}>
              {list.map((record) => (
                <MemoryCard
                  key={record.id}
                  record={record}
                  selected={record.id === selectedNeuronId}
                  onSelect={(id) => selectNeuron(id === selectedNeuronId ? null : id)}
                  project={showProject ? projectLabel(record.namespace, known) : undefined}
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
            </>
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

const LENSES = [
  { id: 'memories', label: 'Memories' },
  { id: 'ai', label: 'What my AI knows' },
] as const;

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
  lensRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, minWidth: 0 },
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
