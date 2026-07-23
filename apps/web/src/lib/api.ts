const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { headers, ...init });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
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

  deleteMemory: (id: string) =>
    fetch(`${BASE}/memory/${id}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error(`API ${r.status}: DELETE /memory/${id}`);
    }),

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

  getGraph: (id: string) =>
    request<{ node: unknown; connections: Array<{ id: string; sourceId: string; targetId: string; relationship: string; strength: number }>; neighbors: unknown[] }>(`/graph/${id}`),

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
