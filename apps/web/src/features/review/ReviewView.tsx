import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ReviewItem, type ReviewQueue, type ReviewSummary } from '../../lib/api.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useRouteStore } from '../../shell/routeStore.js';
import { showToast } from '../../shell/Toasts.js';
import { QUEUES, PAGE_SIZE, isQueue, itemKey, summaryTotal, useReviewStore } from './queues.js';
import { archiveMemories } from './archive.js';
import { settle, settleMany, type BulkAction } from './triage.js';
import { memoryHref, percent, titleOf, type Action } from './parts.js';
import PairCard from './PairCard.js';
import SingleCard from './SingleCard.js';
import BulkBar from './BulkBar.js';
import './review.css';

/** The settled card's exit, before the next one comes in. */
const EXIT_MS = 260;
const NO_ITEMS: ReviewItem[] = [];
/** Load the next page this close to the end of what is loaded. */
const PREFETCH_AT = 3;

function exitDelay(): number {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 0 : EXIT_MS;
}

/** A count that ticks when it changes, so the countdown is seen. */
function Num({ n }: { n: number }) {
  return (
    <span key={n} className="rv-num rv-tick">
      {n.toLocaleString('en-US')}
    </span>
  );
}

function rowMeta(item: ReviewItem): string {
  if (item.kind === 'pair') return item.sharedWordRatio >= 0.999 ? 'Identical words' : `${percent(item.sharedWordRatio)} shared words`;
  if (item.reason === 'possible-secret') {
    const n = item.findings?.length ?? 0;
    return `${n} ${n === 1 ? 'value' : 'values'} found`;
  }
  return `Importance ${percent(item.memory.importance)}, retention ${percent(item.retention)}`;
}

function rowTitle(item: ReviewItem): string {
  return titleOf(item.kind === 'pair' ? item.a : item.memory);
}

/** The four queues as one stacked bar; each segment is a share of the
 *  total. Nothing counted yet, or nothing waiting, is an empty track. */
function CountBar({ summary }: { summary: ReviewSummary | null }) {
  const total = summaryTotal(summary);
  return (
    <div className="rv-bar" aria-hidden="true">
      {summary &&
        total > 0 &&
        QUEUES.filter((q) => summary[q.id] > 0).map((q) => <i key={q.id} data-q={q.id} style={{ flexGrow: summary[q.id] }} />)}
    </div>
  );
}

/**
 * Review: four queues of what needs a person (contradictions, near-duplicates,
 * important memories about to fade, and possible secrets), worked one item at
 * a time from the keyboard, or many at once by selection.
 */
