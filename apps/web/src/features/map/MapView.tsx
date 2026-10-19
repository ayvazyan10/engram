import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { formatRelative } from '../../lib/dates.js';
import { TYPE_NAME } from '../memory/MemoryRow.js';
import { loadPolicy } from '../memory/MemorySheet.js';
import SearchBar from './SearchBar.js';
import MapSheet from './MapSheet.js';
import MapCanvas, { type MapCanvasHandle } from './MapCanvas.js';
import { toHash, useRouteStore } from '../../shell/routeStore.js';
import { LensBar, Legend, TimeScrubber, ZoomControls } from './MapControls.js';
import { loadFaults, loadMap, useMapStore } from './mapStore.js';
import { describeNode, faultLines, honesty, pickable, regionName, spanDays, type LensState } from './lenses.js';
import { step, type Direction } from './lib/hitTest.js';
import { placeLabels } from './lib/labels.js';
import { toLayoutPoint, visibleArea, type Rect, type View } from './lib/project.js';
import './map.css';

interface Props {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  onStore: () => void;
  onCommands: () => void;
}

// The orchestrator adds River and Pulse here after merging their view modules.
const VIEWS = [
  { id: 'sky', label: 'Sky', load: () => import('./views/SkyView.js') },
  { id: 'landscape', label: 'Landscape', load: () => import('./views/LandscapeView.js') },
].map((view) => ({ ...view, Component: lazy(view.load) }));

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
/** The server's default archive threshold, used until its policy arrives. */
const DEFAULT_THRESHOLD = 0.05;
/** Room kept clear of the legend along the bottom of a desktop map. */
const LEGEND_ROOM = 56;
const PHONE_ROOM = 52;
/** And of the Time scrubber above it. */
const PHONE_SCRUB_ROOM = 64;
const NO_AREA: Rect = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * Home: the map of every memory, placed by meaning, under the floating search
 * field and lens switch, with the side sheet as its list twin. Search drops
 * pins; a region label flies there; the keyboard walks from memory to memory
 * and a live region says where it is.
 */
