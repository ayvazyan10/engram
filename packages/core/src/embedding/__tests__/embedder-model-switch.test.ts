/**
 * Regression test for getEmbedder() during a model switch.
 *
 * When switchEmbeddingModel() landed while a first load was in flight, the
 * finished pipeline was correctly NOT cached — but it was still handed back to
 * every caller waiting on that load. store() then tagged the resulting vector
 * with the NEW model id, so the row claimed a model that never produced it and
 * nothing downstream could tell it apart from a current one.
 */

import { describe, it, expect, vi } from 'vitest';

interface PendingLoad {
  model: string;
  finish: () => void;
}

const loads: PendingLoad[] = [];

vi.mock('@xenova/transformers', () => ({
  pipeline: (_task: string, model: string) =>
    new Promise((resolve) => {
      loads.push({ model, finish: () => resolve({ model }) });
    }),
}));

const { getEmbedder, switchEmbeddingModel } = await import('../Embedder.js');

describe('getEmbedder during switchEmbeddingModel', () => {
  it('never returns a pipeline for a model that is no longer active', async () => {
    switchEmbeddingModel('Xenova/gte-small');

    const pending = getEmbedder();
    await vi.waitFor(() => expect(loads).toHaveLength(1));
    expect(loads[0]!.model).toBe('Xenova/gte-small');

    // The active model changes while the first load is still running.
    switchEmbeddingModel('Xenova/bge-base-en-v1.5');
    loads[0]!.finish();

    // The stale result must be discarded and the new model loaded instead.
    await vi.waitFor(() => expect(loads).toHaveLength(2));
    expect(loads[1]!.model).toBe('Xenova/bge-base-en-v1.5');
    loads[1]!.finish();

    const pipe = (await pending) as { model: string };
    expect(pipe.model).toBe('Xenova/bge-base-en-v1.5');

    // And the cache now holds the new model, not the abandoned one.
    const cached = (await getEmbedder()) as { model: string };
    expect(cached.model).toBe('Xenova/bge-base-en-v1.5');
    expect(loads).toHaveLength(2);
  });
});
