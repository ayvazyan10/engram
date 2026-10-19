import { getStoredApiKey } from './apiKey.js';
import { useAuthStore } from '../store/authStore.js';
import type { AnalyticsData } from '../store/analyticsStore.js';

const BASE = '/api';

// One timeout for every call in the app. The 3D scene's own copy of this
// helper used to run on 20s; /graph/layout is the slowest route here and
// measures ~160ms warm and under a second cold against a 651-memory store, so
// 15s is already ~15x the cold figure and the 20s was never measured against
// anything. Kept as one constant rather than a per-call option: a second
// timeout is a second behaviour to reason about, and no caller is asking for
// one.
const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** True when the server sent a JSON `{ error: string }` body we can surface. */
function errorMessageFromBody(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error: unknown }).error;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body) headers['Content-Type'] = 'application/json';
  const apiKey = getStoredApiKey();
  if (apiKey) headers['X-API-Key'] = apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, `Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    const message = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(0, `${message}: ${path}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // No JSON body (or not valid JSON) — fall back to the generic message below.
    }
    // A 401 means the key is missing or wrong — surface the unlock gate
    // (F2) instead of leaving every view to interpret this on its own.
    // `hadKey` is what a stored-but-wrong key looks like vs never having
    // entered one, and drives the gate's "enter a key" vs "wrong key" copy.
    if (res.status === 401) {
      useAuthStore.getState().lock(Boolean(apiKey));
    }
    const message = errorMessageFromBody(body) ?? `API ${res.status}: ${path}`;
    throw new ApiError(res.status, message, body);
  }

  // A genuine 2xx proves whatever key is in play (or no key, if none is
  // required) works — clear a stale gate if one was showing.
  useAuthStore.getState().unlock();

  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, `Invalid JSON response: ${path}`);
  }
}

/** One memory on the map, as `GET /api/map` places it. `x` and `y` lie in
 *  [-1, 1]; `retention` and `protected` are the server's decay verdict. */
export interface MapNode {
  id: string;
  x: number;
  y: number;
  type: 'episodic' | 'semantic' | 'procedural';
  importance: number;
  retention: number;
  protected: boolean;
  createdAt: string;
  lastAccessedAt: string | null;
  namespace: string | null;
  source: string | null;
  isReflection: boolean;
  regionId: string;
  degree: number;
  contradictCount: number;
  label: string;
}

/** A named region of the map. Its id is its medoid memory's, so it stays put
 *  across recomputes; `name` is the server's automatic name. */
export interface MapRegion {
  id: string;
  name: string;
  autoName: string;
  count: number;
  x: number;
  y: number;
  reflectionShare: number;
  contradictions: number;
  newThisWeek: number;
  topTags: string[];
}

/** GET /api/map. A 503 `{ error: 'map not ready', retryAfterMs }` means the
 *  first layout is still being computed; ask again after that delay. */
export interface MapPayload {
  fingerprint: string;
  generatedAt: string;
  computeMs: number;
  method: 'pca2+knn' | 'fallback';
  explainedVariance: [number, number];
  embeddingModel: string | null;
  nodes: MapNode[];
  regions: MapRegion[];
}

/** Read-only recall plan. Offsets count UTF-16 units; omitted items have no span. */
export interface RecallItem {
  id: string;
  rank: number;
  position: number | null;
  offset: number | null;
  section: 'knowledge' | 'patterns' | 'events';
  type: MapNode['type'];
  source: string | null;
  via: 'vector' | 'graph';
  similarity: number;
  score: number;
  chars: number;
  tokens: number;
  included: boolean;
  reason?: 'over_budget';
}

export interface RecallExplanation {
  context: string;
  latencyMs: number;
  budget: { maxTokens: number; usedTokens: number };
  candidates: number;
  items: RecallItem[];
}

/** GET /api/graph/edges — the edge set plus the counts the scene key needs to
 *  state what is on screen and what is not. */
export interface EdgeSummary {
  /** Edges whose endpoints are both on screen — the honest denominator. */
  total: number;
  /** Connection rows in the store, including ones onto archived memories. */
  stored: number;
  matching: number;
  returned: number;
  truncated: boolean;
  minStrength: number;
  limit: number;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    relationship: string;
    strength: number;
  }>;
}

export interface ContradictionResolution {
  sourceId: string;
  targetId: string;
  strategy: 'keep_newest' | 'keep_oldest' | 'keep_important' | 'keep_both' | 'manual';
}

/** Atlas Review (GET /api/review/*). Secret spans arrive already replaced
 *  with `[REDACTED]`; a finding carries only a masked preview. */
export type ReviewQueue = 'contradictions' | 'duplicates' | 'fading' | 'secrets';

export interface ReviewMemory {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  content: string;
  concept: string | null;
  summary: string | null;
  importance: number;
  createdAt: string;
}

export interface ReviewPair {
  kind: 'pair';
  a: ReviewMemory;
  b: ReviewMemory;
  edgeId: string;
  strength: number;
  sharedWordRatio: number;
}

export interface SecretFinding {
  rule: string;
  field: 'content' | 'concept' | 'summary';
  start: number;
  end: number;
  length: number;
  preview: string;
}

