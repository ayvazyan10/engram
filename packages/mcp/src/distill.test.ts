import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NeuralBrain, getDb, schema } from '@engram-ai-memory/core';
import { registerTools } from './tools.ts';
import { getPendingDistillSessions, storeSession } from './store-session.ts';

vi.mock('@engram-ai-memory/core', () => import('../../core/src/index.ts'));
vi.mock('../../core/src/embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../core/src/embedding/Embedder.ts')>(),
  embed: async (text: string) => {
    const bytes = createHash('sha512').update(text).digest();
    return Float32Array.from({ length: 384 }, (_, i) => (bytes[i % bytes.length]! - 128) / 128);
  },
}));

let directory: string;
let brain: NeuralBrain;
let client: Client;
let server: McpServer;
const notifyWrite = vi.fn();

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-distill-'));
  vi.stubEnv('ENGRAM_DB_PATH', join(directory, 'test.db'));
  vi.stubEnv('ENGRAM_SOURCE', 'distill-test');
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '0.97');
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), namespaceMode: 'filter', namespace: 'project' });
  await brain.initialize();
  server = new McpServer({ name: 'distill-test', version: '1.0.0' });
  registerTools(server, brain, async () => {}, { notifyWrite });
  client = new Client({ name: 'distill-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  brain.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  notifyWrite.mockClear();
});

function seed(namespace: string | null = 'project', tags = ['pending-distill'], archivedAt: string | null = null): string {
  const id = randomUUID();
  getDb().insert(schema.memories).values({
    id, type: 'episodic', content: 'Raw session notes '.repeat(500), namespace,
    tags: JSON.stringify(tags), archivedAt, createdAt: '2026-10-01T12:00:00.000Z',
  }).run();
  return id;
}

function rows() { return getDb().select().from(schema.memories).all(); }

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return { isError: result.isError, text: blocks.map((block) => block.text ?? '').join('\n') };
}

it('tags hook-stored raw sessions pending-distill in their project namespace', async () => {
  await storeSession('Implemented the session distillation tools', {
    ENGRAM_DB_PATH: join(directory, 'test.db'), ENGRAM_NAMESPACE_MODE: 'filter', ENGRAM_NAMESPACE: 'project',
  });
  const [raw] = rows();
  expect(raw).toMatchObject({ content: 'Implemented the session distillation tools', type: 'episodic', namespace: 'project' });
  expect(JSON.parse(raw!.tags)).toEqual(['session-summary', 'auto-stored', 'pending-distill']);
});

