import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, ApiError } from '../api.js';
import { useAuthStore } from '../../store/authStore.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('lib/api request helper (F2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    sessionStorage.clear();
    useAuthStore.setState({ locked: false, hadKey: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('does not send an X-API-Key header when no key is stored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { status: 'ok', uptime: 1 }));

    await api.health();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has('X-API-Key')).toBe(false);
  });

  it('sends the sessionStorage-stored key as X-API-Key on every request', async () => {
    sessionStorage.setItem('engram_api_key', 'secret-123');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { status: 'ok', uptime: 1 }));

    await api.health();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('X-API-Key')).toBe('secret-123');
  });

  it('surfaces the server error body instead of discarding it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(400, { error: 'content is required' }));

    await expect(api.storeMemory({ content: '' })).rejects.toThrow('content is required');
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 })
    );

    await expect(api.health()).rejects.toThrow('API 500: /health');
  });

  it('throws an ApiError carrying the status code on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));

    const err = await api.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('times out instead of hanging forever on a stuck request', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    const pending = api.health().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30000);
    const err = await pending;

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/timed out/i);
    vi.useRealTimers();
  });

  it('deleteMemory goes through the shared request helper (picks up auth + error handling)', async () => {
    sessionStorage.setItem('engram_api_key', 'secret-123');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.deleteMemory('mem-1')).resolves.toBeUndefined();

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/memory/mem-1');
    expect(init?.method).toBe('DELETE');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-API-Key')).toBe('secret-123');
  });

  it('deleteMemory surfaces the server error body on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { error: 'memory not found' }));

    await expect(api.deleteMemory('missing')).rejects.toThrow('memory not found');
  });

  describe('auth gate integration (F2)', () => {
    it('locks the gate on a 401 with hadKey=false when no key was stored', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));

      await expect(api.health()).rejects.toThrow();

      expect(useAuthStore.getState()).toMatchObject({ locked: true, hadKey: false });
    });

    it('locks the gate on a 401 with hadKey=true when a (wrong) key was stored', async () => {
      sessionStorage.setItem('engram_api_key', 'wrong-key');
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }));

      await expect(api.health()).rejects.toThrow();

      expect(useAuthStore.getState()).toMatchObject({ locked: true, hadKey: true });
    });

    it('does not lock the gate on a non-401 failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

      await expect(api.health()).rejects.toThrow();

      expect(useAuthStore.getState().locked).toBe(false);
    });

    it('clears a stale lock on a successful response', async () => {
      useAuthStore.setState({ locked: true, hadKey: true });
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { status: 'ok', uptime: 1 }));

      await api.health();

      expect(useAuthStore.getState().locked).toBe(false);
    });
  });
});

describe('lib/api endpoint coverage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    sessionStorage.clear();
    useAuthStore.setState({ locked: false, hadKey: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('stats() hits GET /stats', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { total: 0, byType: {}, bySource: {} }));
    await api.stats();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/stats');
  });

  it('listMemories() builds the query string from type/limit/offset', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { count: 0, memories: [] }));
    await api.listMemories({ type: 'semantic', limit: 10, offset: 5 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('type=semantic');
    expect(String(url)).toContain('limit=10');
    expect(String(url)).toContain('offset=5');
  });

  it('listMemories() omits query params that were not given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { count: 0, memories: [] }));
    await api.listMemories();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).not.toContain('type=');
  });

  it('recall() POSTs the query and maxTokens', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { context: '', memories: [], latencyMs: 1 }));
    await api.recall('hello', 500);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ query: 'hello', maxTokens: 500 });
  });

  it('search() POSTs the query, topK, and types', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { count: 0, results: [] }));
    await api.search('hello', 5, ['semantic']);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({ query: 'hello', topK: 5, types: ['semantic'] });
  });

  it('getGraph() defaults depth to 1', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { node: null, connections: [], neighbors: [] }));
    await api.getGraph('mem-1');
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/graph/mem-1?depth=1');
  });

  it('addTag() POSTs to the tags route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'mem-1', tags: ['a'] }));
    await api.addTag('mem-1', 'a');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/memory/mem-1/tags');
    expect(init?.method).toBe('POST');
  });

  it('removeTag() DELETEs the encoded tag route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { id: 'mem-1', tags: [] }));
    await api.removeTag('mem-1', 'a b');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/memory/mem-1/tags/a%20b');
    expect(init?.method).toBe('DELETE');
  });

  it('getContradictions() hits GET /contradictions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { count: 0, contradictions: [] }));
    await api.getContradictions();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/contradictions');
  });

  it('resolveContradiction() POSTs source/target/strategy', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { resolved: true }));
    await api.resolveContradiction('a', 'b', 'keep_newest');
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({ sourceId: 'a', targetId: 'b', strategy: 'keep_newest' });
  });

  it('getAnalytics() defaults days to 30', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, {
      total: 0, avgImportance: 0, byType: {}, bySource: {}, dailyGrowth: [], hourlyActivity: [], topConcepts: [],
    }));
    await api.getAnalytics();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/analytics?days=30');
  });

  it('getReflections() builds limit and optional type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { count: 0, reflections: [] }));
    await api.getReflections(5, 'pattern');
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('limit=5');
    expect(String(url)).toContain('type=pattern');
  });

  it('getReflectionStatus() hits GET /reflection/status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { enabled: true, due: false, counter: 0, threshold: 10 }));
    await api.getReflectionStatus();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/reflection/status');
  });

  it('updateMemory() PATCHes the memory route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, {
      id: 'mem-1', content: 'x', importance: 0.5, tags: '[]', concept: null, updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    await api.updateMemory('mem-1', { content: 'x' });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/memory/mem-1');
    expect(init?.method).toBe('PATCH');
  });

  it('bulkTag() POSTs ids and tag', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { modified: 2, total: 2 }));
    await api.bulkTag(['a', 'b'], 'tag');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/memory/bulk/tag');
    expect(JSON.parse(init?.body as string)).toEqual({ ids: ['a', 'b'], tag: 'tag' });
  });

  it('bulkArchive() POSTs ids', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { archived: 2, total: 2 }));
    await api.bulkArchive(['a', 'b']);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/memory/bulk/archive');
    expect(JSON.parse(init?.body as string)).toEqual({ ids: ['a', 'b'] });
  });
});
