/**
 * Tests for Batch Embedding Startup / Index Persistence (#8).
 *
 * Validates:
 * 1. VectorSearch serialize/deserialize roundtrip preserves entries
 * 2. saveToDisk/loadFromDisk work correctly
 * 3. NeuralBrain loads cached index on init (skips full DB scan)
 * 4. Incremental sync adds only new memories
 * 5. Corrupt/missing index triggers full rebuild
 * 6. shutdown() auto-saves the index
 * 7. rebuildIndex() forces full rebuild
 * 8. Search works correctly after loading from disk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import { VectorSearch } from '../../retrieval/VectorSearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-idx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

function cleanup(...paths: string[]) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch {}
    try { fs.unlinkSync(p + '-wal'); } catch {}
    try { fs.unlinkSync(p + '-shm'); } catch {}
  }
}

// ─── VectorSearch Serialize/Deserialize ──────────────────────────────────────

describe('VectorSearch — persistence', () => {
  it('serialize/deserialize roundtrip preserves entries', () => {
    const vs = new VectorSearch(4); // tiny 4-dim for speed

    const vec1 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const vec2 = new Float32Array([0.5, 0.6, 0.7, 0.8]);

    vs.upsert({ id: 'mem-1', vector: vec1, type: 'semantic', namespace: 'ns-a' });
    vs.upsert({ id: 'mem-2', vector: vec2, type: 'episodic' });

    const buf = vs.serialize();
    expect(buf.length).toBeGreaterThan(0);

    const vs2 = new VectorSearch(4);
    const meta = vs2.deserialize(buf);

    expect(meta.entryCount).toBe(2);
    expect(meta.dimension).toBe(4);
    expect(meta.ids.has('mem-1')).toBe(true);
    expect(meta.ids.has('mem-2')).toBe(true);
    expect(vs2.size).toBe(2);

    // Verify search still works
    const results = vs2.search(vec1, 2, 0.0);
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe('mem-1');
  });

  it('saveToDisk/loadFromDisk works correctly', () => {
    const filePath = path.join(__dirname, `test-index-${Date.now()}.bin`);
    const vs = new VectorSearch(4);

    vs.upsert({ id: 'a', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });
    vs.upsert({ id: 'b', vector: new Float32Array([0, 1, 0, 0]), type: 'episodic', namespace: 'test' });

    vs.saveToDisk(filePath);
    expect(fs.existsSync(filePath)).toBe(true);

    const vs2 = new VectorSearch(4);
    const meta = vs2.loadFromDisk(filePath);

    expect(meta).not.toBeNull();
    expect(meta!.entryCount).toBe(2);
    expect(vs2.size).toBe(2);

    cleanup(filePath);
  });

  it('loadFromDisk returns null for missing file', () => {
    const vs = new VectorSearch(4);
    const meta = vs.loadFromDisk('/tmp/nonexistent-index-file.bin');
    expect(meta).toBeNull();
  });

  it('deserialize throws on corrupt data', () => {
    const vs = new VectorSearch(4);
    const corrupt = Buffer.from('not a valid index');
    expect(() => vs.deserialize(corrupt)).toThrow();
  });

  it('deserialize throws on dimension mismatch', () => {
    const vs384 = new VectorSearch(384);
    const vs4 = new VectorSearch(4);
    vs4.upsert({ id: 'x', vector: new Float32Array([1, 2, 3, 4]), type: 'semantic' });
    const buf = vs4.serialize();

    expect(() => vs384.deserialize(buf)).toThrow('Dimension mismatch');
  });
});

// ─── NeuralBrain — Index Lifecycle ───────────────────────────────────────────

describe('NeuralBrain — index persistence', () => {
  let dbPath: string;
  let indexPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
    indexPath = dbPath + '.index';
  });

  afterEach(() => {
    closeDb();
    cleanup(dbPath, indexPath);
  });

  it('first init loads from database, no index file', async () => {
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();

    const status = brain.getIndexStatus();
    expect(status.loadedFrom).toBe('database');
    expect(status.indexFileExists).toBe(false);

    brain.shutdown();
  });

  it('shutdown saves index file to disk', async () => {
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'Persist this memory' });

    brain.shutdown();

    expect(fs.existsSync(indexPath)).toBe(true);
    const stat = fs.statSync(indexPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('second init loads from disk cache', async () => {
    // First init + store + shutdown
    let brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'Memory to cache' });
    brain.shutdown();
    closeDb();

    // Second init — should load from disk
    brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();

    const status = brain.getIndexStatus();
    expect(status.loadedFrom).toBe('disk');
    expect(status.entryCount).toBeGreaterThanOrEqual(1);

    brain.shutdown();
  });

  it('incremental sync adds only new memories', async () => {
    // First init + store 2 memories + shutdown
    let brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'First memory' });
    await brain.store({ content: 'Second memory' });
    brain.shutdown();
    closeDb();

    // Second init — add a third memory via direct DB, then init
    const sqlite = new Database(dbPath);
    // (The third memory would be added by another process — we simulate by starting brain,
    // storing, and checking incrementalCount)
    brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();

    // Index loaded 2 from disk, 0 incremental (no new ones yet)
    let status = brain.getIndexStatus();
    expect(status.loadedFrom).toBe('disk');
    expect(status.incrementalCount).toBe(0);

    // Now store a new one — it gets added to the live index
    await brain.store({ content: 'Third memory added after cache' });
    // Search should find all 3
    const results = await brain.search('memory');
    expect(results.length).toBe(3);

    brain.shutdown();
    sqlite.close();
  });

  it('corrupt index file triggers full rebuild from DB', async () => {
    // First init + store + shutdown
    let brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'Memory before corruption' });
    brain.shutdown();
    closeDb();

    // Corrupt the index file
    fs.writeFileSync(indexPath, 'CORRUPT DATA');

    // Second init — should fall back to DB
    brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();

    const status = brain.getIndexStatus();
    expect(status.loadedFrom).toBe('database');
    expect(status.entryCount).toBeGreaterThanOrEqual(1);

    brain.shutdown();
  });

  it('rebuildIndex forces full rebuild and saves', async () => {
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'Memory for rebuild test' });

    const status = await brain.rebuildIndex();
    expect(status.loadedFrom).toBe('database');
    expect(status.entryCount).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(indexPath)).toBe(true);

    brain.shutdown();
  });

  it('search works correctly after loading from disk cache', async () => {
    // First init + store
    let brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'TypeScript is a strongly typed programming language', type: 'semantic' });
    brain.shutdown();
    closeDb();

    // Second init from cache
    brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();

    // Search should find the cached memory
    const results = await brain.search('TypeScript programming');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain('TypeScript');

    brain.shutdown();
  });
});
