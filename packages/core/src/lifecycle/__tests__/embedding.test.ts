/**
 * Tests for Embedding Upgradability (#4).
 *
 * Validates:
 * 1. New memories store the embedding model ID
 * 2. embeddingStatus reports correct counts
 * 3. Legacy memories (no model ID) are detected
 * 4. backfillEmbeddingModel tags legacy memories
 * 5. reEmbed pipeline processes stale memories
 * 6. Auto-migration adds embedding_model column
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { getEmbeddingModelId, unpackFP16 } from '../../embedding/Embedder.js';
import { VectorSearch } from '../../retrieval/VectorSearch.js';
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
  const dbPath = path.join(__dirname, `test-embed-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  // Add columns from later migrations
  addNamespaceIfMissing(sqlite);
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  sqlite.close();
  return dbPath;
}

// ─── Model ID Stored on New Memories ─────────────────────────────────────────

describe('Embedding — model tracking', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('stores the current model ID on new memories', async () => {
    const { memory } = await brain.store({ content: 'Test memory with model tracking' });
    expect(memory.embeddingModel).toBe(getEmbeddingModelId());
  });

  it('stores correct embedding dimension', async () => {
    const { memory } = await brain.store({ content: 'Dimension check' });
    expect(memory.embeddingDim).toBe(384);
  });

  it('getEmbeddingModel returns the active model ID', () => {
    expect(brain.getEmbeddingModel()).toBe(getEmbeddingModelId());
    expect(brain.getEmbeddingModel()).toContain('MiniLM');
  });
});

// ─── Embedding Status ────────────────────────────────────────────────────────

describe('Embedding — status', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('reports all memories as current when freshly stored', async () => {
    await brain.store({ content: 'Memory one' });
    await brain.store({ content: 'Memory two' });

    const status = await brain.embeddingStatus();
    expect(status.totalEmbedded).toBe(2);
    expect(status.currentModelCount).toBe(2);
    expect(status.staleCount).toBe(0);
    expect(status.legacyCount).toBe(0);
    expect(status.needsReEmbed).toBe(false);
    expect(status.currentModel).toBe(getEmbeddingModelId());
    expect(status.currentDimension).toBe(384);
  });

  it('detects legacy memories without model ID', async () => {
    // Store normally
    await brain.store({ content: 'New memory' });

    // Manually insert a legacy memory (no embedding_model)
    const db = getDb();
    const { memory: ref } = await brain.store({ content: 'Will become legacy' });
    await db
      .update(schema.memories)
      .set({ embeddingModel: null })
      .where(eq(schema.memories.id, ref.id));

    const status = await brain.embeddingStatus();
    expect(status.currentModelCount).toBe(1);
    expect(status.legacyCount).toBe(1);
    expect(status.needsReEmbed).toBe(true);
  });

  it('detects stale memories with different model ID', async () => {
    const { memory } = await brain.store({ content: 'Stale memory test' });

    // Simulate a model change by updating the stored model ID
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ embeddingModel: 'old-model/v1' })
      .where(eq(schema.memories.id, memory.id));

    const status = await brain.embeddingStatus();
    expect(status.staleCount).toBe(1);
    expect(status.needsReEmbed).toBe(true);
  });
});

// ─── Backfill ────────────────────────────────────────────────────────────────

describe('Embedding — backfill', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('tags legacy memories with the current model ID', async () => {
    const { memory } = await brain.store({ content: 'Legacy backfill test' });

    // Remove the model ID to simulate legacy
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ embeddingModel: null })
      .where(eq(schema.memories.id, memory.id));

    // Verify it's legacy
    let status = await brain.embeddingStatus();
    expect(status.legacyCount).toBe(1);

    // Backfill
    await brain.backfillEmbeddingModel();

    // Now should be current
    status = await brain.embeddingStatus();
    expect(status.legacyCount).toBe(0);
    expect(status.currentModelCount).toBe(1);

    // Verify the actual DB record
    const [updated] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, memory.id))
      .limit(1);
    expect(updated!.embeddingModel).toBe(getEmbeddingModelId());
  });
});

// ─── Re-Embedding Pipeline ───────────────────────────────────────────────────

describe('Embedding — re-embed pipeline', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('re-embeds stale memories with the current model', async () => {
    const { memory: m1 } = await brain.store({ content: 'First memory about databases' });
    const { memory: m2 } = await brain.store({ content: 'Second memory about APIs' });

    // Mark both as stale (different model)
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ embeddingModel: 'old-model/v1' })
      .where(eq(schema.memories.id, m1.id));
    await db
      .update(schema.memories)
      .set({ embeddingModel: 'old-model/v1' })
      .where(eq(schema.memories.id, m2.id));

    let status = await brain.embeddingStatus();
    expect(status.staleCount).toBe(2);

    // Re-embed
    const result = await brain.reEmbed(true, 10);
    expect(result.total).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify all current now
    status = await brain.embeddingStatus();
    expect(status.staleCount).toBe(0);
    expect(status.currentModelCount).toBe(2);
  });

  it('onlyStale=true skips current memories', async () => {
    await brain.store({ content: 'Already current memory' });
    const { memory: stale } = await brain.store({ content: 'Will be stale' });

    const db = getDb();
    await db
      .update(schema.memories)
      .set({ embeddingModel: 'old-model/v1' })
      .where(eq(schema.memories.id, stale.id));

    const result = await brain.reEmbed(true, 10);
    expect(result.total).toBe(1); // only the stale one
    expect(result.processed).toBe(1);
  });

  it('onlyStale=false re-embeds all memories', async () => {
    await brain.store({ content: 'Memory A' });
    await brain.store({ content: 'Memory B' });

    const result = await brain.reEmbed(false, 10);
    expect(result.total).toBe(2);
    expect(result.processed).toBe(2);
  });

  it('fires progress callback during re-embedding', async () => {
    await brain.store({ content: 'Progress test memory' });

    const db = getDb();
    const all = await db.select().from(schema.memories);
    for (const m of all) {
      await db
        .update(schema.memories)
        .set({ embeddingModel: 'old/v0' })
        .where(eq(schema.memories.id, m.id));
    }

    const progressCalls: number[] = [];
    await brain.reEmbed(true, 1, (progress) => {
      progressCalls.push(progress.processed);
    });

    expect(progressCalls.length).toBeGreaterThan(0);
  });
});

// ─── Re-Embed Index Persistence ──────────────────────────────────────────────

describe('Embedding — re-embed persists the index', () => {
  let brain: NeuralBrain;
  let dbPath: string;
  let indexPath: string;

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

  it('writes refreshed vectors to disk without waiting for shutdown', async () => {
    const { memory } = await brain.store({ content: 'Kubernetes operators reconcile cluster state' });

    // Freeze the current vectors on disk, then change the stored content so the
    // recomputed embedding is genuinely different from the one just persisted.
    brain.saveIndex();
    const before = fs.readFileSync(indexPath);

    const db = getDb();
    await db
      .update(schema.memories)
      .set({ content: 'Sourdough starter needs daily feeding', embeddingModel: 'old-model/v1' })
      .where(eq(schema.memories.id, memory.id));

    const result = await brain.reEmbed(true, 10);
    expect(result.processed).toBe(1);

    expect(fs.readFileSync(indexPath).equals(before)).toBe(false);

    // A process restarting from this file must see what SQLite now holds.
    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    const stored = unpackFP16(Buffer.from(row!.embedding as ArrayBuffer));

    const reloaded = new VectorSearch(stored.length);
    reloaded.loadFromDisk(indexPath);
    const hits = reloaded.search(stored, 1, 0.0);

    expect(hits[0]!.id).toBe(memory.id);
    expect(hits[0]!.similarity).toBeGreaterThan(0.99);
  });

  it('leaves the index alone when nothing needed re-embedding', async () => {
    await brain.store({ content: 'Already current memory' });
    brain.saveIndex();
    const before = fs.readFileSync(indexPath);

    const result = await brain.reEmbed(true, 10);
    expect(result.total).toBe(0);

    expect(fs.readFileSync(indexPath).equals(before)).toBe(true);
  });

  it('a restarted brain reads the refreshed vectors, not the cached ones', async () => {
    const { memory } = await brain.store({ content: 'Postgres vacuum reclaims dead tuples' });
    brain.saveIndex();

    const db = getDb();
    await db
      .update(schema.memories)
      .set({ content: 'Alpine hiking trails close in winter', embeddingModel: 'old-model/v1' })
      .where(eq(schema.memories.id, memory.id));

    await brain.reEmbed(true, 10);

    // Drop the process without a graceful shutdown — that is the case the fix is
    // for. Calling shutdown() here would persist the index itself and mask it.
    closeDb();

    // A second brain over the same files takes the cached-index path on init.
    const restarted = new NeuralBrain({ dbPath, indexPath, defaultSource: 'test' });
    await restarted.initialize();
    expect(restarted.getIndexStatus().loadedFrom).toBe('disk');

    const hits = await restarted.search('winter hiking in the mountains', { topK: 1 });

    expect(hits[0]!.id).toBe(memory.id);
    restarted.shutdown();

    // afterEach shuts down `brain` again — make that a no-op, not a double free.
    brain = restarted;
  });

  it('survives a re-embed when the index cannot be written', async () => {
    await brain.store({ content: 'Memory stored before the path breaks' });

    const db = getDb();
    await db.update(schema.memories).set({ embeddingModel: 'old-model/v1' });

    // Point persistence at a path that cannot be created: an existing *file*
    // stands where the directory would have to be.
    const blocker = dbPath + '.blocked';
    fs.writeFileSync(blocker, 'not a directory');
    const broken = new NeuralBrain({
      dbPath,
      indexPath: path.join(blocker, 'nested', 'index.bin'),
      defaultSource: 'test',
    });
    await broken.initialize();

    const result = await broken.reEmbed(true, 10);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    broken.shutdown();
    try { fs.unlinkSync(blocker); } catch {}
    brain = broken;
  });
});

// ─── Auto-Migration ──────────────────────────────────────────────────────────

describe('Embedding — auto-migration', () => {
  it('adds embedding_model column to existing DB without it', async () => {
    // Create DB WITHOUT embedding_model column
    const dbPath = path.join(__dirname, `test-embed-migrate-${Date.now()}.db`);
    const sqlite = new Database(dbPath);
    const statements = MIGRATION_SQL.split('--> statement-breakpoint');
    for (const stmt of statements) {
      const sql = stmt.trim();
      if (sql) sqlite.exec(sql);
    }
    // Add namespace but NOT embedding_model
    addNamespaceIfMissing(sqlite);
    sqlite.close();

    // Initialize brain — should auto-migrate
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    // Should be able to store with model tracking
    const { memory } = await brain.store({ content: 'Post-migration memory' });
    expect(memory.embeddingModel).toBe(getEmbeddingModelId());

    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });
});
