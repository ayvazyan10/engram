import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getDb, schema } from '../../core/src/db/index.ts';

// Exercise the edited core source rather than a previously built dist tree.
vi.mock('@engram-ai-memory/core', () => import('../../core/src/index.ts'));
vi.mock('../../core/src/embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../core/src/embedding/Embedder.ts')>(),
  embed: async () => new Float32Array(384).fill(1),
}));

const directory = mkdtempSync(join(tmpdir(), 'engram-mcp-dedup-'));
let client: Client;
let brain: typeof import('./server.ts')['brain'];

beforeAll(async () => {
  vi.stubEnv('ENGRAM_DB_PATH', join(directory, 'test.db'));
  vi.stubEnv('ENGRAM_SYNC_URL', '');
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '0.97');
  const mod = await import('./server.ts');
  brain = mod.brain;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'dedup-test', version: '1.0.0' });
  await Promise.all([mod.server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function store(): Promise<{ id: string; deduplicated: boolean }> {
  const result = await client.callTool({
    name: 'store_memory', arguments: { content: 'The service uses TypeScript', type: 'semantic' },
  });
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content.find((item) => item.type === 'text')!.text!);
}

it('includes deduplicated in store_memory response text', async () => {
  const first = await store();
  const second = await store();
  expect(first.deduplicated).toBe(false);
  expect(second).toMatchObject({ id: first.id, deduplicated: true });
});

it('advertises update_memory as a write tool and explains recall ids', async () => {
  const { tools } = await client.listTools();
  expect(tools.find((tool) => tool.name === 'update_memory')?.annotations).toMatchObject({
    readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
  });
  expect(client.getInstructions()).toContain('[id · date]');
  expect(client.getInstructions()).toContain('update_memory');
});

it('updates a memory through its recall prefix and forgets full-id/prefix aliases once', async () => {
  const memory = await brain.episodic.store({ content: 'Old fact' });
  const id = memory.id.slice(0, 8);
  const updated = await client.callTool({
    name: 'update_memory', arguments: { id, content: 'Corrected fact', importance: 0.7, tags: ['fixed'], concept: 'Fact' },
  });
  expect(updated.isError).not.toBe(true);
  const content = updated.content as Array<{ type: string; text: string }>;
  expect(JSON.parse(content[0]!.text)).toMatchObject({
    id: memory.id, content: 'Corrected fact', importance: 0.7, tags: ['fixed'], concept: 'Fact',
  });
  const forgotten = await client.callTool({ name: 'forget', arguments: { ids: [id, memory.id, id] } });
  expect(forgotten.isError).not.toBe(true);
  const report = forgotten.content as Array<{ type: string; text: string }>;
  expect(JSON.parse(report[0]!.text)).toMatchObject({ archived: 1, notFound: [] });
  const archived = await client.callTool({ name: 'update_memory', arguments: { id, content: 'Too late' } });
  expect(archived.isError).toBe(true);
});

it('reports ambiguous prefixes as missing in update_memory and forget', async () => {
  const memory = await brain.episodic.store({ content: 'Prefix collision' });
  for (const id of ['12345678-1111-4111-8111-111111111111', '12345678-2222-4222-8222-222222222222']) {
    getDb().insert(schema.memories).values({ ...memory, id }).run();
  }
  const updated = await client.callTool({ name: 'update_memory', arguments: { id: '12345678', content: 'Ambiguous' } });
  expect(updated.isError).toBe(true);
  const forgotten = await client.callTool({ name: 'forget', arguments: { ids: ['12345678'] } });
  expect(forgotten.isError).toBe(true);
  const report = forgotten.content as Array<{ type: string; text: string }>;
  expect(JSON.parse(report[0]!.text)).toMatchObject({ archived: 0, notFound: ['12345678'] });
});
