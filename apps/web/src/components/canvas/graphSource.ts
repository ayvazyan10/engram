/**
 * The scene's own data source: the projection and the full edge set.
 *
 * SCOPE NOTE — this deliberately does not live in `lib/api.ts`, which is being
 * rewritten in parallel by another agent and is outside this change's remit.
 * It repeats about fifteen lines of that module's request helper (key header,
 * timeout, 401 -> unlock gate) rather than editing a file two people would then
 * both be holding. Fold it back into `lib/api.ts` once that work has landed.
 */

import { getStoredApiKey } from '../../lib/apiKey.js';
import { ApiError } from '../../lib/api.js';
import { useAuthStore } from '../../store/authStore.js';
import type { SceneNodeInput } from '../../store/viewStore.js';

const BASE = '/api';
const REQUEST_TIMEOUT_MS = 20000;

export interface LayoutResponse {
  method: 'pca3' | 'fallback';
  fingerprint: string;
  generatedAt: string;
  halfExtent: number;
  count: number;
  projected: number;
  unprojected: number;
  explainedVariance: number[];
  embeddingModel: string | null;
  computeMs: number;
  nodes: SceneNodeInput[];
}

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

async function getJson<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const apiKey = getStoredApiKey();
  if (apiKey) headers['X-API-Key'] = apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { headers, signal: controller.signal });
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : 'Network error';
    throw new ApiError(0, `${message}: ${path}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // Same contract as lib/api.ts: a 401 raises the unlock gate globally
    // rather than being interpreted separately by every caller.
    if (res.status === 401) useAuthStore.getState().lock(Boolean(apiKey));
    throw new ApiError(res.status, `API ${res.status}: ${path}`);
  }
  return (await res.json()) as T;
}

/** Every memory's 3D coordinate, projected from its embedding server-side. */
export function fetchLayout(): Promise<LayoutResponse> {
  return getJson<LayoutResponse>('/graph/layout');
}

/**
 * Every renderable edge.
 *
 * No filter by default: the live store has 3,102 edges whose endpoints are both
 * visible, which is one `LineSegments` draw call and perfectly legible. The
 * response reports `total`/`stored` regardless, so the scene key can state what
 * is on screen and what is not — the previous client asked for the top 30
 * memories' neighbourhoods and rendered 67 edges out of thousands with no hint
 * that anything was missing.
 */
export function fetchEdges(minStrength = 0): Promise<EdgeSummary> {
  return getJson<EdgeSummary>(`/graph/edges?minStrength=${minStrength}`);
}
