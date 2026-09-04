/**
 * Regression test for getReflectionTasks() memory selection.
 *
 * The query took the newest `maxMemoriesToAnalyze` rows by updatedAt and the
 * engine dropped the ones below `minImportance` afterwards, so a burst of
 * low-importance writes pushed every qualifying memory out of the window and
 * reflection returned nothing at all. getReflections() was already fixed for
 * exactly this ordering; this is its sibling.
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
    `test-reflect-select-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

describe('getReflectionTasks() selection', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    brain?.shutdown();
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('applies minImportance before the row limit', async () => {
    brain = new NeuralBrain({
      dbPath,
      defaultSource: 'test',
      reflection: { types: ['pattern', 'trend'], maxMemoriesToAnalyze: 5, minImportance: 0.3 },
    });
    await brain.initialize();

    for (let i = 0; i < 3; i++) {
      await brain.store({ content: `A durable architectural fact number ${i}`, type: 'semantic', importance: 0.9 });
    }
    // Five newer, low-importance rows: enough to fill the limit on their own.
    for (let i = 0; i < 5; i++) {
      await brain.store({ content: `Throwaway chatter number ${i}`, type: 'episodic', importance: 0.1 });
    }

    const tasks = await brain.getReflectionTasks();

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.stats.total).toBe(3);
    expect(tasks[0]!.stats.byType['semantic']).toBe(3);
    expect(tasks[0]!.stats.byType['episodic']).toBeUndefined();
  });
});
