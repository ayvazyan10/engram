/**
 * Tests for Memory Decay & Garbage Collection.
 *
 * Validates:
 * 1. DecayPolicy — defaults, merging, protection rules
 * 2. ImportanceScorer — retention score formula, decay function
 * 3. DecayEngine — sweep logic, protection, archival, auto-consolidation
 * 4. NeuralBrain integration — runDecaySweep, policy get/update
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import {
  DEFAULT_DECAY_POLICY,
  DEFAULT_PROTECTION_RULES,
  mergePolicy,
} from '../DecayPolicy.js';
import { DecayEngine } from '../DecayEngine.js';
import {
  computeRetentionScore,
  decayImportance,
  recencyScore,
} from '../../retrieval/ImportanceScorer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

/** Create a temp DB with schema applied, return its path. */
function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-decay-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  // Run migration — split on statement-breakpoint marker
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

// ─── DecayPolicy Tests ─────────────────────────────────────────────────────

describe('DecayPolicy', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_DECAY_POLICY.halfLifeDays).toBe(7);
    expect(DEFAULT_DECAY_POLICY.archiveThreshold).toBe(0.05);
    expect(DEFAULT_DECAY_POLICY.decayIntervalMs).toBe(3600000);
    expect(DEFAULT_DECAY_POLICY.batchSize).toBe(200);
    expect(DEFAULT_DECAY_POLICY.importanceDecayRate).toBe(0.01);
    expect(DEFAULT_DECAY_POLICY.importanceFloor).toBe(0.05);
    expect(DEFAULT_DECAY_POLICY.consolidation.enabled).toBe(true);
    expect(DEFAULT_DECAY_POLICY.consolidation.minClusterSize).toBe(3);
    expect(DEFAULT_DECAY_POLICY.protectionRules.length).toBe(4);
  });

  it('merges partial policy with defaults', () => {
    const merged = mergePolicy({ halfLifeDays: 14, archiveThreshold: 0.1 });
    expect(merged.halfLifeDays).toBe(14);
    expect(merged.archiveThreshold).toBe(0.1);
    // Rest stays default
    expect(merged.batchSize).toBe(200);
    expect(merged.importanceDecayRate).toBe(0.01);
    expect(merged.consolidation.enabled).toBe(true);
  });

  it('replaces protection rules entirely when provided', () => {
    const customRule = { name: 'always-protect', predicate: () => true };
    const merged = mergePolicy({ protectionRules: [customRule] });
    expect(merged.protectionRules.length).toBe(1);
    expect(merged.protectionRules[0].name).toBe('always-protect');
  });

  it('merges consolidation config partially', () => {
    const merged = mergePolicy({ consolidation: { enabled: false } as any });
    expect(merged.consolidation.enabled).toBe(false);
    expect(merged.consolidation.minClusterSize).toBe(3); // kept from default
  });
});

// ─── Protection Rules Tests ─────────────────────────────────────────────────

describe('Default Protection Rules', () => {
  const rules = DEFAULT_PROTECTION_RULES;

  it('protects high-importance semantic memories', () => {
    const semantic = { type: 'semantic', importance: 0.85 } as any;
    const lowSemantic = { type: 'semantic', importance: 0.5 } as any;
    const episodic = { type: 'episodic', importance: 0.9 } as any;

    const rule = rules.find((r) => r.name === 'high-importance-semantic')!;
    expect(rule.predicate(semantic)).toBe(true);
    expect(rule.predicate(lowSemantic)).toBe(false);
    expect(rule.predicate(episodic)).toBe(false); // wrong type
  });

  it('protects high-confidence procedural memories', () => {
    const rule = rules.find((r) => r.name === 'high-confidence-procedural')!;
    expect(rule.predicate({ type: 'procedural', confidence: 0.95 } as any)).toBe(true);
    expect(rule.predicate({ type: 'procedural', confidence: 0.5 } as any)).toBe(false);
  });

  it('protects recently accessed memories', () => {
    const rule = rules.find((r) => r.name === 'recently-accessed')!;
    const recent = { lastAccessedAt: new Date().toISOString() } as any;
    const old = { lastAccessedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() } as any;
    const never = { lastAccessedAt: null } as any;

    expect(rule.predicate(recent)).toBe(true);
    expect(rule.predicate(old)).toBe(false);
    expect(rule.predicate(never)).toBe(false);
  });

  it('protects pinned/protected tagged memories', () => {
    const rule = rules.find((r) => r.name === 'pinned-or-protected')!;
    expect(rule.predicate({ tags: '["pinned"]' } as any)).toBe(true);
    expect(rule.predicate({ tags: '["protected"]' } as any)).toBe(true);
    expect(rule.predicate({ tags: '["important"]' } as any)).toBe(false);
    expect(rule.predicate({ tags: '[]' } as any)).toBe(false);
  });
});

