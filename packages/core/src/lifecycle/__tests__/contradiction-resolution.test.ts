/**
 * Regression tests for contradiction auto-resolution and keep_both.
 *
 * - Auto-resolution resolved one pair at a time and never re-checked what an
 *   earlier iteration had archived, while resolveContradiction loaded its two
 *   rows without looking at `archivedAt`. When one pair suggested keep_newest
 *   (archive the existing memory) and another suggested keep_oldest (archive
 *   the new one), both ran: an existing memory was archived "in favour of" a
 *   memory that was itself archived on the next iteration, so its fact left the
 *   store with no replacement at all.
 * - keep_both reported `resolved: true` but skipped the contradicts tombstone,
 *   so getContradictions() kept handing the same pair back as unresolved
 *   forever.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { decideResolution, planAutoResolution } from '../contradictionResolution.js';
import type { Contradiction } from '../ContradictionDetector.js';
import type { Memory } from '../../db/schema.js';

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
    `test-contra-res-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

async function liveIds(): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: schema.memories.id })
    .from(schema.memories)
    .where(isNull(schema.memories.archivedAt));
  return new Set(rows.map((r) => r.id));
}

// ─── Auto-resolution (C1) ────────────────────────────────────────────────────

describe('contradiction auto-resolution', () => {
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

  it('never archives a memory in favour of one it archives in the same pass', async () => {
    brain = new NeuralBrain({
      dbPath,
      defaultSource: 'test',
      contradictionConfig: { enabled: true, autoResolve: true, defaultStrategy: 'keep_oldest' },
    });
    await brain.initialize();

    // The semantic row draws confidence > 0.7 and so suggests keep_newest
    // (archive it, keep the newcomer); the episodic one lands just as high but
    // is not semantic, so it falls through to the configured keep_oldest
    // (archive the newcomer). Together they used to archive BOTH the semantic
    // row and the newcomer that replaced it.
    const semantic = await brain.store({
      content: 'The user prefers dark mode for the editor theme',
      type: 'semantic',
    });
    const episodic = await brain.store({
      content: 'The user prefers dark mode for the editor theme (logged)',
      type: 'episodic',
    });
    const fresh = await brain.store({
      content: 'The user does not prefer dark mode for the editor theme',
      type: 'semantic',
    });

    const strategies = new Map(
      fresh.contradictions.contradictions.map((c) => [c.existingMemoryId, c.suggestedStrategy]),
    );
    // Guard the fixture itself: the bug needs the two suggestions to disagree.
    expect(strategies.get(semantic.memory.id)).toBe('keep_newest');
    expect(strategies.get(episodic.memory.id)).toBe('keep_oldest');

    // Every contradiction is reported against the memory store() just wrote —
    // which is why autoResolveContradictions needs no separate id parameter.
    for (const c of fresh.contradictions.contradictions) {
      expect(c.newMemoryId).toBe(fresh.memory.id);
    }

    const live = await liveIds();
    // keep_oldest wins for the newcomer, so it is discarded — and because it is
    // gone, the memory that would have been archived "for" it must survive.
    expect(fresh.discarded).toBe(true);
    expect(live.has(fresh.memory.id)).toBe(false);
    expect(live.has(semantic.memory.id)).toBe(true);
    expect(live.has(episodic.memory.id)).toBe(true);
  });

  it('refuses to resolve a pair whose other side is already archived', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();

    const older = await brain.store({ content: 'The API listens on port 4901', type: 'semantic' });
    const newer = await brain.store({ content: 'The API listens on port 3001', type: 'semantic' });

    await brain.forget(older.memory.id);

    // keep_oldest would keep the archived memory and archive the live one,
    // leaving the fact with no live carrier at all.
    const result = await brain.resolveContradiction(older.memory.id, newer.memory.id, 'keep_oldest');

    expect(result.resolved).toBe(false);
    expect(result.archivedId).toBeUndefined();
    const live = await liveIds();
    expect(live.has(newer.memory.id)).toBe(true);
  });
});

// ─── keep_both tombstones the edge (C6) ──────────────────────────────────────

describe('resolveContradiction — keep_both', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({
      dbPath,
      defaultSource: 'test',
      contradictionConfig: { enabled: true, similarityThreshold: 0.5, confidenceThreshold: 0.3 },
    });
    await brain.initialize();
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('stops reporting the pair as unresolved', async () => {
    const first = await brain.store({ content: 'The API uses REST for all endpoints', type: 'semantic' });
    const second = await brain.store({
      content: 'The API does not use REST for all endpoints, it uses GraphQL',
      type: 'semantic',
    });

    expect(second.contradictions.hasContradictions).toBe(true);
    expect(await brain.getContradictions()).not.toHaveLength(0);

    const result = await brain.resolveContradiction(first.memory.id, second.memory.id, 'keep_both');
    expect(result.resolved).toBe(true);
    expect(result.archivedId).toBeUndefined();

    // Both memories stay live...
    const live = await liveIds();
    expect(live.has(first.memory.id)).toBe(true);
    expect(live.has(second.memory.id)).toBe(true);

    // ...and the contradiction is resolved rather than reported forever.
    expect(await brain.getContradictions()).toHaveLength(0);

    const edges = await getDb()
      .select()
      .from(schema.memoryConnections)
      .where(
        and(
          eq(schema.memoryConnections.relationship, 'contradicts'),
          isNull(schema.memoryConnections.deletedAt),
        ),
      );
    expect(edges).toHaveLength(0);
  });
});

// ─── Planner unit tests (C1) ─────────────────────────────────────────────────

function fakeMemory(overrides: Partial<Memory> & { id: string }): Memory {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    importance: 0.5,
    archivedAt: null,
    ...overrides,
  } as Memory;
}

function fakeContradiction(overrides: Partial<Contradiction>): Contradiction {
  return {
    newMemoryId: 'new',
    existingMemoryId: 'e1',
    similarity: 0.9,
    confidence: 0.8,
    signals: [],
    suggestedStrategy: 'keep_both',
    ...overrides,
  };
}

describe('planAutoResolution', () => {
  const fresh = fakeMemory({ id: 'new', createdAt: '2026-02-01T00:00:00.000Z' });
  const e1 = fakeMemory({ id: 'e1' });
  const e2 = fakeMemory({ id: 'e2' });
  const byId = new Map([fresh, e1, e2].map((m) => [m.id, m]));

  it('drops a resolution whose survivor another resolution archives', () => {
    const plan = planAutoResolution(
      [
        fakeContradiction({ existingMemoryId: 'e1', suggestedStrategy: 'keep_newest' }),
        fakeContradiction({ existingMemoryId: 'e2', suggestedStrategy: 'keep_oldest' }),
      ],
      byId,
    );

    // keep_oldest archives `new`, so archiving e1 "for" it is dropped.
    expect(plan).toEqual([{ sourceId: 'new', targetId: 'e2', strategy: 'keep_oldest' }]);
  });

  it('keeps every resolution when the survivors all live', () => {
    const plan = planAutoResolution(
      [
        fakeContradiction({ existingMemoryId: 'e1', suggestedStrategy: 'keep_newest' }),
        fakeContradiction({ existingMemoryId: 'e2', suggestedStrategy: 'keep_newest' }),
      ],
      byId,
    );
    expect(plan).toHaveLength(2);
  });

  it('skips a pair that is already archived', () => {
    const archived = new Map(byId);
    archived.set('e1', fakeMemory({ id: 'e1', archivedAt: '2026-03-01T00:00:00.000Z' }));
    const plan = planAutoResolution(
      [fakeContradiction({ existingMemoryId: 'e1', suggestedStrategy: 'keep_newest' })],
      archived,
    );
    expect(plan).toEqual([]);
  });

  it('skips a manual pair and keeps a keep_both pair', () => {
    const plan = planAutoResolution(
      [
        fakeContradiction({ existingMemoryId: 'e1', suggestedStrategy: 'manual' }),
        fakeContradiction({ existingMemoryId: 'e2', suggestedStrategy: 'keep_both' }),
      ],
      byId,
    );
    expect(plan).toEqual([{ sourceId: 'new', targetId: 'e2', strategy: 'keep_both' }]);
  });
});

describe('decideResolution', () => {
  const older = fakeMemory({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z', importance: 0.2 });
  const newer = fakeMemory({ id: 'newer', createdAt: '2026-02-01T00:00:00.000Z', importance: 0.9 });

  it('keep_newest archives the older row', () => {
    expect(decideResolution(older, newer, 'keep_newest')).toEqual({ archivedId: 'older', keptId: 'newer' });
  });

  it('keep_oldest archives the newer row', () => {
    expect(decideResolution(older, newer, 'keep_oldest')).toEqual({ archivedId: 'newer', keptId: 'older' });
  });

  it('keep_important archives the lower-importance row', () => {
    expect(decideResolution(older, newer, 'keep_important')).toEqual({ archivedId: 'older', keptId: 'newer' });
  });

  it('keep_both archives nothing', () => {
    expect(decideResolution(older, newer, 'keep_both')).toEqual({ keptId: 'older' });
  });

  it('manual decides nothing', () => {
    expect(decideResolution(older, newer, 'manual')).toBeNull();
  });
});
