import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const directory = mkdtempSync(join(tmpdir(), 'engram-decay-route-'));
let app: FastifyInstance;
let brain: typeof import('../index.ts')['brain'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = join(directory, 'test.db');
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  const server = await import('../index.ts');
  brain = server.brain;
  await brain.initialize();
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

it('enables, changes and disables the decay timer without resetting consolidation siblings', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const sweep = vi.spyOn(brain, 'runDecaySweep').mockResolvedValue({ scannedCount: 0,
    archivedCount: 0, archivedIds: [], decayedCount: 0, protectedCount: 0,
    consolidatedCount: 0, newSemanticIds: [], durationMs: 0 });
  const consolidation = { enabled: true, minClusterSize: 8, similarityThreshold: 0.9, minEpisodicAgeMs: 1234 };
  const put = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/decay/policy', payload });
  try {
    expect((await put({ consolidation, decayIntervalMs: 100 })).statusCode).toBe(200);
    await vi.advanceTimersByTimeAsync(100);
    expect(sweep).toHaveBeenCalledTimes(1);
    const response = await put({ consolidation: { enabled: false }, decayIntervalMs: 250 });
    expect(response.statusCode).toBe(200);
    expect(response.json().consolidation).toEqual({ ...consolidation, enabled: false });
    await vi.advanceTimersByTimeAsync(249);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);
    await put({ decayIntervalMs: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);
  } finally {
    await put({ decayIntervalMs: 0 });
    sweep.mockRestore();
    vi.useRealTimers();
  }
});
