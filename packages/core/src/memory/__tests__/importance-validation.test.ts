/**
 * Regression tests for importance boundary validation.
 *
 * `input.importance ?? default` let anything numeric through: NaN is not
 * nullish, so it reached SQLite, which stores NaN as NULL and then rejects the
 * row against a NOT NULL constraint — a store() that fails with a constraint
 * error rather than a message about the value. Out-of-range values were
 * accepted outright: importance 100 dominates every recall score and can never
 * fall below the archive threshold, so the memory is permanent and always
 * first. MCP and REST bound the value; a library caller had nothing.
 *
 * The scorer clamps as well, because a database written before this validation
 * can still hold such a row.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { computeRetentionScore, scoreMemory } from '../../retrieval/ImportanceScorer.js';

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
    `test-importance-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

describe('importance validation', () => {
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

  it('rejects NaN', async () => {
    await expect(brain.store({ content: 'nan importance', importance: Number.NaN }))
      .rejects.toThrow(/importance/i);
  });

  it('rejects values above 1', async () => {
    await expect(brain.store({ content: 'huge importance', importance: 100 }))
      .rejects.toThrow(/importance/i);
  });

  it('rejects values below 0', async () => {
    await expect(brain.store({ content: 'negative importance', importance: -0.5 }))
      .rejects.toThrow(/importance/i);
  });

  it('rejects Infinity', async () => {
    await expect(brain.store({ content: 'infinite importance', importance: Infinity }))
      .rejects.toThrow(/importance/i);
  });

  it('accepts the bounds themselves', async () => {
    const low = await brain.store({ content: 'floor importance', importance: 0 });
    const high = await brain.store({ content: 'ceiling importance', importance: 1 });
    expect(low.memory.importance).toBe(0);
    expect(high.memory.importance).toBe(1);
  });

  it('rejects out-of-range values on the typed memory stores too', async () => {
    await expect(brain.episodic.store({ content: 'bad episodic', importance: 7 }))
      .rejects.toThrow(/importance/i);
    await expect(brain.semantic.store({ concept: 'c', content: 'bad semantic', importance: 7 }))
      .rejects.toThrow(/importance/i);
  });
});

describe('scorer clamping for legacy rows', () => {
  const base = {
    similarity: 0.5,
    createdAt: new Date().toISOString(),
    lastAccessedAt: null,
    accessCount: 0,
  };

  it('scoreMemory cannot be dominated by an out-of-range importance', () => {
    const sane = scoreMemory({ ...base, importance: 1 });
    const absurd = scoreMemory({ ...base, importance: 100 });
    expect(absurd).toBeCloseTo(sane, 10);
    expect(absurd).toBeLessThanOrEqual(1);
  });

  it('computeRetentionScore cannot exceed 1 for an out-of-range importance', () => {
    const score = computeRetentionScore({
      importance: 100,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 1000,
    });
    expect(score).toBeLessThanOrEqual(1);
  });

  it('treats a negative stored importance as the floor, not a penalty', () => {
    expect(scoreMemory({ ...base, importance: -5 })).toBeCloseTo(scoreMemory({ ...base, importance: 0 }), 10);
  });
});
