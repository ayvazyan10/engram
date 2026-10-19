import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Rail from './Rail.js';
import BottomNav from './BottomNav.js';
import ScopeSwitch from './ScopeSwitch.js';
import CommandPalette, { GO_KEYS } from './CommandPalette.js';
import Toasts, { showToast } from './Toasts.js';
import { useRouteStore, type Route } from './routeStore.js';
import StoreMemoryModal from '../components/ui/StoreMemoryModal.js';
import UnlockGate from '../components/ui/UnlockGate.js';
// The map is the landing view, so it is in the main chunk rather than split.
import MapView from '../features/map/MapView.js';
import { loadMap } from '../features/map/mapStore.js';
import RecallView from '../features/recall/RecallView.js';
import MemorySheet from '../features/memory/MemorySheet.js';
import Onboarding from '../components/views/Onboarding.js';
import SettingsView from '../features/settings/SettingsView.js';
import ReviewView from '../features/review/ReviewView.js';
import { useReviewCount } from '../features/review/queues.js';
import { useNeuralStore } from '../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../store/memoryStore.js';
import { useTemplateStore } from '../store/templateStore.js';
import { useAuthStore } from '../store/authStore.js';
import { api, ApiError } from '../lib/api.js';
import { refreshServerStats } from '../lib/serverStats.js';
import { useWebSocket, asMemoryRecord } from '../hooks/useWebSocket.js';
import { useThemeVars } from '../hooks/useThemeVars.js';
import './shell.css';

// recharts is the bulk of these three views' weight: fetched only when one opens.
const TimelineView = lazy(() => import('../components/views/TimelineView.js'));
const AnalyticsView = lazy(() => import('../components/views/AnalyticsView.js'));
const ReflectionView = lazy(() => import('../components/views/ReflectionView.js'));

/** The server's page cap for GET /memory (`limit` maximum 200). */
const PAGE_SIZE = 200;
const SEARCH_INPUT = 'input[aria-label="Search memories"]';
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

const TITLES: Record<Route['name'], string> = {
  map: 'Map',
  recall: 'Recall',
  review: 'Review',
  timeline: 'Timeline',
  insights: 'Insights',
  settings: 'Settings',
  welcome: 'Connect an AI',
};

/**
 * The Atlas shell: rail (desktop) or bottom nav (phone), the scope and command
 * bar, the routed screen, the palette, toasts, the store dialog and the unlock
 * gate. It also owns the loads every screen shares (the memory list, the
 * contradiction pairs, the map) so moving between routes refetches nothing.
 * The screens F4–F6 replace are mounted here unchanged.
 */
