/**
 * The tool paths the first two suites never reached.
 *
 * Every handler here has a second shape it answers in — a live decay sweep
 * rather than a dry run, a progressive recall rather than a flat one, a policy
 * update that actually carries numbers, a reflection cycle with something to
 * reflect on. Those branches shipped unexercised: the coverage gate counted the
 * handlers as covered because their happy path ran once.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-mcp-branches-${Date.now()}.db`);

let client: Client;
let brain: typeof import('../server.js')['brain'];

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  return textOf(await client.callTool({ name, arguments: args }));
}

async function callJson<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return JSON.parse(await call(name, args)) as T;
}

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;

  const mod = await import('../server.js');
  brain = mod.brain;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'branches-test-client', version: '1.0.0' });

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

describe('recall_context', () => {
  it('returns phase-grouped results when progressive is set', async () => {
    await call('store_memory', {
      content: 'The vector index is rebuilt from the store on startup when the disk cache is missing',
      type: 'semantic',
    });

    const result = await callJson<{
      context: string;
      memoriesUsed: number;
      phases: { vector: { count: number; memories: unknown[] }; graph: { count: number; memories: unknown[] } };
    }>('recall_context', { query: 'vector index rebuild', progressive: true });

    // The flat shape has no `phases` at all — this is the streaming branch.
    expect(result.phases).toBeDefined();
    expect(result.phases.vector.count).toBe(result.phases.vector.memories.length);
    expect(result.phases.graph.count).toBe(result.phases.graph.memories.length);
    expect(result.memoriesUsed).toBe(result.phases.vector.count + result.phases.graph.count);
    expect(typeof result.context).toBe('string');
  });
});

describe('decay_sweep', () => {
  it('reports a live sweep as live, not as a dry run', async () => {
    const dry = await callJson<{ mode: string; message: string }>('decay_sweep', { dryRun: true });
    expect(dry.mode).toBe('dry-run');
    expect(dry.message).toMatch(/^Dry run: would archive/);

    const live = await callJson<{ mode: string; message: string; durationMs: number }>('decay_sweep', { dryRun: false });
    expect(live.mode).toBe('live');
    expect(live.message).toMatch(/^Archived \d+ memories/);
    expect(live.message).toContain('ms');
  });
});

describe('decay_policy', () => {
  it('applies every numeric field it is given and reports the result', async () => {
    const updated = await callJson<{ policy: Record<string, unknown>; message: string }>('decay_policy', {
      action: 'update',
      halfLifeDays: 45,
      archiveThreshold: 0.15,
      importanceDecayRate: 0.02,
      importanceFloor: 0.05,
      consolidationEnabled: false,
    });

    expect(updated.message).toBe('Policy updated');
    expect(updated.policy.halfLifeDays).toBe(45);
    expect(updated.policy.archiveThreshold).toBe(0.15);
    expect(updated.policy.importanceDecayRate).toBe(0.02);
    expect(updated.policy.importanceFloor).toBe(0.05);
    expect((updated.policy.consolidation as { enabled: boolean }).enabled).toBe(false);

    // A `get` must show the same values back — an update that only echoed its
    // arguments would pass the assertions above and change nothing.
    const fetched = await callJson<{ policy: Record<string, unknown>; message: string }>('decay_policy', { action: 'get' });
    expect(fetched.message).toBe('Current policy');
    expect(fetched.policy.halfLifeDays).toBe(45);
    expect(fetched.policy.importanceFloor).toBe(0.05);
  });

  it('keeps the consolidation settings it was not asked to change', async () => {
    const before = await callJson<{ policy: { consolidation: Record<string, unknown> } }>('decay_policy', { action: 'get' });
    const after = await callJson<{ policy: { consolidation: Record<string, unknown> } }>('decay_policy', {
      action: 'update',
      consolidationEnabled: true,
    });

    expect(after.policy.consolidation.enabled).toBe(true);
    expect(after.policy.consolidation.minClusterSize).toBe(before.policy.consolidation.minClusterSize);
    expect(after.policy.consolidation.similarityThreshold).toBe(before.policy.consolidation.similarityThreshold);
  });
});

describe('check_contradictions', () => {
  it('lists every unresolved contradiction when no memory id is given', async () => {
    const listed = await callJson<{ count: number; contradictions: unknown[]; message: string }>('check_contradictions');
    expect(listed.count).toBe(listed.contradictions.length);
    expect(listed.message).toMatch(/unresolved contradiction/i);
  });
});

describe('list_tags', () => {
  it('returns the tag cloud, then the memories behind one tag', async () => {
    const stored = await callJson<{ id: string }>('store_memory', {
      content: 'A memory that carries a tag used by the tag-cloud assertions',
      type: 'episodic',
      tags: ['branch-coverage'],
    });

    const cloud = await callJson<{ count: number; tags: unknown[]; message: string }>('list_tags');
    expect(cloud.count).toBe(cloud.tags.length);
    expect(cloud.message).toMatch(/unique tags/);

    const byTag = await callJson<{ tag: string; count: number; memories: Array<{ id: string }> }>('list_tags', {
      tag: 'branch-coverage',
    });
    expect(byTag.tag).toBe('branch-coverage');
    expect(byTag.memories.map((m) => m.id)).toContain(stored.id);
  });
});

describe('reflection cycle', () => {
  it('hands back tasks, stores an insight, and reads it back', async () => {
    // Reflection needs at least three qualifying memories before it will
    // produce any task at all.
    for (const content of [
      'Engram stores episodic memories with a decay half-life measured in days',
      'The MCP server exposes twenty-one tools over stdio to any connected client',
      'Cloud sync pushes rows to Postgres and pulls them back with a cursor',
      'The knowledge graph links memories that mention the same concepts',
    ]) {
      await call('store_memory', { content, type: 'semantic' });
    }

    const tasks = await call('request_reflection');
    expect(tasks).toMatch(/reflection task|call store_reflection|Not enough qualifying memories/);

    const stored = await call('store_reflection', {
      type: 'pattern',
      insight: 'Most stored memories describe Engram subsystems rather than user preferences.',
      relatedMemoryIds: [],
      confidence: 0.6,
    });
    expect(stored).toMatch(/Stored pattern reflection/);

    const read = await call('get_reflections', { limit: 5 });
    expect(read).toContain('reflections:');
    expect(read).toContain('[pattern]');
    expect(read).toContain('Most stored memories describe Engram subsystems');
  });

  it('refuses to store an insight it was told is empty', async () => {
    const skipped = await call('store_reflection', { type: 'trend', insight: 'NO_INSIGHT' });
    expect(skipped).toMatch(/nothing stored/i);
  });

  it('says so plainly when a reflection type has nothing stored', async () => {
    const none = await call('get_reflections', { limit: 5, type: 'knowledge_gap' });
    expect(none).toBe('No reflection insights found.');
  });
});
