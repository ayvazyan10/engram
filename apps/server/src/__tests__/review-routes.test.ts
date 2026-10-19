import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, schema } from '../../../../packages/core/src/db/index.ts';
import { tiersFor } from '../security/rateLimit.js';

vi.mock('@engram-ai-memory/core', () => import('../../../../packages/core/src/index.ts'));
vi.mock('../../../../packages/core/src/embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../packages/core/src/embedding/Embedder.ts')>(),
  embed: vi.fn(async () => new Float32Array(384).fill(0.5)),
}));
const directory = mkdtempSync(join(tmpdir(), 'engram-review-'));
let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];
let buildApp: typeof import('../index.js')['buildApp'];
const headers = { 'x-api-key': 'review-test-key' };
const secret = 'ghp_AbCdEf0123456789AbCdEf0123456789AbCdEf12';
const aiSecret = 'sk-ant-api03-S3cretAbCdEf0123456789Qwerty';
const now = '2026-10-01T00:00:00.000Z';

beforeAll(async () => {
  vi.stubEnv('ENGRAM_DB_PATH', join(directory, 'test.db'));
  vi.stubEnv('ENGRAM_SYNC_URL', '');
  vi.stubEnv('ENGRAM_DECAY_INTERVAL', '0');
  vi.stubEnv('ENGRAM_API_KEY', 'review-test-key');
  vi.stubEnv('ENGRAM_NAMESPACE_MODE', 'none');
  vi.stubEnv('ENGRAM_NAMESPACE', '');
  ({ brain, buildApp } = await import('../index.js'));
  await brain.initialize();
});
beforeEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  const db = getDb();
  db.delete(schema.memoryConnections).run();
  db.delete(schema.memories).run();
  db.delete(schema.localMeta).where(eq(schema.localMeta.key, 'review.dismissed.v1')).run();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function memory(id: string, values: Partial<typeof schema.memories.$inferInsert> = {}) {
  getDb().insert(schema.memories).values({ id, content: 'shared words first', type: 'episodic', importance: 0.7, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: now, ...values }).run();
}
function edge(id: string, sourceId: string, targetId: string, values: Partial<typeof schema.memoryConnections.$inferInsert> = {}) {
  getDb().insert(schema.memoryConnections).values({ id, sourceId, targetId, relationship: 'relates_to', strength: 0.95, ...values }).run();
}
function get(url: string) { return app.inject({ method: 'GET', url, headers }); }
function post(url: string, payload: unknown) { return app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) }); }

