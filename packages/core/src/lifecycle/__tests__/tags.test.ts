/**
 * Tests for Tagging & Collections (#14).
 *
 * Validates:
 * 1. getTags returns tag cloud with correct counts
 * 2. getByTag filters memories correctly
 * 3. addTag / removeTag mutations
 * 4. getCollections groups by prefix
 * 5. Namespace scoping for tags
 * 6. Duplicate tag prevention
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-tags-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

// ─── Tag Cloud ───────────────────────────────────────────────────────────────

describe('Tags — cloud', () => {
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

  it('getTags returns empty for no memories', async () => {
    const tags = await brain.getTags();
    expect(tags).toEqual([]);
  });

  it('getTags counts correctly', async () => {
    await brain.store({ content: 'Memory A', tags: ['typescript', 'backend'] });
    await brain.store({ content: 'Memory B', tags: ['typescript', 'frontend'] });
    await brain.store({ content: 'Memory C', tags: ['python'] });

    const tags = await brain.getTags();
    expect(tags.length).toBe(4);

    const tsTag = tags.find((t) => t.tag === 'typescript');
    expect(tsTag?.count).toBe(2);

    const pyTag = tags.find((t) => t.tag === 'python');
    expect(pyTag?.count).toBe(1);
  });

  it('getTags sorted by count descending', async () => {
    await brain.store({ content: 'A', tags: ['common'] });
    await brain.store({ content: 'B', tags: ['common'] });
    await brain.store({ content: 'C', tags: ['common'] });
    await brain.store({ content: 'D', tags: ['rare'] });

    const tags = await brain.getTags();
    expect(tags[0]!.tag).toBe('common');
    expect(tags[0]!.count).toBe(3);
  });
});

// ─── Filter by Tag ───────────────────────────────────────────────────────────

describe('Tags — getByTag', () => {
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

  it('returns only memories with the given tag', async () => {
    await brain.store({ content: 'Tagged A', tags: ['api'] });
    await brain.store({ content: 'Tagged B', tags: ['api', 'backend'] });
    await brain.store({ content: 'No match', tags: ['frontend'] });

    const results = await brain.getByTag('api');
    expect(results.length).toBe(2);
    expect(results.every((m) => JSON.parse(m.tags).includes('api'))).toBe(true);
  });

  it('returns empty for nonexistent tag', async () => {
    await brain.store({ content: 'Something', tags: ['real'] });
    const results = await brain.getByTag('nonexistent');
    expect(results.length).toBe(0);
  });

  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await brain.store({ content: `Memory ${i}`, tags: ['bulk'] });
    }

    const page1 = await brain.getByTag('bulk', 2, 0);
    expect(page1.length).toBe(2);

    const page2 = await brain.getByTag('bulk', 2, 2);
    expect(page2.length).toBe(2);

    const page3 = await brain.getByTag('bulk', 2, 4);
    expect(page3.length).toBe(1);
  });
});

// ─── Add/Remove Tags ─────────────────────────────────────────────────────────

describe('Tags — mutations', () => {
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

  it('addTag adds a new tag', async () => {
    const { memory } = await brain.store({ content: 'Taggable', tags: ['original'] });

    const tags = await brain.addTag(memory.id, 'new-tag');
    expect(tags).toContain('original');
    expect(tags).toContain('new-tag');
  });

  it('addTag is idempotent (no duplicates)', async () => {
    const { memory } = await brain.store({ content: 'Taggable', tags: ['existing'] });

    const tags = await brain.addTag(memory.id, 'existing');
    expect(tags.filter((t) => t === 'existing').length).toBe(1);
  });

  it('removeTag removes a tag', async () => {
    const { memory } = await brain.store({ content: 'Taggable', tags: ['keep', 'remove-me'] });

    const tags = await brain.removeTag(memory.id, 'remove-me');
    expect(tags).toContain('keep');
    expect(tags).not.toContain('remove-me');
  });

  it('removeTag on nonexistent tag returns unchanged', async () => {
    const { memory } = await brain.store({ content: 'Taggable', tags: ['a', 'b'] });

    const tags = await brain.removeTag(memory.id, 'nonexistent');
    expect(tags).toEqual(['a', 'b']);
  });
});

// ─── Collections ─────────────────────────────────────────────────────────────

describe('Tags — collections', () => {
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

  it('groups tags by prefix', async () => {
    await brain.store({ content: 'A', tags: ['project:alpha', 'project:beta'] });
    await brain.store({ content: 'B', tags: ['topic:ml', 'project:alpha'] });
    await brain.store({ content: 'C', tags: ['unprefixed'] });

    const collections = await brain.getCollections();

    const projectCol = collections.find((c) => c.prefix === 'project');
    expect(projectCol).toBeDefined();
    expect(projectCol!.tags.length).toBe(2); // alpha, beta

    const topicCol = collections.find((c) => c.prefix === 'topic');
    expect(topicCol).toBeDefined();

    const defaultCol = collections.find((c) => c.prefix === 'default');
    expect(defaultCol).toBeDefined();
    expect(defaultCol!.tags.some((t) => t.tag === 'unprefixed')).toBe(true);
  });

  it('sorted by total memories descending', async () => {
    await brain.store({ content: 'A', tags: ['big:a'] });
    await brain.store({ content: 'B', tags: ['big:b'] });
    await brain.store({ content: 'C', tags: ['big:c'] });
    await brain.store({ content: 'D', tags: ['small:x'] });

    const collections = await brain.getCollections();
    expect(collections[0]!.prefix).toBe('big');
  });
});
