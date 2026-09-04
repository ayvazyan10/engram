/**
 * Tests for cross-process vector index synchronisation.
 *
 * Engram runs several processes — the REST server, the MCP server, the CLI —
 * against ONE SQLite file, and each holds its own in-memory vector index. A
 * write committed by one process landed in SQLite but stayed invisible to every
 * other process's index until that process restarted: `memory_stats` reported
 * the new total while `search` could not find the memory.
 *
 * These tests drive that from the outside: a second connection writes straight
 * to the database, and the brain must reconcile its index on the next read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import { embed, packFP16 } from '../../embedding/Embedder.js';
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

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

/**
 * Write a memory over a SEPARATE connection — the stand-in for another engram
 * process. Nothing here touches the brain, so only a reconcile can surface it.
 */
async function writeExternally(dbPath: string, id: string, content: string): Promise<void> {
  const vector = await embed(content);
  const raw = new Database(dbPath);
  try {
    raw.prepare(
      `INSERT INTO memories (id, type, content, embedding, embedding_dim, importance)
       VALUES (?, 'semantic', ?, ?, ?, 0.8)`
    ).run(id, content, packFP16(vector), vector.length);
  } finally {
    raw.close();
  }
}

function archiveExternally(dbPath: string, id: string): void {
  const raw = new Database(dbPath);
  try {
    raw.prepare(`UPDATE memories SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  } finally {
    raw.close();
  }
}

describe('NeuralBrain — cross-process index sync', () => {
  let dbPath: string;
  let indexPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    indexPath = dbPath + '.index';
    brain = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Local memory written through the brain itself' });
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('search() finds a memory committed by another connection', async () => {
    await writeExternally(dbPath, 'external-1', 'Saturn has a prominent ring system');

    const hits = await brain.search('Saturn rings', { topK: 10, threshold: 0.1 });

    expect(hits.map((h) => h.id)).toContain('external-1');
  });

  it('recall() finds a memory committed by another connection', async () => {
    await writeExternally(dbPath, 'external-2', 'The Kraken is a legendary sea monster');

    const result = await brain.recall('legendary sea monster');

    expect(result.memories.map((m) => m.id)).toContain('external-2');
  });

  it('drops index entries archived by another connection', async () => {
    await writeExternally(dbPath, 'external-3', 'Ephemeral note about tidal charts');
    // Pull it into the index first, so removal is what the next read must notice.
    await brain.search('tidal charts', { topK: 10, threshold: 0.1 });
    expect(brain.getIndexStatus().entryCount).toBe(2);

    archiveExternally(dbPath, 'external-3');
    const hits = await brain.search('tidal charts', { topK: 10, threshold: 0.1 });

    expect(hits.map((h) => h.id)).not.toContain('external-3');
    expect(brain.getIndexStatus().entryCount).toBe(1);
  });

  it('getIndexStatus() reports the live entry count, not the init snapshot', async () => {
    expect(brain.getIndexStatus().entryCount).toBe(1);

    await writeExternally(dbPath, 'external-4', 'Basalt columns form as lava cools');
    await brain.search('basalt columns', { topK: 10, threshold: 0.1 });

    expect(brain.getIndexStatus().entryCount).toBe(2);
  });

  it('stats() reports an index size that matches the stored total', async () => {
    await writeExternally(dbPath, 'external-5', 'Cassava must be processed before eating');

    const stats = await brain.stats();

    expect(stats.total).toBe(2);
    expect(stats.indexSize).toBe(stats.total);
  });

  it('reconciles once per external commit, not once per read', async () => {
    await writeExternally(dbPath, 'external-6', 'Обсидиан — вулканическое стекло');

    await brain.search('обсидиан', { topK: 5, threshold: 0.1 });
    const afterFirst = brain.getIndexStatus().externalSyncCount;

    await brain.search('обсидиан', { topK: 5, threshold: 0.1 });
    await brain.search('обсидиан', { topK: 5, threshold: 0.1 });

    expect(afterFirst).toBeGreaterThan(0);
    expect(brain.getIndexStatus().externalSyncCount).toBe(afterFirst);
  });

  it('skips a vector from another embedding model instead of failing the read', async () => {
    // Half the dimensions the active model emits — what a memory embedded by a
    // different model looks like. Before this was guarded, upsert's dimension
    // check threw straight out of search().
    const foreign = new Float32Array(192).fill(0.1);
    const raw = new Database(dbPath);
    raw.prepare(
      `INSERT INTO memories (id, type, content, embedding, embedding_dim, importance)
       VALUES ('foreign-dim', 'semantic', 'Vector from another model', ?, 192, 0.8)`
    ).run(packFP16(foreign));
    raw.close();

    const hits = await brain.search('another model', { topK: 5, threshold: 0.1 });

    expect(hits.map((h) => h.id)).not.toContain('foreign-dim');
    expect(brain.getIndexStatus().externalSkipped).toBe(1);
    // The healthy entry is still searchable — one bad row must not poison reads.
    expect(brain.getIndexStatus().entryCount).toBe(1);
  });

  it('leaves the index alone when the brain itself is the only writer', async () => {
    const before = brain.getIndexStatus().externalSyncCount;

    await brain.store({ content: 'Another memory through the brain' });
    const hits = await brain.search('another memory', { topK: 5, threshold: 0.1 });

    // store() already indexed it, so no cross-process reconcile is warranted.
    expect(hits.length).toBeGreaterThan(0);
    expect(brain.getIndexStatus().externalSyncCount).toBe(before);
  });
});
