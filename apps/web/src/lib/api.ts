import { getStoredApiKey } from './apiKey.js';
import { useAuthStore } from '../store/authStore.js';

const BASE = '/api';

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

export const api = {
  // W15: no UI calls this today (it's the request()-helper test suite's
  // stand-in endpoint), but it mirrors a real server route and is exactly
  // the kind of small, self-contained method a future "server status" /
  // uptime indicator would want — kept rather than deleted only to be
  // re-added.
  health: () => request<{ status: string; uptime: number }>('/health'),

  stats: () =>
    request<{
      total: number;
      byType: Record<string, number>;
      bySource: Record<string, number>;
    }>('/stats'),

  listMemories: (params?: { type?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set('type', params.type);
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

  deleteMemory: (id: string) => request<void>(`/memory/${id}`, { method: 'DELETE' }),

  recall: (query: string, maxTokens = 2000) =>
    request<{ context: string; memories: unknown[]; latencyMs: number }>('/recall', {
      method: 'POST',
      body: JSON.stringify({ query, maxTokens }),
    }),

  search: (query: string, topK = 10, types?: string[]) =>
    request<{ count: number; results: unknown[] }>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, topK, types }),
    }),

  // depth is explicit: the server defaults to 2, and the 3D view only draws
  // direct connections — a 2-hop neighbourhood per node produced ~12x the edges.
  getGraph: (id: string, depth = 1) =>
    request<{ node: unknown; connections: Array<{ id: string; sourceId: string; targetId: string; relationship: string; strength: number }>; neighbors: unknown[] }>(`/graph/${id}?depth=${depth}`),

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

  resolveContradiction: (sourceId: string, targetId: string, strategy: string) =>
    request<{ resolved: boolean; archivedId?: string; keptId?: string }>('/contradictions/resolve', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId, strategy }),
    }),

  // Analytics
  getAnalytics: (days = 30) =>
    request<{
      total: number;
      avgImportance: number;
      byType: Record<string, number>;
      bySource: Record<string, number>;
      dailyGrowth: Array<{ date: string; count: number }>;
      hourlyActivity: Array<{ hour: number; dayOfWeek: number; count: number }>;
      topConcepts: Array<{ concept: string; count: number; avgImportance: number }>;
    }>(`/analytics?days=${days}`),

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

  bulkArchive: (ids: string[]) =>
    request<{ archived: number; total: number }>('/memory/bulk/archive', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};
