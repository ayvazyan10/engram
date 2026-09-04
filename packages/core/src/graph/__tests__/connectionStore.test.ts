/**
 * Tests for the memory_connections insert-or-resurrect helper.
 *
 * `idx_connections_unique_pair` (source_id, target_id, relationship) has no
 * notion of `deleted_at` — a tombstoned edge still occupies that slot. These
 * verify `upsertConnection` resurrects a tombstoned row instead of throwing
 * the UNIQUE violation, while a genuine LIVE duplicate still throws exactly
 * as a raw insert always did.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { getDb, closeDb, schema } from '../../db/index.js';
import { upsertConnection } from '../connectionStore.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

/**
 * The migration is resolved from the directory, not by filename: drizzle
 * renames the generated file every time it is regenerated, and a hard-coded
 * name turns that rename into an ENOENT in every suite at once.
 */
const MIGRATION_SQL = fs.readFileSync(
  path.join(
    MIGRATIONS_DIR,
    fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()[0]!,
  ),
  'utf-8',
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-connstore-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

/** Insert a minimal, valid memory row directly so FK targets resolve. */
function insertMemory(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.memories)
    .values({
      id,
      type: 'semantic',
      content: `content for ${id}`,
      embeddingDim: 384,
      importance: 0.5,
      confidence: 1,
      accessCount: 0,
      metadata: '{}',
      tags: '[]',
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe('upsertConnection', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
    getDb(dbPath);
    insertMemory('mem-a');
    insertMemory('mem-b');
  });

  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('inserts a fresh edge when no row occupies the slot', () => {
    const db = getDb();
    const now = new Date().toISOString();

    upsertConnection(db, {
      id: 'edge-1',
      sourceId: 'mem-a',
      targetId: 'mem-b',
      relationship: 'relates_to',
      strength: 0.8,
      bidirectional: false,
      metadata: '{}',
      createdAt: now,
      updatedAt: now,
      deviceId: 'device-1',
    });

    const [row] = db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.id, 'edge-1'))
      .all();
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeNull();
  });

  it('resurrects a tombstoned row instead of throwing a UNIQUE violation', () => {
    const db = getDb();
    const now = new Date().toISOString();

    upsertConnection(db, {
      id: 'edge-2',
      sourceId: 'mem-a',
      targetId: 'mem-b',
      relationship: 'relates_to',
      strength: 0.5,
      bidirectional: false,
      metadata: '{}',
      createdAt: now,
      updatedAt: now,
      deviceId: 'device-1',
    });

    // Tombstone it — the slot (mem-a, mem-b, relates_to) is still occupied.
    const tombstonedAt = new Date(Date.now() + 1000).toISOString();
    db.update(schema.memoryConnections)
      .set({ deletedAt: tombstonedAt, updatedAt: tombstonedAt })
      .where(eq(schema.memoryConnections.id, 'edge-2'))
      .run();

    // Recreate the exact same edge (a different id, as a real caller would
    // generate a fresh uuid) — must not throw.
    const resurrectedAt = new Date(Date.now() + 2000).toISOString();
    expect(() => {
      upsertConnection(db, {
        id: 'edge-2-new-attempt',
        sourceId: 'mem-a',
        targetId: 'mem-b',
        relationship: 'relates_to',
        strength: 0.95,
        bidirectional: true,
        metadata: '{"resurrected":true}',
        createdAt: resurrectedAt,
        updatedAt: resurrectedAt,
        deviceId: 'device-2',
      });
    }).not.toThrow();

    // Exactly one row for this (source, target, relationship) — the original
    // id survives; the resurrection updates it in place rather than adding a
    // second row.
    const rows = db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.sourceId, 'mem-a'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('edge-2');
    expect(rows[0]!.deletedAt).toBeNull();
    expect(rows[0]!.strength).toBe(0.95);
    expect(rows[0]!.bidirectional).toBe(true);
    expect(rows[0]!.deviceId).toBe('device-2');
    expect(rows[0]!.updatedAt).toBe(resurrectedAt);
  });

  it('still throws the UNIQUE violation for a genuine LIVE duplicate', () => {
    const db = getDb();
    const now = new Date().toISOString();

    upsertConnection(db, {
      id: 'edge-3',
      sourceId: 'mem-a',
      targetId: 'mem-b',
      relationship: 'causes',
      strength: 0.5,
      bidirectional: false,
      metadata: '{}',
      createdAt: now,
      updatedAt: now,
      deviceId: 'device-1',
    });

    // No tombstone in between — the slot is occupied by a LIVE row. This must
    // behave exactly as a raw duplicate insert always did: throw.
    expect(() => {
      upsertConnection(db, {
        id: 'edge-3-dup',
        sourceId: 'mem-a',
        targetId: 'mem-b',
        relationship: 'causes',
        strength: 0.7,
        bidirectional: false,
        metadata: '{}',
        createdAt: now,
        updatedAt: now,
        deviceId: 'device-1',
      });
    }).toThrow();
  });
});