export interface ReviewSingle {
  kind: 'single';
  memory: ReviewMemory;
  retention: number;
  reason: 'fading-but-important' | 'possible-secret';
  findings?: SecretFinding[];
}

export type ReviewItem = ReviewPair | ReviewSingle;

export type ReviewSummary = Record<ReviewQueue, number> & { fingerprint: string };

/** `namespace`: a path is one project, `null` the global memories, and
 *  leaving it out is every memory — the same as listMemories. */
function scopeQuery(namespace: string | null | undefined, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  if (typeof namespace === 'string') q.set('namespace', namespace);
  if (namespace === null) q.set('global', 'true');
  const text = q.toString();
  return text ? `?${text}` : '';
}

export const api = {
  // The header's version badge reads `version` from here: it is the running
  // server's, which is the number a release actually carries.
  health: () => request<{ status: string; version: string; uptime: number }>('/health'),

  stats: () =>
    request<{
      total: number;
      byType: Record<string, number>;
      bySource: Record<string, number>;
      byNamespace?: { namespace: string | null; count: number }[];
      dbPath?: string;
    }>('/stats'),

  /** `namespace`: a path lists one project, `null` the global memories, and
   *  leaving it out lists every memory. */
  listMemories: (params?: { type?: string; namespace?: string | null; limit?: number; offset?: number; before?: string }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set('type', params.type);
    // ISO date-time: only memories stored strictly before it (Timeline paging).
    if (params?.before) q.set('before', params.before);
    if (typeof params?.namespace === 'string') q.set('namespace', params.namespace);
    if (params?.namespace === null) q.set('global', 'true');
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    return request<{ count: number; memories: unknown[] }>(`/memory?${q}`);
  },

  storeMemory: (body: {
    content: string;
    type?: string;
    source?: string;
    tags?: string[];
    importance?: number;
    concept?: string;
  }) => request<{ memory: { id: string; type: string; content: string; importance: number; source: string | null; concept: string | null; tags: string; createdAt: string; summary: string | null } }>('/memory', { method: 'POST', body: JSON.stringify(body) }),

  /** `keepalive` lets the call outlive the page: a deferred archive still
   *  waiting out its undo window is sent this way when the tab closes. */
  deleteMemory: (id: string, keepalive = false) => request<void>(`/memory/${id}`, { method: 'DELETE', keepalive }),

  recall: (query: string, maxTokens = 2000) =>
    request<{ context: string; memories: unknown[]; latencyMs: number }>('/recall', {
      method: 'POST',
      body: JSON.stringify({ query, maxTokens }),
    }),

  explainRecall: (query: string, maxTokens = 2000, namespace?: string | null) =>
    request<RecallExplanation>('/recall/explain', {
      method: 'POST',
      body: JSON.stringify({ query, maxTokens, namespace: namespace ?? undefined, global: namespace === null ? true : undefined }),
    }),

  /** `threshold` is the server's cosine floor (0.3 when left out). */
  search: (query: string, topK = 10, types?: string[], namespace?: string | null, threshold?: number) =>
    request<{ count: number; results: unknown[] }>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, topK, threshold, types, namespace: namespace ?? undefined, global: namespace === null ? true : undefined }),
    }),

  // depth is explicit: the server defaults to 2, and the 3D view only draws
  // direct connections — a 2-hop neighbourhood per node produced ~12x the edges.
  getGraph: (id: string, depth = 1) =>
    request<{ node: unknown; connections: Array<{ id: string; sourceId: string; targetId: string; relationship: string; strength: number }>; neighbors: unknown[] }>(`/graph/${id}?depth=${depth}`),

  /** The map for one scope: a path is one project, `null` the global
   *  memories, and leaving it out every memory. */
  getMap: (namespace?: string | null) => {
    const q = new URLSearchParams();
    if (typeof namespace === 'string') q.set('namespace', namespace);
    if (namespace === null) q.set('global', 'true');
    const query = q.toString();
    return request<MapPayload>(`/map${query ? `?${query}` : ''}`);
  },

  /**
   * Every edge between live memories, ids only. The map's Faults lens draws
   * the `contradicts` ones from here: GET /contradictions carries both
   * memories' text with each pair, about 1.8 KB a pair, where this is ids.
   */
  getGraphEdges: (minStrength = 0) =>
    request<EdgeSummary>(`/graph/edges?minStrength=${minStrength}`),

  // Tags
  addTag: (memoryId: string, tag: string) =>
    request<{ id: string; tags: string[] }>(`/memory/${memoryId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    }),

  removeTag: (memoryId: string, tag: string) =>
    request<{ id: string; tags: string[] }>(`/memory/${memoryId}/tags/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    }),

  // Contradictions
  getContradictions: () =>
    request<{
      count: number;
      contradictions: Array<{
        edgeId: string;
        confidence: number;
        source: { id: string; content: string; type: string; importance: number };
        target: { id: string; content: string; type: string; importance: number };
      }>;
    }>('/contradictions'),

  resolveContradiction: (sourceId: string, targetId: string, strategy: string, keepalive = false) =>
    request<{ resolved: boolean; archivedId?: string; keptId?: string }>('/contradictions/resolve', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId, strategy }),
      keepalive,
    }),

  bulkResolveContradictions: (items: ContradictionResolution[]) =>
    request<{
      results: Array<{ ok: boolean; error?: string }>;
      summary: { total: number; resolved: number; failed: number };
    }>('/contradictions/bulk/resolve', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  /**
   * GET /api/decay/policy — the server's own decay configuration.
   *
   * The memory sheet and the map read the archive threshold from here, so it
   * is the server's rather than a constant the client picked.
   */
  getDecayPolicy: () =>
    request<{ halfLifeDays: number; archiveThreshold: number; decayIntervalMs?: number }>('/decay/policy'),

  /** GET /api/sync/status — `{ enabled: false }` when ENGRAM_SYNC_URL is unset. */
  getSyncStatus: () =>
    request<{
      enabled: boolean;
      state?: 'idle' | 'pushing' | 'pulling' | 'error';
      lastSyncAt?: string | null;
      pendingPushCount?: number;
      lastError?: string | null;
    }>('/sync/status'),

  /** GET /api/embeddings/status — the model and how many memories it has embedded. */
  getEmbeddingStatus: () =>
    request<{
      currentModel: string;
      currentDimension: number;
      totalEmbedded: number;
      staleCount: number;
      legacyCount: number;
      dimensionMismatchCount: number;
      needsReEmbed: boolean;
    }>('/embeddings/status'),

  /** GET /api/index/status — the vector index search reads. */
  getIndexStatus: () => request<{ entryCount: number; loadedFrom: string; persisted: boolean }>('/index/status'),

  /**
   * GET /api/analytics — windowed and all-time figures, with the window stated.
   *
   * `days` (1-365) is the ONLY accepted query parameter; anything else is a
   * 400, so no cache-buster may be appended here. The response shape lives in
   * store/analyticsStore.ts, which also owns the boundary guard the view runs
   * before trusting it.
   */
  getAnalytics: (days = 30) => request<AnalyticsData>(`/analytics?days=${days}`),

  // Reflections
  getReflections: (limit = 20, type?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (type) q.set('type', type);
    return request<{
      count: number;
      reflections: Array<{
        id: string;
        type: string;
        content: string;
        importance: number;
        confidence: number;
        tags: string[];
        createdAt: string;
      }>;
    }>(`/reflections?${q}`);
  },

  // Reflection is AI-driven (via MCP request_reflection / store_reflection).
  // The dashboard only reports scheduling state and lists stored insights.
  getReflectionStatus: () =>
    request<{ enabled: boolean; due: boolean; counter: number; threshold: number }>('/reflection/status'),

  // W15: deliberate future API, not dead code — these three match real,
  // working server routes (PATCH /memory/:id, POST /memory/bulk/tag,
  // POST /memory/bulk/archive) for inline editing and multi-select bulk
  // actions that the dashboard UI doesn't expose yet. Removing the client
  // methods wouldn't shrink the shipped bundle meaningfully (they're a few
  // lines each, no extra dependency), so there's nothing to gain by
  // deleting them ahead of the UI that will call them.

  // Inline edit
  updateMemory: (id: string, body: { content?: string; importance?: number; tags?: string[]; concept?: string }) =>
    request<{ id: string; content: string; importance: number; tags: string; concept: string | null; updatedAt: string }>(
      `/memory/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  // Bulk operations
  bulkTag: (ids: string[], tag: string) =>
    request<{ modified: number; total: number }>('/memory/bulk/tag', {
      method: 'POST',
      body: JSON.stringify({ ids, tag }),
    }),

  bulkArchive: (ids: string[], keepalive = false) =>
    request<{ archived: number; total: number }>('/memory/bulk/archive', {
      method: 'POST',
      body: JSON.stringify({ ids }),
      keepalive,
    }),

  // Review
  getReviewSummary: (namespace?: string | null) =>
    request<ReviewSummary>(`/review/summary${scopeQuery(namespace)}`),

  getReviewQueue: (queue: ReviewQueue, params: { namespace?: string | null; limit?: number; offset?: number } = {}) =>
    request<{ total: number; items: ReviewItem[] }>(
      `/review/${queue}${scopeQuery(params.namespace, { limit: String(params.limit ?? 50), offset: String(params.offset ?? 0) })}`
    ),

  /** Drops an item from its queue on this device. Contradictions are not
   *  dismissed: "not a contradiction" is resolveContradiction(keep_both). */
  dismissReview: (queue: Exclude<ReviewQueue, 'contradictions'>, ids: string[]) =>
    request<void>('/review/dismiss', { method: 'POST', body: JSON.stringify({ queue, ids }) }),

  /** Replaces the memory's detected secrets with [REDACTED] on the server.
   *  No text comes back, only how many spans changed. */
  redactMemory: (id: string, rules?: string[]) =>
    request<{ id: string; redacted: number }>(`/memory/${id}/redact`, {
      method: 'POST',
      body: JSON.stringify(rules ? { rules } : {}),
    }),
};
