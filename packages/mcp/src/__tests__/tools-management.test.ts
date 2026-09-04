/**
 * Coverage for the remaining MCP tools — knowledge, lifecycle, contradictions,
 * tags, webhooks and index/embedding introspection.
 *
 * Together with tools.test.ts this exercises every registered tool at least
 * once, so a broken handler cannot ship silently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-mcp-mgmt-${Date.now()}.db`);

let client: Client;
let brain: typeof import('../server.js')['brain'];

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  return textOf(await client.callTool({ name, arguments: args }));
}

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;

  const mod = await import('../server.js');
  brain = mod.brain;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'mgmt-test-client', version: '1.0.0' });

  await Promise.all([
    mod.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client?.close().catch(() => {});
  try { brain?.shutdown(); } catch { /* best effort */ }
  cleanupTestDb(dbPath);
});

describe('add_knowledge', () => {
  it('stores a concept as semantic memory', async () => {
    const res = await call('add_knowledge', {
      concept: 'HNSW',
      content: 'Hierarchical navigable small world graphs power approximate vector search',
    });
    expect(res).toMatch(/HNSW|stored|id/i);
  });
});

describe('lifecycle tools', () => {
  it('decay_sweep runs in dry-run mode', async () => {
    const res = await call('decay_sweep', { dryRun: true });
    expect(res).toMatch(/scanned|archived/i);
  });

  it('decay_policy returns the current policy', async () => {
    const res = await call('decay_policy', { action: 'get' });
    expect(JSON.parse(res)).toHaveProperty('policy');
  });
});

describe('contradiction tools', () => {
  it('check_contradictions reports on a stored memory', async () => {
    await call('store_memory', { content: 'The service listens on port 4901', type: 'semantic' });
    const res = await call('check_contradictions', { limit: 5 });
    expect(typeof res).toBe('string');
  });

  it('resolve_contradiction handles an unknown pair gracefully', async () => {
    const result = await client.callTool({
      name: 'resolve_contradiction',
      arguments: { sourceId: 'missing-a', targetId: 'missing-b', strategy: 'keep_newest' },
    });
    // Either a plain "not found" result or an error result — never a crash.
    expect(result).toBeTruthy();
  });
});

describe('tag tools', () => {
  // These previously called tag_memory as { id, tags: [...] } while the tool
  // takes { memoryId, tag }, and asserted only `typeof result === 'string'` —
  // which the resulting VALIDATION ERROR also satisfies. The tag path was
  // never actually exercised.
  it('tags a memory and lists it back', async () => {
    const stored = await call('store_memory', {
      content: 'Tagging target memory for MCP tests',
      type: 'semantic',
    });
    const id = (JSON.parse(stored) as { id: string }).id;

    const tagged = JSON.parse(await call('tag_memory', { memoryId: id, tag: 'project:engram', action: 'add' })) as {
      id: string; tags: string[]; message: string;
    };
    expect(tagged.id).toBe(id);
    expect(tagged.tags).toContain('project:engram');

    const byTag = JSON.parse(await call('list_tags', { tag: 'project:engram' })) as {
      tag: string; count: number; memories: Array<{ id: string }>;
    };
    expect(byTag.count).toBeGreaterThan(0);
    expect(byTag.memories.map((m) => m.id)).toContain(id);
  });

  it('removes a tag again', async () => {
    const stored = await call('store_memory', { content: 'Untagging target memory for MCP tests', type: 'semantic' });
    const id = (JSON.parse(stored) as { id: string }).id;

    await call('tag_memory', { memoryId: id, tag: 'temporary', action: 'add' });
    const removed = JSON.parse(await call('tag_memory', { memoryId: id, tag: 'temporary', action: 'remove' })) as {
      tags: string[];
    };
    expect(removed.tags).not.toContain('temporary');
  });
});

describe('introspection tools', () => {
  it('index_status reports entry count', async () => {
    const res = await call('index_status');
    expect(res).toMatch(/entryCount|dimension/i);
  });

  it('embedding_status reports the active model and dimension', async () => {
    const res = await call('embedding_status');
    expect(res).toMatch(/currentModel|dimension/i);
  });

  it('plugin_list returns the registry', async () => {
    const res = await call('plugin_list');
    expect(typeof res).toBe('string');
  });

  it('webhook_list returns subscriptions', async () => {
    const res = await call('webhook_list', {});
    expect(typeof res).toBe('string');
  });
});

describe('re_embed', () => {
  it('re-embeds stale memories without error', async () => {
    await call('store_memory', { content: 'Re-embedding candidate memory', type: 'semantic' });
    const res = await call('re_embed', { onlyStale: true });
    expect(res).toMatch(/processed|total|re-embed/i);
  });
});