export default function ReviewView() {
  const route = useRouteStore((s) => s.route);
  const navigate = useRouteStore((s) => s.navigate);
  const scope = useMemoryStore((s) => s.projectFilter);
  const summary = useReviewStore((s) => (s.scope === scope ? s.summary : null));
  const summaryFailed = useReviewStore((s) => s.summaryFailed);
  const cleared = useReviewStore((s) => s.cleared);
  const queues = useReviewStore((s) => s.queues);
  const { loadSummary, loadQueue, remove } = useReviewStore.getState();

  // `#/review` opens on the first queue with something waiting.
  const queue: ReviewQueue = isQueue(route.sub)
    ? route.sub
    : (QUEUES.find((q) => summary && summary[q.id] > 0)?.id ?? 'contradictions');
  // Without a named queue, which one opens waits for the counts.
  const ready = isQueue(route.sub) || summary !== null || summaryFailed;
  const meta = QUEUES.find((q) => q.id === queue)!;
  const state = queues[queue];
  const items = state?.items ?? NO_ITEMS;
  const total = state?.total ?? 0;

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const current = items[Math.min(index, items.length - 1)];
  const at = current ? Math.min(index, items.length - 1) : 0;

  // Counts are refreshed on arrival; the queue on every queue or scope change
  // (the store keeps one it already has).
  useEffect(() => {
    void loadSummary(scope);
  }, [loadSummary, scope]);
  useEffect(() => {
    if (ready) void loadQueue(queue, scope);
    setIndex(0);
    setSelected(new Set());
    setConfirming(false);
  }, [loadQueue, queue, scope, ready]);

  // The next page arrives before the reader reaches the end of this one.
  const more = useCallback(() => void loadQueue(queue, scope, { more: true }), [loadQueue, queue, scope]);
  useEffect(() => {
    if (state && !state.loading && !state.error && items.length < total && at >= items.length - PREFETCH_AT) more();
  }, [state, items.length, total, at, more]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at, queue]);

  const step = useCallback(
    (by: number) => {
      setConfirming(false);
      setIndex((i) => Math.max(0, Math.min(items.length - 1, i + by)));
    },
    [items.length]
  );

  const act = useCallback(
    async (action: Action) => {
      if (!current || busy) return;
      if (action === 'redact' && !confirming) {
        setConfirming(true);
        return;
      }
      const key = itemKey(current);
      const hadFocus = cardRef.current?.contains(document.activeElement) ?? false;
      setBusy(true);
      try {
        const { message, archiveIds } = await settle(queue, current, action);
        setLeaving(action);
        await new Promise((resolve) => setTimeout(resolve, exitDelay()));
        const undo = remove(queue, [key]);
        setSelected((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        if (archiveIds) archiveMemories(archiveIds, message, undo);
        else showToast(message);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 404 || (status === 409 && action === 'redact')) {
          remove(queue, [key]);
          showToast(status === 404 ? 'That memory is no longer there.' : 'Nothing left to redact.');
        } else {
          showToast(`Could not do that: ${err instanceof Error ? err.message : 'Engram did not answer'}`);
        }
      } finally {
        setBusy(false);
        setLeaving(null);
        setConfirming(false);
        // The next card mounts on the following render; focus goes to it.
        if (hadFocus) setTimeout(() => cardRef.current?.focus(), 0);
      }
    },
    [current, busy, confirming, queue, remove]
  );

  const runBulk = useCallback(
    async (action: BulkAction, tag?: string) => {
      const chosen = items.filter((item) => selected.has(itemKey(item)));
      if (chosen.length === 0) return;
      setBusy(true);
      try {
        const { removed, message, archiveIds } = await settleMany(queue, chosen, action, itemKey, tag);
        const undo = remove(queue, removed);
        setSelected(new Set());
        if (archiveIds) archiveMemories(archiveIds, message, undo);
        else showToast(message);
      } catch (err) {
        showToast(`Could not do that: ${err instanceof Error ? err.message : 'Engram did not answer'}`);
      } finally {
        setBusy(false);
      }
    },
    [items, selected, queue, remove]
  );

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const goQueue = useCallback(
    (by: number) => {
      const i = QUEUES.findIndex((q) => q.id === queue);
      navigate(`/review/${QUEUES[(i + by + QUEUES.length) % QUEUES.length]!.id}`);
    },
    [queue, navigate]
  );

  // The keyboard: one key per action, shown on the buttons. Ignored while
  // typing, with a modifier, or as the second key of a `g` jump.
  const lastKey = useRef({ key: '', at: 0 });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
      const previous = lastKey.current;
      lastKey.current = { key: event.key, at: Date.now() };
      if (event.defaultPrevented || typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (previous.key === 'g' && Date.now() - previous.at < 1200) return;
      if (confirming) return;
      const pair = current?.kind === 'pair';
      const openId = current ? (current.kind === 'pair' ? current.a.id : current.memory.id) : null;
      const handlers: Record<string, (() => void) | undefined> = {
        j: () => step(1),
        k: () => step(-1),
        '[': () => goQueue(-1),
        ']': () => goQueue(1),
        o: openId ? () => navigate(memoryHref(openId)) : undefined,
        x: current ? () => toggle(itemKey(current)) : undefined,
        d: current ? () => void act('dismiss') : undefined,
        '1': pair ? () => void act('keepA') : undefined,
        '2': pair ? () => void act('keepB') : undefined,
        p: queue === 'fading' && current ? () => void act('pin') : undefined,
        r: queue === 'secrets' && current ? () => setConfirming(true) : undefined,
        a: queue === 'secrets' && current ? () => void act('archive') : undefined,
        Escape: selected.size ? () => setSelected(new Set()) : undefined,
      };
      const handler = handlers[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step, goQueue, act, toggle, navigate, current, queue, confirming, selected.size]);

  const waiting = summaryTotal(summary);
  const position = `${(at + 1).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
  const nextQueue = QUEUES.find((q) => q.id !== queue && summary && summary[q.id] > 0);

  let card;
  if (current) {
    card =
      current.kind === 'pair' ? (
        <PairCard
          queue={queue as 'contradictions' | 'duplicates'}
          item={current}
          position={position}
          busy={busy}
          onAct={(a) => void act(a)}
        />
      ) : (
        <SingleCard
          queue={queue as 'fading' | 'secrets'}
          item={current}
          position={position}
          busy={busy}
          onAct={(a) => void act(a)}
          confirming={confirming}
          setConfirming={setConfirming}
        />
      );
  } else if (state?.error) {
    card = (
      <div className="rv-state is-error" role="alert">
        <h2 className="rv-h">Could not load {meta.label.toLowerCase()}</h2>
        <p className="rv-why">{state.error}</p>
        <button type="button" className="rv-btn sec" onClick={() => void loadQueue(queue, scope, { retry: true })}>
          Try again
        </button>
      </div>
    );
  } else if (!state || state.loading) {
    card = (
      <div className="rv-state is-loading" role="status">
        <p className="rv-why">Loading {meta.label.toLowerCase()}…</p>
        <i />
        <i />
        <i />
      </div>
    );
  } else {
    card = (
      <div className="rv-state">
        <h2 className="rv-display">All clear</h2>
        <p className="rv-why">{meta.empty}</p>
        {nextQueue && summary && (
          <a className="rv-btn sec" href={`#/review/${nextQueue.id}`}>
            Next: {nextQueue.label} ({summary[nextQueue.id].toLocaleString('en-US')})
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="rv" data-queue={queue}>
      <header className="rv-head">
        <div className="rv-title-row">
          <h1 className="rv-title">Review</h1>
          <p className="rv-count" aria-live="polite">
            {summary ? (
              <>
                <Num n={waiting} /> waiting
                {cleared > 0 && (
                  <>
                    , <Num n={cleared} /> cleared
                  </>
                )}
              </>
            ) : (
              'Counting…'
            )}
          </p>
        </div>
        <CountBar summary={summary} />
        <nav className="rv-queues" aria-label="Review queues">
          {QUEUES.map((q) => (
            <a key={q.id} href={`#/review/${q.id}`} data-q={q.id} aria-current={q.id === queue ? 'page' : undefined}>
              <i aria-hidden="true" />
              <span>{q.label}</span>
              <b className="rv-num">{summary ? summary[q.id].toLocaleString('en-US') : ''}</b>
            </a>
          ))}
        </nav>
      </header>

      <div className="rv-listpane">
        {selected.size > 0 && (
          <BulkBar
            queue={queue}
            count={selected.size}
            allSelected={selected.size === items.length}
            busy={busy}
            onSelectAll={() => setSelected(new Set(items.map(itemKey)))}
            onClear={() => setSelected(new Set())}
            onRun={(action, tag) => void runBulk(action, tag)}
          />
        )}
        {items.length > 0 && (
          <h2 className="rv-list-h">
            {meta.label}
            <span className="rv-num">{total.toLocaleString('en-US')}</span>
          </h2>
        )}
        {items.length > 0 && (
          <ol ref={listRef} className="rv-list" aria-label={`${meta.label}, ${total.toLocaleString('en-US')} waiting`}>
            {items.map((item, i) => {
              const key = itemKey(item);
              const title = rowTitle(item);
              return (
                <li key={key} className="rv-item">
                  <input
                    type="checkbox"
                    className="rv-check"
                    aria-label={`Select ${title}`}
                    checked={selected.has(key)}
                    onChange={() => toggle(key)}
                  />
                  <button
                    type="button"
                    className="rv-row"
                    aria-current={i === at ? 'true' : undefined}
                    onClick={() => {
                      setConfirming(false);
                      setIndex(i);
                    }}
                  >
                    <span className="rv-row-t">{title}</span>
                    <span className="rv-row-m">{rowMeta(item)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {items.length < total && (
          <button type="button" className="rv-more" onClick={more} disabled={state?.loading}>
            {state?.loading ? 'Loading…' : `Show ${Math.min(PAGE_SIZE, total - items.length)} more`}
          </button>
        )}
      </div>

      <section className="rv-reader" aria-label={meta.label}>
        <article
          ref={cardRef}
          key={current ? itemKey(current) : 'state'}
          className="rv-card"
          data-leaving={leaving ?? undefined}
          tabIndex={-1}
          aria-busy={busy}
        >
          {card}
        </article>
      </section>
    </div>
  );
}
