/**
 * Regression guard for the one UPDATE path that moved `updated_at` without
 * re-stamping `device_id`.
 *
 * The push query selects rows this device owns (`device_id IS NULL OR
 * device_id = us`) and paginates on `(updated_at, id)`. A decay sweep is a
 * local write, so it must claim the row — otherwise a memory that arrived from
 * a peer keeps that peer's id, falls outside the push filter forever, and its
 * decayed importance never reaches any other device.
 *
 * The sibling cases (addTag, removeTag, SemanticMemory.update,
 * ProceduralMemory.updateConfidence, reEmbed) live in sync-write-paths.test.ts;
 * the decay sweep was the one member of that set with no coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { getDb, closeDb, schema } from '../../db/index.js';
import { getDeviceId, _resetMemoizedDeviceIdForTests } from '../../sync/deviceId.js';
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

const FOREIGN_DEVICE_ID = 'peer-device-that-wrote-this-row';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function createTestDb(): string {
  const dbPath = path.join(
    __dirname,
    `test-decay-device-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

describe('decay sweep — device attribution', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    _resetMemoizedDeviceIdForTests();
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    _resetMemoizedDeviceIdForTests();
    cleanupTestDb(dbPath);
  });

  it('claims a peer-written row when it decays its importance', async () => {
    // Importance 0.5 keeps it under the high-importance-semantic rule, source
    // 'test' is not an AI client, and no tag pins it — so nothing protects it.
    const { memory } = await brain.store({
      content: 'A fact that arrived from another device and is now going stale',
      type: 'semantic',
      importance: 0.5,
    });

    const db = getDb();
    // Backdate the checkpoint so there is decay to apply, and hand the row to
    // a peer so a missing device stamp is observable.
    const staleAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    await db
      .update(schema.memories)
      .set({ updatedAt: staleAt, deviceId: FOREIGN_DEVICE_ID })
      .where(eq(schema.memories.id, memory.id));

    const result = await brain.runDecaySweep();
    expect(result.decayedCount).toBeGreaterThan(0);

    const [row] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, memory.id));

    expect(row!.importance).toBeLessThan(0.5);
    expect(row!.deviceId).toBe(getDeviceId());
  });

  it('leaves a protected row untouched, device_id included', async () => {
    // The inverse guard: the sweep must claim rows it writes, and only those.
    const { memory } = await brain.store({
      content: 'A pinned fact the sweep must not rewrite',
      type: 'semantic',
      importance: 0.5,
      tags: ['pinned'],
    });

    const db = getDb();
    const staleAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    await db
      .update(schema.memories)
      .set({ updatedAt: staleAt, deviceId: FOREIGN_DEVICE_ID })
      .where(eq(schema.memories.id, memory.id));

    await brain.runDecaySweep();

    const [row] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, memory.id));

    expect(row!.importance).toBe(0.5);
    expect(row!.updatedAt).toBe(staleAt);
    expect(row!.deviceId).toBe(FOREIGN_DEVICE_ID);
  });
});
