/**
 * Regression: GET /api/sessions must not hide pre-upgrade sessions.
 *
 * `sessions.namespace` arrived in v0.4.0, so every row written before the
 * upgrade carries NULL. The listing filtered on equality alone, so turning on
 * `filter` mode — soft, optional scoping — made a user's entire session history
 * disappear. Isolated mode is a hard boundary and still excludes them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb, schema } from '@engram-ai-memory/core';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(os.tmpdir(), `engram-ns-sessions-test-${process.pid}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  process.env['ENGRAM_NAMESPACE_MODE'] = 'filter';
  process.env['ENGRAM_NAMESPACE'] = 'project-a';

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  try { brain?.shutdown(); } catch { /* best effort */ }
  delete process.env['ENGRAM_NAMESPACE_MODE'];
  delete process.env['ENGRAM_NAMESPACE'];
  for (const suffix of ['', '-shm', '-wal', '-journal', '.index']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
  for (const file of fs.readdirSync(os.tmpdir())) {
    if (file.startsWith(path.basename(dbPath) + '.index')) {
      try { fs.unlinkSync(path.join(os.tmpdir(), file)); } catch {}
    }
  }
});

describe('GET /api/sessions in filter mode', () => {
  it('lists namespaced sessions alongside pre-upgrade ones', async () => {
    // Written the way v0.3.x wrote them: no namespace column value.
    await getDb().insert(schema.sessions).values({
      id: 'legacy-session',
      source: 'claude-code',
      context: null,
      namespace: null,
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { source: 'rest-api' },
    });
    expect(created.statusCode).toBe(201);
    const scoped = created.json().sessionId ?? created.json().id;

    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);

    const ids = res.json().map((session: { id: string }) => session.id);
    expect(ids).toContain(scoped);
    expect(ids).toContain('legacy-session');
  });

  it('hides sessions belonging to another namespace', async () => {
    await getDb().insert(schema.sessions).values({
      id: 'foreign-session',
      source: 'claude-code',
      context: null,
      namespace: 'project-b',
    });

    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    const ids = res.json().map((session: { id: string }) => session.id);
    expect(ids).not.toContain('foreign-session');
  });
});
