/**
 * Regression tests for decay/consolidation correctness.
 *
 * - Importance decay was measured from lastAccessedAt on every sweep, so each
 *   hourly sweep re-applied the whole idle period and importance collapsed
 *   quadratically instead of linearly.
 * - autoConsolidate used minEpisodicAgeMs only as a run/no-run gate and never
 *   passed the cutoff to consolidate(), which then folded in fresh memories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { getDb, closeDb, schema } from '../../db/index.js';
import { DecayEngine } from '../DecayEngine.js';
import { mergePolicy } from '../DecayPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8',
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-decaylin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('decay linearity', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    await closeDb();
    for (const suffix of ['', '-shm', '-wal', '-journal', '.index']) {
      try { fs.unlinkSync(dbPath + suffix); } catch {}
    }
  });

  it('does not re-apply the full idle period on every sweep', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    // Importance must stay under 0.8: the default 'high-importance-semantic'
    // protection rule would otherwise skip this memory entirely.
    const { memory } = await brain.store({
      content: 'A durable fact that should decay slowly',
      type: 'semantic',
      source: 'unit-test',
      importance: 0.7,
    });

    // Age the row by 3 days: idle enough to decay, recent enough not to be archived.
    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS).toISOString();
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ createdAt: threeDaysAgo, lastAccessedAt: threeDaysAgo, updatedAt: threeDaysAgo })
      .where(eq(schema.memories.id, memory.id));

    const readImportance = async (): Promise<number> => {
      const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
      return row!.importance ?? 0;
    };

    await brain.runDecaySweep();
    const afterFirst = await readImportance();

    await brain.runDecaySweep();
    const afterSecond = await readImportance();

    // First sweep decays (3 days at 0.01/day ≈ 0.03).
    expect(afterFirst).toBeLessThan(0.7);
    expect(afterFirst).toBeGreaterThan(0.6);

    // Second sweep runs immediately after — almost no time has elapsed, so it
    // must not decay again. The bug produced another full ~0.03 drop.
    expect(afterSecond).toBeCloseTo(afterFirst, 3);
  });
});

describe('autoConsolidate age cutoff', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    await closeDb();
    for (const suffix of ['', '-shm', '-wal', '-journal', '.index']) {
      try { fs.unlinkSync(dbPath + suffix); } catch {}
    }
  });

  it('passes the age cutoff through to consolidateFn', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    // Three old episodes so the eligibility gate opens.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const db = getDb();
    for (let i = 0; i < 3; i++) {
      const { memory } = await brain.store({
        content: `Deployment ran cleanly on service ${i}`,
        type: 'episodic',
        source: 'unit-test',
      });
      await db
        .update(schema.memories)
        .set({ createdAt: twoHoursAgo, updatedAt: twoHoursAgo, lastAccessedAt: twoHoursAgo })
        .where(eq(schema.memories.id, memory.id));
    }

    const engine = new DecayEngine(
      mergePolicy({
        consolidation: {
          enabled: true,
          minClusterSize: 2,
          minEpisodicAgeMs: 60 * 60 * 1000, // 1 hour
          similarityThreshold: 0.8,
        },
      }),
    );

    let receivedCutoff: string | undefined;
    await engine.autoConsolidate(async (_min, _threshold, olderThanIso) => {
      receivedCutoff = olderThanIso;
      return [];
    });

    expect(receivedCutoff).toBeTruthy();
    // Cutoff must be roughly one hour in the past.
    const delta = Date.now() - new Date(receivedCutoff!).getTime();
    expect(delta).toBeGreaterThan(55 * 60 * 1000);
    expect(delta).toBeLessThan(65 * 60 * 1000);
  });

  it('consolidate() leaves memories newer than the cutoff untouched', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const db = getDb();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Old, near-identical episodes — eligible for consolidation.
    for (let i = 0; i < 3; i++) {
      const { memory } = await brain.store({
        content: 'The nightly backup job completed successfully',
        type: 'episodic',
        source: 'unit-test',
      });
      await db
        .update(schema.memories)
        .set({ createdAt: twoHoursAgo, updatedAt: twoHoursAgo, lastAccessedAt: twoHoursAgo })
        .where(eq(schema.memories.id, memory.id));
    }

    // A fresh episode on the same topic — must NOT be swept into consolidation.
    const { memory: fresh } = await brain.store({
      content: 'The nightly backup job completed successfully',
      type: 'episodic',
      source: 'unit-test',
    });

    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await brain.consolidate(2, 0.8, cutoff);

    const [freshRow] = await db.select().from(schema.memories).where(eq(schema.memories.id, fresh.id));
    expect(freshRow!.archivedAt).toBeNull();
  });
});