describe('get_distill_tasks', () => {
  it('returns own project and global pending sessions, with bounded content and metadata', async () => {
    seed('other');
    seed('project', ['pending-distill-extra']);
    seed('project', ['pending-distill'], '2026-10-02T00:00:00.000Z');
    const own = seed();
    const global = seed(null);
    const result = await call('get_distill_tasks', { limit: 2 });
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain('complete_distill');
    const tasks = JSON.parse(result.text.split('\n\n')[1]!) as Array<Record<string, unknown>>;
    expect(tasks).toEqual([
      { id: own, date: '2026-10-01T12:00:00.000Z', namespace: 'project', content: 'Raw session notes '.repeat(500).slice(0, 6000) },
      { id: global, date: '2026-10-01T12:00:00.000Z', namespace: null, content: 'Raw session notes '.repeat(500).slice(0, 6000) },
    ]);
    expect(rows().find((row) => row.id === own)?.archivedAt).toBeNull();
  });

  it('applies the requested and default limits after filtering', async () => {
    for (let i = 0; i < 25; i++) seed();
    expect((await call('get_distill_tasks')).text).toMatch(/^20 distillation/);
    expect((await call('get_distill_tasks', { limit: 1 })).text).toMatch(/^1 distillation/);
  });

  it.each([0, 101, 1.5, '2'])('rejects invalid limit %s', async (limit) => {
    expect((await call('get_distill_tasks', { limit })).isError).toBe(true);
  });

  it('reports an empty queue', async () => {
    expect((await call('get_distill_tasks')).text).toBe('No pending sessions to distill.');
  });

  it('logs and reports task read failures', async () => {
    vi.spyOn(brain, 'getByTag').mockRejectedValueOnce(new Error('read failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('get_distill_tasks')).isError).toBe(true);
    expect(log).toHaveBeenCalledWith('[engram-mcp] get_distill_tasks failed:', expect.any(Error));
  });

  it.each([
    ['isolated', 'project', ['project']],
    ['filter', undefined, [null]],
    ['none', undefined, ['project', 'other', null]],
  ] as const)('uses core scope rules for %s mode', async (namespaceMode, namespace, expected) => {
    seed('project');
    seed('other');
    seed(null);
    // The helper is shared with SessionStart, so these cover its count scope too.
    const view = new NeuralBrain({ dbPath: join(directory, 'test.db'), namespaceMode, namespace });
    await view.initialize();
    try {
      expect((await getPendingDistillSessions(view)).map((row) => row.namespace)).toEqual(expected);
    } finally {
      view.shutdown();
    }
  });
});

describe('complete_distill', () => {
  it('stores facts through core, maps global, then archives the raw session', async () => {
    const id = seed();
    const store = vi.spyOn(brain, 'store');
    const forget = vi.spyOn(brain, 'forget');
    const result = await call('complete_distill', { id, facts: [
      { content: 'Use pnpm for this project', type: 'procedural', importance: 0.8, tags: ['workflow'], global: false },
      { content: 'The user prefers concise answers', global: true },
    ] });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ id, archived: true });
    expect(rows().find((row) => row.id === id)?.archivedAt).toBeTruthy();
    expect(rows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Use pnpm for this project', namespace: 'project', type: 'procedural', importance: 0.8, tags: '["workflow"]', source: 'distill-test' }),
      expect.objectContaining({ content: 'The user prefers concise answers', namespace: null, type: 'semantic' }),
    ]));
    expect(forget.mock.invocationCallOrder[0]).toBeGreaterThan(store.mock.invocationCallOrder[1]!);
    expect(notifyWrite).toHaveBeenCalledTimes(3);
  });

  it.each(['missing', 'untagged', 'foreign', 'archived'] as const)('refuses %s ids without storing facts', async (kind) => {
    const id = kind === 'missing' ? randomUUID()
      : seed(kind === 'foreign' ? 'other' : 'project', kind === 'untagged' ? [] : ['pending-distill'],
        kind === 'archived' ? '2026-10-02T00:00:00.000Z' : null);
    const store = vi.spyOn(brain, 'store');
    const forget = vi.spyOn(brain, 'forget');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('complete_distill', { id, facts: [{ content: 'Must not be stored' }] })).isError).toBe(true);
    expect(store).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('leaves the raw memory and first fact live when the second store fails', async () => {
    const id = seed();
    const originalStore = brain.store.bind(brain);
    const store = vi.spyOn(brain, 'store').mockImplementationOnce(originalStore)
      .mockRejectedValueOnce(new Error('fact store failed'));
    const forget = vi.spyOn(brain, 'forget');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await call('complete_distill', { id, facts: [{ content: 'First durable fact' }, { content: 'Second fact' }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('fact store failed');
    expect(store).toHaveBeenCalledTimes(2);
    expect(forget).not.toHaveBeenCalled();
    expect(rows().find((row) => row.id === id)?.archivedAt).toBeNull();
    expect(rows()).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'First durable fact', archivedAt: null })]));
    expect((await getPendingDistillSessions(brain)).map((row) => row.id)).toContain(id);
    expect(log).toHaveBeenCalledWith('[engram-mcp] complete_distill failed:', expect.any(Error));
  });

  it('can finish an empty extraction, including a global session', async () => {
    const id = seed(null);
    expect((await call('complete_distill', { id, facts: [] })).isError).not.toBe(true);
    expect(rows().find((row) => row.id === id)?.archivedAt).toBeTruthy();
  });

  it('uses existing deduplication for repeated facts', async () => {
    const id = seed();
    const fact = { content: 'The project uses TypeScript', type: 'semantic' as const };
    const existing = await brain.store(fact);
    const result = await call('complete_distill', { id, facts: [fact] });
    expect(JSON.parse(result.text).storedIds).toEqual([existing.memory.id]);
    expect(rows()).toHaveLength(2);
    expect(rows().find((row) => row.id === existing.memory.id)?.archivedAt).toBeNull();
  });

  it('does not archive a fact deduplicated into the raw session itself', async () => {
    const fact = { content: 'An event worth remembering', type: 'episodic' as const };
    const raw = await brain.store({ ...fact, tags: ['pending-distill'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('complete_distill', { id: raw.memory.id, facts: [fact] })).isError).toBe(true);
    expect(rows().find((row) => row.id === raw.memory.id)?.archivedAt).toBeNull();
  });

  it('reports a fact the contradiction policy discarded and still archives the session', async () => {
    const id = seed();
    const fact = await brain.store({ content: 'A discarded fact', type: 'semantic' });
    vi.spyOn(brain, 'store').mockResolvedValueOnce({ ...fact, discarded: true });
    const result = await call('complete_distill', { id, facts: [{ content: 'A discarded fact' }] });
    expect(JSON.parse(result.text)).toMatchObject({ storedIds: [], discardedIds: [fact.memory.id], archived: true });
    expect(rows().find((row) => row.id === id)?.archivedAt).not.toBeNull();
  });

  it('rejects global facts in isolated mode and preserves the session', async () => {
    const id = seed();
    const isolated = new NeuralBrain({ dbPath: join(directory, 'test.db'), namespaceMode: 'isolated', namespace: 'project' });
    await isolated.initialize();
    const isolatedServer = new McpServer({ name: 'isolated-test', version: '1.0.0' });
    registerTools(isolatedServer, isolated, async () => {});
    const isolatedClient = new Client({ name: 'isolated-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([isolatedServer.connect(serverTransport), isolatedClient.connect(clientTransport)]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await isolatedClient.callTool({
        name: 'complete_distill', arguments: { id, facts: [{ content: 'Global preference', global: true }] },
      });
      expect(result.isError).toBe(true);
      expect(rows().find((row) => row.id === id)?.archivedAt).toBeNull();
    } finally {
      await isolatedClient.close();
      await isolatedServer.close();
      isolated.shutdown();
    }
  });

  it('validates required inputs and the fact count limit', async () => {
    const id = seed();
    for (const args of [{ id }, { facts: [] }, { id: '', facts: [] }, { id, facts: Array.from({ length: 101 }, () => ({ content: 'x' })) }]) {
      expect((await call('complete_distill', args)).isError).toBe(true);
    }
    expect(rows().find((row) => row.id === id)?.archivedAt).toBeNull();
  });

  it.each([
    { content: '' }, { content: '  ' }, { content: 'x', type: 'invalid' },
    { content: 'x', importance: 2 }, { content: 'x', tags: [1] }, { content: 'x', global: 'yes' },
  ])('rejects invalid facts before any writes: %j', async (fact) => {
    const id = seed();
    const store = vi.spyOn(brain, 'store');
    expect((await call('complete_distill', { id, facts: [fact] })).isError).toBe(true);
    expect(store).not.toHaveBeenCalled();
    expect(rows().find((row) => row.id === id)?.archivedAt).toBeNull();
  });

  it('advertises read and archive annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === 'get_distill_tasks')?.annotations).toEqual({
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    });
    expect(tools.find((tool) => tool.name === 'complete_distill')?.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
    });
  });
});