describe('Review API', () => {
  it('returns all queue shapes, counts, stable fingerprints and pages', async () => {
    memory('a', { content: `shared ${secret}`, concept: aiSecret, summary: `token=${secret}` });
    memory('b', { content: `shared ${secret}` }); memory('c');
    edge('dup1', 'a', 'b'); edge('dup2', 'b', 'c'); edge('weak', 'a', 'c', { strength: 0.949 });
    edge('contra', 'a', 'b', { relationship: 'contradicts', strength: 0.8 });
    const summary = (await get('/api/review/summary')).json();
    expect(summary).toMatchObject({ contradictions: 1, duplicates: 2, fading: 3, secrets: 2, fingerprint: expect.any(String) });
    expect((await get('/api/review/summary')).json()).toEqual(summary);
    for (const queue of ['contradictions', 'duplicates', 'fading', 'secrets']) {
      const response = await get(`/api/review/${queue}?limit=1&offset=0`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toContain(secret); expect(response.body).not.toContain(aiSecret);
      expect(response.json().items).toHaveLength(1);
      expect(response.json().total).toBe(summary[queue]);
      expect((await get(`/api/review/${queue}?offset=100`)).json()).toEqual({ total: summary[queue], items: [] });
    }
    const duplicates = (await get('/api/review/duplicates')).json();
    expect(duplicates.items[0]).toMatchObject({ kind: 'pair', edgeId: 'dup1', strength: 0.95, sharedWordRatio: 1, a: { content: 'shared [REDACTED]', concept: '[REDACTED]' } });
    const secrets = (await get('/api/review/secrets')).json();
    expect(secrets.items[0]).toMatchObject({ kind: 'single', reason: 'possible-secret', retention: expect.any(Number), findings: expect.arrayContaining([expect.objectContaining({ rule: 'github-token', field: 'content', start: 7, end: 7 + secret.length, length: secret.length, preview: expect.stringContaining('****') })]) });
    expect((await get('/api/review/duplicates?limit=1&offset=1')).json().items[0].edgeId).toBe('dup2');
  });

  it('excludes archived ends, deleted edges, protected and unimportant memories', async () => {
    memory('a'); memory('b', { archivedAt: now }); memory('pinned', { tags: '["pinned"]' });
    memory('recent', { lastAccessedAt: new Date().toISOString() }); memory('low', { importance: 0.59 });
    edge('archived', 'a', 'b'); edge('deleted', 'a', 'pinned', { deletedAt: now });
    edge('archived-contra', 'a', 'b', { relationship: 'contradicts' });
    expect((await get('/api/review/summary')).json()).toMatchObject({ contradictions: 0, duplicates: 0, fading: 1 });
    expect((await get('/api/review/fading')).json().items[0].memory.id).toBe('a');
    const policy = brain.getDecayPolicy();
    vi.spyOn(brain, 'getDecayPolicy').mockReturnValue({ ...policy, archiveThreshold: 0 });
    expect((await get('/api/review/fading')).json().total).toBe(0);
  });

  it('applies namespace/global and brain scope to both pair ends and all queues', async () => {
    for (const [prefix, namespace] of [['a', 'alpha'], ['b', 'beta'], ['g', null]] as const) {
      memory(`${prefix}1`, { namespace, content: secret }); memory(`${prefix}2`, { namespace, content: secret });
      edge(`${prefix}d`, `${prefix}1`, `${prefix}2`);
      edge(`${prefix}c`, `${prefix}1`, `${prefix}2`, { relationship: 'contradicts' });
    }
    edge('cross', 'a1', 'b1'); edge('cross-c', 'a1', 'b1', { relationship: 'contradicts' });
    for (const query of ['namespace=alpha', 'global=true']) {
      const summary = (await get(`/api/review/summary?${query}`)).json();
      expect(summary).toMatchObject({ contradictions: 1, duplicates: 1, fading: 2, secrets: 2 });
      for (const queue of ['contradictions', 'duplicates', 'fading', 'secrets']) {
        expect((await get(`/api/review/${queue}?${query}`)).json().total).toBe(summary[queue]);
      }
    }
    // Use the actual brain configuration for the core contradiction predicates.
    const configured = brain as unknown as { activeNamespace: string; namespaceMode: string };
    const original = { activeNamespace: configured.activeNamespace, namespaceMode: configured.namespaceMode };
    Object.assign(configured, { activeNamespace: 'alpha', namespaceMode: 'isolated' });
    try {
      expect((await get('/api/review/summary')).json()).toMatchObject({ contradictions: 1, duplicates: 1, fading: 2, secrets: 2 });
      for (const query of ['namespace=beta', 'global=true', 'namespace=alpha&global=true']) {
        expect((await get(`/api/review/summary?${query}`)).json()).toMatchObject({ contradictions: 0, duplicates: 0, fading: 0, secrets: 0 });
      }
      expect((await post('/api/review/dismiss', { queue: 'secrets', ids: ['b1'] })).statusCode).toBe(404);
      expect((await post('/api/memory/b1/redact', {})).statusCode).toBe(404);
    } finally { Object.assign(configured, original); }
  });

  it('keeps core soft namespace visibility while REST uses exact list scope', async () => {
    memory('own', { namespace: 'alpha' }); memory('foreign', { namespace: 'beta' }); memory('global'); memory('global2');
    edge('own-global', 'own', 'global', { relationship: 'contradicts' });
    edge('global-global', 'global', 'global2', { relationship: 'contradicts' });
    edge('own-foreign', 'own', 'foreign', { relationship: 'contradicts' });
    const configured = brain as unknown as { activeNamespace: string; namespaceMode: string };
    const original = { activeNamespace: configured.activeNamespace, namespaceMode: configured.namespaceMode };
    Object.assign(configured, { activeNamespace: 'alpha', namespaceMode: 'filter' });
    try {
      expect((await brain.getContradictions()).map((c) => c.edge.id)).toEqual(['global-global', 'own-global']);
      expect((await brain.getContradictions('alpha')).map((c) => c.edge.id)).toEqual(['own-global']);
      expect((await brain.getContradictions(undefined, 1, 1)).map((c) => c.edge.id)).toEqual(['own-global']);
      expect((await get('/api/review/contradictions')).json()).toEqual({ total: 0, items: [] });
      expect((await get('/api/contradictions')).json()).toEqual({ total: 0, count: 0, contradictions: [] });
    } finally { Object.assign(configured, original); }
  });

  it('never returns planted token, password, tunnel or private-key values in Review bodies', async () => {
    const payload = 'AbCdEf0123456789AbCdEf0123456789AbCdEf12';
    const planted = [
      secret, aiSecret, `glpat-${payload}`, 'AKIA1234567890ABCDEF', `cfat_${payload}`,
      `xoxb-${payload}`, `sk_live_${payload}`, `eyJ${payload}.${payload}.${payload}`,
      Buffer.from(JSON.stringify({ a: payload, t: payload, s: payload })).toString('base64'),
      `-----BEGIN PRIVATE KEY-----\n${payload}\n-----END PRIVATE KEY-----`,
    ];
    const password = 'SuperSecret456!';
    memory('all-secrets', { content: planted.join('\n') + `\npassword="${password}"`, concept: secret, summary: aiSecret });
    memory('other', { content: secret });
    edge('dup', 'all-secrets', 'other'); edge('contra', 'all-secrets', 'other', { relationship: 'contradicts' });
    for (const queue of ['summary', 'contradictions', 'duplicates', 'fading', 'secrets']) {
      const response = await get(`/api/review/${queue}`);
      expect(response.statusCode).toBe(200);
      for (const value of [...planted, password]) expect(response.body).not.toContain(value);
    }
    const result = await post('/api/memory/all-secrets/redact', {});
    expect(result.statusCode).toBe(200);
    for (const value of [...planted, password]) expect(result.body).not.toContain(value);
    const row = getDb().select().from(schema.memories).where(eq(schema.memories.id, 'all-secrets')).get()!;
    for (const value of [...planted, password]) expect(row.content).not.toContain(value);
  });

  it('persists dismissals across app recreation, content edits and pair order', async () => {
    memory('a', { content: secret }); memory('b'); edge('dup', 'a', 'b');
    const first = (await get('/api/review/summary')).json();
    for (const [queue, ids] of [['duplicates', ['b', 'a']], ['fading', ['a']], ['secrets', ['a']]] as const) {
      expect((await post('/api/review/dismiss', { queue, ids })).statusCode).toBe(204);
      expect((await post('/api/review/dismiss', { queue, ids })).statusCode).toBe(204);
    }
    await app.close(); app = await buildApp(); await app.ready();
    getDb().update(schema.memories).set({ content: `Updated ${secret}` }).where(eq(schema.memories.id, 'a')).run();
    const after = (await get('/api/review/summary')).json();
    expect(after).toMatchObject({ duplicates: 0, fading: 1, secrets: 0 });
    expect(after.fingerprint).not.toBe(first.fingerprint);
    expect(getDb().select().from(schema.localMeta).where(eq(schema.localMeta.key, 'review.dismissed.v1')).get()).toBeDefined();
  });

  it('redacts selected/all rules via normal updates and re-embeds without purging archives', async () => {
    memory('redact-memory', { content: `key ${secret}; ai ${aiSecret}`, concept: secret, summary: `Note ${secret}` });
    memory('archived-memory', { content: secret, archivedAt: now });
    const update = vi.spyOn(brain, 'updateMemory');
    const first = await post('/api/memory/redact-memory/redact', { rules: ['github-token'] });
    expect(first.statusCode, first.body).toBe(200); expect(first.json()).toEqual({ id: 'redact-memory', redacted: 3 });
    expect(first.body).not.toContain(secret); expect(first.body).not.toContain(aiSecret);
    expect(update).toHaveBeenCalledWith('redact-memory', { content: `key [REDACTED]; ai ${aiSecret}`, concept: '[REDACTED]', summary: 'Note [REDACTED]' });
    const row = getDb().select().from(schema.memories).where(eq(schema.memories.id, 'redact-memory')).get()!;
    expect(row.embedding).not.toBeNull(); expect(row.updatedAt).not.toBe(now); expect(row.deviceId).toBeTruthy();
    const second = await post('/api/memory/redact-memory/redact', {});
    expect(second.json()).toEqual({ id: 'redact-memory', redacted: 1 });
    expect((await get('/api/review/secrets')).json().total).toBe(0);
    expect((await post('/api/memory/redact-memory/redact', {})).statusCode).toBe(409);
    for (const id of ['missing', 'archived-memory', 'redact-m']) expect((await post(`/api/memory/${id}/redact`, {})).statusCode).toBe(404);
    expect(getDb().select().from(schema.memories).where(eq(schema.memories.id, 'archived-memory')).get()!.content).toBe(secret);
  });

  it('does not return a secret on update errors or modify memory after a failed update', async () => {
    memory('failed-redact', { content: secret });
    const update = vi.spyOn(brain, 'updateMemory').mockRejectedValue(new Error(`Embedding failed for ${secret}`));
    const response = await post('/api/memory/failed-redact/redact', {});
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(secret);
    expect(getDb().select().from(schema.memories).where(eq(schema.memories.id, 'failed-redact')).get()!.content).toBe(secret);
    update.mockRejectedValueOnce(new Error('Memory not found: failed-redact'));
    const missing = await post('/api/memory/failed-redact/redact', {});
    expect(missing.statusCode).toBe(404); expect(missing.body).not.toContain(secret);
  });

  it('pages contradictions with SQL totals and consistent project filters', async () => {
    memory('a', { namespace: 'alpha' }); memory('b', { namespace: 'alpha' }); memory('c');
    edge('c1', 'a', 'b', { relationship: 'contradicts' }); edge('c2', 'a', 'c', { relationship: 'contradicts' });
    expect((await get('/api/contradictions?limit=1&offset=1')).json()).toMatchObject({ count: 1, total: 2, contradictions: [{ edgeId: 'c2' }] });
    expect((await get('/api/contradictions?offset=10')).json()).toEqual({ count: 0, total: 2, contradictions: [] });
    expect((await get('/api/contradictions?namespace=alpha')).json()).toMatchObject({ count: 1, total: 1 });
    expect((await get('/api/contradictions?global=true')).json()).toMatchObject({ count: 0, total: 0 });
  });

  it('enforces auth, strict inputs, unknown queues and rate tiers', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/review/summary' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/memory/a/redact', payload: {} })).statusCode).toBe(401);
    expect((await get('/api/review/nope')).statusCode).toBe(404);
    for (const query of ['limit=0', 'limit=201', 'offset=-1', 'global=false', 'typo=x', 'namespace=a&namespace=b']) {
      expect((await get(`/api/review/secrets?${query}`)).statusCode).toBe(400);
    }
    expect((await get('/api/review/summary?limit=1')).statusCode).toBe(400);
    for (const payload of [[], { queue: 'contradictions', ids: ['a'] }, { queue: 'fading', ids: 'a' }, { queue: 'fading', ids: [] }, { queue: 'fading', ids: ['a', 'b'] }, { queue: 'duplicates', ids: ['a'] }, { queue: 'duplicates', ids: ['a', 'a'] }, { queue: 'secrets', ids: ['a'], extra: true }]) {
      expect((await post('/api/review/dismiss', payload)).statusCode).toBe(400);
    }
    expect((await post('/api/review/dismiss', { queue: 'secrets', ids: ['missing'] })).statusCode).toBe(404);
    for (const payload of [[], { rules: 'github-token' }, { rules: ['unknown'] }, { unknown: true }]) {
      expect((await post('/api/memory/a/redact', payload)).statusCode).toBe(400);
    }
    expect(tiersFor('GET', '/api/review/summary')).toContain('whole-store');
    expect(tiersFor('GET', '/api/review/:queue')).toContain('whole-store');
    expect(tiersFor('POST', '/api/memory/:id/redact')).toContain('heavy');
    expect(tiersFor('POST', '/api/review/dismiss')).toEqual(['global']);
  });
});
