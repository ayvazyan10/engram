import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import PlateSurface from '../plates/PlateSurface.js';
import MemoryPanel from '../ui/MemoryPanel.js';
import SearchBar from '../ui/SearchBar.js';
import StatusBar from '../ui/StatusBar.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import ViewSwitcher from '../ui/ViewSwitcher.js';
import TemplateSwitcher from '../ui/TemplateSwitcher.js';
import StoreMemoryModal from '../ui/StoreMemoryModal.js';
import UnlockGate from '../ui/UnlockGate.js';
import CompactMain from './CompactMain.js';
// Home is the landing view, so it is in the main chunk rather than split.
import HomeView from '../views/HomeView.js';
import type { MobilePane } from './MobileTabBar.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { sceneLayout, type SceneNodeInput } from '../../store/viewStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { useDashboardStore } from '../../store/dashboardStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { api, ApiError } from '../../lib/api.js';
import { loadPlateData } from '../../lib/plate/data.js';
import { refreshServerStats } from '../../lib/serverStats.js';
import type { ObsData } from '../../lib/plate/contract.js';
import { useWebSocket, asMemoryRecord } from '../../hooks/useWebSocket.js';
import { COMPACT_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useThemeVars } from '../../hooks/useThemeVars.js';
import { SPACE, STATUS, TYPE, WEIGHT } from '../../lib/tokens.js';

// W16: recharts (the bulk of these three views' weight) shipped to every
// visitor even if they never leave the default plate surface — these were the
// only static imports pulling it into the main chunk. Code-split so it's
// fetched only when a user actually opens Timeline/Analytics/Reflections.
const TimelineView = lazy(() => import('../views/TimelineView.js'));
const AnalyticsView = lazy(() => import('../views/AnalyticsView.js'));
const ReflectionView = lazy(() => import('../views/ReflectionView.js'));

