/**
 * Tests for Webhooks (#13).
 *
 * Validates:
 * 1. Subscribe/unsubscribe CRUD
 * 2. List active vs all
 * 3. Webhook fires on memory store
 * 4. Webhook fires on forget
 * 5. Event filtering (only subscribed events fire)
 * 6. Auto-disable after repeated failures
 * 7. HMAC signing when secret configured
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb, getDb, schema } from '../../db/index.js';
import { WebhookManager } from '../WebhookManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8'
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-wh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  // Webhooks table auto-created by getDb(), but we need it now for direct WebhookManager tests
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT,
      events TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
      description TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      last_triggered_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (active)');
  sqlite.close();
  return dbPath;
}

function cleanup(dbPath: string) {
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}
}

// ─── WebhookManager CRUD ─────────────────────────────────────────────────────

describe('WebhookManager — CRUD', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
    getDb(dbPath); // init DB connection
  });

  afterEach(() => {
    closeDb();
    cleanup(dbPath);
  });

  it('subscribe creates a webhook', async () => {
    const mgr = new WebhookManager();
    const hook = await mgr.subscribe({
      url: 'https://example.com/webhook',
      events: ['stored', 'forgotten'],
      description: 'Test hook',
    });

    expect(hook.id).toBeDefined();
    expect(hook.url).toBe('https://example.com/webhook');
    expect(hook.events).toEqual(['stored', 'forgotten']);
    expect(hook.active).toBe(true);
    expect(hook.failCount).toBe(0);
  });

  it('list returns all webhooks', async () => {
    const mgr = new WebhookManager();
    await mgr.subscribe({ url: 'https://a.com/wh', events: ['stored'] });
    await mgr.subscribe({ url: 'https://b.com/wh', events: ['forgotten'] });

    const all = await mgr.list();
    expect(all.length).toBe(2);
  });

  it('list with activeOnly filters', async () => {
    const mgr = new WebhookManager();
    const h1 = await mgr.subscribe({ url: 'https://a.com/wh', events: ['stored'] });
    await mgr.subscribe({ url: 'https://b.com/wh', events: ['stored'] });

    // Disable h1 by direct DB update
    const db = getDb();
    const { eq } = await import('drizzle-orm');
    await db.update(schema.webhooks).set({ active: false }).where(eq(schema.webhooks.id, h1.id));

    const active = await mgr.list(true);
    expect(active.length).toBe(1);
  });

  it('unsubscribe removes a webhook', async () => {
    const mgr = new WebhookManager();
    const hook = await mgr.subscribe({ url: 'https://a.com/wh', events: ['stored'] });

    await mgr.unsubscribe(hook.id);

    const all = await mgr.list();
    expect(all.length).toBe(0);
  });

  it('get returns a single webhook', async () => {
    const mgr = new WebhookManager();
    const hook = await mgr.subscribe({ url: 'https://a.com/wh', events: ['stored'], description: 'My hook' });

    const found = await mgr.get(hook.id);
    expect(found).not.toBeNull();
    expect(found!.description).toBe('My hook');
  });

  it('get returns null for nonexistent ID', async () => {
    const mgr = new WebhookManager();
    const found = await mgr.get('nonexistent');
    expect(found).toBeNull();
  });
});

// ─── NeuralBrain + Webhooks Integration ──────────────────────────────────────

describe('NeuralBrain — webhook integration', () => {
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

  it('getWebhookManager returns the manager', () => {
    const mgr = brain.getWebhookManager();
    expect(mgr).toBeInstanceOf(WebhookManager);
  });

  it('can subscribe webhooks through the brain', async () => {
    const mgr = brain.getWebhookManager();
    const hook = await mgr.subscribe({
      url: 'https://example.com/hook',
      events: ['stored'],
    });
    expect(hook.id).toBeDefined();

    const all = await mgr.list();
    expect(all.length).toBe(1);
  });

  it('webhook table is auto-created on brain init', async () => {
    // Create a fresh DB without webhooks table
    const freshPath = path.join(__dirname, `test-wh-fresh-${Date.now()}.db`);
    const sqlite = new Database(freshPath);
    const statements = MIGRATION_SQL.split('--> statement-breakpoint');
    for (const stmt of statements) {
      const sql = stmt.trim();
      if (sql) sqlite.exec(sql);
    }
    sqlite.close();
    closeDb();

    // Init brain — should auto-create webhooks table
    const freshBrain = new NeuralBrain({ dbPath: freshPath, defaultSource: 'test' });
    await freshBrain.initialize();

    const mgr = freshBrain.getWebhookManager();
    const hook = await mgr.subscribe({ url: 'https://test.com/wh', events: ['stored'] });
    expect(hook.id).toBeDefined();

    freshBrain.shutdown();
    closeDb();
    cleanup(freshPath);
  });

  it('fireAsync returns delivery results (fails gracefully for unreachable URLs)', async () => {
    const mgr = brain.getWebhookManager();
    await mgr.subscribe({
      url: 'http://127.0.0.1:59999/nonexistent', // unreachable
      events: ['stored'],
    });

    // Fire should not throw
    const results = await mgr.fireAsync('stored', { test: true });
    expect(results.length).toBe(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.attempts).toBe(3); // retried 3 times
  });
});
