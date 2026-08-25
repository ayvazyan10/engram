/**
 * Regression tests for write atomicity and namespace isolation in the
 * low-level memory classes.
 *
 * - SemanticMemory.store inserted the memory row and its relationship edges as
 *   two separate statements with no transaction, so a bad relatesTo target
 *   (targetId is a NOT NULL FK) threw AFTER the memory was committed, leaving an
 *   orphaned row behind while store() rejected.
 * - Episodic/Semantic/Procedural never set `namespace` on write and never
 *   filtered by it on read, so these public classes (brain.episodic etc.) wrote
 *   into the shared pool and read across every tenant.
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
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8',
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

describe('SemanticMemory.store atomicity', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = createTestDb(); });
  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('leaves no orphaned memory row when an edge target does not exist', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const before = await getDb().select().from(schema.memories);

    await expect(
      brain.semantic.store({
        concept: 'Orphan test',
        content: 'This should not be persisted',
        relatesTo: [{ conceptId: 'no-such-memory-id', relationship: 'relates_to' }],
      }),
    ).rejects.toThrow();

    const after = await getDb().select().from(schema.memories);
    expect(after.length).toBe(before.length);
  });

  it('persists the memory and its edges together on success', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const target = await brain.semantic.store({ concept: 'Target', content: 'Existing concept' });
    const linked = await brain.semantic.store({
      concept: 'Linked',
      content: 'Points at the target',
      relatesTo: [{ conceptId: target.id, relationship: 'relates_to' }],
    });

    const edges = await getDb()
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.sourceId, linked.id));

    expect(edges.length).toBe(1);
    expect(edges[0]!.targetId).toBe(target.id);
  });
});

describe('namespace isolation in the memory classes', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = createTestDb(); });
  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('stamps the brain namespace on direct semantic writes', async () => {
    const brain = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-a' });
    await brain.initialize();

    const stored = await brain.semantic.store({ concept: 'Scoped', content: 'Tenant A fact' });

    const [row] = await getDb().select().from(schema.memories).where(eq(schema.memories.id, stored.id));
    expect(row!.namespace).toBe('tenant-a');
  });

  it('does not return another namespace\'s concepts', async () => {
    const brainA = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-a' });
    await brainA.initialize();
    await brainA.semantic.store({ concept: 'Secret', content: 'Belongs to tenant A' });
    await closeDb();

    const brainB = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-b' });
    await brainB.initialize();

    expect(await brainB.semantic.getByConcept('Secret')).toBeUndefined();
    // ...while the owning tenant still sees it.
    expect(await brainA.semantic.getByConcept('Secret')).toBeDefined();
  });

  it('scopes episodic getRecent to the namespace', async () => {
    const brainA = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-a' });
    await brainA.initialize();
    await brainA.episodic.store({ content: 'Tenant A event', source: 'unit-test' });

    const brainB = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-b' });
    await brainB.initialize();
    const recent = await brainB.episodic.getRecent(50);

    expect(recent.every((m) => m.namespace === 'tenant-b')).toBe(true);
  });

  it('scopes procedural triggers to the namespace', async () => {
    const brainA = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-a' });
    await brainA.initialize();
    await brainA.procedural.store({
      triggerPattern: 'when the build fails',
      actionPattern: 'read the compiler output',
      content: 'Build triage',
    });

    const brainB = new NeuralBrain({ dbPath, namespaceMode: 'isolated', namespace: 'tenant-b' });
    await brainB.initialize();

    expect(await brainB.procedural.getByTrigger('when the build fails')).toEqual([]);
  });
});