export default function AppLayout() {
  const { neurons, setNeurons, reconcileNeurons, setConnections, setContradictionPairs } = useNeuralStore();
  const { setRecords, appendRecords, storeChanges } = useMemoryStore();
  const viewMode = useDashboardStore((s) => s.viewMode);
  const t = useTemplateStore((s) => s.activeTemplate);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The plate's node set does not come from the memory page: it comes from
  // GET /api/graph/layout, which places EVERY memory by projecting its
  // embedding. The sidebar still lists its own page of records.
  const [sceneNodes, setSceneNodes] = useState<SceneNodeInput[] | null>(null);
  // The five plates all read this one derived object. It is loaded with the
  // projection, from the same responses, and it is NOT a dependency of the
  // active plate — switching plates re-renders, it does not refetch, and the
  // selection rides through untouched.
  const [plateData, setPlateData] = useState<ObsData | null>(null);
  const [plateError, setPlateError] = useState<string | null>(null);
  /** Bumped by the retry button. The load is otherwise fired only by a change
   *  in the record count, so a failed load has no other way back. */
  const [plateAttempt, setPlateAttempt] = useState(0);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The running server's own version (GET /health). Not the web package's:
   *  that one is a workspace number the release never bumps. */
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const locked = useAuthStore((s) => s.locked);

  // Below ~900px the fixed 260px sidebar + 252px inspector alone exceed a
  // 375px viewport — see MobileTabBar.tsx for the full reasoning (V3).
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const [mobilePane, setMobilePane] = useState<MobilePane>('canvas');

  useThemeVars(t);
  useWebSocket();

  // F2: a failed load must not look identical to an empty store. A 401 is
  // handled globally by the unlock gate (lib/api.ts locks useAuthStore on
  // every 401) — MemoryPanel's error banner is reserved for everything else
  // (network errors, 5xx, timeouts) so the two failure modes read distinctly.
  const loadMemories = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.listMemories({ limit: PAGE_SIZE })
      .then((res) => setRecords(parseMemories(res.memories)))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setLoadError(err instanceof Error ? err.message : 'Could not reach Engram API');
      })
      .finally(() => setLoading(false));
  }, [setRecords]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  /** The next page of the list, from the server's own limit/offset. The
   *  offset is what is loaded: socket arrivals are the newest rows, so they
   *  already account for the shift they caused at the top. */
  const loadMore = useCallback(() => {
    setLoadingMore(true);
    api.listMemories({ limit: PAGE_SIZE, offset: useMemoryStore.getState().records.length })
      .then((res) => appendRecords(parseMemories(res.memories)))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setLoadError(err instanceof Error ? err.message : 'Could not reach Engram API');
      })
      .finally(() => setLoadingMore(false));
  }, [appendRecords]);

  // A memory stored (over the socket or from the modal) or archived changes
  // the census; ask for it then instead of waiting out the 15s poll. Skipped
  // at 0: the first subscriber already asks once on mount.
  useEffect(() => {
    if (storeChanges > 0) void refreshServerStats();
  }, [storeChanges]);

  useEffect(() => {
    api.health()
      .then((res) => {
        if (typeof res.version === 'string') setServerVersion(res.version);
      })
      // No version is better than a wrong one: the badge stays hidden.
      .catch(() => {});
  }, []);

  /** Re-run the plate load after a failure. A failed load never set the
   *  guard, so bumping the attempt counter is what actually re-fires the
   *  effect. */
  const retryPlate = useCallback(() => {
    setPlateError(null);
    setPlateAttempt((n) => n + 1);
  }, []);

  // W12: the whole-store fetches below key on `storeChanges`, which a socket
  // 'memory:stored' arrival or an archive bumps, so they refresh instead of
  // staying stale after the initial load. They used to key on the loaded
  // record count, which also moved when the first page landed (0 -> 200) —
  // every cold load fetched the plate data twice — and would move again on
  // every "Load more". An edit that leaves the store's membership alone — a
  // tag added, a concept edited — doesn't refetch.
  const contradictionsFetchedForRef = useRef(-1);
  useEffect(() => {
    if (contradictionsFetchedForRef.current === storeChanges) return;
    contradictionsFetchedForRef.current = storeChanges;
    api.getContradictions()
      .then((res) => {
        setContradictionPairs(
          res.contradictions.map((c) => ({
            sourceId: c.source.id,
            targetId: c.target.id,
            confidence: c.confidence,
          }))
        );
      })
      .catch(() => {});
  }, [storeChanges, setContradictionPairs]);

  // W12: a ref-held "already fetched for this store state" guard, not a
  // dependency-array trick. Toggling `viewMode` away from and back to '3d' with
  // the store unchanged is a no-op; a new or removed record refetches once,
  // including one that arrived over the socket while another view was showing.
  //
  // What changed here: this used to sort records by importance, take the top
  // 30, and fire thirty GET /graph/:id requests, then drop every edge whose
  // other endpoint had fallen outside the 200-row page — 67 edges out of
  // thousands, biased toward important nodes, with nothing on screen saying so.
  // Two requests now: the projection, and the whole edge set.
  //
  // ONE load feeds both consumers. `loadPlateData` makes the three requests
  // (/graph/layout, /graph/edges, /decay/policy) and returns the derived plate
  // data alongside the raw responses, so the plate and the inspector are
  // talking about the same store and a load costs three requests rather than
  // five. There is no fallback sphere any more: the plates are arguments about
  // this store's real shape, and an id-derived sphere is invented data — the
  // one surface that used to confess it (the scene key) has been retired
  // because each plate now states its own denominators.
  //
  // The guard is earned when a load LANDS, not when it starts. A run whose
  // cleanup fires first (StrictMode's dev-only double effect, or leaving the
  // plates mid-load) discards its response, so the next run must fetch again —
  // setting the guard up front left the dev server on "Reading the store"
  // forever, waiting on a response its own cleanup had thrown away.
  const sceneFetchedForRef = useRef(-1);
  useEffect(() => {
    if (viewMode !== '3d') return;
    if (sceneFetchedForRef.current === storeChanges) return;

    let cancelled = false;
    loadPlateData()
      .then(({ data, layout, edges }) => {
        if (cancelled) return;
        sceneFetchedForRef.current = storeChanges;
        setPlateData(data);
        setPlateError(null);
        setSceneNodes(layout.nodes);
        setConnections(
          edges.edges.map((e) => ({
            id: e.id,
            sourceId: e.sourceId,
            targetId: e.targetId,
            relationship: e.relationship,
            strength: e.strength,
          }))
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A 401 is the unlock gate's, exactly as it is for the memory list:
        // the gate covers the dashboard and unlocking reloads, so the box
        // stays in its loading state rather than showing a second, competing
        // explanation of the same failure.
        if (err instanceof ApiError && err.status === 401) return;
        // Anything else is stated on the plate box. It must not be allowed to
        // look like an empty store — see PlateSurface for the two treatments.
        setPlateError(err instanceof Error ? err.message : 'Could not reach Engram API');
      });

    return () => {
      cancelled = true;
    };
  }, [storeChanges, viewMode, plateAttempt, setConnections]);

  useEffect(() => {
    if (!sceneNodes || sceneNodes.length === 0 || viewMode !== '3d') return;
    // ONE layout, always: the projection as the server computed it. This is
    // deliberately not keyed on the active plate — a plate owns its own
    // geometry and reads `plateData`, so switching plates must not disturb
    // `neurons`, which is what the inspector and the socket reconciliation
    // read.
    const positions = sceneLayout(sceneNodes);

    if (firstLoad || neurons.length === 0) {
      setNeurons(positions.map((p) => ({ ...p, activation: 0, tx: p.x, ty: p.y, tz: p.z })));
      setFirstLoad(false);
    } else {
      // Reconcile rather than only retarget: memories stored during the session
      // never appeared as neurons until a full page reload.
      reconcileNeurons(positions);
    }
  // firstLoad/neurons.length/setNeurons/reconcileNeurons deliberately excluded:
  // firstLoad and neurons.length are read only to pick a branch, both are
  // updated inside this very effect, and including them would either loop or
  // add nothing. setNeurons/reconcileNeurons are stable Zustand actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneNodes, viewMode]);

  /**
   * Escape, owned in one place.
   *
   * Two plates used to bind their own window listener for it. In this app that
   * key is already spent twice — SearchBar clears its field on Escape and does
   * not stop propagation, and ModalShell closes on Escape — so a plate's own
   * listener silently threw away the reader's selection every time the search
   * field was cleared, and one keystroke closed a modal AND wiped the plate
   * behind it. Three listeners for one key cannot agree, so the host takes it
   * and declines in the three cases where the key belongs to something else:
   * a text field, an open modal or the unlock gate, and anything a component
   * nearer the event has already handled (the plate chooser and ModalShell
   * mark their own Escape that way — the latter is what covers the archive
   * confirmation, which this component does not know is open).
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (showStoreModal || locked) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      useNeuralStore.getState().selectNeuron(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [showStoreModal, locked]);

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Header */}
      <header className="ec-header" style={{ ...s.header, background: t.headerBg, borderBottomColor: t.headerBorder }}>
        <div className="ec-logo" style={s.logo}>
          <BrandMark color={t.accent} />
          <span className="ec-logo-text" style={{ ...s.logoText, color: t.textPrimary }}>Engram</span>
          {/* The server's version, from /health. It was the web package's
              (0.4.1) while the release was 0.7.0; hidden until known. */}
          {serverVersion && (
            <span className="ec-logo-badge ec-tabular" style={{ ...s.logoBadge, color: t.textMuted }}>v{serverVersion}</span>
          )}
        </div>

        <ViewSwitcher />

        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, flexShrink: 0 }}>
          <TemplateSwitcher />
          <ConnectionDot />
        </div>
      </header>

      {/* Main — mode aware */}
      {viewMode === 'home' ? (
        <HomeView
          loading={loading}
          error={loadError}
          onRetry={loadMemories}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
          onStore={() => setShowStoreModal(true)}
        />
      ) : viewMode === '3d' ? (
        isCompact ? (
          <CompactMain
            pane={mobilePane}
            onPaneChange={setMobilePane}
            loading={loading}
            loadError={loadError}
            loadMemories={loadMemories}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
            onStore={() => setShowStoreModal(true)}
            plateData={plateData}
            plateError={plateError}
            onPlateRetry={retryPlate}
          />
        ) : (
          <div style={s.main}>
            <div style={{ ...s.sidebar, background: t.panelBg, borderRightColor: t.panelBorder }}>
              <SearchBar />
              <MemoryPanel
                loading={loading}
                error={loadError}
                onRetry={loadMemories}
                onStore={() => setShowStoreModal(true)}
                onLoadMore={loadMore}
                loadingMore={loadingMore}
              />
            </div>

            {/* The plate slot. PlateSurface is the positioned, measured box —
                every plate roots itself inside it and bleeds to its edges. */}
            <div style={s.canvas}>
              <PlateSurface data={plateData} error={plateError} onRetry={retryPlate} />
            </div>

            <div style={{ ...s.inspector, background: t.panelBg, borderLeftColor: t.panelBorder }}>
              <NeuronInspector />
            </div>
          </div>
        )
      ) : (
        <div style={s.fullView}>
          <Suspense fallback={<div style={{ ...s.loadingText, color: t.textMuted, padding: SPACE.lg }}>Loading…</div>}>
            {/* loading / error / onRetry come from the same state MemoryPanel
                receives, so every surface reports the same load in the same
                words. Threaded from here because these three are rendered by
                this component and cannot reach that state themselves. */}
            {viewMode === 'timeline' && (
              <TimelineView loading={loading} error={loadError} onRetry={loadMemories} />
            )}
            {viewMode === 'analytics' && (
              <AnalyticsView loading={loading} error={loadError} onRetry={loadMemories} />
            )}
            {viewMode === 'reflections' && (
              <ReflectionView loading={loading} error={loadError} onRetry={loadMemories} />
            )}
          </Suspense>
        </div>
      )}

      <StatusBar />

      {showStoreModal && (
        <StoreMemoryModal
          onClose={() => setShowStoreModal(false)}
          onStored={(record) => {
            setShowStoreModal(false);
            useMemoryStore.getState().addRecord(record);
          }}
        />
      )}

      {locked && <UnlockGate />}
    </div>
  );
}

