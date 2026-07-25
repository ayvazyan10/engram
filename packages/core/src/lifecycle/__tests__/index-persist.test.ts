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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
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

// ─── Header Validation: Model + Checksum ─────────────────────────────────────

describe('VectorSearch — header validation', () => {
  const vecOf = (a: number, b: number) => new Float32Array([a, b, 0, 0]);

  function indexWith(modelId: string | null): VectorSearch {
    const vs = new VectorSearch(4, modelId);
    vs.upsert({ id: 'm1', vector: vecOf(1, 0), type: 'semantic' });
    vs.upsert({ id: 'm2', vector: vecOf(0, 1), type: 'episodic' });
    return vs;
  }

  it('round-trips the embedding model through the header', () => {
    const buf = indexWith('Xenova/all-MiniLM-L6-v2').serialize();

    const reader = new VectorSearch(4, 'Xenova/all-MiniLM-L6-v2');
    const meta = reader.deserialize(buf);

    expect(meta.embeddingModel).toBe('Xenova/all-MiniLM-L6-v2');
    expect(meta.entryCount).toBe(2);
  });

  it('rejects an index written by a different embedding model', () => {
    const buf = indexWith('old-model/v1').serialize();

    const reader = new VectorSearch(4, 'Xenova/all-MiniLM-L6-v2');
    expect(() => reader.deserialize(buf)).toThrow(/model mismatch/i);
  });

  it('skips the model check when the reader declares no model', () => {
    const buf = indexWith('some-model/v9').serialize();

    const reader = new VectorSearch(4);
    expect(() => reader.deserialize(buf)).not.toThrow();
  });

  it('rejects a payload corrupted after the header', () => {
    const buf = indexWith('m').serialize();

    // Flip a byte inside a vector — dimension and count still line up, so only a
    // checksum can catch this.
    const corrupt = Buffer.from(buf);
    corrupt[corrupt.length - 3] ^= 0xff;

    const reader = new VectorSearch(4, 'm');
    expect(() => reader.deserialize(corrupt)).toThrow(/checksum/i);
  });

  it('rejects a header whose entry count understates the payload', () => {
    const vs = new VectorSearch(4, 'm');
    vs.upsert({ id: 'm1', vector: vecOf(1, 0), type: 'semantic' });
    vs.upsert({ id: 'm2', vector: vecOf(0, 1), type: 'episodic' });
    vs.upsert({ id: 'm3', vector: vecOf(1, 1), type: 'procedural' });

    // `count` lives in the header, outside the CRC's reach, and nothing else
    // cross-checks it: parsing fewer entries than the payload holds still leaves
    // the checksum valid, so only a length check catches this.
    const truncated = Buffer.from(vs.serialize());
    truncated.writeUInt32LE(1, 12);

    const reader = new VectorSearch(4, 'm');
    expect(() => reader.deserialize(truncated)).toThrow(/length mismatch/i);
  });

  it('leaves the reader untouched when validation fails', () => {
    const reader = new VectorSearch(4, 'm');
    reader.upsert({ id: 'existing', vector: vecOf(1, 0), type: 'semantic' });

    const foreign = indexWith('other-model/v2').serialize();
    expect(() => reader.deserialize(foreign)).toThrow();

    // A refused load must not have dropped what the index already held.
    expect(reader.size).toBe(1);
    expect(reader.getIds().has('existing')).toBe(true);
  });

  it('rejects an index written in the previous format version', () => {
    const buf = indexWith('m').serialize();

    // Downgrade the version field to v1 — the pre-header-validation format.
    const older = Buffer.from(buf);
    older.writeUInt32LE(1, 4);

    const reader = new VectorSearch(4, 'm');
    expect(() => reader.deserialize(older)).toThrow(/unsupported index version/i);
  });
});

// ─── Asynchronous, Atomic Persistence ────────────────────────────────────────

