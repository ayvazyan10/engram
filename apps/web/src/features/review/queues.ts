import { useEffect } from 'react';
import { create } from 'zustand';
import { api, ApiError, type ReviewItem, type ReviewQueue, type ReviewSummary } from '../../lib/api.js';
import { useMemoryStore, type ProjectFilter } from '../../store/memoryStore.js';

export interface QueueMeta {
  id: ReviewQueue;
  label: string;
  /** What the queue holds, one sentence, for the empty state. */
  empty: string;
}

export const QUEUES: readonly QueueMeta[] = [
  { id: 'contradictions', label: 'Contradictions', empty: 'No two memories disagree here. New pairs appear when your AI stores something that conflicts.' },
  { id: 'duplicates', label: 'Near-duplicates', empty: 'No memory is stored twice here.' },
  { id: 'fading', label: 'Fading but important', empty: 'Nothing important is about to fade.' },
  { id: 'secrets', label: 'Possible secrets', empty: 'No passwords, keys or tokens were found in these memories.' },
];

export function isQueue(value: string | null | undefined): value is ReviewQueue {
  return QUEUES.some((q) => q.id === value);
}

/** Items per request; the server allows 1 to 200. */
export const PAGE_SIZE = 50;

/** A pair is its edge; a single is its memory. */
export function itemKey(item: ReviewItem): string {
  return item.kind === 'pair' ? item.edgeId : item.memory.id;
}

export interface QueueState {
  items: ReviewItem[];
  total: number;
  loading: boolean;
  error: string | null;
}

interface ReviewState {
  /** The scope everything below was loaded for. */
  scope: ProjectFilter;
  summary: ReviewSummary | null;
  summaryLoading: boolean;
  /** The last summary request failed: the screen stops waiting for it. */
  summaryFailed: boolean;
  queues: Partial<Record<ReviewQueue, QueueState>>;
  /** Items settled since the scope was last picked: the countdown's other half. */
  cleared: number;
  loadSummary: (scope: ProjectFilter) => Promise<void>;
  /** The first page, or with `more` the next one. A loaded queue is kept
   *  until the scope changes: Review reads share a tight rate limit. */
  loadQueue: (queue: ReviewQueue, scope: ProjectFilter, options?: { more?: boolean; retry?: boolean }) => Promise<void>;
  /** Takes settled items out of a queue and its count; returns their Undo. */
  remove: (queue: ReviewQueue, keys: string[]) => () => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Could not reach Engram';
}

export const useReviewStore = create<ReviewState>((set, get) => {
  /** A new scope starts from nothing; a reply for an old one is dropped. */
  const enter = (scope: ProjectFilter) => {
    if (get().scope !== scope) set({ scope, summary: null, summaryLoading: false, summaryFailed: false, queues: {}, cleared: 0 });
  };
  const patchQueue = (queue: ReviewQueue, patch: Partial<QueueState>) =>
    set((s) => {
      const prev = s.queues[queue] ?? { items: [], total: 0, loading: false, error: null };
      return { queues: { ...s.queues, [queue]: { ...prev, ...patch } } };
    });

  return {
    scope: undefined,
    summary: null,
    summaryLoading: false,
    summaryFailed: false,
    queues: {},
    cleared: 0,

    loadSummary: async (scope) => {
      enter(scope);
      if (get().summaryLoading) return;
      set({ summaryLoading: true });
      try {
        const summary = await api.getReviewSummary(scope);
        if (get().scope === scope) set({ summary, summaryFailed: false });
      } catch {
        // The badge simply stays empty; the Review screen states its own errors.
        if (get().scope === scope) set({ summaryFailed: true });
      } finally {
        if (get().scope === scope) set({ summaryLoading: false });
      }
    },

    loadQueue: async (queue, scope, options = {}) => {
      enter(scope);
      const current = get().queues[queue];
      if (current?.loading) return;
      if (current && !current.error && !options.more && !options.retry) return;
      const offset = options.more && current ? current.items.length : 0;
      patchQueue(queue, { loading: true, error: null });
      try {
        const page = await api.getReviewQueue(queue, { namespace: scope, limit: PAGE_SIZE, offset });
        if (get().scope !== scope) return;
        if (offset > 0) {
          // An empty page past the end means the queue shrank meanwhile: stop
          // asking rather than ask again for what is not there.
          const items = [...current!.items, ...page.items];
          patchQueue(queue, { items, total: page.items.length ? page.total : items.length, loading: false });
          return;
        }
        patchQueue(queue, { items: page.items, total: page.total, loading: false });
        // The list is newer than the summary: keep the tab's count in step.
        const summary = get().summary;
        if (summary && summary[queue] !== page.total) set({ summary: { ...summary, [queue]: page.total } });
      } catch (err) {
        if (get().scope !== scope) return;
        const locked = err instanceof ApiError && err.status === 401;
        patchQueue(queue, { loading: false, error: locked ? null : messageOf(err) });
      }
    },

    remove: (queue, keys) => {
      const state = get().queues[queue];
      if (!state) return () => {};
      const scope = get().scope;
      const drop = new Set(keys);
      const items = state.items.filter((item) => !drop.has(itemKey(item)));
      const removed = state.items.length - items.length;
      if (removed === 0) return () => {};
      const summary = get().summary;
      set((s) => ({
        queues: { ...s.queues, [queue]: { ...state, items, total: Math.max(0, state.total - removed) } },
        summary: summary ? { ...summary, [queue]: Math.max(0, summary[queue] - removed) } : summary,
        cleared: s.cleared + removed,
      }));
      return () => {
        if (get().scope !== scope) return;
        set((s) => {
          const current = s.queues[queue];
          if (!current) return s;
          const restored = [...current.items];
          let count = 0;
          state.items.forEach((item, index) => {
            if (drop.has(itemKey(item)) && !restored.some((other) => itemKey(other) === itemKey(item))) {
              restored.splice(index, 0, item);
              count++;
            }
          });
          return {
            queues: { ...s.queues, [queue]: { ...current, items: restored, total: current.total + count } },
            summary: s.summary ? { ...s.summary, [queue]: s.summary[queue] + count } : null,
            cleared: Math.max(0, s.cleared - count),
          };
        });
      };
    },
  };
});

export function summaryTotal(summary: ReviewSummary | null): number {
  return summary ? QUEUES.reduce((sum, q) => sum + summary[q.id], 0) : 0;
}

/** The rail and bottom-nav badge: everything waiting in Review for the
 *  current scope, asked again whenever the scope changes. */
export function useReviewCount(): number {
  const filter = useMemoryStore((s) => s.projectFilter);
  useEffect(() => {
    void useReviewStore.getState().loadSummary(filter);
  }, [filter]);
  return useReviewStore((s) => summaryTotal(s.summary));
}
