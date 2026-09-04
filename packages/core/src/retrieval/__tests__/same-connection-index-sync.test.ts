/**
 * Tests for index reconciliation after a write on the brain's OWN connection.
 *
 * `SyncEngine` applies every pulled row through `getDb()` — the same singleton
 * connection the brain holds (see sync/SyncEngine.ts, which stores `this.db =
 * getDb()` and hands it to `applyPulledMemory`). SQLite's `PRAGMA data_version`
 * deliberately does NOT move for commits made on the connection reading it (see
 * db/adapter.ts), so a staleness check built on that pragma alone reports
 * "nothing changed" for exactly the writes sync produces: the post-pull
 * `onIndexRebuildNeeded -> brain.syncIndexFromStore()` hook reconciled nothing
 * and pulled memories stayed unsearchable until the process restarted.
 *
 * These tests write straight through the brain's own connection — the sync
 * apply path minus the network — and require the next reconcile to notice.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
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
  const dbPath = path.join(__dirname, `test-samecon-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
 * Insert a memory the way `applyPulledMemory` does: through the shared
 * connection, without going anywhere near `brain.store()`. Only a reconcile can
 * put this row into the in-memory index.
 */
async function writeOnSharedConnection(id: string, content: string): Promise<void> {
  const db = getDb();
  const vector = await embed(content);
  const now = new Date().toISOString();
  await db.insert(schema.memories).values({
    id,
    type: 'semantic',
    content,
    embedding: packFP16(vector),
    embeddingDim: vector.length,
    importance: 0.8,
    createdAt: now,
    updatedAt: now,
  });
}

describe('NeuralBrain — reconciling writes made on the brain\'s own connection', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, indexPath: dbPath + '.index', defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Local memory written through the brain itself' });
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanupTestDb(dbPath);
  });

  it('syncIndexFromStore() indexes a row committed on the shared connection', async () => {
    await writeOnSharedConnection('pulled-1', 'Sync pulled this memory from another device');

    const changed = await brain.syncIndexFromStore();

    expect(changed).toBe(1);
    expect(brain.getIndexStatus().entryCount).toBe(2);
  });

  it('search() finds a row committed on the shared connection', async () => {
    await writeOnSharedConnection('pulled-2', 'The Antikythera mechanism is an ancient analogue computer');

    const hits = await brain.search('ancient analogue computer', { topK: 10, threshold: 0.1 });

    expect(hits.map((h) => h.id)).toContain('pulled-2');
  });

  it('drops a row archived on the shared connection', async () => {
    await writeOnSharedConnection('pulled-3', 'Tidal charts for the Bay of Fundy');
    await brain.syncIndexFromStore();
    expect(brain.getIndexStatus().entryCount).toBe(2);

    const now = new Date().toISOString();
    await getDb()
      .update(schema.memories)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.memories.id, 'pulled-3'));

    const hits = await brain.search('tidal charts', { topK: 10, threshold: 0.1 });

    expect(hits.map((h) => h.id)).not.toContain('pulled-3');
    expect(brain.getIndexStatus().entryCount).toBe(1);
  });

  it('re-indexes a row whose vector was replaced on the shared connection', async () => {
    // A pull applies updates as well as inserts: the same row id comes back with
    // new content. Membership does not change, so an add/remove-only reconcile
    // left the superseded vector in the index.
    await writeOnSharedConnection('pulled-5', 'Paris is the capital of France');
    await brain.syncIndexFromStore();

    const replacement = await embed('Alpine hiking trails close in winter');
    const now = new Date().toISOString();
    await getDb()
      .update(schema.memories)
      .set({
        content: 'Alpine hiking trails close in winter',
        embedding: packFP16(replacement),
        updatedAt: now,
      })
      .where(eq(schema.memories.id, 'pulled-5'));

    const capital = await brain.search('capital of France', { topK: 50, threshold: 0 });
    const hiking = await brain.search('alpine hiking trails in winter', { topK: 50, threshold: 0 });

    const capitalScore = capital.find((h) => h.id === 'pulled-5')?.score ?? 0;
    const hikingScore = hiking.find((h) => h.id === 'pulled-5')?.score ?? 0;
    expect(hikingScore).toBeGreaterThan(capitalScore);
  });

  it('early-outs once reconciled — one reconcile per commit, not per read', async () => {
    await writeOnSharedConnection('pulled-4', 'Обсидиан — вулканическое стекло');

    expect(await brain.syncIndexFromStore()).toBe(1);
    const afterFirst = brain.getIndexStatus().externalSyncCount;

    // No commit since, so these must do no work at all.
    expect(await brain.syncIndexFromStore()).toBe(0);
    expect(await brain.syncIndexFromStore()).toBe(0);
    expect(brain.getIndexStatus().externalSyncCount).toBe(afterFirst);
  });

  it('reads no table at all when nothing has committed', async () => {
    // The pragma check this replaced was effectively free, and a check that
    // scanned the memories table on every search would trade one bug for a
    // slower system. Nothing committed since the last claim must cost nothing.
    await brain.store({ content: 'Another memory through the brain' });

    const spy = vi.spyOn(getDb(), 'select');
    expect(await brain.syncIndexFromStore()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not reconcile after the brain writes through store() itself', async () => {
    const before = brain.getIndexStatus().externalSyncCount;

    await brain.store({ content: 'Another memory through the brain' });

    // store() already indexed it — reconciling would be pure waste.
    expect(await brain.syncIndexFromStore()).toBe(0);
    expect(brain.getIndexStatus().externalSyncCount).toBe(before);
  });
});
