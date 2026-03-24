/**
 * Tests for Plugin System (#15).
 *
 * Validates:
 * 1. Plugin registration/unregistration
 * 2. List returns correct metadata
 * 3. Hooks fire in registration order
 * 4. Error in one plugin doesn't break others
 * 5. onStore hook fires on brain.store()
 * 6. onRecall hook fires on brain.recall()
 * 7. onForget hook fires on brain.forget()
 * 8. Manifest validation (missing fields)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import { PluginRegistry } from '../PluginRegistry.js';
import type { EngramPlugin } from '../PluginRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.exec(`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT,
    events TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
    description TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    last_triggered_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.close();
  return dbPath;
}

function cleanup(dbPath: string) {
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
}

// ─── PluginRegistry Unit ─────────────────────────────────────────────────────

describe('PluginRegistry — unit', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('register adds a plugin', () => {
    registry.register({
      id: 'test/logger', name: 'Logger', version: '1.0.0',
      hooks: { onStore: async () => {} },
    });
    expect(registry.size).toBe(1);
    expect(registry.has('test/logger')).toBe(true);
  });

  it('register replaces existing plugin with same ID', () => {
    registry.register({ id: 'p1', name: 'V1', version: '1.0.0', hooks: {} });
    registry.register({ id: 'p1', name: 'V2', version: '2.0.0', hooks: {} });
    expect(registry.size).toBe(1);
    expect(registry.get('p1')?.version).toBe('2.0.0');
  });

  it('unregister removes a plugin', () => {
    registry.register({ id: 'p1', name: 'P', version: '1.0', hooks: {} });
    expect(registry.unregister('p1')).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('unregister returns false for nonexistent', () => {
    expect(registry.unregister('nope')).toBe(false);
  });

  it('list returns correct metadata', () => {
    registry.register({
      id: 'my/plugin', name: 'My Plugin', version: '1.2.3',
      description: 'Test plugin',
      hooks: { onStore: async () => {}, onRecall: async () => {} },
    });

    const list = registry.list();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe('my/plugin');
    expect(list[0]!.hooks).toContain('onStore');
    expect(list[0]!.hooks).toContain('onRecall');
    expect(list[0]!.hooks.length).toBe(2);
  });

  it('throws on invalid manifest', () => {
    expect(() => registry.register({ id: '', name: 'X', version: '1', hooks: {} } as EngramPlugin)).toThrow();
    expect(() => registry.register({ id: 'x', name: '', version: '1', hooks: {} } as EngramPlugin)).toThrow();
  });

  it('runHook fires hooks in registration order', async () => {
    const order: string[] = [];

    registry.register({
      id: 'first', name: 'First', version: '1',
      hooks: { onStore: async () => { order.push('first'); } },
    });
    registry.register({
      id: 'second', name: 'Second', version: '1',
      hooks: { onStore: async () => { order.push('second'); } },
    });

    await registry.runHook('onStore', { memory: {} as any, contradictions: 0 });
    expect(order).toEqual(['first', 'second']);
  });

  it('error in one plugin does not break others', async () => {
    const results: string[] = [];

    registry.register({
      id: 'bad', name: 'Bad', version: '1',
      hooks: { onStore: async () => { throw new Error('plugin crash'); } },
    });
    registry.register({
      id: 'good', name: 'Good', version: '1',
      hooks: { onStore: async () => { results.push('good'); } },
    });

    // Should not throw
    await registry.runHook('onStore', { memory: {} as any, contradictions: 0 });
    expect(results).toEqual(['good']);
  });
});

// ─── NeuralBrain + Plugins Integration ───────────────────────────────────────

describe('NeuralBrain — plugin hooks', () => {
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

  it('registerPlugin / listPlugins work', () => {
    brain.registerPlugin({
      id: 'test/p', name: 'Test', version: '1.0',
      hooks: { onStore: async () => {} },
    });

    const list = brain.listPlugins();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe('test/p');
  });

  it('onStore hook fires when memory is stored', async () => {
    const stored: string[] = [];

    brain.registerPlugin({
      id: 'store-watcher', name: 'Store Watcher', version: '1.0',
      hooks: {
        onStore: async (ctx) => { stored.push(ctx.memory.id); },
      },
    });

    const { memory } = await brain.store({ content: 'Plugin test memory' });

    // Give the async hook time to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(stored).toContain(memory.id);
  });

  it('onRecall hook fires on recall', async () => {
    let recalledQuery = '';

    brain.registerPlugin({
      id: 'recall-watcher', name: 'Recall Watcher', version: '1.0',
      hooks: {
        onRecall: async (ctx) => { recalledQuery = ctx.query; },
      },
    });

    await brain.store({ content: 'Something to recall' });
    await brain.recall('Something');

    await new Promise((r) => setTimeout(r, 50));
    expect(recalledQuery).toBe('Something');
  });

  it('onForget hook fires on forget', async () => {
    let forgottenId = '';

    brain.registerPlugin({
      id: 'forget-watcher', name: 'Forget Watcher', version: '1.0',
      hooks: {
        onForget: async (ctx) => { forgottenId = ctx.memoryId; },
      },
    });

    const { memory } = await brain.store({ content: 'Will be forgotten' });
    await brain.forget(memory.id);

    await new Promise((r) => setTimeout(r, 50));
    expect(forgottenId).toBe(memory.id);
  });

  it('unregisterPlugin stops hooks from firing', async () => {
    const calls: string[] = [];

    brain.registerPlugin({
      id: 'temp', name: 'Temp', version: '1.0',
      hooks: { onStore: async () => { calls.push('fired'); } },
    });

    brain.unregisterPlugin('temp');

    await brain.store({ content: 'After unregister' });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]);
  });
});
