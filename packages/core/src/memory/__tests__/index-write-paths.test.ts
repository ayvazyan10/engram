/**
 * Tests for the direct memory writers — `brain.semantic`, `brain.episodic` and
 * `brain.procedural`.
 *
 * These are public `readonly` members of NeuralBrain, so callers reach them as
 * a first-class API. They used to insert into SQLite and stop there: nothing
 * upserted the new vector into the index or the new node into the graph, and
 * nothing recorded `embedding_model`. The row existed and `stats()` counted it,
 * but `search()` could never surface it, and `embeddingStatus()` reported it as
 * legacy forever, so `reEmbed(onlyStale)` re-embedded it on every run.
 *
 * `semantic.update()` was the worst of the three: it re-embedded into the
 * database while the index kept the old vector, `shutdown()` persisted that
 * stale vector, and `initialize()` trusted the cache for any id it already
 * held — so the staleness survived restarts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { embed, getEmbeddingModelId, packFP16 } from '../../embedding/Embedder.js';
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
  const dbPath = path.join(__dirname, `test-writepath-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  addNamespaceIfMissing(sqlite);
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  sqlite.close();
  return dbPath;
}

async function scoreFor(brain: NeuralBrain, query: string, id: string): Promise<number> {
  const hits = await brain.search(query, { topK: 50, threshold: 0 });
  return hits.find((h) => h.id === id)?.score ?? 0;
}

describe('brain.semantic / .episodic / .procedural — index and graph write paths', () => {
  let dbPath: string;
  let indexPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    indexPath = dbPath + '.index';
    brain = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('semantic.store() makes the memory searchable', async () => {
    const memory = await brain.semantic.store({
      concept: 'Capital of France',
      content: 'Paris is the capital of France',
    });

    const hits = await brain.search('capital of France', { topK: 10, threshold: 0 });

    expect(hits.map((h) => h.id)).toContain(memory.id);
  });

  it('episodic.store() makes the memory searchable', async () => {
    const memory = await brain.episodic.store({
      content: 'Deployed the billing service on Tuesday morning',
    });

    const hits = await brain.search('billing service deployment', { topK: 10, threshold: 0 });

    expect(hits.map((h) => h.id)).toContain(memory.id);
  });

  it('procedural.store() makes the memory searchable', async () => {
    const memory = await brain.procedural.store({
      triggerPattern: 'when a migration fails',
      actionPattern: 'roll back and re-run with --verbose',
      content: 'Migration rollback procedure',
    });

    const hits = await brain.search('migration fails rollback', { topK: 10, threshold: 0 });

    expect(hits.map((h) => h.id)).toContain(memory.id);
  });

  it('stats() reports an index and graph that match the stored total', async () => {
    await brain.semantic.store({ concept: 'Capital of France', content: 'Paris is the capital of France' });
    await brain.episodic.store({ content: 'Reviewed the sync engine pull path' });
    await brain.procedural.store({
      triggerPattern: 'when the index looks stale',
      actionPattern: 'call syncIndexFromStore',
      content: 'Index staleness procedure',
    });

    const stats = await brain.stats();

    expect(stats.total).toBe(3);
    expect(stats.indexSize).toBe(3);
    expect(stats.graphNodes).toBe(3);
  });

  it('records the embedding model, so the rows are not re-embedded forever', async () => {
    await brain.semantic.store({ concept: 'Capital of France', content: 'Paris is the capital of France' });
    await brain.episodic.store({ content: 'Reviewed the sync engine pull path' });
    await brain.procedural.store({
      triggerPattern: 'when the index looks stale',
      actionPattern: 'call syncIndexFromStore',
      content: 'Index staleness procedure',
    });

    const status = await brain.embeddingStatus();

    expect(status.legacyCount).toBe(0);
    expect(status.currentModelCount).toBe(3);
    expect(status.needsReEmbed).toBe(false);

    const rows = await getDb().select().from(schema.memories);
    for (const row of rows) {
      expect(row.embeddingModel).toBe(getEmbeddingModelId());
    }
  });

  it('semantic.store() adds its relatesTo edges to the graph', async () => {
    const first = await brain.semantic.store({ concept: 'France', content: 'France is a country in Europe' });
    await brain.semantic.store({
      concept: 'Capital of France',
      content: 'Paris is the capital of France',
      relatesTo: [{ conceptId: first.id, relationship: 'relates_to' }],
    });

    const stats = await brain.stats();

    expect(stats.graphNodes).toBe(2);
    expect(stats.graphEdges).toBeGreaterThanOrEqual(1);
  });

  it('semantic.update() refreshes the indexed vector', async () => {
    const memory = await brain.semantic.store({
      concept: 'Capital of France',
      content: 'Paris is the capital of France',
    });

    await brain.semantic.update(memory.id, { content: 'Alpine hiking trails close in winter' });

    const capitalScore = await scoreFor(brain, 'capital of France', memory.id);
    const hikingScore = await scoreFor(brain, 'alpine hiking trails in winter', memory.id);

    expect(hikingScore).toBeGreaterThan(capitalScore);
  });

  it('the refreshed vector survives a restart', async () => {
    // Stored through brain.store(), so the index really does hold a vector for
    // this id — the worst case in the report: update() re-embedded into the
    // database, the index kept the old vector, shutdown() persisted it, and the
    // next initialize() trusted the cache, so the staleness outlived restarts.
    const stored = await brain.store({ content: 'Paris is the capital of France', type: 'semantic' });
    const memory = stored.memory;
    await brain.semantic.update(memory.id, { content: 'Alpine hiking trails close in winter' });

    brain.shutdown();
    closeDb();

    brain = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await brain.initialize();

    const capitalScore = await scoreFor(brain, 'capital of France', memory.id);
    const hikingScore = await scoreFor(brain, 'alpine hiking trails in winter', memory.id);

    expect(hikingScore).toBeGreaterThan(capitalScore);
  });

  it('initialize() refreshes a cached vector the database has since moved past', async () => {
    // A vector the persisted index disagrees with is exactly what an older
    // Engram left behind, and what any external re-embed produces. initialize()
    // used to skip every id already in the cache, so the stale vector was
    // reloaded on every start and never corrected.
    const memory = await brain.store({ content: 'Paris is the capital of France' });
    brain.shutdown();
    closeDb();

    const replacement = await embed('Alpine hiking trails close in winter');
    const raw = new Database(dbPath);
    raw.prepare('UPDATE memories SET content = ?, embedding = ?, updated_at = ? WHERE id = ?').run(
      'Alpine hiking trails close in winter',
      packFP16(replacement),
      new Date().toISOString(),
      memory.memory.id
    );
    raw.close();

    brain = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await brain.initialize();

    expect(brain.getIndexStatus().loadedFrom).toBe('disk');
    const capitalScore = await scoreFor(brain, 'capital of France', memory.memory.id);
    const hikingScore = await scoreFor(brain, 'alpine hiking trails in winter', memory.memory.id);
    expect(hikingScore).toBeGreaterThan(capitalScore);
  });

  it('initialize() leaves an unchanged cached index alone', async () => {
    await brain.store({ content: 'First memory' });
    await brain.store({ content: 'Second memory' });
    brain.shutdown();
    closeDb();

    brain = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await brain.initialize();

    // Nothing changed in the database, so the cache is authoritative and no
    // entry needs re-indexing — this is what makes the disk cache worth having.
    const status = brain.getIndexStatus();
    expect(status.loadedFrom).toBe('disk');
    expect(status.incrementalCount).toBe(0);
    expect(status.entryCount).toBe(2);
  });

  it('a row written by brain.semantic is recalled after a restart', async () => {
    const memory = await brain.semantic.store({
      concept: 'Capital of France',
      content: 'Paris is the capital of France',
    });
    brain.shutdown();
    closeDb();

    brain = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await brain.initialize();

    const hits = await brain.search('capital of France', { topK: 10, threshold: 0 });
    expect(hits.map((h) => h.id)).toContain(memory.id);

    const row = await getDb().select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row[0]!.embeddingModel).toBe(getEmbeddingModelId());
  });
});