export default function MapView({ onCommands, ...sheet }: Props) {
  const route = useRouteStore((s) => s.route);
  const active = VIEWS.find((view) => view.id === route.params.view);
  const isMap = !active;
  const changeView = (id: string) => {
    const params = { ...route.params };
    if (id === 'map') delete params.view;
    else params.view = id;
    useRouteStore.getState().navigate(toHash({ ...route, params }));
  };
  const { status, error, model, payload, lens, cutDays, regionId, focusId, hoverId, names, arrivals, faults, faultError } = useMapStore();
  const { setLens, setCut, setRegion, setFocus, setHover } = useMapStore.getState();
  const { searchQuery, searchResults, weakerResults, projectFilter, hiddenIds } = useMemoryStore();
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery('(max-width: 720px)');
  const timeLens = lens === 'time';
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [area, setArea] = useState<Rect>(NO_AREA);
  const [tip, setTip] = useState<{ id: string; at: [number, number] } | null>(null);
  const [said, say] = useState('');
  const [now] = useState(() => Date.now());
  const viewRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<MapCanvasHandle>(null);
  const lastView = useRef<View>({ k: 1, x: 0, y: 0 });
  const labelEls = useRef(new Map<string, HTMLButtonElement>());
  const labelSize = useRef(new Map<string, [number, number]>());

  // The archive threshold sets how faint a fading memory is drawn. Until the
  // policy arrives (or if it cannot), the server's default stands in.
  useEffect(() => {
    loadPolicy()
      .then((p) => setThreshold(p.archiveThreshold))
      .catch(() => setThreshold(DEFAULT_THRESHOLD));
  }, []);

  // The Faults lens loads its lines the first time it opens on this map.
  useEffect(() => {
    if (lens === 'faults' && faults === null && model) void loadFaults();
  }, [lens, faults, model]);

  // The usable map: the view less the sheet and the floating field.
  useLayoutEffect(() => {
    const view = viewRef.current!;
    const measure = () => {
      const box = view.getBoundingClientRect();
      const s = view.querySelector('.mp-sheet')?.getBoundingClientRect();
      const field = view.querySelector('.mp-field')?.getBoundingClientRect();
      const top = (field?.bottom ?? box.top) - box.top + 12;
      const sheetRect =
        s && s.width > 0 ? { left: s.left - box.left, top: s.top - box.top, right: s.right - box.left, bottom: s.bottom - box.top } : null;
      const next = visibleArea(box.width, box.height, sheetRect, top);
      // Keep clear of the legend (desktop) or the lens switch (phone) along the bottom.
      next.bottom = Math.max(next.top + 1, next.bottom - (phone ? PHONE_ROOM + (timeLens ? PHONE_SCRUB_ROOM : 0) : LEGEND_ROOM));
      view.style.setProperty('--mp-sheet-h', `${sheetRect && sheetRect.top > box.height / 3 ? box.height - sheetRect.top : 0}px`);
      setArea((prev) =>
        prev.left === next.left && prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom ? prev : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    const sheetEl = view.querySelector('.mp-sheet');
    if (sheetEl) observer.observe(sheetEl);
    const fieldEl = view.querySelector('.mp-field');
    if (fieldEl) observer.observe(fieldEl);
    return () => observer.disconnect();
  }, [phone, timeLens, isMap]);

  const hits = useMemo(
    () => (searchQuery ? new Set([...searchResults, ...weakerResults].map((r) => r.id)) : null),
    [searchQuery, searchResults, weakerResults]
  );
  const pins = useMemo(() => (hits && model ? [...hits].filter((id) => model.at.has(id)) : []), [hits, model]);
  const weak = useMemo(() => new Set(weakerResults.map((r) => r.id)), [weakerResults]);
  const lensState = useMemo<LensState>(
    () => ({ lens, cutDays, now, hits, regionId, hidden: hiddenIds }),
    [lens, cutDays, now, hits, regionId, hiddenIds]
  );
  const lines = useMemo(
    () => (lens === 'faults' && model && faults ? faultLines(faults, model.at, model.nodes, selectedId, regionId) : null),
    [lens, model, faults, selectedId, regionId]
  );
  const regionById = useMemo(() => new Map(model?.regions.map((r) => [r.id, r]) ?? []), [model]);
  const nameOf = useCallback(
    (id: string | null | undefined) => {
      const r = id ? regionById.get(id) : undefined;
      return r ? regionName(r, names) : null;
    },
    [regionById, names]
  );

  // Labels are measured once per name, then only moved.
  useLayoutEffect(() => {
    labelEls.current.forEach((el, id) => labelSize.current.set(id, [el.offsetWidth, el.offsetHeight]));
  }, [model, names, phone]);

  const onFrame = useCallback(
    (view: View) => {
      lastView.current = view;
      if (!model) return;
      const boxes = model.regions.map((r) => {
        const [lx, ly] = model.anchors.get(r.id)!;
        const [w, h] = labelSize.current.get(r.id) ?? [120, 34];
        return { id: r.id, x: lx * view.k + view.x, y: ly * view.k + view.y, w, h };
      });
      const spots = placeLabels(boxes, area);
      labelEls.current.forEach((el, id) => {
        const at = spots.get(id);
        el.style.visibility = at ? '' : 'hidden';
        if (at) el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
      });
    },
    [model, area]
  );

  // A memory that arrives while the map is open is said as well as shown.
  const heard = useRef(0);
  useEffect(() => {
    const ids = [...arrivals.keys()].slice(heard.current);
    heard.current = arrivals.size;
    const last = ids.length > 0 && model ? model.nodes[model.at.get(ids[ids.length - 1]!) ?? -1] : undefined;
    if (!last) return;
    say(ids.length === 1 ? `New memory on the map. ${describeNode(last, nameOf(last.regionId))}` : `${ids.length} new memories on the map.`);
  }, [arrivals, model, nameOf]);

  // A memory opened from the list (or a link) is brought into view.
  useEffect(() => {
    const i = selectedId && model ? model.at.get(selectedId) : undefined;
    if (i !== undefined) canvas.current?.reveal(i);
  }, [selectedId, model]);

  const openRegion = useCallback(
    (id: string | null) => {
      setRegion(id);
      if (id) canvas.current?.showRegion(id);
      else canvas.current?.fit();
    },
    [setRegion]
  );

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!model || event.altKey || event.ctrlKey || event.metaKey) return;
    const dir = ARROWS[event.key];
    if (dir) {
      event.preventDefault();
      const shown = (i: number) => pickable(model.created[i]!, lensState);
      const from = focusId ? (model.at.get(focusId) ?? -1) : -1;
      let next: number;
      if (from !== -1) next = step(model.index, model.xs, model.ys, from, dir, shown);
      else {
        // The first step lands on the open memory, or on the one nearest the middle.
        const [lx, ly] = toLayoutPoint(lastView.current, (area.left + area.right) / 2, (area.top + area.bottom) / 2);
        next = selectedId && model.at.has(selectedId) ? model.at.get(selectedId)! : model.index.find(lx, ly);
      }
      if (next === -1) {
        say('No memory further that way.');
        return;
      }
      const node = model.nodes[next]!;
      setFocus(node.id);
      canvas.current?.reveal(next);
      say(describeNode(node, nameOf(node.regionId)));
    } else if ((event.key === 'Enter' || event.key === ' ') && focusId) {
      event.preventDefault();
      selectNeuron(focusId);
    } else if (event.key === '+' || event.key === '=') {
      canvas.current?.zoomBy(1.5);
    } else if (event.key === '-' || event.key === '_') {
      canvas.current?.zoomBy(1 / 1.5);
    } else if (event.key === '0') {
      canvas.current?.fit();
    } else if ((event.key === 'r' || event.key === 'R') && model.regions.length > 0) {
      const at = model.regions.findIndex((r) => r.id === regionId);
      const n = (at + 1) % model.regions.length;
      const next = model.regions[n]!;
      openRegion(next.id);
      say(`${regionName(next, names)}, ${next.count.toLocaleString('en-US')} memories. Region ${n + 1} of ${model.regions.length}.`);
    } else if (event.key === 'Escape' && regionId) {
      event.preventDefault();
      openRegion(null);
      say('All regions.');
    }
  };

  const tipNode = tip && model ? model.nodes[model.at.get(tip.id) ?? -1] : undefined;
  const count = model?.nodes.length ?? 0;
  const ready = status === 'ready' && model !== null && count > 0;
  const faultNote =
    lens !== 'faults'
      ? null
      : faultError
        ? `Could not load the fault lines: ${faultError}`
        : lines === null
          ? 'Loading the fault lines…'
          : `${lines.length.toLocaleString('en-US')} fault ${lines.length === 1 ? 'line' : 'lines'} ${
              selectedId && model?.at.has(selectedId) ? 'touch the open memory' : regionId ? 'touch this region' : 'on the map'
            }. Each joins two memories that contradict each other.`;

  return (
    <div ref={viewRef} className="mp-view" data-lens={lens} data-view={active?.id ?? 'map'}>
      <h1 className="at-sr">Memory map</h1>
      <div className="mp-view-switch mp-lens" role="group" aria-label="View">
        <button type="button" aria-pressed={isMap} onClick={() => changeView('map')}>Map</button>
        {VIEWS.map((view) => <button key={view.id} type="button" aria-pressed={active === view} onClick={() => changeView(view.id)}>{view.label}</button>)}
      </div>
      {active && payload ? (
        <div className="mp-alternate"><Suspense fallback={<p className="mp-view-loading">Loading…</p>}><active.Component payload={payload} /></Suspense></div>
      ) : ready ? (
        <div
          className="mp-map"
          role="application"
          aria-roledescription="map"
          aria-label={`Memory map, ${count.toLocaleString('en-US')} memories in ${model.regions.length} regions`}
          aria-describedby="mp-keys"
          tabIndex={0}
          onKeyDown={onKey}
        >
          <MapCanvas
            ref={canvas}
            model={model}
            area={area}
            lens={lensState}
            threshold={threshold}
            selectedId={selectedId}
            focusId={focusId}
            hoverId={hoverId}
            faults={lines}
            pins={pins}
            weak={weak}
            arrivals={arrivals}
            reduced={reduced}
            onHover={(id, at) => {
              setHover(id);
              setTip(id && at ? { id, at } : null);
            }}
            onPick={(id) => {
              if (!id) return;
              setFocus(id);
              selectNeuron(id);
            }}
            onFrame={onFrame}
          />
          <div className="mp-labels">
            {model.regions.map((r) => (
              <button
                key={r.id}
                ref={(el) => {
                  if (el) labelEls.current.set(r.id, el);
                  else labelEls.current.delete(r.id);
                }}
                type="button"
                className="mp-lbl"
                data-big={r.count >= count / 8 || undefined}
                aria-pressed={regionId === r.id}
                tabIndex={-1}
                onClick={() => openRegion(regionId === r.id ? null : r.id)}
              >
                {regionName(r, names)}
                <small>{r.count.toLocaleString('en-US')} memories</small>
              </button>
            ))}
          </div>
          {tipNode && tip && (
            <div
              className="mp-tip"
              style={{ left: Math.max(8, Math.min(tip.at[0] + 14, area.right - 290)), top: tip.at[1] + 80 > area.bottom ? tip.at[1] - 80 : tip.at[1] + 16 }}
            >
              <b>{tipNode.label}</b>
              <span>
                {tipNode.isReflection ? `${TYPE_NAME[tipNode.type]} reflection` : TYPE_NAME[tipNode.type]}, {nameOf(tipNode.regionId)},{' '}
                {formatRelative(tipNode.createdAt)}
                {tipNode.protected ? ', protected' : ''}
                {tipNode.contradictCount > 0 ? `, ${tipNode.contradictCount} contradictions` : ''}
              </span>
            </div>
          )}
          <p id="mp-keys" className="at-sr">
            Arrow keys move between memories, Enter opens one, plus and minus zoom, 0 shows the whole map, R steps through the
            regions. The list beside the map holds the same memories.
          </p>
        </div>
      ) : (
        <Ground status={status} error={error} scoped={projectFilter !== undefined} onRetry={() => void loadMap(projectFilter)} />
      )}

      {isMap && <div className="mp-top">
        <SearchBar onCommands={onCommands} />
        {ready && <LensBar lens={lens} onLens={setLens} />}
      </div>}

      {isMap && ready && payload && (
        <>
          {lens === 'time' ? (
            <TimeScrubber created={model.created} now={now} span={spanDays(model.created, now)} cut={cutDays} onCut={setCut} />
          ) : (
            <Legend note={honesty(payload)} faults={faultNote} />
          )}
          <ZoomControls onZoom={(f) => canvas.current?.zoomBy(f)} onFit={() => canvas.current?.fit()} />
        </>
      )}

      <p className="at-sr" aria-live="polite">
        {said}
      </p>
      <MapSheet {...sheet} onRegion={openRegion} />
    </div>
  );
}

