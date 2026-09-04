import { useSyncExternalStore } from 'react';
import { api } from './api.js';

/**
 * The server's decay policy, shared by everything that draws recency (F3).
 *
 * The scene encoded recency as brightness with a 30-day half-life hardcoded in
 * `canvas/encoding.ts`, and the scene key printed "30-day half-life" as the
 * definition of the channel. The server's actual policy is 7 days
 * (`GET /api/decay/policy` → `{"halfLifeDays":7,"archiveThreshold":0.05,…}`)
 * and the web client never asked for it.
 *
 * That is not a cosmetic gap. At 30 days a month-old memory drew at 0.71
 * brightness — reading as "still fresh" — while the server put its strength at
 * 2^(-30/7) = 0.051, sitting on the archive threshold. The legend inverted the
 * reading of every dim node in the graph.
 *
 * Same shape as `serverStats.ts`: one module-level snapshot with the request
 * shared across subscribers, so three surfaces asking the same question cannot
 * disagree about the answer. Unlike the census, a policy is configuration
 * rather than a moving figure — so this fetches once and only keeps retrying
 * while it has nothing.
 *
 * There is deliberately NO fallback half-life. A default is exactly how the
 * previous bug worked: a number the client invented, presented as the server's.
 * With no policy in hand `useDecayPolicy()` returns null, `recencyBrightness`
 * turns the channel off, and the scene key says so out loud.
 */

export interface DecayPolicy {
  /** Days for a memory's strength to halve. */
  halfLifeDays: number;
  /** Strength below which the server archives a memory. */
  archiveThreshold: number;
}

const RETRY_INTERVAL_MS = 30000;

let snapshot: DecayPolicy | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

function stopRetrying(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Never trust the response shape — a policy with a non-positive or absent
 *  half-life is not a policy, and must not silently become one. */
function parsePolicy(value: unknown): DecayPolicy | null {
  if (!value || typeof value !== 'object') return null;
  const { halfLifeDays, archiveThreshold } = value as Record<string, unknown>;
  if (typeof halfLifeDays !== 'number' || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return null;
  return {
    halfLifeDays,
    archiveThreshold:
      typeof archiveThreshold === 'number' && Number.isFinite(archiveThreshold) ? archiveThreshold : 0,
  };
}

async function refresh(): Promise<void> {
  if (inFlight || snapshot !== null) return;
  inFlight = true;
  try {
    const parsed = parsePolicy(await api.getDecayPolicy());
    if (!parsed) return;
    snapshot = parsed;
    stopRetrying();
    for (const listener of listeners) listener();
  } catch {
    // Keep retrying on the timer. Callers render the "unavailable" branch
    // meanwhile; none of them substitutes a number of its own.
  } finally {
    inFlight = false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && snapshot === null) {
    void refresh();
    timer = setInterval(() => void refresh(), RETRY_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopRetrying();
  };
}

function getSnapshot(): DecayPolicy | null {
  return snapshot;
}

/** The server's decay policy, or `null` until it has actually been read. */
export function useDecayPolicy(): DecayPolicy | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Drops the shared snapshot and any pending retry. Module-level state
 *  outlives a single test file's renders, so tests reset it explicitly. */
export function resetDecayPolicy(): void {
  snapshot = null;
  inFlight = false;
  listeners.clear();
  stopRetrying();
}
