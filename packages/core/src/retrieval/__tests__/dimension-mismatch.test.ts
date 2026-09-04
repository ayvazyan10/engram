/**
 * Tests for a database that holds vectors from more than one embedding model.
 *
 * Switching `ENGRAM_EMBEDDING_MODEL` changes the dimension of everything
 * `embed()` produces, while the rows already in SQLite keep the old one.
 * `VectorSearch.upsert()` refuses a vector of the wrong length on purpose —
 * mixing dimensions makes cosine similarity score garbage — so every unguarded
 * upsert turns one incompatible row into a thrown error.
 *
 * `reconcileIndex()` has always handled that by skipping and counting the row.
 * `initialize()`, `rebuildIndex()` and `store()` did not, which made the
 * database un-initialisable: `initialize()` threw, and `reEmbed()` — the
 * documented remedy — asserts an initialised brain, so it could not be reached.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { getEmbeddingModelId, packFP16 } from '../../embedding/Embedder.js';
import { VectorSearch } from '../VectorSearch.js';
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

/**
 * `memories.namespace` arrived in a later migration generation. Add it only
 * when the schema just applied does not already carry it, so this suite works
 * against either generation.
 */
function addNamespaceIfMissing(sqlite: InstanceType<typeof Database>): void {
  const { n } = sqlite
    .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('memories') WHERE name = 'namespace'")
    .get() as { n: number };
  if (n === 0) sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
}

/** What a row embedded by a 768-dim model looks like to a 384-dim index. */
const FOREIGN_DIM = 768;

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-dimmix-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  addNamespaceIfMissing(sqlite);
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.close();
  return dbPath;
}

/** Insert a row whose vector came from a model of a different dimension. */
function insertForeignDimRow(dbPath: string, id: string, content: string): void {
  const vector = new Float32Array(FOREIGN_DIM).fill(0.02);
  const raw = new Database(dbPath);
  try {
    raw
      .prepare(
        `INSERT INTO memories (id, type, content, embedding, embedding_dim, embedding_model, importance)
         VALUES (?, 'semantic', ?, ?, ?, 'Xenova/bge-base-en-v1.5', 0.8)`
      )
      .run(id, content, packFP16(vector), FOREIGN_DIM);
  } finally {
    raw.close();
  }
}

function indexOf(brain: NeuralBrain): VectorSearch {
  // The index is private on purpose; a test that needs to observe or perturb it
  // reaches in rather than the production API growing a hole for it.
  return (brain as unknown as { vectorSearch: VectorSearch }).vectorSearch;
}

describe('NeuralBrain — vectors from another embedding model', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(() => {
    try {
      brain?.shutdown();
    } catch {
      // Already shut down, or never initialised — nothing to persist.
    }
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('initialize() skips the incompatible vector instead of throwing', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Paris is the capital of France' });
    brain.shutdown();
    closeDb();

    insertForeignDimRow(dbPath, 'foreign-1', 'A memory embedded by a 768-dim model');

    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await expect(brain.initialize()).resolves.toBeUndefined();

    const status = brain.getIndexStatus();
    expect(status.entryCount).toBe(1);
    expect(status.dimensionMismatched).toBe(1);
  });

  it('embeddingStatus() reports the mismatch so an operator knows re_embed is due', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Paris is the capital of France' });
    brain.shutdown();
    closeDb();

    insertForeignDimRow(dbPath, 'foreign-2', 'A memory embedded by a 768-dim model');

    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    const status = await brain.embeddingStatus();
    expect(status.dimensionMismatchCount).toBe(1);
    expect(status.needsReEmbed).toBe(true);
  });

  it('reEmbed() is reachable and clears the mismatch', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Paris is the capital of France' });
    brain.shutdown();
    closeDb();

    insertForeignDimRow(dbPath, 'foreign-3', 'Basalt columns form as lava cools slowly');

    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    const progress = await brain.reEmbed();
    expect(progress.failed).toBe(0);
    expect(progress.processed).toBeGreaterThanOrEqual(1);

    const hits = await brain.search('basalt columns lava', { topK: 10, threshold: 0 });
    expect(hits.map((h) => h.id)).toContain('foreign-3');

    const after = await brain.embeddingStatus();
    expect(after.dimensionMismatchCount).toBe(0);
    expect(after.needsReEmbed).toBe(false);
    expect(after.currentModel).toBe(getEmbeddingModelId());
  });

  it('rebuildIndex() skips the incompatible vector and keeps the rest', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Paris is the capital of France' });
    brain.shutdown();
    closeDb();

    // Ordered ahead of a healthy row: a throw here used to abandon the rebuild
    // with the index already cleared and only part of the database re-added.
    insertForeignDimRow(dbPath, 'foreign-4', 'A memory embedded by a 768-dim model');

    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Basalt columns form as lava cools slowly' });

    const status = await brain.rebuildIndex();

    expect(status.entryCount).toBe(2);
    expect(status.dimensionMismatched).toBe(1);
    const hits = await brain.search('basalt columns lava', { topK: 10, threshold: 0 });
    expect(hits.map((h) => h.id).length).toBeGreaterThan(0);
  });

  it('rebuildIndex() leaves the previous index intact when the rebuild fails', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Paris is the capital of France' });
    await brain.store({ content: 'Basalt columns form as lava cools slowly' });

    const db = getDb();
    const spy = vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('database read exploded');
    });

    // clear()-then-repopulate meant any failure after the clear left the process
    // searching an empty index until the next restart.
    await expect(brain.rebuildIndex()).rejects.toThrow('database read exploded');
    spy.mockRestore();

    expect(brain.getIndexStatus().entryCount).toBe(2);
    // Both entries are still reachable — the index was never emptied.
    expect((await brain.search('capital of France', { topK: 10, threshold: 0 })).length).toBeGreaterThan(0);
    expect((await brain.search('basalt columns lava', { topK: 10, threshold: 0 })).length).toBeGreaterThan(0);
  });

  it('store() does not throw when the live index holds another dimension', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    // The state switchEmbeddingModel() leaves behind: the index is sized for a
    // model that no longer matches what embed() produces. Reached directly here
    // rather than by switching for real, which would download a second model.
    indexOf(brain).setDimension(FOREIGN_DIM);

    const result = await brain.store({ content: 'Stored while the index is sized for another model' });

    expect(result.memory.id).toBeTruthy();
    const rows = await getDb().select().from(schema.memories);
    expect(rows.length).toBe(1);
    // The row is durable but unsearchable until re_embed — and that is reported.
    expect(brain.getIndexStatus().dimensionMismatched).toBeGreaterThanOrEqual(1);
  });
});
