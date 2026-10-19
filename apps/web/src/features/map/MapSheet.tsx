import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useServerStats } from '../../lib/serverStats.js';
import { projectLabel } from '../../lib/projects.js';
import { formatRelative } from '../../lib/dates.js';
import { useScopeChoices } from '../../shell/ScopeSwitch.js';
import { Icon } from '../../shell/icons.js';
import { MemoryRow } from '../memory/MemoryRow.js';
import { useMapStore, type SheetPanel } from './mapStore.js';
import RegionsPanel from './RegionsPanel.js';
import './map.css';

/** A run of machine-written memories this long or longer folds into one line. */
const FOLD_MIN = 3;

export type SheetItem =
  | { kind: 'memory'; record: MemoryRecord }
  | { kind: 'stream'; key: string; title: string; detail: string; records: MemoryRecord[] };

type StreamKind = 'mission-control' | 'task-outcomes' | 'reflections';

/** Which machine stream wrote a memory, or null for anything else. */
export function streamOf(record: Pick<MemoryRecord, 'content' | 'source'>): StreamKind | null {
  if (record.source === 'mission-control' || record.content.startsWith('[Mission Control]')) return 'mission-control';
  if (record.source === 'autopilot-learning') return 'task-outcomes';
  if (record.source === 'reflection') return 'reflections';
  return null;
}

function counted(pairs: [number, string, string][]): string[] {
  return pairs.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
}

function countMatching(records: MemoryRecord[], test: (r: MemoryRecord) => boolean): number {
  return records.filter(test).length;
}

function hasTag(record: MemoryRecord, tag: string): boolean {
  return record.tags.includes(`"${tag}"`);
}

/** What a folded line says: how many of what, and over what time. */
function describe(kind: StreamKind, records: MemoryRecord[]): { title: string; detail: string } {
  const newest = formatRelative(records[0]!.createdAt);
  const oldest = formatRelative(records[records.length - 1]!.createdAt);
  const span = newest === oldest ? newest : `${oldest} to ${newest}`;
  const status = (word: string) => countMatching(records, (r) => new RegExp(`^\\[Mission Control\\]\\s+${word}\\b`).test(r.content));
  const parts =
    kind === 'mission-control'
      ? counted([
          [status('DONE'), 'done', 'done'],
          [status('BLOCKED'), 'blocked', 'blocked'],
          [status('REVIEW'), 'in review', 'in review'],
          [status('BACKLOG'), 'in backlog', 'in backlog'],
        ])
      : kind === 'reflections'
        ? counted([
            [countMatching(records, (r) => hasTag(r, 'reflection:pattern')), 'pattern', 'patterns'],
            [countMatching(records, (r) => hasTag(r, 'reflection:trend')), 'trend', 'trends'],
            [countMatching(records, (r) => hasTag(r, 'reflection:knowledge_gap')), 'knowledge gap', 'knowledge gaps'],
            [countMatching(records, (r) => hasTag(r, 'reflection:contradiction_summary')), 'contradiction', 'contradictions'],
          ])
        : counted([
            [countMatching(records, (r) => /Success:\s*True/i.test(r.content)), 'succeeded', 'succeeded'],
            [countMatching(records, (r) => /Success:\s*False/i.test(r.content)), 'failed', 'failed'],
          ]);
  const n = records.length;
  const title =
    kind === 'mission-control'
      ? `Mission Control reported ${n} tasks`
      : kind === 'reflections'
        ? `The reflection engine wrote ${n} reports`
        : `${n} task outcomes`;
  return { title, detail: [...parts, span].join(', ') };
}

/**
 * Recent memories with machine streams folded: a run of three or more
 * consecutive Mission Control reports, task outcomes or reflection reports
 * becomes one line that opens to show them. Shorter runs stay as they are.
 */
export function foldStreams(records: MemoryRecord[]): SheetItem[] {
  const items: SheetItem[] = [];
  let i = 0;
  while (i < records.length) {
    const kind = streamOf(records[i]!);
    let end = i + 1;
    while (kind && end < records.length && streamOf(records[end]!) === kind) end++;
    const run = records.slice(i, end);
    if (kind && run.length >= FOLD_MIN) {
      items.push({ kind: 'stream', key: `${kind}:${run[0]!.id}`, records: run, ...describe(kind, run) });
    } else {
      for (const record of run) items.push({ kind: 'memory', record });
    }
    i = end;
  }
  return items;
}

interface Props {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  onStore: () => void;
  /** Opens a region on the map (and here), or closes it with null. */
  onRegion: (id: string | null) => void;
}

const PANELS: { panel: SheetPanel; label: string }[] = [
  { panel: 'recent', label: 'Recent' },
  { panel: 'regions', label: 'Regions' },
];

/** Phone: the sheet rests at one of three heights (share of the space under the field). */
const SNAPS = [0.3, 0.46, 1] as const;

