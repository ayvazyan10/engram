/**
 * Coverage for PUT /api/decay/policy.
 *
 * The body schema used to accept anything: no `additionalProperties: false`,
 * `batchSize` typed as `number` rather than `integer`, and the whole body
 * cast straight to Partial<DecayPolicyConfig>. Three payloads a browser could
 * post disabled decay protection or broke the engine outright:
 *
 *   {"protectionRules": []}            -> 200, every default rule gone, so the
 *                                        next sweep archived memories the user
 *                                        had tagged `pinned` / `protected`
 *   {"protectionRules": [{"name":"x"}]} -> 200, then every sweep threw
 *                                        "rule.predicate is not a function"
 *   {"batchSize": 1.5}                 -> 200, then every sweep threw
 *                                        SQLITE_MISMATCH from the LIMIT clause
 *
 * A JSON body can never carry the `predicate` function a protection rule
 * needs, so the key is rejected outright rather than validated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-server-decay-policy-${Date.now()}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  try { brain?.shutdown(); } catch { /* best effort */ }
  cleanupTestDb(dbPath);
});

function putPolicy(payload: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: '/api/decay/policy', payload });
}

function getPolicy() {
  return app.inject({ method: 'GET', url: '/api/decay/policy' });
}

/** The sweep must still run after every rejected update. */
async function expectSweepStillWorks(): Promise<void> {
  const res = await app.inject({ method: 'POST', url: '/api/decay', payload: { dryRun: true } });
  expect(res.statusCode).toBe(200);
}

describe('PUT /api/decay/policy — protectionRules', () => {
  it('rejects an empty protectionRules array and keeps the default rules', async () => {
    const res = await putPolicy({ protectionRules: [] });
    expect(res.statusCode).toBe(400);

    const after = await getPolicy();
    expect(after.json().protectionRuleCount).toBe(5);
  });

  it('rejects a rule with no predicate and leaves the sweep runnable', async () => {
    const res = await putPolicy({ protectionRules: [{ name: 'x' }] });
    expect(res.statusCode).toBe(400);

    const after = await getPolicy();
    expect(after.json().protectionRuleCount).toBe(5);
    await expectSweepStillWorks();
  });

  it('explains why protectionRules cannot be set over HTTP', async () => {
    const res = await putPolicy({ protectionRules: [{ name: 'x', predicate: 'nope' }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/protectionRules/i);
  });
});

describe('PUT /api/decay/policy — numeric bounds', () => {
  it('rejects a fractional batchSize and leaves the sweep runnable', async () => {
    const res = await putPolicy({ batchSize: 1.5 });
    expect(res.statusCode).toBe(400);

    const after = await getPolicy();
    expect(after.json().batchSize).toBe(200);
    await expectSweepStillWorks();
  });

  it('rejects a batchSize below 1', async () => {
    expect((await putPolicy({ batchSize: 0 })).statusCode).toBe(400);
  });

  it('rejects an absurdly large batchSize', async () => {
    expect((await putPolicy({ batchSize: 10_000_000 })).statusCode).toBe(400);
  });

  it('rejects an out-of-range archiveThreshold', async () => {
    expect((await putPolicy({ archiveThreshold: 5 })).statusCode).toBe(400);
  });

  it('rejects a negative decayIntervalMs', async () => {
    expect((await putPolicy({ decayIntervalMs: -1 })).statusCode).toBe(400);
  });

  it('rejects a fractional consolidation.minClusterSize', async () => {
    expect((await putPolicy({ consolidation: { minClusterSize: 2.5 } })).statusCode).toBe(400);
  });

  // The core validation is the backstop for anything the route schema lets
  // through — here a minEpisodicAgeMs past Number.MAX_SAFE_INTEGER. It must
  // surface as a 400 carrying its own message, never as a 500.
  it('turns a core-level policy rejection into a 400, not a 500', async () => {
    const res = await putPolicy({ consolidation: { minEpisodicAgeMs: 1e18 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid decay policy: consolidation\.minEpisodicAgeMs/);
    await expectSweepStillWorks();
  });
});

describe('PUT /api/decay/policy — accepted updates', () => {
  it('never forwards an unknown key to the live policy', async () => {
    const res = await putPolicy({ halfLifeDays: 10, somethingElse: 'ignored' });
    expect(res.statusCode).toBe(200);
    expect(res.json().halfLifeDays).toBe(10);
    expect(brain.getDecayPolicy()).not.toHaveProperty('somethingElse');
  });

  it('applies a valid update', async () => {
    const res = await putPolicy({ batchSize: 50, archiveThreshold: 0.2 });
    expect(res.statusCode).toBe(200);
    expect(res.json().batchSize).toBe(50);
    expect(res.json().archiveThreshold).toBe(0.2);
    expect(res.json().protectionRuleCount).toBe(5);
    await expectSweepStillWorks();
  });
});
