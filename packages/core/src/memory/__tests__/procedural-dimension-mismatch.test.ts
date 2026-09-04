/**
 * Regression test for ProceduralMemory.getByTrigger.
 *
 * Its local cosineSimilarity iterated Math.min(a.length, b.length) components,
 * so a 384-dim rule left behind by a previous embedding model was scored
 * against the first 384 components of a 768-dim query — noise, scored
 * confidently enough to clear minSimilarity, with no throw and no skip. This is
 * exactly the silent-garbage case VectorSearch.upsert refuses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { embed, packFP16 } from '../../embedding/Embedder.js';

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
    `test-proc-dim-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

const TRIGGER = 'when the production build fails on CI';

describe('ProceduralMemory.getByTrigger — dimension mismatch', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('skips a rule whose stored vector has another dimension', async () => {
    const rule = await brain.procedural.store({
      triggerPattern: TRIGGER,
      actionPattern: 'rerun the build with a clean cache',
      content: 'CI build failure recovery',
    });

    // Re-stamp the row with a vector from a hypothetical 768-dim model whose
    // first 384 components are exactly the query's — a prefix comparison would
    // score it a perfect 1.0.
    const queryVec = await embed(TRIGGER);
    const wide = new Float32Array(queryVec.length * 2);
    wide.set(queryVec, 0);
    wide.fill(0.01, queryVec.length);

    await getDb()
      .update(schema.memories)
      .set({ embedding: packFP16(wide), embeddingDim: wide.length })
      .where(eq(schema.memories.id, rule.id));

    const matches = await brain.procedural.getByTrigger(TRIGGER, 0.5);
    expect(matches).toHaveLength(0);
  });

  it('still returns a rule whose vector matches the query dimension', async () => {
    await brain.procedural.store({
      triggerPattern: TRIGGER,
      actionPattern: 'rerun the build with a clean cache',
      content: 'CI build failure recovery',
    });

    const matches = await brain.procedural.getByTrigger(TRIGGER, 0.5);
    expect(matches).toHaveLength(1);
  });
});
