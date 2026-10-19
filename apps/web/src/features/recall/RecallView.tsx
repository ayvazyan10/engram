import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouteStore } from '../../shell/routeStore.js';
import { Icon } from '../../shell/icons.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { api, type RecallExplanation } from '../../lib/api.js';
import MapCanvas, { type MapCanvasHandle } from '../map/MapCanvas.js';
import { loadMap, useMapStore } from '../map/mapStore.js';
import type { LensState } from '../map/lenses.js';
import type { Rect } from '../map/lib/project.js';
import { contextSpans, memorySpan, routeLayout } from './routeLayout.js';
import '../map/map.css';
import './recall.css';

type Answer =
  | { status: 'idle' | 'loading' }
  | { status: 'done'; data: RecallExplanation }
  | { status: 'error'; message: string };
const NO_PINS: string[] = [];
const NO_WEAK = new Set<string>();
const NO_ARRIVALS = new Map<string, number>();
const NO_ITEMS: RecallExplanation['items'] = [];

export default function RecallView({ onStore }: { onStore: () => void }) {
  const query = useRouteStore((s) => s.route.params.q ?? '');
  const setParam = useRouteStore((s) => s.setParam);
  const { records, projectFilter } = useMemoryStore();
  const { model, status: mapStatus, error: mapError, hoverId, focusId, setHover, setFocus } = useMapStore();
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [input, setInput] = useState(query);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer>({ status: 'idle' });
  const [tab, setTab] = useState<'route' | 'exact'>('route');
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [area, setArea] = useState<Rect>({ left: 0, top: 0, right: 0, bottom: 0 });
  const mapBox = useRef<HTMLDivElement>(null);
  const canvas = useRef<MapCanvasHandle>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setInput(query), [query]);
  useEffect(() => {
    setCopied('idle');
    setHover(null);
    setFocus(null);
    if (!query.trim()) {
      setAnswer({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setAnswer({ status: 'loading' });
    api.explainRecall(query, maxTokens, projectFilter)
      .then((data) => { if (!cancelled) setAnswer({ status: 'done', data }); })
      .catch((err: unknown) => {
        if (!cancelled) setAnswer({ status: 'error', message: err instanceof Error ? err.message : 'Recall failed' });
      });
    return () => { cancelled = true; };
  }, [query, maxTokens, projectFilter, attempt, setHover, setFocus]);

  useEffect(() => () => { setHover(null); setFocus(null); }, [setHover, setFocus]);

  useLayoutEffect(() => {
    const el = mapBox.current!;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setArea({ left: 24, top: 64, right: Math.max(25, box.width - 24), bottom: Math.max(65, box.height - 64) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const data = answer.status === 'done' ? answer.data : null;
  const items = useMemo(() => [...(data?.items ?? NO_ITEMS)].sort((a, b) => a.rank - b.rank), [data]);
  const included = useMemo(() => items.filter((item) => item.included), [items]);
  const stops = useMemo(() => routeLayout(items, model), [items, model]);
  const spans = useMemo(() => data ? contextSpans(data) : [], [data]);
  const lens = useMemo<LensState>(() => ({ lens: 'meaning', cutDays: 0, now: 0,
    hits: new Set(included.map((item) => item.id)), regionId: null }), [included]);
  const activeId = hoverId ?? focusId;
  const excerpts = useMemo(() => new Map(items.map((item) => {
    const span = data ? memorySpan(data.context, item) : null;
    const record = records.find((r) => r.id === item.id);
    const index = model?.at.get(item.id);
    const text = span && data ? data.context.slice(span.textStart, span.end)
      : record?.summary ?? record?.content ?? (index === undefined ? null : model?.nodes[index]?.label);
    return [item.id, text || `Memory ${item.id}`];
  })), [data, items, records, model]);

  useEffect(() => {
    const index = focusId ? model?.at.get(focusId) : undefined;
    if (index !== undefined) canvas.current?.reveal(index);
    if (focusId) {
      const el = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-memory]') ?? [])
        .find((node) => node.dataset.memory === focusId);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusId, model, tab]);

  const open = (id: string) => {
    selectNeuron(id);
    setParam('m', id);
  };
  const copy = async () => {
    if (!data?.context) return;
    try {
      await navigator.clipboard.writeText(data.context);
      setCopied('copied');
    } catch {
      setCopied('failed');
      setTab('exact');
    }
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (target.closest('.rc-map') && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') canvas.current?.fit();
      else canvas.current?.zoomBy(event.key === '-' ? 1 / 1.5 : 1.5);
    } else if (event.key === 'c') {
      event.preventDefault();
      void copy();
    } else if ((event.key === 'j' || event.key === 'k') && included.length) {
      event.preventDefault();
      const current = included.findIndex((item) => item.id === focusId);
      const next = current === -1 ? (event.key === 'j' ? 0 : included.length - 1)
        : (current + (event.key === 'j' ? 1 : -1) + included.length) % included.length;
      setHover(null);
      setFocus(included[next]!.id);
      // Keep native Enter on controls; stepping gives the panel keyboard focus.
      panel.current?.focus({ preventScroll: true });
    } else if (event.key === 'Enter' && focusId && !target.closest('button')) {
      event.preventDefault();
      open(focusId);
    }
  };

  // The server rounds the total once, so segment widths use chars, not rounded item tokens.
  const totalChars = included.reduce((sum, item) => sum + item.chars, 0);
  const used = data?.budget.usedTokens ?? 0;
  const budget = data?.budget.maxTokens ?? maxTokens;

  return (
    <div className="rc-view" onKeyDown={onKey}>
      <div className="rc-map" ref={mapBox} role="region" aria-label="Recall route on the memory map" tabIndex={0} aria-describedby="rc-keys">
        {model && model.nodes.length > 0 ? (
          <MapCanvas ref={canvas} model={model} area={area} lens={lens} threshold={0.05}
            selectedId={selectedId} focusId={focusId} hoverId={hoverId} faults={null}
            pins={NO_PINS} weak={NO_WEAK} arrivals={NO_ARRIVALS} route={stops} reduced={reduced}
            onHover={(id) => setHover(id)} onPick={(id) => { if (id) open(id); }} onFrame={() => {}} />
        ) : (
          <div className="rc-map-state" role={mapStatus === 'error' ? 'alert' : 'status'}>
            <p>{mapStatus === 'error' ? `Could not chart the map: ${mapError}`
              : mapStatus === 'ready' ? 'No memories charted yet.' : 'The map is being charted…'}</p>
            {mapStatus === 'error' && <button className="at-btn sec" onClick={() => void loadMap(projectFilter)}>Retry map</button>}
          </div>
        )}
        <div className="rc-map-title"><Icon name="route" size={20} /><span>The route your AI walks</span></div>
        <div className="rc-map-note">
          <span>Stops follow rank order. Dashed lines arrive at graph-expanded memories.</span>
          <button className="at-btn sec" onClick={() => canvas.current?.fit()}>Fit map</button>
        </div>
      </div>

      <section className="rc-sheet" aria-labelledby="rc-title">
        <header className="rc-head">
          <h1 id="rc-title">What my AI would be told</h1>
          <p className="rc-muted">The memories Engram would hand your AI, with the exact context beside their route.</p>
          <form className="rc-field" role="search" onSubmit={(event) => {
            event.preventDefault();
            const next = input.trim();
            if (next === query) setAttempt((n) => n + 1);
            else setParam('q', next || null);
          }}>
            <Icon name="route" size={18} />
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="What might your AI be asked?"
              aria-label="Question for recall" spellCheck={false} autoComplete="off" />
            <button type="submit" className="at-btn">Ask</button>
          </form>
          <label className="rc-budget-control">Token budget
            <select value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))}>
              {[500, 1000, 2000, 4000].map((n) => <option key={n} value={n}>{n.toLocaleString('en-US')}</option>)}
            </select>
          </label>
          {data && <>
            <div className="rc-budget" role="meter" aria-label="Context token budget" aria-valuemin={0}
              aria-valuemax={budget} aria-valuenow={Math.min(used, budget)} aria-valuetext={`${used} of ${budget} tokens`}>
              {included.map((item) => <span key={item.id} data-type={item.type} data-active={activeId === item.id}
                title={`Rank ${item.rank}: ${item.tokens} tokens`} onMouseEnter={() => setHover(item.id)} onMouseLeave={() => setHover(null)}
                style={{ width: `${totalChars ? item.chars / totalChars * Math.min(1, used / budget) * 100 : 0}%` }} />)}
            </div>
            <p className="rc-budget-label">{used.toLocaleString('en-US')} / {budget.toLocaleString('en-US')} tokens · {included.length} included · {data.candidates} candidates · {data.latencyMs} ms</p>
            {used > budget && <p className="rc-muted">The top memory is always included, even when it exceeds the budget.</p>}
          </>}
        </header>

        <div className="rc-toolbar">
          <div role="tablist" aria-label="Recall display">
            {(['route', 'exact'] as const).map((name) => <button key={name} type="button" role="tab" id={`rc-tab-${name}`}
              aria-controls="rc-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
              onClick={() => setTab(name)} onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'route' : event.key === 'End' ? 'exact' : tab === 'route' ? 'exact' : 'route';
                setTab(next);
                document.getElementById(`rc-tab-${next}`)?.focus();
              }}>{name === 'route' ? 'Route' : 'Exact'}</button>)}
          </div>
          <button type="button" className="at-btn sec" disabled={!data?.context} onClick={() => void copy()}>{copied === 'copied' ? 'Copied' : 'Copy'}</button>
        </div>
        {copied === 'failed' && <p role="alert" className="rc-copy-note">The browser blocked the clipboard. Select the exact text below and copy it.</p>}
        {copied === 'copied' && <span role="status" className="at-sr">Exact context copied.</span>}
        <div ref={panel} className="rc-body" role="tabpanel" id="rc-panel" aria-labelledby={`rc-tab-${tab}`} tabIndex={0}>
          {answer.status === 'idle' && <div className="rc-empty"><h2>Ask a question. Follow the context.</h2><p>Enter something your AI might be asked to see which memories it would receive.</p></div>}
          {answer.status === 'loading' && <p role="status">Finding the memories your AI would receive…</p>}
          {answer.status === 'error' && <div role="alert"><p>Recall failed: {answer.message}</p><button className="at-btn sec" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>}
          {data && included.length === 0 && <div className="rc-empty"><h2>No memories to hand back</h2><p>For “{query}” your AI would get no memories back.</p><button className="at-btn sec" onClick={onStore}>Store a memory</button></div>}
          {data && tab === 'route' && <>
            {included.length > stops.length && <p className="rc-muted">{included.length - stops.length} included memories have no position on this map. They are still in the context.</p>}
            <ol className="rc-list" aria-label="Memories in rank order">
              {items.map((item) => <li key={item.id} value={item.rank}>
                <button type="button" className="rc-row" data-memory={item.id} data-active={activeId === item.id}
                  data-included={item.included} aria-pressed={selectedId === item.id} onClick={() => open(item.id)}
                  onMouseEnter={() => setHover(item.id)} onMouseLeave={() => setHover(null)} onFocus={() => setFocus(item.id)}>
                  <span className="rc-rank">{item.rank}</span>
                  <span><span className="rc-excerpt">{excerpts.get(item.id)}</span>
                    <span className="rc-meta">{item.section} · {item.via} · {item.tokens} tokens · {item.included ? 'Included' : item.reason === 'over_budget' ? 'Over budget' : 'Not included'}</span>
                  </span>
                </button>
              </li>)}
            </ol>
          </>}
          {data && tab === 'exact' && <pre className="rc-exact" aria-label="Exact context">{spans.map((part, i) => part.id === null ? part.text : (
            <span key={i} data-memory={part.id} data-active={activeId === part.id} className="rc-span" role="button" tabIndex={0}
              aria-label={`Open memory ${part.id}`} onClick={() => {
                if (window.getSelection()?.isCollapsed !== false) open(part.id!);
              }} onFocus={() => setFocus(part.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(part.id!); } }}
              onMouseEnter={() => setHover(part.id)} onMouseLeave={() => setHover(null)}>{part.text}</span>
          ))}</pre>}
        </div>
        <p id="rc-keys" className="rc-keys">j / k step through included memories · Enter opens · c copies · + / − zoom the map · 0 fits</p>
        <p className="at-sr" aria-live="polite">{focusId ? excerpts.get(focusId)?.slice(0, 80) : ''}</p>
      </section>
    </div>
  );
}