/**
 * The Map's side sheet (a draggable bottom sheet on a phone), the list twin
 * of the map. Recent: the newest memories, machine streams folded, loading
 * older ones on scroll. Regions: the map's places, each a button. Results:
 * what the search found (the pins on the map), then any weaker matches, and
 * always the way to ask what the AI would be told instead. Pointing at a row
 * rings its memory on the map, and pointing at a mark marks its row.
 */
export default function MapSheet({ loading, error, onRetry, onLoadMore, loadingMore, onStore, onRegion }: Props) {
  const { records, searchQuery, searchResults, weakerResults, isSearching, projectFilter, hiddenIds } = useMemoryStore();
  const openId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const panel = useMapStore((s) => s.panel);
  const regionCount = useMapStore((s) => s.model?.regions.length ?? 0);
  const hoverId = useMapStore((s) => s.hoverId);
  const setHover = useMapStore((s) => s.setHover);
  const setPanel = useMapStore((s) => s.setPanel);
  const stats = useServerStats();
  const choices = useScopeChoices();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [snap, setSnap] = useState(1);
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  /** A drag ends in a click too; that click must not also step the height. */
  const dragged = useRef(false);

  const known = stats?.byNamespace.map((b) => b.namespace) ?? [];
  const showProject = known.some((ns) => ns !== null) && projectFilter === undefined;
  const scopeName = choices.find((c) => c.value === projectFilter)?.label ?? projectLabel(projectFilter, known);
  const visible = (list: MemoryRecord[]) => list.filter((r) => !hiddenIds.has(r.id));
  const recent = visible(records);
  const total =
    projectFilter === undefined
      ? (stats?.total ?? records.length)
      : (stats?.byNamespace.find((b) => b.namespace === projectFilter)?.count ?? records.length);
  const more = !searchQuery && total > records.length;
  const strong = visible(searchResults);
  const weaker = visible(weakerResults);

  // Older memories load as the end of the list scrolls into view.
  useEffect(() => {
    const target = moreRef.current;
    if (!target || !more || loadingMore || loading || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoadMore(), {
      root: bodyRef.current,
      rootMargin: '0px 0px 400px 0px',
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, loadingMore, loading, onLoadMore]);

  // The row of the memory under the pointer (here or on the map) is marked,
  // and kept in view when the pointer is on the map.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.querySelectorAll('[data-hover]').forEach((el) => el.removeAttribute('data-hover'));
    const el = hoverId ? [...body.querySelectorAll<HTMLElement>('[data-id]')].find((e) => e.dataset.id === hoverId) : undefined;
    if (!el) return;
    el.setAttribute('data-hover', '');
    if (!body.matches(':hover')) el.scrollIntoView({ block: 'nearest' });
  }, [hoverId, panel, searchQuery]);

  const row = (record: MemoryRecord, query = '') => (
    <MemoryRow
      key={record.id}
      record={record}
      query={query}
      project={showProject ? projectLabel(record.namespace, known) : undefined}
      current={record.id === openId}
      onOpen={selectNeuron}
    />
  );

  /** j/k and the arrows step through the rows and folded lines. */
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step || !bodyRef.current) return;
    const stops = [...bodyRef.current.querySelectorAll<HTMLElement>('.mm-row, .mp-group > button, .mp-region, .mp-back')];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    event.preventDefault();
    stops[Math.min(stops.length - 1, Math.max(0, at + step))]?.focus();
  };

  const onGrabDown = (event: PointerEvent<HTMLButtonElement>) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    drag.current = { y: event.clientY, h: sheet.offsetHeight, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    sheet.dataset.dragging = 'true';
  };
  const onGrabMove = (event: PointerEvent<HTMLButtonElement>) => {
    const sheet = sheetRef.current;
    const d = drag.current;
    if (!sheet || !d) return;
    const dy = event.clientY - d.y;
    if (Math.abs(dy) > 4) d.moved = true;
    sheet.style.height = `${Math.max(120, d.h - dy)}px`;
  };
  const onGrabUp = () => {
    const sheet = sheetRef.current;
    const d = drag.current;
    drag.current = null;
    if (!sheet || !d) return;
    dragged.current = d.moved;
    delete sheet.dataset.dragging;
    if (d.moved) {
      const room = sheet.parentElement?.clientHeight ?? 1;
      const share = sheet.offsetHeight / room;
      let best = 0;
      SNAPS.forEach((s, i) => {
        if (Math.abs(s - share) < Math.abs(SNAPS[best]! - share)) best = i;
      });
      setSnap(best);
    }
    sheet.style.height = '';
  };

  const regions = !searchQuery && panel === 'regions';
  const head = searchQuery
    ? resultsHead(searchQuery, strong.length, weaker.length)
    : regions
      ? `${regionCount} regions`
      : 'Recent memories';
  const count = searchQuery
    ? `${strong.length + weaker.length} found`
    : regions
      ? `${regionCount} regions`
      : `${total.toLocaleString('en-US')} memories`;
  const lede = searchQuery
    ? isSearching
      ? 'Searching…'
      : `In ${scopeName}. Pins mark where they sit on the map.`
    : regions
      ? 'Found from where memories sit. Pick one to fly there.'
      : `${total.toLocaleString('en-US')} in ${scopeName}. Machine-written streams are folded into one line.`;

  return (
    <section
      ref={sheetRef}
      className="mp-sheet"
      data-snap={snap}
      aria-label={searchQuery ? 'Search results' : regions ? 'Regions' : 'Recent memories'}
    >
      <button
        type="button"
        className="mp-grab"
        aria-label="Raise or lower the list"
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
        onClick={() => {
          if (!dragged.current) setSnap((s) => (s + 1) % SNAPS.length);
          dragged.current = false;
        }}
      >
        <i />
      </button>
      <header className="mp-head">
        <div className="mp-head-row">
          <h2>{head}</h2>
          <small className="mp-count">{count}</small>
          <button type="button" className="at-btn sec mp-store" onClick={onStore} aria-label="Store a memory">
            <Icon name="plus" size={16} />
            <span>Store a memory</span>
          </button>
        </div>
        <p aria-live="polite">{lede}</p>
        {!searchQuery && (
          <div className="mp-panels" role="group" aria-label="List">
            {PANELS.map((p) => (
              <button key={p.panel} type="button" aria-pressed={panel === p.panel} onClick={() => setPanel(p.panel)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div
        ref={bodyRef}
        className="mp-body"
        aria-busy={isSearching || loading}
        onKeyDown={onListKey}
        onPointerOver={(e) => setHover((e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id ?? null)}
        onPointerLeave={() => setHover(null)}
      >
        {regions ? (
          <RegionsPanel onRegion={onRegion} />
        ) : searchQuery ? (
          <>
            {strong.map((r) => row(r, searchQuery))}
            {weaker.length > 0 && (
              <div className="mp-weak">
                <h3>Weaker matches</h3>
                <p>
                  {strong.length === 0 ? 'Nothing matched closely' : `Only ${strong.length} matched closely`}, so these are
                  looser matches by meaning.
                </p>
              </div>
            )}
            {weaker.map((r) => row(r, searchQuery))}
            <AskRecall query={searchQuery} empty={strong.length + weaker.length === 0} scoped={projectFilter !== undefined} />
          </>
        ) : error && !loading ? (
          <div className="mp-note" role="alert">
            <p>Could not load your memories: {error}</p>
            <button type="button" className="at-btn sec" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : loading && recent.length === 0 ? (
          <div className="mp-note" aria-label="Loading">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} className="mm-skel" style={{ width: `${88 - i * 9}%` }} />
            ))}
          </div>
        ) : (
          <>
            {foldStreams(recent).map((item) =>
              item.kind === 'memory' ? (
                row(item.record)
              ) : (
                <div key={item.key} className="mp-group">
                  <button
                    type="button"
                    aria-expanded={open.has(item.key)}
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.key)) next.delete(item.key);
                        else next.add(item.key);
                        return next;
                      })
                    }
                  >
                    <span className="mp-stack" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="mp-group-t">
                      <b>{item.title}</b>
                      <small>{item.detail}</small>
                    </span>
                    <Icon name="chev" size={16} />
                  </button>
                  {open.has(item.key) && <div className="mp-group-rows">{item.records.map((r) => row(r))}</div>}
                </div>
              )
            )}
            {recent.length === 0 && !loading && (
              <div className="mp-note">
                <p>{projectFilter === undefined ? 'No memories yet.' : `No memories in ${scopeName} yet.`}</p>
              </div>
            )}
            {more && (
              <div ref={moreRef} className="mp-more">
                <span>
                  Showing {records.length.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
                </span>
                <button type="button" className="mm-quiet" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load older'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function resultsHead(query: string, strong: number, weaker: number): string {
  if (strong === 1) return `1 memory matches “${query}”`;
  if (strong > 1) return `${strong} memories match “${query}”`;
  return weaker > 0 ? `No close matches for “${query}”` : `Nothing matches “${query}”`;
}

/** Recall is always on offer: it asks by meaning and follows links, so it can
 *  find what a search by these words did not. */
function AskRecall({ query, empty, scoped }: { query: string; empty: boolean; scoped: boolean }) {
  const setFilter = useMemoryStore((s) => s.setProjectFilter);
  return (
    <div className="mp-recall">
      <p>
        {empty
          ? 'Search matches what your memories say. Your AI asks by meaning and follows links, so it may still know something about this.'
          : 'Your AI asks by meaning and follows links between memories, so it may be told more than this.'}
      </p>
      <div>
        <a className={empty ? 'at-btn' : 'at-btn sec'} href={`#/recall?${new URLSearchParams({ q: query })}`}>
          <Icon name="route" size={16} />
          Ask what my AI would be told
        </a>
        {empty && scoped && (
          <button type="button" className="at-btn sec" onClick={() => setFilter(undefined)}>
            Search all projects
          </button>
        )}
      </div>
    </div>
  );
}
