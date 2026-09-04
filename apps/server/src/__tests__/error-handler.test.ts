/**
 * The application error handler.
 *
 * Fastify 5 installs none of its own, so an uncaught throw fell through to the
 * framework's fallback serializer, which returns `error.message` and
 * `error.code` for a 500 as readily as for a 400. That is how a duplicate
 * POST /api/connections answered with
 * "UNIQUE constraint failed: memory_connections.source_id, ..." — the caller
 * learned the table, the columns and the storage engine from an error they
 * triggered on purpose.
 *
 * Driven against a bare Fastify instance rather than the real app: a 500 has
 * to be provoked deliberately, and every route that used to produce one has
 * since been given a proper status code.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { installErrorHandler } from '../lib/errorHandler.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function buildThrowingApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  installErrorHandler(instance);

  instance.get('/boom', async () => {
    const err = new Error('UNIQUE constraint failed: memory_connections.source_id, memory_connections.target_id');
    (err as Error & { code?: string }).code = 'SQLITE_CONSTRAINT_UNIQUE';
    throw err;
  });

  instance.get('/path-leak', async () => {
    throw new Error('ENOENT: no such file or directory, open \'/home/someone/.engram/engram.db.index\'');
  });

  instance.get('/conflict', async () => {
    const err = new Error("Operation 'index-rebuild' is already in progress.");
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  });

  instance.post('/validated', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
    handler: async () => ({ ok: true }),
  });

  await instance.ready();
  return instance;
}

describe('5xx responses', () => {
  it('does not return the SQL constraint text', async () => {
    app = await buildThrowingApp();
    const res = await app.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('UNIQUE constraint');
    expect(res.body).not.toContain('memory_connections');
    expect(res.body).not.toContain('SQLITE_CONSTRAINT_UNIQUE');
    expect(res.json().error).toBe('Internal Server Error');
  });

  it('does not return a filesystem path', async () => {
    app = await buildThrowingApp();
    const res = await app.inject({ method: 'GET', url: '/path-leak' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('/home/someone');
    expect(res.body).not.toContain('ENOENT');
  });
});

describe('4xx responses keep their message', () => {
  it('passes a declared 4xx status and message through', async () => {
    app = await buildThrowingApp();
    const res = await app.inject({ method: 'GET', url: '/conflict' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
    // The caller needs to know WHY, and this message describes their own
    // request rather than anything internal.
    expect(res.json().message).toMatch(/already in progress/);
  });

  it('keeps schema validation messages, which name the offending field', async () => {
    app = await buildThrowingApp();
    const res = await app.inject({ method: 'POST', url: '/validated', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/name/);
  });
});
