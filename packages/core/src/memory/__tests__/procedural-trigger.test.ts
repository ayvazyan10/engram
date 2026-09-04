/**
 * Regression test: ProceduralMemory.getByTrigger ignored its triggerQuery
 * argument entirely and returned the top-20 procedural memories by importance,
 * so "when X do Y" retrieval returned unrelated rules.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
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
  const dbPath = path.join(__dirname, `test-procedural-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

describe('ProceduralMemory.getByTrigger', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('ranks trigger-relevant rules above unrelated ones', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.procedural.store({
      triggerPattern: 'when deploying to production',
      actionPattern: 'run the smoke test suite first',
      content: 'Production deployment checklist',
    });
    await brain.procedural.store({
      triggerPattern: 'when writing SQL queries',
      actionPattern: 'always use parameterized statements',
      content: 'SQL injection safety rule',
    });

    const hits = await brain.procedural.getByTrigger('deploying to production');

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.triggerPattern).toContain('deploying');
  });

  it('does not return unrelated rules for a specific trigger', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    // The unrelated rule is deliberately the most important one — the old
    // implementation ordered purely by importance and would return it first.
    await brain.procedural.store({
      triggerPattern: 'when the database migration fails',
      actionPattern: 'roll back and restore the snapshot',
      content: 'Migration rollback procedure',
    });

    const hits = await brain.procedural.getByTrigger('how to bake sourdough bread');

    expect(hits.every((h) => h.triggerPattern !== 'when the database migration fails')).toBe(true);
  });

  it('returns nothing for an empty trigger query', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.procedural.store({
      triggerPattern: 'when tests fail',
      actionPattern: 'read the stack trace',
      content: 'Debug procedure',
    });

    expect(await brain.procedural.getByTrigger('   ')).toEqual([]);
  });
});
