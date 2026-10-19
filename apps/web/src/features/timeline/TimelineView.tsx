import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { api, ApiError } from '../../lib/api.js';
import { safeParseISO, formatTimeOfDay, UNKNOWN_DATE_LABEL } from '../../lib/dates.js';
import { projectLabel } from '../../lib/projects.js';
import { useServerStats } from '../../lib/serverStats.js';
import { asMemoryRecord } from '../../hooks/useWebSocket.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useRouteStore } from '../../shell/routeStore.js';
import { useScopeChoices } from '../../shell/ScopeSwitch.js';
import { Icon } from '../../shell/icons.js';
import { MemoryRow } from '../memory/MemoryRow.js';
import { foldStreams, type SheetItem } from '../map/MapSheet.js';
import './timeline.css';

/** The server's page cap for GET /memory. */
export const PAGE_SIZE = 200;
const UNKNOWN_DAY = 'unknown';

export interface Day {
  key: string;
  label: string;
  records: MemoryRecord[];
  /** The day's memories with machine streams folded, as the Map's list folds them. */
  items: SheetItem[];
}

/** "Today", "Yesterday", "Saturday 17 October", with the year only when it is not this one. */
export function dayLabel(date: Date, now = new Date()): string {
  const ago = differenceInCalendarDays(now, date);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return format(date, date.getFullYear() === now.getFullYear() ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy');
}

/** Newest first, one group per local calendar day; an unparsable date gets a group of its own. */
export function groupByDay(records: MemoryRecord[], now = new Date()): Day[] {
  const days = new Map<string, { label: string; records: MemoryRecord[] }>();
  for (const record of records) {
    const parsed = safeParseISO(record.createdAt);
    const key = parsed ? format(parsed, 'yyyy-MM-dd') : UNKNOWN_DAY;
    const day = days.get(key) ?? { label: parsed ? dayLabel(parsed, now) : UNKNOWN_DATE_LABEL, records: [] };
    day.records.push(record);
    days.set(key, day);
  }
  return [...days].map(([key, day]) => ({ key, ...day, items: foldStreams(day.records) }));
}

/** `2026-10-01` (the jump-to-date value) as the ISO instant that day ends at. */
export function endOfPickedDay(value: string): string | null {
  const parsed = safeParseISO(value);
  return parsed ? addDays(startOfDay(parsed), 1).toISOString() : null;
}

function parseRows(rows: unknown[]): MemoryRecord[] {
  return rows.map(asMemoryRecord).filter((r): r is MemoryRecord => r !== null);
}

/**
 * Every memory in time order, a page of 200 at a time, grouped by day with
 * machine streams folded. `?before=YYYY-MM-DD` starts on that day. Paging is
 * pinned to one instant: the first page's newest memory (or the picked day's
 * end), then `offset` beneath it, so a memory stored meanwhile cannot shift a
 * page. Rows open the memory sheet.
 */
export default function TimelineView() {
  const picked = useRouteStore((s) => s.route.params.before ?? '');
  const setParam = useRouteStore((s) => s.setParam);
  const projectFilter = useMemoryStore((s) => s.projectFilter);
  const hiddenIds = useMemoryStore((s) => s.hiddenIds);
  const liveRecords = useMemoryStore((s) => s.records);
  const openId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const stats = useServerStats();
  const choices = useScopeChoices();

  const [rows, setRows] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const anchor = useRef<string | undefined>(undefined);
  /** Bumped per (re)start, so a page for an older date or scope is dropped. */
  const generation = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    (offset: number) => {
      const gen = generation.current;
      setLoading(true);
      setError(null);
      api
        .listMemories({ limit: PAGE_SIZE, offset, before: anchor.current, namespace: projectFilter })
        .then((res) => {
          if (gen !== generation.current) return;
          const page = parseRows(res.memories);
          if (offset === 0 && !anchor.current && page[0]) {
            const newest = safeParseISO(page[0].createdAt);
            if (newest) anchor.current = new Date(newest.getTime() + 1).toISOString();
          }
          setRows((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            return [...prev, ...page.filter((r) => !seen.has(r.id))];
          });
          setDone(res.memories.length < PAGE_SIZE);
        })
        .catch((err: unknown) => {
          if (gen !== generation.current || (err instanceof ApiError && err.status === 401)) return;
          setError(err instanceof Error ? err.message : 'Could not reach Engram');
        })
        .finally(() => {
          if (gen === generation.current) setLoading(false);
        });
    },
    [projectFilter]
  );

  // A new date, a new scope or Try again starts over from the first page.
  useEffect(() => {
    generation.current += 1;
    anchor.current = picked ? (endOfPickedDay(picked) ?? undefined) : undefined;
    setRows([]);
    setDone(false);
    fetchPage(0);
  }, [picked, fetchPage, attempt]);

  const loadOlder = useCallback(() => {
    if (!loading && !done && !error) fetchPage(rows.length);
  }, [loading, done, error, fetchPage, rows.length]);

  // Older days load as the end of the list scrolls into view.
  useEffect(() => {
    const target = moreRef.current;
    if (!target || done || loading || error || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadOlder(), {
      rootMargin: '0px 0px 600px 0px',
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [done, loading, error, loadOlder]);

  const days = useMemo(() => {
    // On the newest page, memories that arrived live join the top; edits made
    // in the sheet show through, and archived memories leave at once.
    const live = new Map(liveRecords.map((r) => [r.id, r]));
    const newest = rows[0]?.createdAt;
    const arrivals = !picked && newest ? liveRecords.filter((r) => r.createdAt > newest && !rows.some((x) => x.id === r.id)) : [];
    const shown = [...arrivals, ...rows.map((r) => live.get(r.id) ?? r)].filter((r) => !hiddenIds.has(r.id));
    return groupByDay(shown);
  }, [rows, liveRecords, hiddenIds, picked]);

  const known = stats?.byNamespace.map((b) => b.namespace) ?? [];
  const showProject = known.some((ns) => ns !== null) && projectFilter === undefined;
  const scopeName = choices.find((c) => c.value === projectFilter)?.label ?? projectLabel(projectFilter, known);
  const total =
    projectFilter === undefined ? stats?.total : stats?.byNamespace.find((b) => b.namespace === projectFilter)?.count;
  const pickedDate = picked ? safeParseISO(picked) : null;
  const shownCount = days.reduce((n, d) => n + d.records.length, 0);

  /** j/k and the arrows step through rows and folded lines, across days. */
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step || !bodyRef.current) return;
    const stops = [...bodyRef.current.querySelectorAll<HTMLElement>('.mm-row, .tl-fold > button')];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    event.preventDefault();
    stops[Math.min(stops.length - 1, Math.max(0, at + step))]?.focus();
  };

  const lede =
    total === 0 && !pickedDate
      ? `Nothing stored in ${scopeName} yet.`
      : pickedDate
        ? `Memories stored on or before ${format(pickedDate, 'd MMMM yyyy')} in ${scopeName}, newest first.`
        : `${total === undefined ? 'Every memory' : `${total.toLocaleString('en-US')} ${total === 1 ? 'memory' : 'memories'}`} in ${scopeName}, newest first. Machine-written streams are folded into one line.`;

  return (
    <div className="tl-page">
      <header className="tl-head">
        <div>
          <h1 className="at-display">Timeline</h1>
          <p className="at-lede" aria-live="polite">{lede}</p>
        </div>
        {(total !== 0 || picked) && (
          <div className="tl-jump">
            <label htmlFor="tl-date">Jump to a date</label>
            <span className="tl-jump-row">
              <input
                id="tl-date"
                type="date"
                value={picked}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => setParam('before', e.target.value || null)}
              />
              {picked && (
                <button type="button" className="at-btn sec" onClick={() => setParam('before', null)}>
                  Newest
                </button>
              )}
            </span>
          </div>
        )}
      </header>

      <div ref={bodyRef} className="tl-days" aria-busy={loading} onKeyDown={onListKey}>
        {days.map((day) => (
          <section key={day.key} className="tl-day" aria-labelledby={`tl-${day.key}`}>
            <header className="tl-day-h">
              <h2 id={`tl-${day.key}`}>{day.label}</h2>
              <small>
                {day.records.length} {day.records.length === 1 ? 'memory' : 'memories'}
              </small>
            </header>
            <div className="tl-rows">
              {day.items.map((item) =>
                item.kind === 'memory' ? (
                  <div key={item.record.id} className="tl-row">
                    <time dateTime={item.record.createdAt}>{formatTimeOfDay(item.record.createdAt)}</time>
                    <MemoryRow
                      record={item.record}
                      project={showProject ? projectLabel(item.record.namespace, known) : undefined}
                      current={item.record.id === openId}
                      onOpen={selectNeuron}
                    />
                  </div>
                ) : (
                  <Fold key={item.key} item={item} openId={openId} onOpen={selectNeuron} />
                )
              )}
            </div>
          </section>
        ))}

        {error ? (
          <div className="tl-note" role="alert">
            <p>Could not load the timeline: {error}</p>
            <button type="button" className="at-btn sec" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="tl-note" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className="mm-skel" style={{ width: `${86 - i * 11}%` }} />
            ))}
          </div>
        ) : shownCount === 0 ? (
          <Empty picked={pickedDate} scoped={projectFilter !== undefined} scopeName={scopeName} />
        ) : done ? (
          <p className="tl-end">{pickedDate ? 'The start of the store.' : 'That is every memory, back to the first.'}</p>
        ) : (
          <div ref={moreRef} className="tl-more">
            <span>{rows.length.toLocaleString('en-US')} loaded</span>
            <button type="button" className="mm-quiet" onClick={loadOlder}>
              Load older
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A folded run of machine-written memories: one line, opening to show them. */
function Fold({
  item,
  openId,
  onOpen,
}: {
  item: Extract<SheetItem, { kind: 'stream' }>;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tl-fold">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <time dateTime={item.records[0]!.createdAt}>{formatTimeOfDay(item.records[0]!.createdAt)}</time>
        <span className="tl-stack" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="tl-fold-t">
          <b>{item.title}</b>
          <small>{item.detail}</small>
        </span>
        <Icon name="chev" size={16} />
      </button>
      {open && (
        <div className="tl-fold-rows">
          {item.records.map((r) => (
            <div key={r.id} className="tl-row">
              <time dateTime={r.createdAt}>{formatTimeOfDay(r.createdAt)}</time>
              <MemoryRow record={r} current={r.id === openId} onOpen={onOpen} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ picked, scoped, scopeName }: { picked: Date | null; scoped: boolean; scopeName: string }) {
  const setParam = useRouteStore((s) => s.setParam);
  const setFilter = useMemoryStore((s) => s.setProjectFilter);
  if (picked) {
    return (
      <div className="tl-empty">
        <h2>Nothing stored by {format(picked, 'd MMMM yyyy')}</h2>
        <p>The first memory in {scopeName} came later than that.</p>
        <button type="button" className="at-btn sec" onClick={() => setParam('before', null)}>
          Back to the newest
        </button>
      </div>
    );
  }
  if (scoped) {
    return (
      <div className="tl-empty">
        <h2>No memories in {scopeName} yet</h2>
        <p>Memories your AI stores while working in this project will line up here by day.</p>
        <button type="button" className="at-btn sec" onClick={() => setFilter(undefined)}>
          Show all projects
        </button>
      </div>
    );
  }
  return (
    <div className="tl-empty">
      <h2>Nothing on the timeline yet</h2>
      <p>Every memory your AI stores lands here, under the day it was written.</p>
      <a className="at-btn" href="#/welcome">
        <Icon name="plug" size={16} />
        Connect an AI
      </a>
    </div>
  );
}
