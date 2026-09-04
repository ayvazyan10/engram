/**
 * The HMAC secret is write-only.
 *
 * `toSubscription()` used to copy `row.secret` straight into every
 * subscription it returned, so `list()`, `get()` and `subscribe()` all handed
 * back the exact value a receiver uses to verify `X-Engram-Signature`. The
 * REST surface returns those objects verbatim, so anyone with API read access
 * could mint deliveries that any of the user's endpoints would accept as
 * genuine.
 *
 * A read path never needs the value — only whether one is configured — so the
 * subscription type carries `hasSecret` and the secret itself never leaves the
 * process. It still has to reach the signer, which is the other half of what
 * these tests pin down.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { closeDb, getDb } from '../../db/index.js';
import { WebhookManager } from '../WebhookManager.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SECRET = 'SUPERSECRET-HMAC-KEY';

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-secret-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT,
      events TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
      description TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      last_triggered_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  sqlite.close();
  return dbPath;
}

/** Serialize whatever the manager returns exactly as the REST layer would. */
function overTheWire(value: unknown): string {
  return JSON.stringify(value);
}

describe('WebhookManager — the HMAC secret never comes back out', () => {
  let dbPath: string;
  const originalAllowPrivate = process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];

  beforeEach(() => {
    process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'true';
    dbPath = createTestDb();
    getDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    cleanupTestDb(dbPath);
    if (originalAllowPrivate === undefined) delete process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];
    else process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = originalAllowPrivate;
  });

  it('subscribe() reports that a secret is set without echoing it', async () => {
    const mgr = new WebhookManager();
    const hook = await mgr.subscribe({
      url: 'https://example.com/webhook',
      events: ['stored'],
      secret: SECRET,
    });

    expect(hook.hasSecret).toBe(true);
    expect(overTheWire(hook)).not.toContain(SECRET);
    expect(hook).not.toHaveProperty('secret');
  });

  it('subscribe() reports hasSecret:false when none was supplied', async () => {
    const mgr = new WebhookManager();
    const hook = await mgr.subscribe({ url: 'https://example.com/webhook', events: ['stored'] });
    expect(hook.hasSecret).toBe(false);
  });

  it('list() never carries the secret', async () => {
    const mgr = new WebhookManager();
    await mgr.subscribe({ url: 'https://example.com/webhook', events: ['stored'], secret: SECRET });

    const hooks = await mgr.list();
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.hasSecret).toBe(true);
    expect(overTheWire(hooks)).not.toContain(SECRET);
  });

  it('get() never carries the secret', async () => {
    const mgr = new WebhookManager();
    const created = await mgr.subscribe({
      url: 'https://example.com/webhook',
      events: ['stored'],
      secret: SECRET,
    });

    const found = await mgr.get(created.id);
    expect(found).not.toBeNull();
    expect(found!.hasSecret).toBe(true);
    expect(overTheWire(found)).not.toContain(SECRET);
  });

  it('still signs deliveries with the stored secret', async () => {
    const bodies: string[] = [];
    const signatures: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf-8'));
        signatures.push(String(req.headers['x-engram-signature'] ?? ''));
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');

    try {
      const mgr = new WebhookManager();
      const hook = await mgr.subscribe({
        url: `http://127.0.0.1:${address.port}/hook`,
        events: ['stored'],
        secret: SECRET,
      });

      const result = await mgr.sendTest(hook.id);
      expect(result.success).toBe(true);

      const expected = `sha256=${createHmac('sha256', SECRET).update(bodies[0]!).digest('hex')}`;
      expect(signatures[0]).toBe(expected);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
