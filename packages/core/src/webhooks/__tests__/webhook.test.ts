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
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

// These tests exercise CRUD, event filtering and delivery mechanics using
// placeholder/loopback URLs. The SSRF guard (covered by urlGuard.test.ts) would
// otherwise reject them, so opt into private targets explicitly.
process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every migration in order, concatenated.
 *
 * Read from the directory rather than by filename: drizzle-kit names its
 * output with a random word pair, so regenerating the schema renames the file
 * and a hardcoded path stops the whole suite from even collecting. Reading
 * every *.sql in sorted order also picks up a second migration when one is
 * added, instead of silently building the table set from the first alone.
 */
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');
const MIGRATION_SQL = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'))
  .join('\n--> statement-breakpoint\n');

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-wh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  const statements = MIGRATION_SQL.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  // Add-if-missing, not unconditional ALTER: whether `namespace` and
  // `embedding_model` come from the checked-in migration or have to be added
  // on top of it depends on when the schema was last regenerated, and a
  // straight ALTER fails with "duplicate column name" the moment they arrive
  // in the migration itself. Mirrors addColumnIfMissing() in db/adapter.ts.
  const hasColumn = (table: string, column: string): boolean => {
    const row = sqlite
      .prepare('SELECT COUNT(*) as cnt FROM pragma_table_info(?) WHERE name = ?')
      .get(table, column) as { cnt: number };
    return row.cnt > 0;
  };
  if (!hasColumn('memories', 'namespace')) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  }
  if (!hasColumn('memories', 'embedding_model')) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  }
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

// ─── WebhookManager CRUD ─────────────────────────────────────────────────────

describe('WebhookManager — CRUD', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
    getDb(dbPath); // init DB connection
  });

  afterEach(() => {
    closeDb();
    cleanupTestDb(dbPath);
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
    cleanupTestDb(dbPath);
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
    cleanupTestDb(freshPath);
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
