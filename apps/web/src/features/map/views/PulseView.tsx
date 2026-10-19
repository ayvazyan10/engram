import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { arc } from 'd3-shape';
import { api, type MapPayload, type RecallExplanation } from '../../../lib/api.js';
import { useMemoryStore } from '../../../store/memoryStore.js';
import { useNeuralStore } from '../../../store/neuralStore.js';
import { useMediaQuery } from '../../../hooks/useMediaQuery.js';
import { typeColor, useFlowEdges, usePulseClock } from './flow.js';
import { clamp, dotFrame, END_MS, pulseLayout, rimPath, smooth, START_MS, THREAD_MS, WAVE_MS } from './pulse.js';
import './flow.css';

type Answer = { status: 'idle' | 'loading' } | { status: 'done'; data: RecallExplanation } | { status: 'error'; message: string };
const EMPTY: RecallExplanation = { items: [], candidates: 0, context: '', latencyMs: 0, budget: { maxTokens: 2000, usedTokens: 0 } };

export default function PulseView({ payload }: { payload: MapPayload }) {
  const projectFilter = useMemoryStore((s) => s.projectFilter);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { edges, note } = useFlowEdges(payload);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer>({ status: 'idle' });
  const [replay, setReplay] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [size, setSize] = useState(640);
  const radial = useRef<HTMLDivElement>(null);
  const prefix = useId().replace(/:/g, '');
  useEffect(() => {
    setHover(null); setFocus(null);
    if (!query.trim() || !payload.nodes.length) { setAnswer({ status: 'idle' }); return; }
    let cancelled = false;
    setAnswer({ status: 'loading' });
    api.explainRecall(query, 2000, projectFilter).then((data) => {
      if (!cancelled) setAnswer({ status: 'done', data });
    }).catch((error: unknown) => {
      if (!cancelled) setAnswer({ status: 'error', message: error instanceof Error ? error.message : 'Recall failed' });
    });
    return () => { cancelled = true; };
  }, [query, attempt, projectFilter, payload.nodes.length]);
  useEffect(() => {
    const el = radial.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth) setSize(Math.min(el.clientWidth, Math.max(340, window.innerHeight - 236), 820)); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [payload.nodes.length]);
  const data = answer.status === 'done' ? answer.data : null;
  const model = useMemo(() => pulseLayout(data ?? EMPTY, payload, edges, size), [data, payload, edges, size]);
  const clockKey = useMemo(() => data ? { data, replay } : null, [data, replay]);
  const elapsed = usePulseClock(clockKey, reduced, END_MS);
  const activeId = hover ?? focus;
  const active = model.items.find((item) => item.id === activeId);
  const linked = new Set(active ? [active.id, active.puller, ...model.items.filter((i) => i.puller === active.id).map((i) => i.id)] : []);
  const open = (id: string) => useNeuralStore.getState().selectNeuron(id);
  const ask = (text: string) => { const next = text.trim(); if (!next) return; setInput(next); setQuery(next); setAttempt((n) => n + 1); };
  const included = model.items.filter((item) => item.included);
  const arrived = included.filter((item) => elapsed >= item.time + 60);
  const allArrived = arrived.length === included.length;
  const used = data && allArrived ? data.budget.usedTokens : Math.ceil(arrived.reduce((sum, item) => sum + item.budgetTokens, 0));
  const budget = data?.budget.maxTokens ?? 2000;
  const vectorCount = model.items.filter((item) => item.via === 'vector').length;
  const wave = clamp((elapsed - START_MS) / WAVE_MS);
  const waveRadius = model.center + (model.outer + 12 - model.center) * wave;
  const waveAlpha = 1 - clamp((elapsed - START_MS - WAVE_MS) / 400) ** 3;
  if (!payload.nodes.length) return <p className="flow-empty">No memories to recall yet.</p>;
  return <section className="flow-view" aria-label="Recall pulse">
    <header className="flow-head">
      <h1>Recall pulse</h1>
      <p>Each candidate sits on a ring by rank. A pulse walks outward, adding memories to the context within the token budget.</p>
      <form className="flow-search" role="search" onSubmit={(event) => { event.preventDefault(); ask(input); }}>
        <input aria-label="Question for recall" placeholder="What might your AI be asked?" value={input} onChange={(event) => setInput(event.target.value)} autoComplete="off" />
        <button type="submit" disabled={!input.trim()}>Ask</button>
        <button type="button" disabled={!data} onClick={() => { setHover(null); setFocus(null); setReplay((n) => n + 1); }}>Replay</button>
      </form>
      {answer.status === 'idle' && <><p className="flow-note">Ask a question to see which memories your AI would receive.</p>
        <div className="flow-tools" aria-label="Suggested questions">{[...payload.regions].sort((a, b) => b.count - a.count).slice(0, 3).map((region) => <button type="button" key={region.id} onClick={() => ask(region.name)}>{region.name}</button>)}</div></>}
      <ul className="flow-legend" aria-label="Pulse legend">
        <li>● vector match</li><li>○ graph expansion</li><li>⌒ pulled in by (inferred link)</li><li>◌ dashed = graph, source unknown</li><li>dot size = tokens</li>
        <li className="flow-sem">● semantic</li><li className="flow-epi">● episodic</li><li className="flow-pro">● procedural</li>
      </ul>
    </header>
    {note && <p className="flow-note" role="status">{note}</p>}
    {answer.status === 'loading' && <p role="status">Finding the memories your AI would receive…</p>}
    {answer.status === 'error' && <div role="alert"><p>Recall failed: {answer.message}</p><button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>}
    <div className="flow-pulse-grid">
      <div className="flow-radial" ref={radial}>
        <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-label="Candidates by rank and region" onClick={() => setFocus(null)}>
          <defs>
            <filter id={`${prefix}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation={model.narrow ? 2.5 : 4} /></filter>
            <radialGradient id={`${prefix}-wave`}><stop offset="70%" stopColor="var(--sem)" stopOpacity={0} /><stop offset="97%" stopColor="var(--sem)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--sem)" stopOpacity={0} /></radialGradient>
            {model.sectors.map((sector, i) => <path key={sector.id} id={`${prefix}-rim${i}`} d={rimPath(sector.start, sector.end, model.outer + (model.narrow ? 13 : 20)).path} />)}
          </defs>
          {model.sectors.map((sector, i) => <path key={sector.id} d={arc()({ innerRadius: model.center + 6, outerRadius: model.outer + 8, startAngle: sector.start + Math.PI / 2, endAngle: sector.end + Math.PI / 2 }) ?? ''} fill={i % 2 ? 'var(--wash)' : 'var(--wash-2)'} />)}
          {[1, 5, 10, 25, 50, 100, 200].filter((rank) => rank <= model.items.length).map((rank) => <g key={rank}>
            <circle r={model.radius(rank)} fill="none" stroke="var(--contour)" strokeOpacity={0.55} strokeDasharray="1 4" />
            <text x={3} y={-model.radius(rank) - 3} fontSize={10} fill="var(--ink-3)">#{rank}</text>
          </g>)}
          {model.budgetRadius !== null && <g><circle r={model.budgetRadius} fill="none" stroke="var(--fault)" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
            {!model.narrow && <text transform={`rotate(28) translate(0,${-model.budgetRadius - 5})`} textAnchor="middle" fontSize={10.5} fill="var(--fault-text)">last included rank</text>}</g>}
          {model.sectors.map((sector, i) => {
            const rim = rimPath(sector.start, sector.end, model.outer + (model.narrow ? 13 : 20));
            const max = Math.floor((sector.end - sector.start) * (model.outer + 13) / ((model.narrow ? 10 : 11.5) * 0.56));
            return max < 4 ? null : <text key={sector.id} fontSize={model.narrow ? 10 : 11.5} fontWeight={560} fill="var(--ink-2)" dy={rim.lower ? '0.75em' : 0}>
              <textPath href={`#${prefix}-rim${i}`} startOffset="50%" textAnchor="middle">{sector.name.length > max ? `${sector.name.slice(0, max - 1)}…` : sector.name}</textPath>
            </text>;
          })}
          {data && !reduced && elapsed >= START_MS && elapsed < START_MS + WAVE_MS + 400 && <g pointerEvents="none" opacity={waveAlpha}>
            <circle r={model.center} transform={`scale(${waveRadius / model.center})`} fill={`url(#${prefix}-wave)`} />
            <circle r={model.center} transform={`scale(${waveRadius / model.center})`} fill="none" stroke="var(--sem)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          </g>}
          {model.items.map((item) => {
            const puller = model.items.find((p) => p.id === item.puller);
            if (!puller) return null;
            return <path key={item.id} d={`M${puller.x},${puller.y}Q${(puller.x + item.x) * 0.225},${(puller.y + item.y) * 0.225} ${item.x},${item.y}`} fill="none" stroke={item.included ? typeColor(item.type) : 'var(--ink-3)'} strokeWidth={item.included ? 1.3 : 0.8}
              opacity={active && !linked.has(item.id) ? 0.06 : item.included ? 0.75 : 0.35} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - smooth((elapsed - item.time + THREAD_MS) / THREAD_MS)} />;
          })}
          {model.items.map((item) => {
            const frame = dotFrame(item, elapsed);
            const color = frame.fault ? 'var(--fault)' : frame.active && item.included ? typeColor(item.type) : 'var(--ink-3)';
            const x = item.x + Math.cos(item.angle) * frame.outward, y = item.y + Math.sin(item.angle) * frame.outward;
            const alpha = active && !linked.has(item.id) ? 0.12 : frame.alpha;
            return <g key={item.id} data-memory={item.id}>
              {item.included && frame.active && <circle cx={item.x} cy={item.y} r={item.size * 2} fill={typeColor(item.type)} filter={`url(#${prefix}-glow)`} opacity={alpha * (0.45 + 0.45 * (1 - smooth((elapsed - item.time) / 1160)))} />}
              <g role="button" tabIndex={0} aria-label={`Inspect rank ${item.rank}: ${item.label}`} aria-pressed={focus === item.id} className="flow-dot"
                onPointerEnter={() => setHover(item.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(item.id)} onBlur={() => setHover(null)}
                onClick={(event) => { event.stopPropagation(); setFocus((id) => id === item.id ? null : item.id); }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setFocus(item.id); } }}>
                <circle cx={x} cy={y} r={Math.max(11, item.size)} fill="transparent" />
                <circle transform={`translate(${x},${y}) scale(${frame.scale})`} r={item.size} fill={item.via === 'vector' ? color : 'var(--paper)'} stroke={color} strokeWidth={item.via === 'vector' ? 0 : 1.7} strokeDasharray={item.via === 'graph' && !item.puller ? '2 1.6' : undefined} opacity={alpha} />
                {activeId === item.id && <circle cx={x} cy={y} r={item.size + 4} stroke="var(--ink)" fill="none" />}
              </g>
            </g>;
          })}
          <g pointerEvents="none"><circle r={model.center} fill="var(--raised)" stroke="var(--sem)" strokeWidth={1.5} />
            <foreignObject x={-model.center + 5} y={-model.center * 0.7} width={model.center * 2 - 10} height={model.center * 1.4}>
              <div className="flow-query" title={query || 'Your question'}><strong>{query ? `“${query}”` : 'Your question'}</strong><small>{data ? `${data.candidates} candidates · ${data.latencyMs} ms` : 'Start a recall'}</small></div>
            </foreignObject>
          </g>
        </svg>
        {active && <div className="flow-pulse-tip" role="tooltip" onPointerEnter={() => setHover(active.id)} onPointerLeave={() => setHover(null)}>
          <strong>{active.label}</strong><span>{payload.regions.find((r) => r.id === active.regionId)?.name ?? 'Not on the map'} · {active.type}</span>
          <span>Rank {active.rank} · score {active.score.toFixed(3)} · similarity {active.similarity.toFixed(3)}</span>
          <span>{active.tokens} tokens · {active.via === 'vector' ? 'vector match' : active.puller ? `graph expansion, inferred link from “${model.items.find((p) => p.id === active.puller)?.label}”` : 'graph expansion, source unknown'}</span>
          <span className={active.included ? 'flow-pro' : 'flow-fault'}>{active.why}</span>
          <button type="button" onClick={() => open(active.id)}>Open</button>
        </div>}
      </div>
      <aside className="flow-context">
        <h2>Context the AI receives</h2>
        <p className="flow-count">{used.toLocaleString('en-US')} <small>/ {budget.toLocaleString('en-US')} tokens</small></p>
        <p className="flow-note">{included.length} of {model.items.length} candidates fit · {vectorCount} vector matches, {model.items.length - vectorCount} via the memory graph · final context order shown as #</p>
        <div className="flow-track" role="meter" aria-label="Context token budget" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(used, budget)} aria-valuetext={`${used} of ${budget} tokens`}>
          {included.map((item) => <span key={item.id} style={{ left: `${item.offset / budget * 100}%`, width: `${item.budgetTokens / budget * 100}%`, background: typeColor(item.type), transform: `scaleX(${1 - (1 - clamp((elapsed - item.time - 60) / 420)) ** 3})` }} />)}
        </div>
        {data && data.budget.usedTokens > budget && <p className="flow-note">The top memory is always included, even when it exceeds the budget.</p>}
        {data && !included.length && <p>No memories to hand back for “{query}”.</p>}
        <ol className="flow-context-list" aria-label="Memories in the context">
          {included.map((item) => <li key={item.id} style={{ opacity: smooth((elapsed - item.time - 60) / 260), transform: `translateY(${8 * (1 - smooth((elapsed - item.time - 60) / 260))}px)`, visibility: elapsed < item.time + 60 ? 'hidden' : 'visible' }}>
            <button type="button" data-active={linked.has(item.id)} onClick={() => open(item.id)} onPointerEnter={() => setHover(item.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(item.id)} onBlur={() => setHover(null)}>
              <i style={{ background: item.via === 'vector' ? typeColor(item.type) : 'transparent', borderColor: typeColor(item.type) }} />
              <span>#{item.position} {item.label}</span><small>{item.tokens}</small>
            </button>
          </li>)}
        </ol>
        {!!model.items.some((item) => !item.included) && <details className="flow-excluded"><summary>Why candidates were left out</summary>
          {model.items.filter((item) => !item.included).map((item) => <button type="button" key={item.id} onClick={() => open(item.id)} onPointerEnter={() => setHover(item.id)} onPointerLeave={() => setHover(null)}><strong>Rank {item.rank}: {item.label}</strong><span>{item.why}</span></button>)}
        </details>}
        <p className="flow-note">The dashed budget ring marks the last included rank. Graph threads are inferred from earlier linked candidates, preferring vector matches; they are not a retrieval trace.</p>
      </aside>
    </div>
  </section>;
}