describe('VectorSearch — async persistence', () => {
  // Scratch files go to a per-test temp dir, removed unconditionally afterwards —
  // a failing assertion must not leave binary debris in the source tree.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-idx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveToDiskAsync writes an index loadFromDisk can read', async () => {
    const filePath = path.join(tmpDir, 'index.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'a', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });
    vs.upsert({ id: 'b', vector: new Float32Array([0, 1, 0, 0]), type: 'episodic', namespace: 'test' });

    await vs.saveToDiskAsync(filePath);

    const vs2 = new VectorSearch(4);
    const meta = vs2.loadFromDisk(filePath);
    expect(meta!.entryCount).toBe(2);
    expect(vs2.size).toBe(2);
  });

  it('creates the parent directory when missing', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'index.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'a', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    await vs.saveToDiskAsync(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('rejects — and leaves the previous index intact — when the write fails', async () => {
    const filePath = path.join(tmpDir, 'index.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'good', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });
    await vs.saveToDiskAsync(filePath);
    const good = fs.readFileSync(filePath);

    // Make the directory read-only so creating the temp file fails.
    fs.chmodSync(tmpDir, 0o500);
    vs.upsert({ id: 'later', vector: new Float32Array([0, 1, 0, 0]), type: 'semantic' });
    await expect(vs.saveToDiskAsync(filePath)).rejects.toThrow();
    fs.chmodSync(tmpDir, 0o700);

    // The readable index from before must survive a failed replacement.
    expect(fs.readFileSync(filePath).equals(good)).toBe(true);
  });

  it('never leaves a temp file behind on success', async () => {
    const filePath = path.join(tmpDir, 'index.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'a', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    await vs.saveToDiskAsync(filePath);

    expect(fs.readdirSync(tmpDir)).toEqual(['index.bin']);
  });

  it('overlapping saves both land, last call wins, nothing is silently dropped', async () => {
    const filePath = path.join(tmpDir, 'concurrent.bin');
    const vs = new VectorSearch(4);

    vs.upsert({ id: 'first', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });
    const firstSave = vs.saveToDiskAsync(filePath);

    // Second caller enters while the first write is still in flight — the shape
    // of reEmbed() racing an explicit POST /api/index/save.
    vs.upsert({ id: 'second', vector: new Float32Array([0, 1, 0, 0]), type: 'semantic' });
    const secondSave = vs.saveToDiskAsync(filePath);

    await expect(Promise.all([firstSave, secondSave])).resolves.toBeDefined();

    // Saves are serialized, so the file holds the later caller's snapshot whole —
    // not a blend, and not the earlier one overwriting it.
    const probe = new VectorSearch(4);
    const meta = probe.loadFromDisk(filePath);
    expect(meta!.entryCount).toBe(2);
    expect(meta!.ids.has('second')).toBe(true);

    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('an in-flight async save cannot clobber a later synchronous one', async () => {
    const filePath = path.join(tmpDir, 'shutdown.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'stale', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    // Hold the async write open so the sync save lands in the middle of it —
    // a re-embed still running when SIGTERM triggers shutdown().
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const realWriteFile = fs.promises.writeFile;
    const spy = vi
      .spyOn(fs.promises, 'writeFile')
      .mockImplementation(async (...args: Parameters<typeof fs.promises.writeFile>) => {
        await held;
        return realWriteFile(...args);
      });

    const asyncSave = vs.saveToDiskAsync(filePath);

    // shutdown()'s synchronous save writes the newer state.
    vs.upsert({ id: 'fresh', vector: new Float32Array([0, 1, 0, 0]), type: 'semantic' });
    spy.mockRestore();
    vs.saveToDisk(filePath);

    release();
    await asyncSave;

    // The older in-flight snapshot must not be published over the newer one.
    const meta = new VectorSearch(4).loadFromDisk(filePath);
    expect(meta!.ids.has('fresh')).toBe(true);
    expect(meta!.entryCount).toBe(2);
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a failed save does not poison the next one', async () => {
    const filePath = path.join(tmpDir, 'recover.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'a', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    // A directory in place of the target makes rename fail.
    fs.mkdirSync(filePath);
    await expect(vs.saveToDiskAsync(filePath)).rejects.toThrow();
    fs.rmdirSync(filePath);

    await expect(vs.saveToDiskAsync(filePath)).resolves.toBeUndefined();
    expect(new VectorSearch(4).loadFromDisk(filePath)!.entryCount).toBe(1);
  });

  it('keeps draining the queue when every queued save fails', async () => {
    const filePath = path.join(tmpDir, 'chained.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'a', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    // Read-only directory: both fail at the temp write, so neither is merely
    // superseded — each reports its own failure.
    fs.chmodSync(tmpDir, 0o500);
    const first = vs.saveToDiskAsync(filePath);
    const second = vs.saveToDiskAsync(filePath);

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();

    // The queue keeps advancing once the obstruction is gone.
    fs.chmodSync(tmpDir, 0o700);
    await expect(vs.saveToDiskAsync(filePath)).resolves.toBeUndefined();
    expect(new VectorSearch(4).loadFromDisk(filePath)!.entryCount).toBe(1);
  });

  it('a superseded save resolves without publishing its stale snapshot', async () => {
    const filePath = path.join(tmpDir, 'superseded.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'only', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    const stale = vs.saveToDiskAsync(filePath);
    vs.remove('only');
    vs.upsert({ id: 'replacement', vector: new Float32Array([0, 1, 0, 0]), type: 'episodic' });
    const fresh = vs.saveToDiskAsync(filePath);

    await expect(stale).resolves.toBeUndefined();
    await expect(fresh).resolves.toBeUndefined();

    const meta = new VectorSearch(4).loadFromDisk(filePath);
    expect(meta!.ids.has('replacement')).toBe(true);
    expect(meta!.ids.has('only')).toBe(false);
  });

  it('serializes a snapshot taken before the await', async () => {
    const filePath = path.join(tmpDir, 'snapshot.bin');
    const vs = new VectorSearch(4);
    vs.upsert({ id: 'first', vector: new Float32Array([1, 0, 0, 0]), type: 'semantic' });

    const writing = vs.saveToDiskAsync(filePath);
    // Mutating while the write is in flight must not corrupt the file.
    vs.upsert({ id: 'second', vector: new Float32Array([0, 1, 0, 0]), type: 'semantic' });
    await writing;

    const vs2 = new VectorSearch(4);
    const meta = vs2.loadFromDisk(filePath);
    expect(meta!.entryCount).toBe(1);
    expect(meta!.ids.has('first')).toBe(true);

    cleanup(filePath);
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

  it('discards a cached index whose embedding model no longer matches', async () => {
    let brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'Memory embedded by the current model' });
    brain.shutdown();
    closeDb();

    // Rewrite the header's model field to something else, leaving the vectors —
    // and the checksum over them — untouched.
    const cached = fs.readFileSync(indexPath);
    const modelLen = cached.readUInt32LE(16);
    const forged = Buffer.concat([
      cached.subarray(0, 20),
      Buffer.from('impostor-model/v0'.padEnd(modelLen, ' ').slice(0, modelLen), 'utf8'),
      cached.subarray(20 + modelLen),
    ]);
    fs.writeFileSync(indexPath, forged);

    brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();

    // The stale cache must be dropped and the index rebuilt from SQLite.
    const status = brain.getIndexStatus();
    expect(status.loadedFrom).toBe('database');
    expect(status.entryCount).toBe(1);

    // And recall must still work off the rebuilt index.
    const hits = await brain.search('memory embedded by the current model');
    expect(hits.length).toBeGreaterThanOrEqual(1);

    brain.shutdown();
  });

  it('saveIndexAsync persists a readable index', async () => {
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath });
    await brain.initialize();
    await brain.store({ content: 'Memory saved through the async path' });

    await brain.saveIndexAsync();

    expect(brain.getIndexStatus().indexFileExists).toBe(true);
    const probe = new VectorSearch(brain.getIndexStatus().dimension);
    expect(probe.loadFromDisk(indexPath)!.entryCount).toBeGreaterThanOrEqual(1);

    brain.shutdown();
  });

  it('saveIndexAsync rejects when no index path is configured', async () => {
    const brain = new NeuralBrain({ dbPath, defaultSource: 'test', indexPath: '' });
    await brain.initialize();

    // An empty indexPath falls back to `${dbPath}.index`, so drop dbPath too by
    // pointing the resolver at nothing it can use.
    (brain as unknown as { config: { dbPath?: string; indexPath?: string } }).config = {};

    await expect(brain.saveIndexAsync()).rejects.toThrow('No index path configured');

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
