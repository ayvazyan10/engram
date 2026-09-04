/**
 * `forget` must not report memories it never archived.
 *
 * The handler looped `await brain.forget(id)` and answered
 * `{"archived": ids.length}` without checking anything. Outside isolated mode
 * `brain.forget` on an unknown id is a silent no-op, so an AI that mistyped or
 * hallucinated an id was told the memory was gone — and the `forgotten` webhook
 * and the `onForget` plugin hook fired for ids that never existed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import { partitionByExistence, forgetReport, hasMissingIds } from '../forget.js';

/** A brain that only knows which ids exist — enough for the partition logic. */
function presenceOf(known: string[]): { getGraph(): { getNode(id: string): unknown } } {
  return { getGraph: () => ({ getNode: (id: string) => (known.includes(id) ? { id } : undefined) }) };
}

const dbPath = path.join(os.tmpdir(), `engram-mcp-forget-${Date.now()}.db`);

let client: Client;
let brain: typeof import('../server.js')['brain'];

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

async function callRaw(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function payloadOf(result: ToolResult): Record<string, unknown> {
  const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
  return JSON.parse(text) as Record<string, unknown>;
}

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;

  const mod = await import('../server.js');
  brain = mod.brain;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'forget-test-client', version: '1.0.0' });

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

describe('forget', () => {
  it('archives a memory that exists and says so', async () => {
    const stored = await callRaw('store_memory', { content: 'A note that will be archived', type: 'episodic' });
    const id = (payloadOf(stored) as { id: string }).id;

    const result = await callRaw('forget', { ids: [id], reason: 'superseded' });
    const payload = payloadOf(result);

    expect(result.isError).toBeFalsy();
    expect(payload.archived).toBe(1);
    expect(payload.notFound).toEqual([]);
    expect(payload.reason).toBe('superseded');
  });

  it('reports ids that do not exist instead of counting them as archived', async () => {
    const result = await callRaw('forget', { ids: ['does-not-exist-1', 'does-not-exist-2'] });
    const payload = payloadOf(result);

    expect(payload.archived).toBe(0);
    expect(payload.notFound).toEqual(['does-not-exist-1', 'does-not-exist-2']);
    expect(result.isError).toBe(true);
    expect(String(payload.message)).toMatch(/not found/i);
  });

  it('archives the real ids in a mixed batch and still flags the unknown one', async () => {
    const stored = await callRaw('store_memory', { content: 'One real memory in a mixed batch', type: 'episodic' });
    const id = (payloadOf(stored) as { id: string }).id;

    const result = await callRaw('forget', { ids: [id, 'ghost-id'] });
    const payload = payloadOf(result);

    expect(payload.archived).toBe(1);
    expect(payload.notFound).toEqual(['ghost-id']);
    expect(result.isError).toBe(true);
  });

  it('does not archive the same memory twice — a second forget reports not found', async () => {
    const stored = await callRaw('store_memory', { content: 'Archived once, then asked for again', type: 'episodic' });
    const id = (payloadOf(stored) as { id: string }).id;

    await callRaw('forget', { ids: [id] });
    const second = await callRaw('forget', { ids: [id] });
    const payload = payloadOf(second);

    expect(payload.archived).toBe(0);
    expect(payload.notFound).toEqual([id]);
    expect(second.isError).toBe(true);
  });
});

describe('partitionByExistence', () => {
  it('splits ids by whether the graph knows them', () => {
    const partition = partitionByExistence(presenceOf(['a', 'c']), ['a', 'b', 'c', 'd']);
    expect(partition.existing).toEqual(['a', 'c']);
    expect(partition.missing).toEqual(['b', 'd']);
  });

  it('collapses duplicates so one memory is never counted twice', () => {
    const partition = partitionByExistence(presenceOf(['a']), ['a', 'a', 'ghost', 'ghost']);
    expect(partition.existing).toEqual(['a']);
    expect(partition.missing).toEqual(['ghost']);
  });

  it('treats an empty request as nothing to do', () => {
    const partition = partitionByExistence(presenceOf(['a']), []);
    expect(partition.existing).toEqual([]);
    expect(partition.missing).toEqual([]);
    expect(hasMissingIds(partition)).toBe(false);
  });

  it('asks the graph once per unique id, not once per element', () => {
    const asked: string[] = [];
    const brain = { getGraph: () => ({ getNode: (id: string) => { asked.push(id); return undefined; } }) };
    partitionByExistence(brain, ['x', 'x', 'y']);
    expect(asked).toEqual(['x', 'y']);
  });
});

describe('forgetReport', () => {
  it('counts only what was archived and names what was not found', () => {
    const report = forgetReport({ existing: ['a'], missing: ['ghost'] }, 'cleanup');
    expect(report.archived).toBe(1);
    expect(report.notFound).toEqual(['ghost']);
    expect(report.reason).toBe('cleanup');
    expect(report.message).toBe('Archived 1 memory(ies); 1 id(s) not found: ghost');
  });

  it('keeps the plain message when every id was found', () => {
    const report = forgetReport({ existing: ['a', 'b'], missing: [] }, undefined);
    expect(report.message).toBe('Archived 2 memory(ies)');
    expect(report.reason).toBe('not specified');
    expect(hasMissingIds({ existing: ['a', 'b'], missing: [] })).toBe(false);
  });

  it('never says it archived something when nothing existed', () => {
    const report = forgetReport({ existing: [], missing: ['x', 'y'] }, undefined);
    expect(report.archived).toBe(0);
    expect(report.message).toMatch(/^Archived 0 memory\(ies\); 2 id\(s\) not found: x, y$/);
    expect(hasMissingIds({ existing: [], missing: ['x', 'y'] })).toBe(true);
  });
});
