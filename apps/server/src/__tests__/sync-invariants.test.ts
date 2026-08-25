/**
 * Regression tests for the Phase 0 sync invariants on apps/server's direct
 * Drizzle write paths.
 *
 * `POST /api/connections`, `PATCH /api/memory/:id`, and
 * `POST /api/memory/bulk/tag` write straight to the database instead of
 * going through a NeuralBrain method, so they must uphold the same
 * invariant NeuralBrain's own write paths do: `updated_at` and `device_id`
 * set on insert/update. `GET /api/graph/:id` reads `memory_connections`
 * directly too, and must not resurface a soft-deleted (tombstoned) edge.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import { getDb, schema } from '@engram-ai-memory/core';
import { and, eq, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-sync-invariants-test-${process.pid}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  // Must be set before importing the server module — the brain singleton reads
  // it at construction time.
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0'; // no background sweeps during tests

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  // shutdown() is synchronous.
  try { brain?.shutdown(); } catch { /* best effort */ }
  cleanupTestDb(dbPath);
});

/** Store a memory through the API and return its id. */
async function storeMemory(content: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/memory',
    payload: { content, type: 'semantic', source: 'sync-invariants-test', importance: 0.6 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().memory.id as string;
}

describe('POST /api/connections', () => {
  it('sets non-null updated_at and device_id on the inserted row', async () => {
    const a = await storeMemory('Sync invariant node A');
    const b = await storeMemory('Sync invariant node B');

    const res = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { sourceId: a, targetId: b, relationship: 'relates_to' },
    });
    expect(res.statusCode).toBe(201);
    const connectionId = res.json().id as string;

    const [row] = await getDb()
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.id, connectionId));

    expect(row?.updatedAt).toEqual(expect.any(String));
    expect(row?.deviceId).toEqual(expect.any(String));
  });

  it('resurrects a tombstoned edge instead of 500ing when POSTed again with the same triple', async () => {
    // Deliberately dissimilar content — brain.store()'s own auto-link
    // (similarity >= 0.5) must NOT fire between these, or it would create its
    // own connections and confound the one this test controls below.
    const a = await storeMemory('Xylophone repair manuals from the 1970s');
    const b = await storeMemory('The migratory patterns of Arctic terns');

    const created = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { sourceId: a, targetId: b, relationship: 'relates_to' },
    });
    expect(created.statusCode).toBe(201);
    const connectionId = created.json().id as string;
    const beforeUpdatedAt = created.json().updatedAt as string;

    // Tombstone it directly — this is what forget()/archiveAtomic do; there is
    // no DELETE endpoint for connections in apps/server. idx_connections_unique_pair
    // (source_id, target_id, relationship) has no notion of deleted_at, so the
    // tombstoned row still occupies the slot.
    const tombstonedAt = new Date(Date.now() + 1000).toISOString();
    await getDb()
      .update(schema.memoryConnections)
      .set({ deletedAt: tombstonedAt, updatedAt: tombstonedAt })
      .where(eq(schema.memoryConnections.id, connectionId));

    // Re-create the exact same (sourceId, targetId, relationship) triple —
    // the ordinary "delete a connection, then create it again" user flow.
    // Before wiring POST /api/connections to upsertConnection, this hit the
    // still-occupied unique index and surfaced as an unhandled 500.
    const recreated = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { sourceId: a, targetId: b, relationship: 'relates_to' },
    });
    expect(recreated.statusCode).toBe(201);

    const [row] = await getDb()
      .select()
      .from(schema.memoryConnections)
      .where(
        and(
          eq(schema.memoryConnections.sourceId, a),
          eq(schema.memoryConnections.targetId, b),
          eq(schema.memoryConnections.relationship, 'relates_to')
        )
      );

    // The original row is resurrected in place — same id, not a second row.
    expect(row?.id).toBe(connectionId);
    expect(row?.deletedAt).toBeNull();
    expect(row?.updatedAt).not.toBe(tombstonedAt);
    expect(row!.updatedAt > beforeUpdatedAt).toBe(true);

    // The response returned by the recreate call reflects the resurrected
    // row's real id, not a phantom uuid that was never persisted.
    expect(recreated.json().id).toBe(connectionId);
  });
});

describe('memory writes carry a device_id', () => {
  it('PATCH /api/memory/:id sets device_id', async () => {
    const id = await storeMemory('Device id patch target');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/memory/${id}`,
      payload: { importance: 0.9 },
    });
    expect(patch.statusCode).toBe(200);

    const [row] = await getDb().select().from(schema.memories).where(eq(schema.memories.id, id));
    expect(row?.deviceId).toEqual(expect.any(String));
  });

  it('POST /api/memory/bulk/tag sets device_id', async () => {
    const id = await storeMemory('Device id bulk tag target');

    const bulk = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/tag',
      payload: { ids: [id], tag: 'sync-check' },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().modified).toBe(1);

    const [row] = await getDb().select().from(schema.memories).where(eq(schema.memories.id, id));
    expect(row?.deviceId).toEqual(expect.any(String));
  });
});

describe('GET /api/graph/:id', () => {
  it('does not return an edge whose deleted_at is set', async () => {
    const root = await storeMemory('Graph root for tombstone test');
    const live = await storeMemory('Live neighbour');
    const tombstoned = await storeMemory('Tombstoned neighbour');

    const liveRes = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { sourceId: root, targetId: live, relationship: 'relates_to' },
    });
    expect(liveRes.statusCode).toBe(201);

    // NeuralBrain.store() auto-links each new memory to its most similar
    // existing ones, so storing `tombstoned` may already have created a real
    // edge to `root` or `live` independent of this test. Clear anything
    // touching `tombstoned` so the only edge left is the one this test
    // controls below.
    await getDb()
      .delete(schema.memoryConnections)
      .where(
        or(
          eq(schema.memoryConnections.sourceId, tombstoned),
          eq(schema.memoryConnections.targetId, tombstoned)
        )
      );

    // Insert the tombstoned edge directly — apps/server has no delete
    // endpoint for connections, and this proves the read-side filter works
    // independent of how a row comes to be soft-deleted (e.g. the core
    // agent's concurrent work on turning deletes into tombstones).
    const { v4: uuidv4 } = await import('uuid');
    await getDb()
      .insert(schema.memoryConnections)
      .values({
        id: uuidv4(),
        sourceId: root,
        targetId: tombstoned,
        relationship: 'relates_to',
        deletedAt: new Date().toISOString(),
      });

    const res = await app.inject({ method: 'GET', url: `/api/graph/${root}?depth=1` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const neighborIds = body.neighbors.map((n: { id: string }) => n.id);
    const connectionTargets = body.connections.map((c: { targetId: string }) => c.targetId);

    expect(neighborIds).toContain(live);
    expect(neighborIds).not.toContain(tombstoned);
    expect(connectionTargets).not.toContain(tombstoned);

    // The row itself is still physically present — soft delete, not hard.
    const [rawRow] = await getDb()
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.targetId, tombstoned));
    expect(rawRow?.deletedAt).toEqual(expect.any(String));
  });
});
