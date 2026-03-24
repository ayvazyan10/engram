/**
 * Tests for Namespace Isolation.
 *
 * Validates:
 * 1. Without namespace — everything works as before (backwards compat)
 * 2. With namespace — store scopes memories, search/stats only return same-namespace
 * 3. crossNamespace flag — allows searching across all namespaces
 * 4. Two brains sharing one DB — each sees only its own namespace
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-ns-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  // Add namespace column (simulating auto-migration)
  sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  sqlite.close();
  return dbPath;
}

function cleanup(dbPath: string) {
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
}

// ─── Backwards Compatibility ────────────────────────────────────────────────

describe('Namespace — backwards compatibility', () => {
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

  it('no namespace configured — getNamespace returns undefined', () => {
    expect(brain.getNamespace()).toBeUndefined();
  });

  it('stored memories have null namespace by default', async () => {
    const { memory: mem } = await brain.store({ content: 'No namespace memory' });
    expect(mem.namespace).toBeNull();
  });

  it('stats show namespace as null', async () => {
    await brain.store({ content: 'Test' });
    const stats = await brain.stats();
    expect(stats.namespace).toBeNull();
    expect(stats.total).toBe(1);
  });

  it('search returns all memories regardless of namespace', async () => {
    await brain.store({ content: 'Global memory about TypeScript' });
    const results = await brain.search('TypeScript');
    expect(results.length).toBe(1);
  });
});

// ─── Namespace Scoping ──────────────────────────────────────────────────────

describe('Namespace — scoped operations', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test', namespace: 'project-a' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanup(dbPath);
  });

  it('getNamespace returns configured namespace', () => {
    expect(brain.getNamespace()).toBe('project-a');
  });

  it('stored memories carry the namespace', async () => {
    const { memory: mem } = await brain.store({ content: 'Namespaced memory' });
    expect(mem.namespace).toBe('project-a');
  });

  it('stats are scoped to namespace', async () => {
    await brain.store({ content: 'In project-a' });
    const stats = await brain.stats();
    expect(stats.namespace).toBe('project-a');
    expect(stats.total).toBe(1);
  });

  it('per-store namespace override works', async () => {
    const { memory: mem } = await brain.store({ content: 'Override to project-b', namespace: 'project-b' });
    expect(mem.namespace).toBe('project-b');

    // project-b memory not visible in project-a stats
    const stats = await brain.stats();
    expect(stats.total).toBe(0);
  });
});

// ─── Two Brains Sharing One DB ──────────────────────────────────────────────

describe('Namespace — two brains, one DB', () => {
  let brainA: NeuralBrain;
  let brainB: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();

    // Brain A stores first, then shuts down so brain B can use the same DB singleton
    brainA = new NeuralBrain({ dbPath, defaultSource: 'test', namespace: 'alpha' });
    await brainA.initialize();
    await brainA.store({ content: 'Alpha memory about deployment workflows' });
    await brainA.store({ content: 'Alpha memory about CI pipelines' });
    brainA.shutdown();
    closeDb();

    // Brain B uses a different namespace
    brainB = new NeuralBrain({ dbPath, defaultSource: 'test', namespace: 'beta' });
    await brainB.initialize();
    await brainB.store({ content: 'Beta memory about database schemas' });
  });

  afterEach(() => {
    brainB.shutdown();
    closeDb();
    cleanup(dbPath);
  });

  it('brain B only sees its own memories in stats', async () => {
    const stats = await brainB.stats();
    expect(stats.total).toBe(1);
    expect(stats.namespace).toBe('beta');
  });

  it('brain B search only returns beta memories', async () => {
    const results = await brainB.search('deployment workflows');
    // Should NOT find alpha's deployment memory
    expect(results.length).toBe(0);
  });

  it('crossNamespace search returns memories from all namespaces', async () => {
    const results = await brainB.search('deployment workflows', { crossNamespace: true });
    // Should find alpha's deployment memory via cross-namespace
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('decay sweep only affects the active namespace', async () => {
    // Age beta's memory and run decay
    const { getDb, schema } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();

    // Get all beta memories
    const betaMems = await db.select().from(schema.memories).where(eq(schema.memories.namespace, 'beta'));
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    for (const m of betaMems) {
      await db.update(schema.memories).set({
        createdAt: oldDate,
        updatedAt: oldDate,
        lastAccessedAt: null,
        importance: 0.01,
      }).where(eq(schema.memories.id, m.id));
    }

    brainB.updateDecayPolicy({ archiveThreshold: 0.1 });
    const result = await brainB.runDecaySweep(false);

    expect(result.archivedCount).toBe(1); // only beta's memory

    // Alpha's memories should still be in DB
    const alphaMems = await db.select().from(schema.memories).where(eq(schema.memories.namespace, 'alpha'));
    const activeAlpha = alphaMems.filter(m => !m.archivedAt);
    expect(activeAlpha.length).toBe(2); // untouched
  });
});

// ─── Auto-migration ─────────────────────────────────────────────────────────

describe('Namespace — auto-migration', () => {
  it('adds namespace column to existing DB without it', async () => {
    // Create a DB WITHOUT the namespace column
    const dbPath = path.join(__dirname, `test-migrate-${Date.now()}.db`);
    const sqlite = new Database(dbPath);
    const statements = MIGRATION_SQL.split('--> statement-breakpoint');
    for (const stmt of statements) {
      const sql = stmt.trim();
      if (sql) sqlite.exec(sql);
    }
    // Do NOT add namespace column — let auto-migration handle it
    sqlite.close();

    // Initialize brain — should auto-migrate
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    // Should be able to store with namespace
    const { memory: mem } = await brain.store({ content: 'Post-migration memory', namespace: 'migrated' });
    expect(mem.namespace).toBe('migrated');

    brain.shutdown();
    closeDb();
    cleanup(dbPath);
  });
});