/** The server's page cap for GET /memory (`limit` maximum 200). */
const PAGE_SIZE = 200;

/**
 * W10: the server response was cast unvalidated. A single row missing a field
 * asMemoryRecord requires (id/content/type) doesn't get to reach date-fns /
 * string-slicing calls downstream and throw — the exact same shape check
 * already applied to the socket's 'memory:stored' payload.
 */
function parseMemories(rows: unknown[]): MemoryRecord[] {
  return rows.map(asMemoryRecord).filter((r): r is MemoryRecord => r !== null);
}

/**
 * The brand mark: the central node and its three primary neighbours from
 * public/logo.svg, drawn in the template's accent. It replaces a '⬡' — which
 * is GLYPH.concept, the timeline card's "concept" marker — so the wordmark
 * no longer shares its icon with a record field.
 */
function BrandMark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" style={{ color, flexShrink: 0 }}>
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.55">
        <path d="M10 10V4.2M10 10l5 2.9M10 10l-5 2.9" />
      </g>
      <circle cx="10" cy="10" r="2.6" fill="currentColor" />
      <circle cx="10" cy="3.6" r="1.7" fill="currentColor" />
      <circle cx="15.5" cy="13.2" r="1.7" fill="currentColor" />
      <circle cx="4.5" cy="13.2" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** Socket state. Green means the live feed is up; otherwise it recedes to
 *  the muted role rather than a fixed slate that ignored the template. */