/** Before the map can be drawn: being charted, failed, or nothing to chart. */
function Ground({ status, error, scoped, onRetry }: { status: string; error: string | null; scoped: boolean; onRetry: () => void }) {
  return (
    <div className="mp-ground" role={status === 'error' ? 'alert' : undefined}>
      <svg viewBox="0 0 400 260" className="mp-contours" aria-hidden="true">
        <path d="M60 170c10-60 70-110 150-110s120 40 112 92-62 88-140 88S50 220 60 170z" />
        <path d="M104 166c6-38 46-70 100-70s82 26 76 60-42 58-94 58-88-18-82-48z" />
        <path d="M146 162c4-20 26-36 56-36s44 14 40 32-24 30-50 30-50-8-46-26z" />
      </svg>
      {status === 'error' ? (
        <>
          <p>Could not chart the map: {error}</p>
          <button type="button" className="at-btn sec" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : status === 'ready' ? (
        <p>{scoped ? 'Nothing charted in this project yet.' : 'Nothing charted yet.'} Every memory your AI stores becomes a place on this map.</p>
      ) : (
        <p aria-live="polite">
          {status === 'pending' ? 'The map is being charted. Until it is, every memory is in the list.' : 'Opening the map…'}
        </p>
      )}
    </div>
  );
}
