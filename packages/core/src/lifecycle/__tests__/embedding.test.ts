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
import { getEmbeddingModelId } from '../../embedding/Embedder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-embed-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  // Add columns from later migrations
  sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  sqlite.close();
  return dbPath;
}

function cleanup(dbPath: string) {
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
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
    cleanup(dbPath);
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
    cleanup(dbPath);
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
    cleanup(dbPath);
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
    cleanup(dbPath);
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
    sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
    sqlite.close();

    // Initialize brain — should auto-migrate
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    // Should be able to store with model tracking
    const { memory } = await brain.store({ content: 'Post-migration memory' });
    expect(memory.embeddingModel).toBe(getEmbeddingModelId());

    brain.shutdown();
    closeDb();
    cleanup(dbPath);
  });
});
