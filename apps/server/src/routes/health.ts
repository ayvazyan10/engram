import type { FastifyPluginAsync } from 'fastify';
import type { DecayPolicyConfig } from '@engram/core';
import { brain } from '../index.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
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
      version: '0.1.0',
      uptime: process.uptime(),
    }),
  });

  app.get('/stats', {
    schema: {
      tags: ['health'],
      summary: 'Brain memory statistics',
    },
    handler: async () => brain.stats(),
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
      const results = await brain.consolidate(minClusterSize, threshold);
      return {
        consolidated: results.length,
        memories: results.map((m) => ({ id: m.id, concept: m.concept, content: m.content?.slice(0, 200) })),
      };
    },
  });

  // ─── Decay & Garbage Collection ──────────────────────────────────────────

  app.post('/decay', {
    schema: {
      tags: ['health'],
      summary: 'Run a memory decay sweep',
      body: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (req) => {
      const { dryRun } = (req.body as { dryRun?: boolean }) ?? {};
      return brain.runDecaySweep(dryRun ?? false);
    },
  });

  app.get('/decay/policy', {
    schema: {
      tags: ['health'],
      summary: 'Get the current decay policy',
    },
    handler: async () => {
      const policy = brain.getDecayPolicy();
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
    },
  });

  app.put('/decay/policy', {
    schema: {
      tags: ['health'],
      summary: 'Update the decay policy',
      body: {
        type: 'object',
        properties: {
          halfLifeDays: { type: 'number', minimum: 1 },
          archiveThreshold: { type: 'number', minimum: 0, maximum: 1 },
          decayIntervalMs: { type: 'number', minimum: 0 },
          batchSize: { type: 'number', minimum: 1 },
          importanceDecayRate: { type: 'number', minimum: 0, maximum: 1 },
          importanceFloor: { type: 'number', minimum: 0, maximum: 1 },
          consolidation: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              minClusterSize: { type: 'number', minimum: 2 },
              similarityThreshold: { type: 'number', minimum: 0, maximum: 1 },
              minEpisodicAgeMs: { type: 'number', minimum: 0 },
            },
          },
        },
      },
    },
    handler: async (req) => {
      const updates = req.body as Partial<DecayPolicyConfig>;
      brain.updateDecayPolicy(updates);
      const policy = brain.getDecayPolicy();
      return {
        message: 'Decay policy updated',
        halfLifeDays: policy.halfLifeDays,
        archiveThreshold: policy.archiveThreshold,
        decayIntervalMs: policy.decayIntervalMs,
        batchSize: policy.batchSize,
        importanceDecayRate: policy.importanceDecayRate,
        importanceFloor: policy.importanceFloor,
        consolidation: policy.consolidation,
        protectionRuleCount: policy.protectionRules.length,
      };
    },
  });
};