function ConnectionDot() {
  const { isConnected } = useNeuralStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const color = isConnected ? STATUS.success : t.textMuted;
  return (
    <div
      role="status"
      aria-label={isConnected ? 'Live' : 'Offline'}
      style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs, fontSize: TYPE.sm, fontWeight: WEIGHT.medium, color }}
      title={isConnected ? 'Live updates connected' : 'Live updates disconnected — the dashboard shows what it last loaded'}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <span className="ec-live-label">{isConnected ? 'Live' : 'Offline'}</span>
    </div>
  );
}

const s = {
  root: { display: 'flex', flexDirection: 'column' as const, width: '100%', height: '100%', overflow: 'hidden' },
  header: {
    // `position: relative` + a z-index above the main row: the plate chooser's
    // drawer is an absolutely positioned child of this bar, and without a
    // stacking context here the surface it selects paints over it.
    position: 'relative' as const, zIndex: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `0 ${SPACE.lg}`, minHeight: '48px', borderBottom: '1px solid',
    flexShrink: 0, gap: SPACE.md,
  },
  logo: { display: 'flex', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 },
  logoText: { fontSize: TYPE.md, fontWeight: WEIGHT.semibold, letterSpacing: '-0.01em' },
  logoBadge: { fontSize: TYPE.xs, fontWeight: WEIGHT.regular, marginLeft: SPACE['3xs'] },
  main: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  fullView: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  sidebar: { width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRight: '1px solid', overflow: 'hidden' },
  canvas: { flex: 1, position: 'relative' as const, overflow: 'hidden', minWidth: 0, height: '100%' },
  inspector: { width: '252px', flexShrink: 0, borderLeft: '1px solid', overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  loadingText: { fontSize: TYPE.base },
} as const;
