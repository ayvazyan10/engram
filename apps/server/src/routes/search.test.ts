import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

vi.mock('@engram-ai-memory/core', () => import('../../../../packages/core/src/index.ts'));
vi.mock('../../../../packages/core/src/embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../packages/core/src/embedding/Embedder.ts')>(),
  embed: async () => new Float32Array(384).fill(1),
}));

const directory = mkdtempSync(join(tmpdir(), 'engram-rest-filters-'));
const filters = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z', tags: ['project', 'release'] };
let app: FastifyInstance;
let brain: typeof import('../index.ts')['brain'];
let matchingId: string;

beforeAll(async () => {
  vi.stubEnv('ENGRAM_DB_PATH', join(directory, 'test.db'));
  vi.stubEnv('ENGRAM_SYNC_URL', '');
  vi.stubEnv('ENGRAM_DECAY_INTERVAL', '0');
  const mod = await import('../index.ts');
  brain = mod.brain;
  await brain.initialize();
  for (const [content, date, tags] of [
    ['Before', '2025-12-31', filters.tags],
    ['After', '2026-02-01', filters.tags],
    ['One tag', '2026-01-15', ['project']],
    ['Matching', '2026-01-15', filters.tags],
  ] as const) {
    const memory = await brain.episodic.store({ content, eventAt: new Date(`${date}T00:00:00Z`), tags: [...tags] });
    if (content === 'Matching') matchingId = memory.id;
  }
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe.each(['/api/search', '/api/recall'])('POST %s filters', (url) => {
  it('accepts and applies the date window and all tags', async () => {
    const response = await app.inject({ method: 'POST', url, payload: { query: 'query', ...filters } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect((body.results ?? body.memories).map((memory: { id: string }) => memory.id)).toEqual([matchingId]);
  });

  it.each([{ since: 'yesterday' }, { until: '2026-01-15' }, { tags: 'project' }, { tags: [1] }, { since: [filters.since] }])(
    'rejects invalid filters: %j', async (invalid) => {
      const response = await app.inject({ method: 'POST', url, payload: { query: 'query', ...invalid } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'Bad Request' });
    },
  );
});

it('applies filters before emitting any SSE memories', async () => {
  const query = new URLSearchParams({ query: 'query', since: filters.since, until: filters.until });
  for (const tag of filters.tags) query.append('tags', tag);
  const response = await app.inject({ method: 'GET', url: `/api/recall/stream?${query}` });
  expect(response.statusCode).toBe(200);
  const chunks = response.body.split('\n').filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
  expect(chunks.filter((chunk) => chunk.memory).map((chunk) => chunk.memory.id)).toEqual([matchingId]);
  expect(chunks.at(-1)).toMatchObject({ phase: 'complete', memories: [{ id: matchingId }] });
});

it('rejects malformed SSE dates before opening the stream', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/recall/stream?query=query&since=yesterday' });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'Bad Request' });
});
