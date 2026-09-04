import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import NeuralCanvas from '../canvas/NeuralCanvas.js';
import MemoryPanel from '../ui/MemoryPanel.js';
import SearchBar from '../ui/SearchBar.js';
import StatusBar from '../ui/StatusBar.js';
import NeuronInspector from '../ui/NeuronInspector.js';
import ViewSwitcher from '../ui/ViewSwitcher.js';
import TemplateSwitcher from '../ui/TemplateSwitcher.js';
import StoreMemoryModal from '../ui/StoreMemoryModal.js';
import UnlockGate from '../ui/UnlockGate.js';
import MobileTabBar, { type MobilePane } from './MobileTabBar.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useViewStore } from '../../store/viewStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { useDashboardStore } from '../../store/dashboardStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { api, ApiError } from '../../lib/api.js';
import { useWebSocket, asMemoryRecord } from '../../hooks/useWebSocket.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useThemeVars } from '../../hooks/useThemeVars.js';
import { RADIUS, SPACE, TYPE } from '../../lib/tokens.js';

// W16: recharts (the bulk of these three views' weight) shipped to every
// visitor even if they never leave the default 3D view — these were the
// only static imports pulling it into the main chunk. Code-split so it's
// fetched only when a user actually opens Timeline/Analytics/Reflections.
const TimelineView = lazy(() => import('../views/TimelineView.js'));
const AnalyticsView = lazy(() => import('../views/AnalyticsView.js'));
const ReflectionView = lazy(() => import('../views/ReflectionView.js'));

