/**
 * Regression tests for recall-path persistence and budget truncation.
 *
 * Both bugs came from the same audit finding cluster:
 * - access stats / audit log were issued as bare `void db.update(...)`, and
 *   drizzle query builders are lazy — the SQL was never sent.
 * - the token-budget loop `break`s on the first oversized memory, so a single
 *   large top-scored memory could yield an empty context.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { getDb, closeDb, schema } from '../../db/index.js';
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
  const dbPath = path.join(__dirname, `test-recall-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

describe('recall persistence', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('persists accessCount and lastAccessedAt for recalled memories', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const { memory } = await brain.store({
      content: 'TypeScript generics allow reusable type-safe abstractions',
      type: 'semantic',
      source: 'unit-test',
      importance: 0.7,
    });

    const db = getDb();
    const [before] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    const countBefore = before!.accessCount ?? 0;

    const result = await brain.recall('TypeScript generics');
    expect(result.memories.length).toBeGreaterThan(0);

    const [after] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(after!.accessCount ?? 0).toBeGreaterThan(countBefore);
    expect(after!.lastAccessedAt).toBeTruthy();
  });

  it('writes an audit row to context_assemblies', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.store({
      content: 'Postgres uses MVCC for concurrency control',
      type: 'semantic',
      source: 'unit-test',
      importance: 0.7,
    });

    await brain.recall('Postgres concurrency');

    const db = getDb();
    const logs = await db.select().from(schema.contextAssemblies);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('returns the top memory even when it alone exceeds the token budget', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    // Long but strongly on-topic, so vector search still matches it while the
    // content far exceeds the token budget below.
    await brain.store({
      content: 'quantum entanglement correlations between particles. '.repeat(20),
      type: 'semantic',
      source: 'unit-test',
      importance: 0.7,
    });

    // maxTokens 10 => ~40 chars budget, far below the stored content length.
    const result = await brain.recall('quantum entanglement', { maxTokens: 10 });

    expect(result.memories.length).toBeGreaterThanOrEqual(1);
    expect(result.context).not.toBe('');
  });

  it('keeps filling the budget with smaller items after an oversized one', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    // A long, highly-relevant memory plus a short, also-relevant one.
    await brain.store({
      content: `neural plasticity mechanisms ${'detail '.repeat(600)}`,
      type: 'semantic',
      source: 'unit-test',
      importance: 0.9,
    });
    await brain.store({
      content: 'neural plasticity is adaptive',
      type: 'semantic',
      source: 'unit-test',
      importance: 0.9,
    });

    // Budget large enough for the short memory but not the long one.
    const result = await brain.recall('neural plasticity', { maxTokens: 40 });
    expect(result.memories.length).toBeGreaterThanOrEqual(1);
  });
});
