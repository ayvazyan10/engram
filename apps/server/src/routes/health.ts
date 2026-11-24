import type { FastifyPluginAsync } from 'fastify';
import type { DecayPolicyConfig } from '@engram-ai-memory/core';
import { homedir } from 'node:os';
import { sep } from 'node:path';
import { brain, VERSION, notifySyncWrite, realtime } from '../index.js';
import { runExclusive, OperationInProgressError } from '../lib/exclusive.js';
import { strictObjectBody } from '../lib/strictBody.js';

/**
 * The subset of the policy that is safe to hand back over HTTP.
 *
 * `protectionRules` themselves never leave the process — a rule is a name plus
 * a predicate function, and only the count means anything to a caller.
 */
function serializePolicy(policy: DecayPolicyConfig) {
  return {
    halfLifeDays: policy.halfLifeDays,
    archiveThreshold: policy.archiveThreshold,
    decayIntervalMs: policy.decayIntervalMs,
    batchSize: policy.batchSize,
    importanceDecayRate: policy.importanceDecayRate,
    importanceFloor: policy.importanceFloor,
    consolidation: policy.consolidation,
    protectionRuleCount: policy.protectionRules.length,
  };
}

/** Timer and manual routes share one guard: decay also runs consolidation. */
async function runScheduledDecaySweep(): Promise<void> {
  try {
    const result = await runExclusive('consolidate', () => brain.runDecaySweep());
    if (result.archivedCount > 0 || result.consolidatedCount > 0) {
      console.info(
        `Decay sweep: archived ${result.archivedCount}, decayed ${result.decayedCount}, consolidated ${result.consolidatedCount} (${result.durationMs}ms)`
      );
      realtime?.emit('memory:decayed', result);
    }
  } catch (err: unknown) {
    if (err instanceof OperationInProgressError) return;
    console.error('[engram] decay sweep failed, schedule continues:', err);
  }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  let decayTimer: ReturnType<typeof setInterval> | undefined;
  function rescheduleDecayTimer(): void {
    clearInterval(decayTimer);
    decayTimer = undefined;
    const { decayIntervalMs } = brain.getDecayPolicy();
    if (decayIntervalMs > 0) {
      decayTimer = setInterval(() => void runScheduledDecaySweep(), decayIntervalMs);
    }
  }
  app.addHook('onReady', async () => { rescheduleDecayTimer(); });
  app.addHook('onClose', async () => { clearInterval(decayTimer); });

  app.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
    handler: async () => ({
      status: 'ok',
      version: VERSION,
      uptime: process.uptime(),
    }),
  });

  app.get('/stats', {
    schema: {
      tags: ['health'],
      summary: 'Brain memory statistics',
    },
    handler: async () => {
      const stats = await brain.stats();
      const home = homedir();
      return {
        ...stats,
        dbPath: stats.dbPath === home || stats.dbPath.startsWith(`${home}${sep}`)
          ? `~${stats.dbPath.slice(home.length)}` : stats.dbPath,
      };
    },
  });

  app.post('/consolidate', {
    schema: {
      tags: ['health'],
      summary: 'Consolidate episodic memories into semantic summaries',
      body: {
        type: 'object',
        properties: {
          minClusterSize: { type: 'number', minimum: 2, default: 3 },
          threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.6 },
        },
      },
    },
    handler: async (req) => {
      const { minClusterSize, threshold } = (req.body as { minClusterSize?: number; threshold?: number }) ?? {};
      // Single-flight: consolidation clusters and rewrites across the whole
      // store, so two overlapping runs can consolidate the same episodes twice.
      const results = await runExclusive('consolidate', () =>
        brain.consolidate(minClusterSize, threshold)
      );
      if (results.length > 0) notifySyncWrite();
      return {
        consolidated: results.length,
        memories: results.map((m) => ({ id: m.id, concept: m.concept, content: m.content?.slice(0, 200) })),
      };
    },
  });

  // ─── Decay & Garbage Collection ──────────────────────────────────────────

  app.post<{ Body: { dryRun?: boolean } }>('/decay', {
    schema: {
      tags: ['health'],
      summary: 'Run a memory decay sweep',
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', default: false },
        },
      },
    },
    preValidation: [async (req, reply) => {
      if (req.body === undefined) req.body = {};
      if (req.body?.dryRun !== undefined && typeof req.body.dryRun !== 'boolean') {
        return reply.code(400).send({ error: 'Bad Request', message: 'dryRun must be a boolean.' });
      }
      return undefined;
    }, strictObjectBody(['dryRun'])],
    handler: async (req) => {
      const { dryRun } = req.body;
      // Decay includes consolidation, so all three entry points share a guard.
      const result = await runExclusive('consolidate', () => brain.runDecaySweep(dryRun ?? false));
      if (!dryRun && (result.archivedCount > 0 || result.decayedCount > 0 || result.consolidatedCount > 0)) {
        notifySyncWrite();
      }
      return result;
    },
  });

  app.get('/decay/policy', {
    schema: {
      tags: ['health'],
      summary: 'Get the current decay policy',
    },
    handler: async () => serializePolicy(brain.getDecayPolicy()),
  });

  app.put('/decay/policy', {
    schema: {
      tags: ['health'],
      summary: 'Update the decay policy',
      // `additionalProperties: false` matters as much as the bounds: the body
      // used to be cast straight to Partial<DecayPolicyConfig>, so any key a
      // caller invented was forwarded into the live policy. `protectionRules`
      // is deliberately absent — see the preValidation hook below.
      //
      // `batchSize` and `minClusterSize` are `integer`, not `number`: a
      // fractional batchSize reaches the sweep's SQL LIMIT clause and only
      // fails there, as SQLITE_MISMATCH on every sweep afterwards. The
      // maximums mirror the ranges DecayPolicy.mergePolicy() enforces, so an
      // out-of-range value is a 400 here rather than a 500 later.
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          halfLifeDays: { type: 'number', minimum: 1, maximum: 36500 },
          archiveThreshold: { type: 'number', minimum: 0, maximum: 1 },
          // Zero disables the timer; enabled intervals are whole milliseconds
          // of at least one second, within Node's signed 32-bit timer limit.
          decayIntervalMs: {
            type: 'integer', maximum: 2147483647,
            anyOf: [{ const: 0 }, { minimum: 1000 }],
          },
          batchSize: { type: 'integer', minimum: 1, maximum: 100000 },
          importanceDecayRate: { type: 'number', minimum: 0, maximum: 1 },
          importanceFloor: { type: 'number', minimum: 0, maximum: 1 },
          consolidation: {
            type: 'object',
            additionalProperties: false,
            properties: {
              enabled: { type: 'boolean' },
              minClusterSize: { type: 'integer', minimum: 2, maximum: 10000 },
              similarityThreshold: { type: 'number', minimum: 0, maximum: 1 },
              minEpisodicAgeMs: { type: 'number', minimum: 0 },
            },
          },
        },
      },
    },
    /**
     * Refuse `protectionRules` outright, before schema validation.
     *
     * A rule is a name plus a `predicate` function, and JSON has no way to
     * carry a function — so every value this key can possibly hold is
     * malformed. Accepting it at all was the bug: `{"protectionRules": []}`
     * replaced all five defaults with nothing and the next sweep archived
     * memories tagged `pinned`/`protected`, while `[{"name":"x"}]` made every
     * sweep throw "rule.predicate is not a function". Rules are set in
     * process, by an embedder passing `decayPolicy` to NeuralBrain.
     *
     * This runs as a hook rather than as a schema keyword because Fastify's
     * ajv is configured with `removeAdditional`, which would strip the key
     * silently and leave the caller believing the update took effect.
     */
    preValidation: async (req, reply) => {
      const body = req.body;
      if (typeof body === 'object' && body !== null && 'protectionRules' in body) {
        return reply.code(400).send({
          error:
            'protectionRules cannot be set over HTTP: a rule needs a predicate function, ' +
            'which JSON cannot express. Configure them in-process instead.',
        });
      }
      return undefined;
    },
    handler: async (req, reply) => {
      const updates = req.body as Partial<DecayPolicyConfig>;
      const previousInterval = brain.getDecayPolicy().decayIntervalMs;
      try {
        brain.updateDecayPolicy(updates);
      } catch (err: unknown) {
        // mergePolicy() rejects a policy that cannot work. Its message is
        // ours and safe to return; anything else is a genuine internal
        // failure and must not be reflected back to the caller.
        const message = err instanceof Error ? err.message : '';
        if (!message.startsWith('Invalid decay policy:')) throw err;
        return reply.code(400).send({ error: message });
      }
      if (brain.getDecayPolicy().decayIntervalMs !== previousInterval) rescheduleDecayTimer();
      return { message: 'Decay policy updated', ...serializePolicy(brain.getDecayPolicy()) };
    },
  });
};
