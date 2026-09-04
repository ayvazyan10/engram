/**
 * Regression test: a decay sweep must not win a content conflict.
 *
 * `updated_at` is two things at once — the sync clock that last-write-wins
 * compares, and this engine's decay checkpoint. Stamping it with wall-clock
 * `now` meant a background bookkeeping write on a locally-stale row outranked a
 * genuine edit made on another device seconds earlier: device B edits at
 * 10:00:00, device A sweeps at 10:00:05 over a copy that has not pulled that
 * edit yet, pushes, and B's edit is replaced by A's stale content.
 *
 * The sweep now measures and stamps an instant `decayConflictWindowMs` in the
 * past, so any content edit made inside that window is strictly newer than
 * anything decay can write. Decay stays linear because each sweep still applies
 * exactly the interval between consecutive stamps.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { DecayEngine } from '../DecayEngine.js';
import { DEFAULT_DECAY_CONFLICT_WINDOW_MS, mergePolicy } from '../DecayPolicy.js';
import type { DecayPolicyConfig } from '../DecayPolicy.js';

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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function createTestDb(): string {
  const dbPath = path.join(
    __dirname,
    `test-decay-window-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

describe('decay sweep — conflict window', () => {
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

  it('defaults the conflict window when a policy omits it', () => {
    // The field is optional on DecayPolicyConfig so that hand-written policies
    // do not break; omitting it must still mean one hour, never zero.
    expect(mergePolicy({}).decayConflictWindowMs).toBe(DEFAULT_DECAY_CONFLICT_WINDOW_MS);
    expect(DEFAULT_DECAY_CONFLICT_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('keeps a caller-supplied conflict window, zero included', () => {
    expect(mergePolicy({ decayConflictWindowMs: 5_000 }).decayConflictWindowMs).toBe(5_000);
    expect(mergePolicy({ decayConflictWindowMs: 0 }).decayConflictWindowMs).toBe(0);
  });

  it('still bounds-checks a conflict window the caller does set', () => {
    expect(() => mergePolicy({ decayConflictWindowMs: -1 })).toThrow(/decayConflictWindowMs/);
    expect(() => mergePolicy({ decayConflictWindowMs: 31 * 24 * 60 * 60 * 1000 }))
      .toThrow(/decayConflictWindowMs/);
    expect(() => mergePolicy({ decayConflictWindowMs: Number.NaN })).toThrow(/decayConflictWindowMs/);
  });

  it('falls back to the default window for a policy built without mergePolicy', async () => {
    const { memory } = await brain.store({
      content: 'A fact decayed by a hand-written policy',
      type: 'semantic',
      importance: 0.5,
    });

    const db = getDb();
    // Only updatedAt is backdated: recency stays high enough that the row
    // decays rather than being archived outright.
    const staleAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    await db
      .update(schema.memories)
      .set({ updatedAt: staleAt })
      .where(eq(schema.memories.id, memory.id));

    // A complete DecayPolicyConfig literal that omits the optional window.
    // What this checks is the RUNTIME half: DecayEngine must fall back to the
    // one-hour default for a policy that never went through mergePolicy, rather
    // than treating the missing value as a zero-length window. (That the
    // literal compiles at all is guarded by _WindowStaysOptional in
    // DecayPolicy.ts — test files are excluded from tsc, so it cannot be
    // guarded from here.)
    const handWritten: DecayPolicyConfig = {
      halfLifeDays: 7,
      archiveThreshold: 0.05,
      decayIntervalMs: 0,
      batchSize: 200,
      importanceDecayRate: 0.01,
      importanceFloor: 0.05,
      protectionRules: [],
      consolidation: {
        enabled: false,
        minClusterSize: 3,
        similarityThreshold: 0.6,
        minEpisodicAgeMs: 0,
      },
    };

    const before = Date.now();
    const result = await new DecayEngine(handWritten).sweep(async () => {});
    expect(result.decayedCount).toBeGreaterThan(0);

    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    const lag = before - new Date(row!.updatedAt).getTime();
    expect(lag).toBeGreaterThan(DEFAULT_DECAY_CONFLICT_WINDOW_MS - 5_000);
    expect(lag).toBeLessThan(DEFAULT_DECAY_CONFLICT_WINDOW_MS + 5_000);
  });

  it('stamps updated_at behind a content edit made moments earlier', async () => {
    const { memory } = await brain.store({
      content: 'A fact that is about to go stale on this device',
      type: 'semantic',
      importance: 0.5,
    });

    const db = getDb();
    const staleAt = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    await db
      .update(schema.memories)
      .set({ updatedAt: staleAt })
      .where(eq(schema.memories.id, memory.id));

    // Another device edited this row one second ago; this device has not pulled
    // it yet, so its local copy still carries the stale content above.
    const peerEditAt = Date.now() - 1000;

    const result = await brain.runDecaySweep();
    expect(result.decayedCount).toBeGreaterThan(0);

    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.importance).toBeLessThan(0.5);
    // The decay write must lose last-write-wins against the peer's edit.
    expect(new Date(row!.updatedAt).getTime()).toBeLessThan(peerEditAt);
  });

  it('still advances the checkpoint, so decay stays linear', async () => {
    const { memory } = await brain.store({
      content: 'A durable fact that should decay slowly',
      type: 'semantic',
      importance: 0.7,
    });

    const db = getDb();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .update(schema.memories)
      .set({ createdAt: threeDaysAgo, lastAccessedAt: threeDaysAgo, updatedAt: threeDaysAgo })
      .where(eq(schema.memories.id, memory.id));

    const read = async (): Promise<number> => {
      const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
      return row!.importance ?? 0;
    };

    await brain.runDecaySweep();
    const afterFirst = await read();
    await brain.runDecaySweep();
    const afterSecond = await read();

    expect(afterFirst).toBeLessThan(0.7);
    expect(afterSecond).toBeCloseTo(afterFirst, 3);
  });

  it('leaves a row alone when its checkpoint is inside the window', async () => {
    const { memory } = await brain.store({
      content: 'A fact edited a moment ago somewhere in the fleet',
      type: 'semantic',
      importance: 0.5,
    });

    const db = getDb();
    const [before] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));

    const result = await brain.runDecaySweep();
    expect(result.decayedCount).toBe(0);

    const [after] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(after!.updatedAt).toBe(before!.updatedAt);
    expect(after!.importance).toBe(before!.importance);
  });
});