// ─── ImportanceScorer Tests ─────────────────────────────────────────────────

describe('ImportanceScorer', () => {
  describe('recencyScore', () => {
    it('returns ~1.0 for very recent memories', () => {
      const now = new Date();
      const score = recencyScore(now.toISOString(), null, now);
      expect(score).toBeCloseTo(1.0, 2);
    });

    it('returns ~0.5 after one half-life (7 days)', () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const score = recencyScore(sevenDaysAgo.toISOString(), null, now);
      expect(score).toBeCloseTo(0.5, 1);
    });

    it('uses lastAccessedAt over createdAt when available', () => {
      const now = new Date();
      const oldCreated = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recentAccess = new Date(now.getTime() - 1000);
      const score = recencyScore(oldCreated.toISOString(), recentAccess.toISOString(), now);
      expect(score).toBeGreaterThan(0.99);
    });

    it('respects custom halfLifeDays', () => {
      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const score = recencyScore(fourteenDaysAgo.toISOString(), null, now, 14);
      expect(score).toBeCloseTo(0.5, 1);
    });
  });

  describe('decayImportance', () => {
    it('reduces importance by decay rate per day', () => {
      expect(decayImportance(0.5, 10)).toBeCloseTo(0.4, 2); // 0.5 - 0.01*10
    });

    it('never drops below floor', () => {
      expect(decayImportance(0.1, 100)).toBe(0.05); // default floor
    });

    it('accepts custom decay rate and floor', () => {
      expect(decayImportance(0.5, 10, 0.02, 0.1)).toBeCloseTo(0.3, 2); // 0.5 - 0.02*10
      expect(decayImportance(0.1, 100, 0.02, 0.1)).toBe(0.1); // custom floor
    });
  });

  describe('computeRetentionScore', () => {
    it('returns high score for important, recent, frequently accessed memories', () => {
      const score = computeRetentionScore({
        importance: 0.9,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 50,
      });
      // importance(0.9) × recency(~1.0) × accessFactor(~0.70) ≈ 0.63
      expect(score).toBeGreaterThan(0.5);
    });

    it('returns low score for old, unimportant, never-accessed memories', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const score = computeRetentionScore({
        importance: 0.1,
        createdAt: thirtyDaysAgo.toISOString(),
        lastAccessedAt: null,
        accessCount: 0,
      });
      expect(score).toBeLessThan(0.05);
    });

    it('access frequency provides a floor of 0.3 for zero-access memories', () => {
      const score = computeRetentionScore({
        importance: 1.0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
      });
      // With importance=1, recency=1, accessFactor=0.3 → score = 0.3
      expect(score).toBeCloseTo(0.3, 1);
    });
  });
});

// ─── DecayEngine Unit Tests ─────────────────────────────────────────────────

describe('DecayEngine', () => {
  it('isProtected returns true for protected memories', () => {
    const engine = new DecayEngine(DEFAULT_DECAY_POLICY);
    const protectedMem = { type: 'semantic', importance: 0.9 } as any;
    expect(engine.isProtected(protectedMem)).toBe(true);
  });

  it('isProtected returns false for unprotected memories', () => {
    const engine = new DecayEngine(DEFAULT_DECAY_POLICY);
    const unprotected = { type: 'episodic', importance: 0.3, confidence: 0.5, lastAccessedAt: null, tags: '[]' } as any;
    expect(engine.isProtected(unprotected)).toBe(false);
  });

  it('computeRetention returns expected values', () => {
    const engine = new DecayEngine(DEFAULT_DECAY_POLICY);
    const now = new Date();

    const fresh = {
      importance: 0.8,
      createdAt: now.toISOString(),
      lastAccessedAt: now.toISOString(),
      accessCount: 10,
    } as any;
    expect(engine.computeRetention(fresh, now)).toBeGreaterThan(0.3);

    const stale = {
      importance: 0.1,
      createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      lastAccessedAt: null,
      accessCount: 0,
    } as any;
    expect(engine.computeRetention(stale, now)).toBeLessThan(0.01);
  });

  it('updatePolicy replaces the active policy', () => {
    const engine = new DecayEngine(DEFAULT_DECAY_POLICY);
    const newPolicy = mergePolicy({ halfLifeDays: 30 });
    engine.updatePolicy(newPolicy);
    expect(engine.getPolicy().halfLifeDays).toBe(30);
  });
});

// ─── NeuralBrain Integration Tests ──────────────────────────────────────────

