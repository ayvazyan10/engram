/**
 * Regression test for RecallOptions.types.
 *
 * The type filter was handed to the vector search only. Graph expansion then
 * pulled in neighbours of the vector hits, and the record loop that follows
 * checked archived / sources / namespace but never the type — so a recall
 * restricted to semantic memories returned episodic neighbours and rendered a
 * whole "[PAST EVENTS & CONVERSATIONS]" section for them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import type { RecallChunk, RecallStreamComplete } from '../ContextAssembler.js';

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
    `test-recall-types-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

describe('recall type filter', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    // Auto-linking wires these three together, so the episodic pair is reachable
    // from the semantic hit by graph expansion.
    await brain.store({ content: 'PostgreSQL connection pooling uses PgBouncer', type: 'semantic' });
    await brain.store({ content: 'We debugged the PostgreSQL connection pool yesterday', type: 'episodic' });
    await brain.store({ content: 'PostgreSQL connection pool exhaustion caused an outage', type: 'episodic' });
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('excludes graph-expanded neighbours of another type', async () => {
    const result = await brain.recall('PostgreSQL connection pooling', { types: ['semantic'] });

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories.map((m) => m.type)).toEqual(result.memories.map(() => 'semantic'));
    expect(result.context).not.toContain('[PAST EVENTS & CONVERSATIONS]');
  });

  it('excludes graph-expanded neighbours of another type while streaming', async () => {
    const chunks: Array<RecallChunk | RecallStreamComplete> = [];
    for await (const chunk of brain.recallStream('PostgreSQL connection pooling', { types: ['semantic'] })) {
      chunks.push(chunk);
    }

    const complete = chunks.at(-1) as RecallStreamComplete;
    expect(complete.phase).toBe('complete');
    expect(complete.memories.length).toBeGreaterThan(0);
    for (const memory of complete.memories) expect(memory.type).toBe('semantic');
    expect(complete.context).not.toContain('[PAST EVENTS & CONVERSATIONS]');
  });
});
