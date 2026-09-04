import { useSyncExternalStore } from 'react';
import { api } from './api.js';

/**
 * The server's own memory census, shared by every surface that needs it (H6).
 *
 * Two numbers were on screen at once with nothing explaining the gap: the
 * sidebar said "MEMORY GRAPH 200" and the status bar said "653 memories · 200
 * nodes visible". 200 is the server's `listMemories` page cap, not a total —
 * but only the status bar knew the real figure, because it was the only
 * component that called `/stats`.
 *
 * Resolved: this module is the one place that asks for the census, and the
 * store field that tracks the loaded page is now named `loadedCount` for what
 * it is (`setRecords` sets it to `records.length`). The two numbers are never
 * substituted for one another — a surface with no census yet says "N loaded"
 * rather than passing N off as the total.
 *
 * A module-level snapshot with one poll shared across subscribers, rather
 * than a `useEffect` + `setInterval` per component: three panels asking the
 * same question every 15s should not be three requests, and they must not be
 * able to disagree with each other about the answer.
 */

export interface ServerStats {
  /** Every non-archived memory the server holds. */
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
}

const POLL_INTERVAL_MS = 15000;

let snapshot: ServerStats | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

async function refresh(): Promise<void> {
  try {
    const res = await api.stats();
    if (!res || typeof res !== 'object') return;
    const byType = res.byType ?? {};
    const bySource = res.bySource ?? {};
    snapshot = {
      total: typeof res.total === 'number' ? res.total : sum(byType),
      byType,
      bySource,
    };
    for (const listener of listeners) listener();
  } catch {
    // Keep the last good snapshot. A failed poll is not new information —
    // the surfaces that read this all have their own error affordances for
    // the load that actually matters to them.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): ServerStats | null {
  return snapshot;
}

/** The latest census, or `null` before the first successful poll. */
export function useServerStats(): ServerStats | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Drops the shared snapshot and any live poll. Module-level state outlives
 *  a single test file's renders, so tests reset it explicitly. */
export function resetServerStats(): void {
  snapshot = null;
  listeners.clear();
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
