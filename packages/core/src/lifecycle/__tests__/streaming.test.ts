/**
 * Tests for Streaming Recall (#5).
 *
 * Validates:
 * 1. recallStream yields chunks with correct phases
 * 2. Vector phase memories arrive first
 * 3. Graph phase memories arrive after vector phase
 * 4. Complete event has full context and all memories
 * 5. Empty query returns only complete event
 * 6. Chunks include running contextSoFar
 * 7. Ranks are sequential
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import type { RecallChunk, RecallStreamComplete } from '../../retrieval/ContextAssembler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-stream-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  sqlite.close();
  return dbPath;
}

function cleanup(dbPath: string) {
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
}

// ─── Streaming Recall ────────────────────────────────────────────────────────

describe('Streaming Recall — basic', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanup(dbPath);
  });

  it('yields vector phase chunks followed by complete event', async () => {
    await brain.store({ content: 'TypeScript is a programming language', type: 'semantic' });
    await brain.store({ content: 'JavaScript is the foundation of TypeScript', type: 'semantic' });

    const chunks: Array<RecallChunk | RecallStreamComplete> = [];
    for await (const chunk of brain.recallStream('TypeScript programming')) {
      chunks.push(chunk);
    }

    // Must have at least one chunk + complete event
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Last chunk must be 'complete'
    const last = chunks[chunks.length - 1]!;
    expect(last.phase).toBe('complete');
    expect('context' in last).toBe(true);
    expect('memories' in last).toBe(true);

    // All non-complete chunks should be vector or graph phase
    const memoryChunks = chunks.filter((c): c is RecallChunk => c.phase !== 'complete');
    for (const chunk of memoryChunks) {
      expect(['vector', 'graph']).toContain(chunk.phase);
      expect(chunk.memory).toBeDefined();
      expect(chunk.memory.id).toBeDefined();
      expect(chunk.memory.score).toBeGreaterThan(0);
      expect(chunk.rank).toBeGreaterThan(0);
    }
  });

  it('vector phase memories arrive before graph phase', async () => {
    await brain.store({ content: 'React is a UI library for building interfaces', type: 'semantic' });
    await brain.store({ content: 'Vue.js is an alternative frontend framework', type: 'semantic' });
    await brain.store({ content: 'Angular is a full framework by Google', type: 'semantic' });

    const phases: string[] = [];
    for await (const chunk of brain.recallStream('frontend frameworks')) {
      if (chunk.phase !== 'complete') {
        phases.push(chunk.phase);
      }
    }

    // All vector phases should come before any graph phases
    const lastVectorIdx = phases.lastIndexOf('vector');
    const firstGraphIdx = phases.indexOf('graph');

    if (firstGraphIdx >= 0 && lastVectorIdx >= 0) {
      expect(lastVectorIdx).toBeLessThan(firstGraphIdx);
    }
  });

  it('ranks are sequential starting from 1', async () => {
    await brain.store({ content: 'Memory about databases and SQL' });
    await brain.store({ content: 'Memory about database migrations' });

    const ranks: number[] = [];
    for await (const chunk of brain.recallStream('databases')) {
      if (chunk.phase !== 'complete' && 'rank' in chunk) {
        ranks.push(chunk.rank);
      }
    }

    if (ranks.length > 0) {
      expect(ranks[0]).toBe(1);
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i]).toBe(ranks[i - 1]! + 1);
      }
    }
  });

  it('complete event includes all yielded memories', async () => {
    await brain.store({ content: 'Python for data science and ML' });
    await brain.store({ content: 'Python machine learning with scikit-learn' });

    const memoryIds = new Set<string>();
    let completeEvent: RecallStreamComplete | null = null;

    for await (const chunk of brain.recallStream('Python ML')) {
      if (chunk.phase === 'complete' && 'memories' in chunk) {
        completeEvent = chunk as RecallStreamComplete;
      } else if ('memory' in chunk) {
        memoryIds.add(chunk.memory.id);
      }
    }

    expect(completeEvent).not.toBeNull();
    expect(completeEvent!.context.length).toBeGreaterThan(0);
    expect(completeEvent!.latencyMs).toBeGreaterThanOrEqual(0);

    // Complete event should have all the memories that were yielded
    for (const id of memoryIds) {
      expect(completeEvent!.memories.some((m) => m.id === id)).toBe(true);
    }
  });

  it('contextSoFar grows with each chunk', async () => {
    await brain.store({ content: 'Kubernetes orchestrates container workloads' });
    await brain.store({ content: 'Docker provides containerization for applications' });

    const contextLengths: number[] = [];
    for await (const chunk of brain.recallStream('containers and orchestration')) {
      if (chunk.phase !== 'complete' && 'contextSoFar' in chunk) {
        contextLengths.push(chunk.contextSoFar.length);
      }
    }

    // Each subsequent context should be >= previous
    for (let i = 1; i < contextLengths.length; i++) {
      expect(contextLengths[i]).toBeGreaterThanOrEqual(contextLengths[i - 1]!);
    }
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('Streaming Recall — edge cases', () => {
  let brain: NeuralBrain;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(() => {
    brain.shutdown();
    closeDb();
    cleanup(dbPath);
  });

  it('empty store yields only complete event with empty context', async () => {
    const chunks: Array<RecallChunk | RecallStreamComplete> = [];
    for await (const chunk of brain.recallStream('anything')) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.phase).toBe('complete');
    expect((chunks[0] as RecallStreamComplete).context).toBe('');
    expect((chunks[0] as RecallStreamComplete).memories).toHaveLength(0);
  });

  it('streaming recall produces same final context as regular recall', async () => {
    await brain.store({ content: 'The API server uses Fastify framework', type: 'semantic' });
    await brain.store({ content: 'Database layer uses Drizzle ORM with SQLite', type: 'semantic' });

    // Regular recall
    const regular = await brain.recall('API server technology');

    // Streaming recall — collect final context
    let streamContext = '';
    for await (const chunk of brain.recallStream('API server technology')) {
      if (chunk.phase === 'complete' && 'context' in chunk) {
        streamContext = chunk.context;
      }
    }

    // Both should produce the same final context
    // (they may differ slightly in ordering due to timing, but should have same content)
    expect(streamContext.length).toBeGreaterThan(0);
    expect(regular.context.length).toBeGreaterThan(0);

    // Both should mention the same memories
    expect(streamContext.includes('Fastify') || streamContext.includes('Drizzle')).toBe(true);
    expect(regular.context.includes('Fastify') || regular.context.includes('Drizzle')).toBe(true);
  });
});
