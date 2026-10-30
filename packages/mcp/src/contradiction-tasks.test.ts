import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NeuralBrain, getDb, schema } from '@engram-ai-memory/core';
import { registerTools } from './tools.ts';

vi.mock('@engram-ai-memory/core', () => import('../../core/src/index.ts'));
let directory: string;
let brain: NeuralBrain;
let client: Client;
let server: McpServer;
const notifyWrite = vi.fn();
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-verify-'));
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), namespaceMode: 'filter', namespace: 'project' });
  await brain.initialize();
  server = new McpServer({ name: 'verify-test', version: '1.0.0' });
  registerTools(server, brain, async () => {}, { notifyWrite });
  client = new Client({ name: 'verify-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
});
afterEach(async () => {
  await client.close();
  await server.close();
  brain.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  notifyWrite.mockClear();
});
function seed(namespace: string | null = 'project', metadata = '{}', archivedAt: string | null = null) {
  const sourceId = randomUUID();
  const targetId = randomUUID();
  getDb().insert(schema.memories).values([
    { id: sourceId, type: 'semantic', content: 'New fact', namespace, source: 'client', createdAt: '2026-10-02', archivedAt },
    { id: targetId, type: 'semantic', content: 'Old fact', namespace: 'project', source: 'notes', createdAt: '2026-10-01' },
  ]).run();
  getDb().insert(schema.memoryConnections).values({ id: randomUUID(), sourceId, targetId,
    relationship: 'contradicts', strength: 0.8, metadata }).run();
  return { sourceId, targetId };
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return { isError: result.isError, text: blocks.map((block) => block.text ?? '').join('\n') };
}
it('returns complete pending pairs, including legacy and shared, filtering before limit', async () => {
  seed('foreign');
  seed('project', '{"status":"confirmed"}');
  seed('project', '{}', '2026-10-03');
  const own = seed('project', '{"signals":["negation"],"suggestedStrategy":"keep_both"}');
  const shared = seed(null);
  const result = await call('get_contradiction_tasks', { limit: 2 });
  expect(result.isError).not.toBe(true);
  const tasks = JSON.parse(result.text).tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: { id: own.sourceId, content: 'New fact', createdAt: '2026-10-02', source: 'client' },
      target: { id: own.targetId, content: 'Old fact', createdAt: '2026-10-01', source: 'notes' },
      confidence: 0.8, signals: ['negation'], suggestedStrategy: 'keep_both' }),
    expect.objectContaining({ source: expect.objectContaining({ id: shared.sourceId }) }),
  ]));
});
it('applies default and explicit limits and reports an empty queue', async () => {
  expect(JSON.parse((await call('get_contradiction_tasks')).text).tasks).toEqual([]);
  for (let i = 0; i < 21; i++) seed();
  expect(JSON.parse((await call('get_contradiction_tasks')).text).tasks).toHaveLength(20);
  expect(JSON.parse((await call('get_contradiction_tasks', { limit: 1 })).text).tasks).toHaveLength(1);
});
it.each([0, 101, 1.5, '2'])('rejects invalid limit %s', async (limit) => {
  expect((await call('get_contradiction_tasks', { limit })).isError).toBe(true);
});
it.each(['contradiction', 'none'])('records %s and notifies sync', async (verdict) => {
  const pair = seed();
  expect((await call('complete_contradiction_check', { ...pair, verdict })).isError).not.toBe(true);
  expect(await brain.getContradictionTasks()).toEqual([]);
  expect(await brain.getContradictions()).toHaveLength(verdict === 'contradiction' ? 1 : 0);
  expect(notifyWrite).toHaveBeenCalledTimes(1);
  expect(getDb().select().from(schema.memories).all().every((row) => !row.archivedAt)).toBe(true);
});
it('confirms before resolving with keep_newest', async () => {
  const pair = seed();
  const result = await call('complete_contradiction_check', { ...pair, verdict: 'contradiction', strategy: 'keep_newest' });
  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.text).resolution).toMatchObject({ resolved: true, archivedId: pair.targetId });
  expect(await brain.getContradictions()).toEqual([]);
  expect(notifyWrite).toHaveBeenCalledTimes(2);
});
it.each(['foreign', 'archived', 'missing', 'dismissed'])('rejects %s pairs without writes', async (kind) => {
  const pair = seed(kind === 'foreign' ? 'foreign' : 'project',
    kind === 'dismissed' ? '{"status":"dismissed"}' : '{}', kind === 'archived' ? '2026-10-03' : null);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await call('complete_contradiction_check', { ...pair,
    sourceId: kind === 'missing' ? randomUUID() : pair.sourceId, verdict: 'contradiction' });
  expect(result.isError).toBe(true);
  expect(notifyWrite).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalled();
});
it('validates ids, verdict, and strategy at the boundary', async () => {
  const pair = seed();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const args of [{}, { ...pair, verdict: 'yes' }, { ...pair, sourceId: '', verdict: 'none' },
    { ...pair, verdict: 'contradiction', strategy: 'bad' }, { ...pair, verdict: 'none', strategy: 'keep_newest' }]) {
    expect((await call('complete_contradiction_check', args)).isError).toBe(true);
  }
  expect(await brain.getContradictionTasks()).toHaveLength(1);
  expect(notifyWrite).not.toHaveBeenCalled();
});
it('reports read failures explicitly', async () => {
  vi.spyOn(brain, 'getContradictionTasks').mockRejectedValueOnce(new Error('read failed'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await call('get_contradiction_tasks')).isError).toBe(true);
  expect(log).toHaveBeenCalledWith('[engram-mcp] get_contradiction_tasks failed:', expect.any(Error));
});