describe('NeuralBrain decay integration', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({
      dbPath,
      defaultSource: 'test',
      decayPolicy: { decayIntervalMs: 0 }, // disable auto-decay
    });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    // Clean up test DB files
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('getDecayPolicy returns merged policy', () => {
    const policy = brain.getDecayPolicy();
    expect(policy.halfLifeDays).toBe(7);
    expect(policy.decayIntervalMs).toBe(0); // our override
  });

  it('updateDecayPolicy changes the active policy', () => {
    brain.updateDecayPolicy({ halfLifeDays: 21 });
    expect(brain.getDecayPolicy().halfLifeDays).toBe(21);
  });

  it('dry run does not archive anything', async () => {
    // Store a memory
    await brain.store({ content: 'Test memory for dry run', type: 'episodic', importance: 0.01 });

    const result = await brain.runDecaySweep(true);
    expect(result.scannedCount).toBeGreaterThanOrEqual(1);

    // Stats should still show the memory
    const stats = await brain.stats();
    expect(stats.total).toBe(1);
  });

  it('sweep archives stale low-importance memories', async () => {
    // Store a very old, low-importance memory by manipulating the DB directly
    const { memory: mem } = await brain.store({ content: 'Old stale memory', type: 'episodic', importance: 0.05 });

    // Manually age this memory to 60 days ago
    const { getDb, schema } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await db.update(schema.memories).set({
      createdAt: sixtyDaysAgo,
      updatedAt: sixtyDaysAgo,
      lastAccessedAt: null,
    }).where(eq(schema.memories.id, mem.id));

    // Run sweep with a generous threshold
    brain.updateDecayPolicy({ archiveThreshold: 0.1 });
    const result = await brain.runDecaySweep(false);

    expect(result.archivedCount).toBeGreaterThanOrEqual(1);
    expect(result.archivedIds).toContain(mem.id);

    // Confirm memory is no longer in active stats
    const stats = await brain.stats();
    expect(stats.total).toBe(0);
  });

  it('sweep protects high-importance semantic memories', async () => {
    const { memory: mem } = await brain.store({
      content: 'Critical architecture decision',
      type: 'semantic',
      importance: 0.9,
    });

    // Age it
    const { getDb, schema } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await db.update(schema.memories).set({
      createdAt: oldDate,
      updatedAt: oldDate,
      lastAccessedAt: null,
    }).where(eq(schema.memories.id, mem.id));

    const result = await brain.runDecaySweep(false);

    expect(result.protectedCount).toBeGreaterThanOrEqual(1);
    expect(result.archivedIds).not.toContain(mem.id);

    const stats = await brain.stats();
    expect(stats.total).toBe(1); // still alive
  });

  it('sweep decays importance on surviving memories', async () => {
    const { memory: mem } = await brain.store({
      content: 'Moderate importance memory',
      type: 'episodic',
      importance: 0.5,
    });

    // Age it to 10 days — should survive but importance should decrease
    const { getDb, schema } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await db.update(schema.memories).set({
      createdAt: tenDaysAgo,
      updatedAt: tenDaysAgo,
      lastAccessedAt: null,
    }).where(eq(schema.memories.id, mem.id));

    await brain.runDecaySweep(false);

    // Check importance was reduced
    const [updated] = await db.select().from(schema.memories).where(eq(schema.memories.id, mem.id));
    expect(updated.importance).toBeLessThan(0.5);
    expect(updated.importance).toBeGreaterThanOrEqual(0.05); // above floor
  });

  it('protects pinned memories from archival', async () => {
    const { memory: mem } = await brain.store({
      content: 'Pinned memory that must survive',
      type: 'episodic',
      importance: 0.01,
      tags: ['pinned'],
    });

    // Age it heavily
    const { getDb, schema } = await import('../../db/index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await db.update(schema.memories).set({
      createdAt: oldDate,
      updatedAt: oldDate,
      lastAccessedAt: null,
    }).where(eq(schema.memories.id, mem.id));

    const result = await brain.runDecaySweep(false);

    expect(result.protectedCount).toBeGreaterThanOrEqual(1);
    expect(result.archivedIds).not.toContain(mem.id);
  });

  it('sweep result includes timing', async () => {
    const result = await brain.runDecaySweep(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.scannedCount).toBe('number');
    expect(typeof result.archivedCount).toBe('number');
    expect(typeof result.decayedCount).toBe('number');
    expect(typeof result.protectedCount).toBe('number');
    expect(typeof result.consolidatedCount).toBe('number');
    expect(Array.isArray(result.archivedIds)).toBe(true);
    expect(Array.isArray(result.newSemanticIds)).toBe(true);
  });
});
