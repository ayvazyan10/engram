/**
 * Regression test for consolidate() vs. contradiction auto-resolution.
 *
 * consolidate() destructured only `memory` from store(), ignoring the
 * `discarded` flag that says the row was archived the instant it was written.
 * With auto-resolution on, the deterministic dedup summary repeats each
 * episode's wording — negations included — so it contradicts its own sources at
 * near-identical similarity and is archived immediately. consolidate() then
 * archived the whole cluster behind that dead summary and reported it as
 * created: three episodes plus one summary, none of them live.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { inArray, isNull } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
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

/** Apply the schema, tolerating either migration generation. */
function applySchema(sqlite: InstanceType<typeof Database>): void {
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  // `memories.namespace` arrived in a later migration generation; add it only
  // when the schema just applied does not already carry it.
  const { n } = sqlite
    .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('memories') WHERE name = 'namespace'")
    .get() as { n: number };
  if (n === 0) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  }
}

function createTestDb(): string {
  const dbPath = path.join(
    __dirname,
    `test-consolidate-discard-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

describe('consolidate() with contradiction auto-resolution', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({
      dbPath,
      defaultSource: 'test',
      contradictionConfig: { enabled: true, autoResolve: true, defaultStrategy: 'keep_oldest' },
    });
    await brain.initialize();
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('leaves the cluster alone when its summary is discarded on write', async () => {
    const episodes = [
      await brain.store({ content: 'The nightly backup did not complete successfully', type: 'episodic' }),
      await brain.store({ content: 'The nightly backup did not complete successfully again', type: 'episodic' }),
      await brain.store({ content: 'The nightly backup did not complete successfully today', type: 'episodic' }),
    ];
    const episodeIds = episodes.map((e) => e.memory.id);

    const db = getDb();
    const before = await db
      .select({ id: schema.memories.id })
      .from(schema.memories)
      .where(inArray(schema.memories.id, episodeIds));
    expect(before).toHaveLength(3);

    const created = await brain.consolidate(3, 0.5);

    // Nothing consolidate() reports as created may be archived.
    if (created.length > 0) {
      const rows = await db
        .select()
        .from(schema.memories)
        .where(inArray(schema.memories.id, created.map((m) => m.id)));
      for (const row of rows) expect(row.archivedAt).toBeNull();
    }

    // The summary was discarded, so its sources must still be there.
    expect(created).toHaveLength(0);
    const live = await db
      .select({ id: schema.memories.id })
      .from(schema.memories)
      .where(isNull(schema.memories.archivedAt));
    const liveIds = new Set(live.map((r) => r.id));
    for (const id of episodeIds) expect(liveIds.has(id)).toBe(true);
  });
});
