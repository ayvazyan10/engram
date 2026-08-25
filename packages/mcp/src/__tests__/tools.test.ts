/**
 * MCP tool-contract tests.
 *
 * Driven through a real MCP Client over an in-memory transport, so these
 * exercise the same path a connected AI client uses — tool registration,
 * argument validation and response shape — rather than calling handlers
 * directly.
 *
 * packages/mcp previously had no tests, while the audit found contract defects
 * here: get_reflections filtering after the DB LIMIT, the 'reflected' event
 * missing from the subscribe enum, decay_policy wiping consolidation settings,
 * and a cached rejected init promise bricking the server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-mcp-test-${Date.now()}.db`);

let client: Client;
let brain: typeof import('../server.js')['brain'];

/** Text payload of a tool result. */
function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return textOf(result);
}

/**
 * The SDK reports tool input-validation failures as a RESULT with isError:true
 * (or a rejected promise, depending on where validation trips) — not always a
 * rejection. Accept either, but require a failure.
 */
async function expectToolError(name: string, args: Record<string, unknown>): Promise<void> {
  try {
    const result = await client.callTool({ name, arguments: args });
    expect((result as { isError?: boolean }).isError, `${name} should report an error`).toBe(true);
  } catch (err) {
    expect(err).toBeTruthy();
  }
}

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;

  const mod = await import('../server.js');
  brain = mod.brain;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });

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

describe('tool registration', () => {
  it('exposes the documented reflection tool set', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    // The LLM layer was removed — these must be gone.
    expect(names).not.toContain('trigger_reflection');
    expect(names).not.toContain('llm_status');

    // ...and replaced by the AI-driven pair.
    expect(names).toContain('request_reflection');
    expect(names).toContain('store_reflection');
    expect(names).toContain('get_reflections');
  });

  it('exposes the core memory tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    for (const expected of ['store_memory', 'search_memory', 'recall_context', 'memory_stats', 'forget']) {
      expect(names, expected).toContain(expected);
    }
  });

  it('reports the real package version, not a hardcoded 0.1.0', async () => {
    const version = client.getServerVersion();
    expect(version?.version).not.toBe('0.1.0');
    expect(version?.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('store_memory & search_memory', () => {
  it('stores a memory and finds it again', async () => {
    const stored = await call('store_memory', {
      content: 'Engram stores embeddings as FP16 blobs',
      type: 'semantic',
      importance: 0.7,
    });
    expect(stored).toContain('"id"');

    const found = await call('search_memory', { query: 'FP16 embeddings', topK: 5, threshold: 0.1 });
    expect(found).toContain('FP16');
  });

  it('rejects an out-of-range importance', async () => {
    await expectToolError('store_memory', { content: 'x', importance: 42 });
  });

  it('recall_context returns assembled context', async () => {
    await call('store_memory', { content: 'The dashboard runs on port 4902', type: 'semantic' });
    const ctx = await call('recall_context', { query: 'dashboard port', maxTokens: 500 });
    expect(typeof ctx).toBe('string');
  });
});

describe('reflection tools', () => {
  it('request_reflection returns reasoning tasks, never generated insights', async () => {
    for (let i = 0; i < 5; i++) {
      await call('store_memory', {
        content: `Reflection source memory number ${i} about deployment habits`,
        type: 'semantic',
        importance: 0.6,
      });
    }

    const text = await call('request_reflection');
    // Engram runs no LLM: the tool hands back prompts for the AI to reason over.
    expect(text).toMatch(/reflection task|not enough qualifying memories/i);
    if (text.includes('task')) {
      expect(text).toContain('TASK:');
      expect(text).toContain('store_reflection');
    }
  });

  it('store_reflection persists an insight and get_reflections returns it', async () => {
    const stored = await call('store_reflection', {
      type: 'pattern',
      insight: 'The user consistently deploys late in the evening.',
      confidence: 0.8,
    });
    expect(stored).toMatch(/stored pattern reflection/i);

    const listed = await call('get_reflections', { limit: 10 });
    expect(listed).toContain('deploys late in the evening');
  });

  it('store_reflection ignores a NO_INSIGHT result', async () => {
    const res = await call('store_reflection', { type: 'trend', insight: 'NO_INSIGHT' });
    expect(res).toMatch(/nothing stored/i);
  });

  it('get_reflections filters by type in SQL, so LIMIT cannot hide matches', async () => {
    // Add several non-pattern reflections AFTER the pattern one above. With the
    // old in-memory filtering (applied after the DB LIMIT) a small limit
    // returned zero patterns even though one existed.
    for (let i = 0; i < 5; i++) {
      await call('store_reflection', { type: 'trend', insight: `Trend observation ${i}`, confidence: 0.5 });
    }

    const patterns = await call('get_reflections', { limit: 3, type: 'pattern' });
    expect(patterns).toContain('deploys late in the evening');
  });

  it('rejects an unknown reflection type', async () => {
    await expectToolError('store_reflection', { type: 'nonsense', insight: 'x' });
  });
});

describe('webhook_subscribe', () => {
  it('accepts the reflected event', async () => {
    process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'true';
    try {
      const res = await call('webhook_subscribe', {
        url: 'http://127.0.0.1:9999/hook',
        events: ['reflected', 'stored'],
      });
      expect(res).toContain('Webhook subscribed');
    } finally {
      delete process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];
    }
  });

  it('rejects an unknown event name', async () => {
    await expectToolError('webhook_subscribe', { url: 'https://example.com/h', events: ['not-an-event'] });
  });
});

describe('decay_policy', () => {
  it('merges consolidation settings instead of replacing them', async () => {
    const before = (JSON.parse(await call('decay_policy', { action: 'get' })) as {
      policy: { consolidation: { minClusterSize: number; minEpisodicAgeMs: number; enabled: boolean } };
    }).policy;
    expect(before.consolidation.minClusterSize).toBeGreaterThan(0);

    await call('decay_policy', { action: 'update', consolidationEnabled: false });

    const after = (JSON.parse(await call('decay_policy', { action: 'get' })) as {
      policy: typeof before;
    }).policy;
    expect(after.consolidation.enabled).toBe(false);
    // Regression: replacing the object wiped these back to undefined.
    expect(after.consolidation.minClusterSize).toBe(before.consolidation.minClusterSize);
    expect(after.consolidation.minEpisodicAgeMs).toBe(before.consolidation.minEpisodicAgeMs);
  });
});

describe('stats & forget', () => {
  it('memory_stats reports totals', async () => {
    const stats = await call('memory_stats');
    expect(stats).toContain('total');
  });

  it('forget archives a memory', async () => {
    const stored = await call('store_memory', { content: 'Temporary note to forget', type: 'episodic' });
    const id = (JSON.parse(stored) as { id: string }).id;

    const res = await call('forget', { ids: [id] });
    expect(res.toLowerCase()).toMatch(/forgot|archiv/);
  });
});
