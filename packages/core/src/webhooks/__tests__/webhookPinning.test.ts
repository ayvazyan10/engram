/**
 * Delivery-time SSRF tests for WebhookManager.
 *
 * The guard in urlGuard.ts resolves the target hostname and inspects the
 * answer. That is only worth anything if the socket then goes to *that*
 * address. These tests cover the gap: a hostname whose DNS answer changes
 * between the guard's lookup and the connection (classic DNS rebinding), and
 * the transport mechanics the pinning is built on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { closeDb, getDb } from '../../db/index.js';
import { WebhookManager } from '../WebhookManager.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * TEST-NET-3 (RFC 5737). The guard classifies it as public, and nothing
 * routes there — so it stands in for "the public address the attacker's
 * nameserver hands the guard" without any real traffic leaving the box.
 */
const PUBLIC_DECOY = '203.0.113.9';

/** Short per-attempt timeout so the unroutable decoy fails fast. */
const FAST_TIMEOUT_MS = 200;

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface ReceivedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

interface TestServer {
  readonly port: number;
  readonly received: ReceivedRequest[];
  close(): Promise<void>;
}

type Responder = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const okResponder: Responder = (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
};

/** Start an HTTP listener on loopback that records everything it receives. */
async function startServer(respond: Responder = okResponder): Promise<TestServer> {
  const received: ReceivedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      });
      respond(req, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind a port');

  return {
    port: address.port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-pin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

// ─── DNS rebinding ───────────────────────────────────────────────────────────

describe('WebhookManager — delivery is pinned to the validated address', () => {
  let dbPath: string;
  let servers: TestServer[];
  const originalAllowPrivate = process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];

  beforeEach(() => {
    // The pin only applies when the guard is actually enforcing.
    process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'false';
    dbPath = createTestDb();
    getDb(dbPath);
    servers = [];
  });

  afterEach(async () => {
    for (const s of servers) await s.close();
    closeDb();
    cleanupTestDb(dbPath);
    if (originalAllowPrivate === undefined) delete process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];
    else process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = originalAllowPrivate;
  });

  it('never connects to the address a second resolution would return', async () => {
    // The victim: a listener on loopback, standing in for the instance
    // metadata service or any internal endpoint.
    const victim = await startServer();
    servers.push(victim);

    // The attacker's nameserver answers a public address for the guard's
    // lookup. `localhost` still resolves to 127.0.0.1 through the OS, which is
    // exactly the second, unchecked resolution `fetch` used to perform.
    const mgr = new WebhookManager({
      lookup: async () => [PUBLIC_DECOY],
      requestTimeoutMs: FAST_TIMEOUT_MS,
    });
    await mgr.subscribe({ url: `http://localhost:${victim.port}/hook`, events: ['stored'] });

    const results = await mgr.fireAsync('stored', { test: true });

    expect(victim.received, 'delivery reached the loopback listener').toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
  });

  it('aborts before opening a socket when the host has moved to a private address', async () => {
    const victim = await startServer();
    servers.push(victim);

    let answer = [PUBLIC_DECOY];
    const mgr = new WebhookManager({
      lookup: async () => answer,
      requestTimeoutMs: FAST_TIMEOUT_MS,
    });
    await mgr.subscribe({ url: `http://localhost:${victim.port}/hook`, events: ['stored'] });

    answer = ['127.0.0.1']; // attacker repoints the record after subscribe

    const results = await mgr.fireAsync('stored', { test: true });

    expect(victim.received).toHaveLength(0);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.attempts, 'rejected before any delivery attempt').toBe(0);
  });
});

// ─── Transport mechanics ─────────────────────────────────────────────────────

describe('WebhookManager — delivery transport', () => {
  let dbPath: string;
  let servers: TestServer[];
  const originalAllowPrivate = process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];

  beforeEach(() => {
    // Loopback targets are the point of these tests, so use the documented
    // local-development escape hatch rather than weakening the guard.
    process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'true';
    dbPath = createTestDb();
    getDb(dbPath);
    servers = [];
  });

  afterEach(async () => {
    for (const s of servers) await s.close();
    closeDb();
    cleanupTestDb(dbPath);
    if (originalAllowPrivate === undefined) delete process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];
    else process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = originalAllowPrivate;
  });

  it('posts the signed JSON payload and reports success', async () => {
    const target = await startServer();
    servers.push(target);

    const mgr = new WebhookManager({ requestTimeoutMs: 5000 });
    await mgr.subscribe({
      url: `http://127.0.0.1:${target.port}/hook?x=1`,
      events: ['stored'],
      secret: 'shhh',
    });

    const results = await mgr.fireAsync('stored', { id: 'mem-1' });

    expect(results[0]!.success).toBe(true);
    expect(results[0]!.statusCode).toBe(200);
    expect(target.received).toHaveLength(1);

    const req = target.received[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/hook?x=1');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-engram-event']).toBe('stored');
    expect(req.headers['x-engram-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(req.headers['host']).toBe(`127.0.0.1:${target.port}`);
    expect(JSON.parse(req.body)).toMatchObject({ event: 'stored', data: { id: 'mem-1' } });
  });

  it('does not follow a redirect towards a private address', async () => {
    // Where a followed redirect would land.
    const internal = await startServer();
    servers.push(internal);

    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${internal.port}/latest/meta-data/` });
      res.end();
    });
    servers.push(redirector);

    const mgr = new WebhookManager({ requestTimeoutMs: 5000 });
    await mgr.subscribe({ url: `http://127.0.0.1:${redirector.port}/hook`, events: ['stored'] });

    const results = await mgr.fireAsync('stored', { test: true });

    expect(internal.received, 'redirect was followed').toHaveLength(0);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.statusCode).toBe(302);
  });

  it('treats a 4xx as permanent and does not retry', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(400);
      res.end('nope');
    });
    servers.push(target);

    const mgr = new WebhookManager({ requestTimeoutMs: 5000 });
    await mgr.subscribe({ url: `http://127.0.0.1:${target.port}/hook`, events: ['stored'] });

    const results = await mgr.fireAsync('stored', { test: true });

    expect(target.received).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.statusCode).toBe(400);
  });

  it('retries a 5xx up to the retry budget', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(503);
      res.end('later');
    });
    servers.push(target);

    const mgr = new WebhookManager({ requestTimeoutMs: 5000 });
    await mgr.subscribe({ url: `http://127.0.0.1:${target.port}/hook`, events: ['stored'] });

    const results = await mgr.fireAsync('stored', { test: true });

    expect(target.received).toHaveLength(3);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.attempts).toBe(3);
  });
});
