/**
 * The scene's data source. Small, but it carries the same two contracts every
 * other request in this app has to honour: send the stored API key, and let a
 * 401 raise the unlock gate globally rather than being reinterpreted by each
 * caller.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchEdges, fetchLayout } from '../graphSource.js';
import { useAuthStore } from '../../../store/authStore.js';
import { ApiError } from '../../../lib/api.js';

const STORAGE_KEY = 'engram_api_key';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('graphSource', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAuthStore.setState({ locked: false, hadKey: false });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the projection from the layout endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ method: 'pca3', nodes: [] })
    );
    const result = await fetchLayout();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/graph/layout');
    expect(result.method).toBe('pca3');
  });

  it('asks for every edge by default, and states the filter when one is given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ edges: [] }));
    await fetchEdges();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/graph/edges?minStrength=0');

    await fetchEdges(0.9);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/graph/edges?minStrength=0.9');
  });

  it('sends the stored API key', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'secret-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ nodes: [] }));
    await fetchLayout();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
  });

  it('raises the unlock gate on a 401 instead of leaving the scene to guess', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
    await expect(fetchLayout()).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().locked).toBe(true);
  });

  it('surfaces a network failure as an ApiError rather than a raw TypeError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchEdges()).rejects.toMatchObject({ status: 0 });
  });

  it('reports a timeout distinctly', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort);
    await expect(fetchLayout()).rejects.toThrow(/timed out/i);
  });

  it('does not lock the gate for a non-401 failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    await expect(fetchEdges()).rejects.toMatchObject({ status: 500 });
    expect(useAuthStore.getState().locked).toBe(false);
  });
});
