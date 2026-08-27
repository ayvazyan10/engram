/**
 * Auth coverage for the Socket.io '/neural' namespace (Phase 4, task 4.4).
 *
 * Before this, the namespace had no auth at all: any client that could reach
 * the port received every real-time memory event, even with ENGRAM_API_KEY
 * set on the REST side. `setupRealtime()` (exported from ../index.ts) now
 * gates the namespace with the same `secretsMatch()` timing-safe comparison
 * the REST hook uses, via a Socket.io `use()` middleware checked against
 * `socket.handshake.auth.token`.
 *
 * `start()` itself is not exported and must not be called from tests — its
 * shutdown() path calls `process.exit(0)`, which would kill the whole vitest
 * worker. Instead each suite below builds the app, listens on an
 * OS-assigned port, and calls the exported `setupRealtime()` directly —
 * exercising the exact function start() calls, without process.exit or
 * signal handlers.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const TEST_API_KEY = 'socket-auth-test-key-9f3c2a';

/** Track every client socket opened by a test so afterEach can force-close it. */
const openSockets: ClientSocket[] = [];

function connectClient(baseUrl: string, token?: string): ClientSocket {
  const socket = ioClient(`${baseUrl}/neural`, {
    auth: token === undefined ? {} : { token },
    reconnection: false,
    forceNew: true,
    transports: ['websocket'],
    timeout: 5000,
  });
  openSockets.push(socket);
  return socket;
}

/** Resolves with the connect_error, or rejects if the socket connects instead. */
function waitForRejection(socket: ClientSocket): Promise<Error> {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => reject(new Error('expected the connection to be rejected')));
    socket.on('connect_error', (err: Error) => resolve(err));
  });
}

/** Resolves once connected, or rejects with the connect_error otherwise. */
function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err: Error) => reject(err));
  });
}

afterEach(() => {
  while (openSockets.length > 0) {
    openSockets.pop()?.close();
  }
});

describe('Socket.io /neural namespace auth — ENGRAM_API_KEY set', () => {
  const dbPath = path.join(os.tmpdir(), `engram-socket-auth-on-${process.pid}.db`);
  let app: FastifyInstance;
  let brain: typeof import('../index.js')['brain'];
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env['ENGRAM_DB_PATH'] = dbPath;
    process.env['ENGRAM_DECAY_INTERVAL'] = '0';
    process.env['ENGRAM_API_KEY'] = TEST_API_KEY;

    const mod = await import('../index.js');
    brain = mod.brain;
    await brain.initialize();
    app = await mod.buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    mod.setupRealtime(app.server);

    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    try { brain?.shutdown(); } catch { /* best effort */ }
    cleanupTestDb(dbPath);
    delete process.env['ENGRAM_API_KEY'];
  });

  it('rejects a connection with no token', async () => {
    const socket = connectClient(baseUrl);
    const err = await waitForRejection(socket);
    expect(err.message).toMatch(/Unauthorized/);
    expect(socket.connected).toBe(false);
  });

  it('rejects a connection with the wrong token', async () => {
    const socket = connectClient(baseUrl, 'not-the-right-key');
    const err = await waitForRejection(socket);
    expect(err.message).toMatch(/Unauthorized/);
    expect(socket.connected).toBe(false);
  });

  it('accepts a connection with the correct token', async () => {
    const socket = connectClient(baseUrl, TEST_API_KEY);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);
  });
});

describe('Socket.io /neural namespace auth — ENGRAM_API_KEY unset', () => {
  const dbPath = path.join(os.tmpdir(), `engram-socket-auth-off-${process.pid}.db`);
  let app: FastifyInstance;
  let brain: typeof import('../index.js')['brain'];
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env['ENGRAM_API_KEY'];
    process.env['ENGRAM_DB_PATH'] = dbPath;
    process.env['ENGRAM_DECAY_INTERVAL'] = '0';

    const mod = await import('../index.js');
    brain = mod.brain;
    await brain.initialize();
    app = await mod.buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    mod.setupRealtime(app.server);

    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    try { brain?.shutdown(); } catch { /* best effort */ }
    cleanupTestDb(dbPath);
  });

  it('accepts a connection with no token (backward compatible)', async () => {
    const socket = connectClient(baseUrl);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);
  });
});