export default function AppLayout() {
  const { neurons, setNeurons, reconcileNeurons, setConnections, setContradictionPairs } = useNeuralStore();
  const { records, setRecords } = useMemoryStore();
  const { activeView } = useViewStore();
  const viewMode = useDashboardStore((s) => s.viewMode);
  const t = useTemplateStore((s) => s.activeTemplate);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const locked = useAuthStore((s) => s.locked);

  // Below ~900px the fixed 260px sidebar + 252px inspector alone exceed a
  // 375px viewport — see MobileTabBar.tsx for the full reasoning (V3).
  const isCompact = useMediaQuery('(max-width: 900px)');
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
    api.listMemories({ limit: 200 })
      .then((res) => {
        // W10: the server response was cast unvalidated. A single row
        // missing a field asMemoryRecord requires (id/content/type) doesn't
        // get to reach date-fns / string-slicing calls downstream and throw
        // — reused here from useWebSocket.ts, the exact same shape check
        // already applied to the socket's 'memory:stored' payload.
        const parsed = (res.memories as unknown[])
          .map(asMemoryRecord)
          .filter((r): r is MemoryRecord => r !== null);
        setRecords(parsed);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setLoadError(err instanceof Error ? err.message : 'Could not reach Engram API');
      })
      .finally(() => setLoading(false));
  }, [setRecords]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  // W12: fetches below key on `records` itself (not a synthetic
  // `records.length > 0` boolean, which only ever ran once) so a socket
  // 'memory:stored' arrival — which changes `records`' length — refreshes
  // contradictions and connections instead of leaving them permanently
  // stale after the initial load. The count guard (same shape as the
  // connections effect below) means an unrelated edit that leaves the
  // record count unchanged — a tag added, a concept edited — doesn't
  // refetch; only an actual arrival or removal does.
  const contradictionsFetchedForCountRef = useRef(-1);
  useEffect(() => {
    if (records.length === 0) return;
    if (contradictionsFetchedForCountRef.current === records.length) return;
    contradictionsFetchedForCountRef.current = records.length;
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
  }, [records, setContradictionPairs]);

  useEffect(() => {
    if (records.length === 0 || viewMode !== '3d') return;
    const positions = activeView.layout(records);

    if (firstLoad || neurons.length === 0) {
      setNeurons(positions.map((p) => ({ ...p, activation: 0, tx: p.x, ty: p.y, tz: p.z })));
      setFirstLoad(false);
    } else {
      // Reconcile rather than only retarget: setTargetPositions mapped over the
      // EXISTING array, so memories stored during the session never appeared as
      // neurons until a full page reload.
      reconcileNeurons(positions);
    }
  // firstLoad/neurons.length/setNeurons/reconcileNeurons deliberately excluded:
  // firstLoad and neurons.length are read only to pick a branch, both are
  // updated inside this very effect, and including them would either loop
  // (setNeurons's new array reference re-triggers on `neurons.length`) or add
  // nothing (the branch decision is already fresh off the current render on
  // every legitimate re-run — records/activeView/viewMode changing is what a
  // "legitimate re-run" means here). setNeurons/reconcileNeurons are stable
  // Zustand actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, activeView, viewMode]);

  // W12: a ref-counted "already fetched for this many records" guard, not a
  // dependency-array trick — `records` (not `records.length > 0`) is a real
  // dependency so eslint can see everything the effect reads, but toggling
  // `viewMode` away from and back to '3d' with the same record count is a
  // no-op instead of re-running the 30-call Promise.all below (five tab
  // flips used to mean 150 requests). A new/removed record still refetches,
  // including one that arrived over the socket while a different view was
  // showing — the guard is keyed on count, not on "did we ever fetch", so
  // returning to 3D after that always finds it stale and fetches once.
  const connectionsFetchedForCountRef = useRef(-1);
  useEffect(() => {
    if (records.length === 0 || viewMode !== '3d') return;
    if (connectionsFetchedForCountRef.current === records.length) return;
    connectionsFetchedForCountRef.current = records.length;
    const top = [...records].sort((a, b) => b.importance - a.importance).slice(0, 30);
    Promise.all(top.map((m) => api.getGraph(m.id, 1).catch(() => null))).then((graphs) => {
      // The route returns edges in both directions, so the same edge arrives
      // once per endpoint — dedupe by id and drop self-loops.
      const byId = new Map<string, Parameters<typeof setConnections>[0][number]>();
      graphs.forEach((g, i) => {
        if (!g) return;
        const src = top[i]!.id;
        g.connections?.forEach((c) => {
          const sourceId = c.sourceId || src;
          if (!c.targetId || sourceId === c.targetId) return;
          if (byId.has(c.id)) return;
          byId.set(c.id, { id: c.id, sourceId, targetId: c.targetId, relationship: c.relationship, strength: c.strength });
        });
      });
      setConnections([...byId.values()]);
    });
  }, [records, viewMode, setConnections]);

  return (
    <div style={{ ...s.root, background: t.rootBg }}>
      {/* Header */}
      <div className="ec-header" style={{ ...s.header, background: t.headerBg, borderBottomColor: t.headerBorder }}>
        <div style={s.logo}>
          <span style={{ ...s.logoIcon, color: t.accent }}>⬡</span>
          <span style={{ ...s.logoText, color: t.textPrimary }}>Engram</span>
          <span className="ec-logo-badge" style={{ ...s.logoBadge, color: t.textMuted, background: t.cardBg }}>v0.2</span>
        </div>

        <ViewSwitcher />

        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <TemplateSwitcher />
          <ConnectionDot />
        </div>
      </div>

      {/* Main — mode aware */}
      {viewMode === '3d' ? (
        isCompact ? (
          <CompactMain
            pane={mobilePane}
            onPaneChange={setMobilePane}
            loading={loading}
            loadError={loadError}
            loadMemories={loadMemories}
            onStore={() => setShowStoreModal(true)}
          />
        ) : (
          <div style={s.main}>
            <div style={{ ...s.sidebar, background: t.panelBg, borderRightColor: t.panelBorder }}>
              <SearchBar />
              <MemoryPanel loading={loading} error={loadError} onRetry={loadMemories} onStore={() => setShowStoreModal(true)} />
            </div>

            <div style={s.canvas}>
              <CanvasOrLoading loading={loading} hasRecords={records.length > 0} />
            </div>

            <div style={{ ...s.inspector, background: t.panelBg, borderLeftColor: t.panelBorder }}>
              <NeuronInspector />
            </div>
          </div>
        )
      ) : (
        <div style={s.fullView}>
          <Suspense fallback={<div style={{ ...s.loadingText, color: t.textMuted, padding: SPACE.lg }}>Loading…</div>}>
            {viewMode === 'timeline' && <TimelineView />}
            {viewMode === 'analytics' && <AnalyticsView />}
            {viewMode === 'reflections' && <ReflectionView />}
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

function CanvasOrLoading({ loading, hasRecords }: { loading: boolean; hasRecords: boolean }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  if (loading && !hasRecords) {
    return (
      <div style={{ ...s.loadingOverlay, background: t.rootBg }}>
        <div style={{ ...s.spinner, borderColor: t.panelBorder, borderTopColor: t.accent }} />
        <div style={{ ...s.loadingText, color: t.textMuted }}>Loading neural graph…</div>
      </div>
    );
  }
  return <NeuralCanvas />;
}

interface CompactMainProps {
  pane: MobilePane;
  onPaneChange: (pane: MobilePane) => void;
  loading: boolean;
  loadError: string | null;
  loadMemories: () => void;
  onStore: () => void;
}

/** The 3D-mode layout below ~900px (V3): one full-width pane at a time
 *  (list / canvas / inspector), switched via MobileTabBar instead of the
 *  desktop's fixed 3-column row. */
function CompactMain({ pane, onPaneChange, loading, loadError, loadMemories, onStore }: CompactMainProps) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const records = useMemoryStore((s) => s.records);

  return (
    <div style={s.compactMain}>
      <div style={s.compactPaneArea}>
        {pane === 'list' && (
          <div className="ec-mobile-pane" style={{ background: t.panelBg, display: 'flex', flexDirection: 'column' }}>
            <SearchBar />
            <MemoryPanel loading={loading} error={loadError} onRetry={loadMemories} onStore={onStore} />
          </div>
        )}
        {pane === 'canvas' && (
          <div className="ec-mobile-pane" style={{ position: 'relative' }}>
            <CanvasOrLoading loading={loading} hasRecords={records.length > 0} />
          </div>
        )}
        {pane === 'inspector' && (
          <div className="ec-mobile-pane" style={{ background: t.panelBg }}>
            <NeuronInspector />
          </div>
        )}
      </div>
      <MobileTabBar pane={pane} onChange={onPaneChange} t={t} />
    </div>
  );
}

function ConnectionDot() {
  const { isConnected } = useNeuralStore();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: TYPE.sm, color: isConnected ? '#22c55e' : '#64748b' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: isConnected ? '#22c55e' : '#475569', display: 'inline-block', boxShadow: isConnected ? '0 0 6px #22c55e88' : 'none' }} />
      {isConnected ? 'Live' : 'Offline'}
    </div>
  );
}

const s = {
  root: { display: 'flex', flexDirection: 'column' as const, width: '100%', height: '100%', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', minHeight: '46px', borderBottom: '1px solid',
    flexShrink: 0, gap: '12px',
  },
  logo: { display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 },
  logoIcon: { fontSize: '16px' },
  logoText: { fontSize: TYPE.md, fontWeight: 700, letterSpacing: '-0.02em' },
  logoBadge: { fontSize: TYPE.xs, padding: '1px 5px', borderRadius: RADIUS.tight },
  main: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  fullView: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },
  sidebar: { width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRight: '1px solid', overflow: 'hidden' },
  canvas: { flex: 1, position: 'relative' as const, overflow: 'hidden', minWidth: 0, height: '100%' },
  inspector: { width: '252px', flexShrink: 0, borderLeft: '1px solid', overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  compactMain: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  compactPaneArea: { flex: 1, overflow: 'hidden', minHeight: 0 },
  loadingOverlay: { position: 'absolute' as const, inset: 0, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '12px' },
  // W13: had no `animation`, so it just sat there as a static ring —
  // @keyframes ec-spin already exists (styles/global.css) and SearchBar's
  // own spinner already uses it; this one just never did.
  spinner: { width: '28px', height: '28px', border: '2px solid', borderRadius: '50%', animation: 'ec-spin 0.8s linear infinite' },
  loadingText: { fontSize: TYPE.base },
} as const;