export default function Shell() {
  const setContradictionPairs = useNeuralStore((s) => s.setContradictionPairs);
  const { setRecords, appendRecords, storeChanges, projectFilter } = useMemoryStore();
  const route = useRouteStore((s) => s.route);
  const navigate = useRouteStore((s) => s.navigate);
  const reviewCount = useReviewCount();
  const t = useTemplateStore((s) => s.activeTemplate);
  const locked = useAuthStore((s) => s.locked);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useThemeVars(t);
  useWebSocket();

  // A 401 is the unlock gate's (lib/api.ts locks on every 401); anything else
  // is stated on the list so a failed load never looks like an empty store.
  const loadMemories = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.listMemories({ limit: PAGE_SIZE, namespace: projectFilter })
      .then((res) => {
        // A quick second pick must not be overwritten by the first's reply.
        if (useMemoryStore.getState().projectFilter === projectFilter) setRecords(parseMemories(res.memories));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setLoadError(err instanceof Error ? err.message : 'Could not reach Engram API');
      })
      .finally(() => setLoading(false));
  }, [setRecords, projectFilter]);

  // Fires again whenever the scope changes. The scope is global now: it is
  // kept across routes, and every screen that lists memories honours it.
  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  /** The next page, from the server's own limit/offset. Socket arrivals are
   *  the newest rows, so they already account for the shift they caused. */
  const loadMore = useCallback(() => {
    setLoadingMore(true);
    const { records, projectFilter: namespace } = useMemoryStore.getState();
    api.listMemories({ limit: PAGE_SIZE, offset: records.length, namespace })
      .then((res) => {
        if (useMemoryStore.getState().projectFilter === namespace) appendRecords(parseMemories(res.memories));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return;
        setLoadError(err instanceof Error ? err.message : 'Could not reach Engram API');
      })
      .finally(() => setLoadingMore(false));
  }, [appendRecords]);

  // A memory stored or archived changes the census: ask now, not at the next poll.
  useEffect(() => {
    if (storeChanges > 0) void refreshServerStats();
  }, [storeChanges]);

  // Whole-store fetches key on `storeChanges` (a socket arrival or an archive),
  // not on the loaded count, so paging and edits do not refetch them.
  const contradictionsFetchedForRef = useRef(-1);
  useEffect(() => {
    if (contradictionsFetchedForRef.current === storeChanges) return;
    contradictionsFetchedForRef.current = storeChanges;
    api.getContradictions()
      .then((res) => {
        setContradictionPairs(
          res.contradictions.map((c) => ({ sourceId: c.source.id, targetId: c.target.id, confidence: c.confidence }))
        );
      })
      .catch(() => {});
  }, [storeChanges, setContradictionPairs]);

  // The map, for the scope: again when a memory joins or leaves the store, so
  // an arrival lands on the map (the server places it by its neighbours).
  useEffect(() => {
    void loadMap(projectFilter);
  }, [projectFilter, storeChanges]);

  // `?m=<id>` and the selected memory are one value: a link opens the memory,
  // and selecting or closing one rewrites the link in place.
  const memoryParam = route.params.m ?? null;
  useEffect(() => {
    if (useNeuralStore.getState().selectedNeuronId !== memoryParam) useNeuralStore.getState().selectNeuron(memoryParam);
  }, [memoryParam]);
  useEffect(
    () =>
      useNeuralStore.subscribe((state, prev) => {
        if (state.selectedNeuronId !== prev.selectedNeuronId) useRouteStore.getState().setParam('m', state.selectedNeuronId);
      }),
    []
  );

  useEffect(() => {
    document.title = route.name === 'map' ? 'Engram' : `${TITLES[route.name]} — Engram`;
  }, [route.name]);

  // An empty store opens on the steps to connect an AI, once per visit; the
  // map stays reachable from the rail.
  const welcomed = useRef(false);
  useEffect(() => {
    const empty = !loading && !loadError && projectFilter === undefined && useMemoryStore.getState().records.length === 0;
    if (!empty || welcomed.current || useRouteStore.getState().route.name !== 'map') return;
    welcomed.current = true;
    navigate('/welcome');
  }, [loading, loadError, projectFilter, navigate]);

  /** `/` and the palette's Search: the field is on the map. */
  const focusSearch = useCallback(() => {
    if (useRouteStore.getState().route.name !== 'map') flushSync(() => navigate('/'));
    const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT);
    input?.focus();
    input?.select();
  }, [navigate]);

  /**
   * The keyboard, owned in one place. Escape clears the selected memory unless
   * something nearer already handled it (a dialog, the scope list, a field).
   * ⌘K / Ctrl+K opens the palette from anywhere; `/` and `g` then a letter
   * work when no field has focus.
   */
  const pendingGo = useRef(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || showStoreModal || locked) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      );
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing || paletteOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        useNeuralStore.getState().selectNeuron(null);
      } else if (event.key === '/') {
        event.preventDefault();
        focusSearch();
      } else if (Date.now() - pendingGo.current < 1200 && GO_KEYS[event.key]) {
        pendingGo.current = 0;
        navigate(GO_KEYS[event.key]!);
      } else {
        pendingGo.current = event.key === 'g' ? Date.now() : 0;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [showStoreModal, locked, paletteOpen, focusSearch, navigate]);

  const openStore = useCallback(() => setShowStoreModal(true), []);
  const viewProps = { loading, error: loadError, onRetry: loadMemories };

  return (
    <div className="at-shell">
      <Rail reviewCount={reviewCount} />

      <div className="at-stage">
        {/* The map carries its scope and commands in its own search field. */}
        {route.name !== 'map' && (
        <header className="at-bar" data-route={route.name}>
          {/* A phone has no rail to say where you are; the place name does. */}
          <span className="at-where" aria-hidden="true">
            {TITLES[route.name]}
          </span>
          {route.name === 'insights' ? (
            <>
              <ScopeSwitch fixedNote="Insights count every project." />
              <nav className="at-tabs" aria-label="Insights">
                <a href="#/insights" aria-current={route.sub !== 'reflections' ? 'page' : undefined}>Numbers</a>
                <a href="#/insights/reflections" aria-current={route.sub === 'reflections' ? 'page' : undefined}>Reflections</a>
              </nav>
            </>
          ) : (
            route.name !== 'settings' && route.name !== 'welcome' && <ScopeSwitch />
          )}
          <button type="button" className="at-cmd" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Control+K Meta+K">
            <span className="at-cmd-keys" aria-hidden="true">
              <kbd>{MOD_KEY}</kbd>
              <kbd>K</kbd>
            </span>
            <span>Commands</span>
          </button>
        </header>
        )}

        <main className="at-main" aria-label={TITLES[route.name]}>
          {route.name === 'map' ? (
            <MapView
              {...viewProps}
              onLoadMore={loadMore}
              loadingMore={loadingMore}
              onStore={openStore}
              onCommands={() => setPaletteOpen(true)}
            />
          ) : route.name === 'recall' ? (
            <RecallView onStore={openStore} />
          ) : route.name === 'welcome' ? (
            <div className="at-scroll">
              <Onboarding onRefresh={loadMemories} onDone={() => navigate('/')} />
            </div>
          ) : route.name === 'settings' ? (
            <div className="at-scroll">
              <SettingsView />
            </div>
          ) : route.name === 'review' ? (
            <ReviewView />
          ) : (
            <Suspense fallback={<p className="at-wait">Loading…</p>}>
              {route.name === 'timeline' && <TimelineView {...viewProps} />}
              {route.name === 'insights' && route.sub === 'reflections' && <ReflectionView {...viewProps} />}
              {route.name === 'insights' && route.sub !== 'reflections' && <AnalyticsView {...viewProps} />}
            </Suspense>
          )}
        </main>
      </div>

      <BottomNav reviewCount={reviewCount} onCommands={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSearch={focusSearch} onStore={openStore} />
      <MemorySheet />
      <Toasts />

      {showStoreModal && (
        <StoreMemoryModal
          onClose={() => setShowStoreModal(false)}
          onStored={(record) => {
            setShowStoreModal(false);
            useMemoryStore.getState().addRecord(record);
            showToast('Memory stored');
          }}
        />
      )}

      {locked && <UnlockGate />}
    </div>
  );
}

/** Rows that lack a field the views read (id, content, type) are dropped
 *  rather than allowed to crash a whole screen. */
function parseMemories(rows: unknown[]): MemoryRecord[] {
  return rows.map(asMemoryRecord).filter((r): r is MemoryRecord => r !== null);
}
