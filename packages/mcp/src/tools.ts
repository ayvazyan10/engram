import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeuralBrain, SyncEngine, DecayPolicyConfig } from '@engram-ai-memory/core';
import { z } from 'zod';
import { partitionByExistence, forgetReport, hasMissingIds } from './forget.js';
import { registerMemoryTools } from './memory-tools.js';
import type * as StoreModule from './store-session.ts';

// Match session-start's lazy loading of emitted CommonJS siblings.
const storeModulePath = './store-session.js';

export interface ToolContext {
  server: McpServer;
  brain: NeuralBrain;
  ensureInitialized: () => Promise<void>;
  syncEngine: Pick<SyncEngine, 'notifyWrite'> | undefined;
  clientSource: () => string;
}

type Maintenance = Pick<NeuralBrain, 'runDecaySweep' | 'reEmbed'>;

/** Register the same tools for either transport without creating a brain. */
export function registerTools(
  server: McpServer,
  brain: NeuralBrain,
  ensureInitialized: () => Promise<void>,
  syncEngine?: Pick<SyncEngine, 'notifyWrite'>,
  maintenance: Maintenance = brain,
): void {
  const clientSource = (): string =>
    process.env['ENGRAM_SOURCE'] || server.server.getClientVersion()?.name || 'mcp-client';
  const context: ToolContext = { server, brain, ensureInitialized, syncEngine, clientSource };
  registerMemoryTools(context);
  registerForget(context);
  registerListTags(context);
  registerTagMemory(context);
  registerGetContradictionTasks(context);
  registerCompleteContradictionCheck(context);
  registerGetDistillTasks(context);
  registerCompleteDistill(context);
  registerRequestReflection(context);
  registerStoreReflection(context);
  registerGetReflections(context);
  if (process.env['ENGRAM_ADMIN_TOOLS'] === '1') {
    registerMemoryStats(context);
    registerDecaySweep(context, maintenance);
    registerDecayPolicy(context);
    registerCheckContradictions(context);
    registerResolveContradiction(context);
    registerPluginList(context);
    registerWebhookSubscribe(context);
    registerWebhookList(context);
    registerIndexStatus(context);
    registerEmbeddingStatus(context);
    registerReEmbed(context, maintenance);
  }
}

function registerMemoryStats({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'memory_stats',
    'Get statistics about the current state of the AI brain memory system.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      await ensureInitialized();
      const stats = await brain.stats();
      return {
        content: [{
          type: 'text', text: JSON.stringify(stats),
        }],
      };
    }
  );
}

function registerForget({ server, brain, ensureInitialized, syncEngine }: ToolContext): void {
  server.tool(
    'forget',
    'Archive outdated or incorrect memories. Use when info is superseded, user asks to forget, or after resolving contradictions.',
    {
      ids: z.array(z.string()).describe('Memory IDs or unique prefixes (at least 8 characters) to archive'),
      reason: z.string().optional().describe('Reason for forgetting (logged only)'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ ids, reason }) => {
      await ensureInitialized();
      // Resolve first so aliases count once and missing or ambiguous ids are reported.
      const partition = partitionByExistence(brain, ids);
      for (const id of partition.existing) {
        await brain.forget(id);
      }
      if (partition.existing.length > 0) syncEngine?.notifyWrite();
      const report = forgetReport(partition, reason);
      return {
        ...(hasMissingIds(partition) ? { isError: true } : {}),
        content: [{
          type: 'text', text: JSON.stringify(report),
        }],
      };
    }
  );
}

function registerDecaySweep({ server, ensureInitialized, syncEngine }: ToolContext, maintenance: Maintenance): void {
  server.tool(
    'decay_sweep',
    'Run a memory decay sweep — evaluates all memories and archives stale ones based on the decay policy. Also triggers auto-consolidation of old episodic memories if enabled.',
    {
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, compute what would be archived without actually modifying anything'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ dryRun }) => {
      await ensureInitialized();
      const result = await maintenance.runDecaySweep(dryRun);
      if (!dryRun) syncEngine?.notifyWrite();
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            ...result,
            mode: dryRun ? 'dry-run' : 'live',
            message: dryRun
              ? `Dry run: would archive ${result.archivedCount} memories, decay ${result.decayedCount}, consolidate ${result.consolidatedCount}`
              : `Archived ${result.archivedCount} memories, decayed ${result.decayedCount}, consolidated ${result.consolidatedCount} in ${result.durationMs}ms`,
          }),
        }],
      };
    }
  );
}

function registerDecayPolicy({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'decay_policy',
    'View or update the memory decay policy configuration. Controls how aggressively memories are forgotten and when auto-consolidation runs.',
    {
      action: z.enum(['get', 'update']).describe("'get' to view current policy, 'update' to modify it"),
      halfLifeDays: z.number().min(1).optional().describe('Ebbinghaus half-life in days'),
      archiveThreshold: z.number().min(0).max(1).optional().describe('Retention score below which memories are archived'),
      importanceDecayRate: z.number().min(0).max(1).optional().describe('Daily importance reduction rate'),
      importanceFloor: z.number().min(0).max(1).optional().describe('Minimum importance after decay'),
      consolidationEnabled: z.boolean().optional().describe('Enable/disable auto-consolidation'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ action, halfLifeDays, archiveThreshold, importanceDecayRate, importanceFloor, consolidationEnabled }) => {
      await ensureInitialized();
      if (action === 'update') {
        const updates: Partial<DecayPolicyConfig> = {};
        if (halfLifeDays !== undefined) updates.halfLifeDays = halfLifeDays;
        if (archiveThreshold !== undefined) updates.archiveThreshold = archiveThreshold;
        if (importanceDecayRate !== undefined) updates.importanceDecayRate = importanceDecayRate;
        if (importanceFloor !== undefined) updates.importanceFloor = importanceFloor;
        if (consolidationEnabled !== undefined) {
          // Merge to preserve consolidation settings the caller omitted.
          updates.consolidation = {
            ...brain.getDecayPolicy().consolidation,
            enabled: consolidationEnabled,
          };
        }
        brain.updateDecayPolicy(updates);
      }
      const policy = brain.getDecayPolicy();
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            policy: {
              halfLifeDays: policy.halfLifeDays,
              archiveThreshold: policy.archiveThreshold,
              decayIntervalMs: policy.decayIntervalMs, batchSize: policy.batchSize,
              importanceDecayRate: policy.importanceDecayRate, importanceFloor: policy.importanceFloor,
              consolidation: policy.consolidation,
              protectionRuleCount: policy.protectionRules.length,
            },
            message: action === 'update' ? 'Policy updated' : 'Current policy',
          }),
        }],
      };
    }
  );
}

function registerCheckContradictions({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'check_contradictions',
    'Check a memory for contradictions with existing memories, or list all unresolved contradictions.',
    {
      memoryId: z.string().optional().describe('Memory ID to check. If omitted, lists all unresolved contradictions.'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ memoryId }) => {
      await ensureInitialized();
      if (memoryId) {
        const result = await brain.checkContradictions(memoryId);
        return {
          content: [{
            type: 'text', text: JSON.stringify({
              ...result,
              message: result.hasContradictions
                ? `Found ${result.contradictions.length} unverified possible contradiction(s) for memory ${memoryId}`
                : `No contradictions found for memory ${memoryId}`,
            }),
          }],
        };
      }
      // List all unresolved contradictions
      const contradictions = await brain.getContradictions();
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            count: contradictions.length,
            contradictions: contradictions.map((c) => ({
              confidence: c.edge.strength,
              metadata: JSON.parse(c.edge.metadata || '{}'),
              source: { id: c.source.id, content: c.source.content.slice(0, 200), type: c.source.type },
              target: { id: c.target.id, content: c.target.content.slice(0, 200), type: c.target.type },
            })),
            message: contradictions.length > 0
              ? `${contradictions.length} unresolved contradiction(s)`
              : 'No unresolved contradictions',
          }),
        }],
      };
    }
  );
}

function registerResolveContradiction({ server, brain, ensureInitialized, syncEngine }: ToolContext): void {
  server.tool(
    'resolve_contradiction',
    'Resolve a contradiction between two memories using a strategy: keep_newest (archive old), keep_oldest (archive new), keep_important (archive lower importance), keep_both (keep both, resolve edge), manual (no action).',
    {
      sourceId: z.string().describe('ID of the first memory in the contradiction'),
      targetId: z.string().describe('ID of the second memory in the contradiction'),
      strategy: z
        .enum(['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual'])
        .describe('Resolution strategy'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ sourceId, targetId, strategy }) => {
      await ensureInitialized();
      const result = await brain.resolveContradiction(sourceId, targetId, strategy);
      if (result.resolved) syncEngine?.notifyWrite();
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            ...result,
            strategy,
            message: result.resolved
              ? `Contradiction resolved via ${strategy}. Kept: ${result.keptId}, Archived: ${result.archivedId ?? 'none'}`
              : 'Contradiction not resolved (manual review or memories not found)',
          }),
        }],
      };
    }
  );
}

function registerPluginList({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'plugin_list',
    'List all registered Engram plugins with their hooks and metadata.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      await ensureInitialized();
      const plugins = brain.listPlugins();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: plugins.length,
            plugins,
            message: plugins.length > 0
              ? `${plugins.length} plugin(s) registered`
              : 'No plugins registered',
          }),
        }],
      };
    }
  );
}

function registerListTags({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'list_tags',
    'Get all tags with memory counts (tag cloud), or get memories for a specific tag.',
    {
      tag: z.string().optional().describe('If provided, returns memories with this tag. If omitted, returns the tag cloud.'),
      limit: z.number().min(1).max(200).optional().default(50).describe('Max memories to return when filtering by tag.'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ tag, limit }) => {
      await ensureInitialized();
      if (tag) {
        const memories = await brain.getByTag(tag, limit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tag,
              count: memories.length,
              memories: memories.map((m) => ({
                id: m.id, type: m.type, content: m.content.slice(0, 200),
                importance: m.importance, source: m.source,
              })),
            }),
          }],
        };
      }
      const tags = await brain.getTags();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: tags.length,
            tags,
            message: `${tags.length} unique tags across all memories`,
          }),
        }],
      };
    }
  );
}

function registerTagMemory({ server, brain, ensureInitialized, syncEngine }: ToolContext): void {
  server.tool(
    'tag_memory',
    'Add or remove a tag on a memory.',
    {
      memoryId: z.string().describe('Memory ID to tag/untag'),
      tag: z.string().describe('Tag string to add or remove'),
      action: z.enum(['add', 'remove']).default('add').describe('Whether to add or remove the tag'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ memoryId, tag, action }) => {
      await ensureInitialized();
      const tags = action === 'add'
        ? await brain.addTag(memoryId, tag)
        : await brain.removeTag(memoryId, tag);
      syncEngine?.notifyWrite();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: memoryId,
            tags,
            message: action === 'add' ? `Tag "${tag}" added` : `Tag "${tag}" removed`,
          }),
        }],
      };
    }
  );
}

function registerWebhookSubscribe({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'webhook_subscribe',
    'Subscribe a URL to receive HTTP callbacks when memory events occur. Events: stored, forgotten, decayed, consolidated, contradiction, reflected.',
    {
      url: z.string().url().describe('The HTTP(S) URL to receive webhook POST requests'),
      events: z.array(z.enum(['stored', 'forgotten', 'decayed', 'consolidated', 'contradiction', 'reflected'])).describe('Events to subscribe to'),
      secret: z.string().optional().describe('Shared secret for HMAC-SHA256 signature verification'),
      description: z.string().optional().describe('Human-readable description of this webhook'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ url, events, secret, description }) => {
      await ensureInitialized();
      const hook = await brain.getWebhookManager().subscribe({ url, events, secret, description });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...hook, message: `Webhook subscribed: ${hook.id}` }) }],
      };
    }
  );
}

function registerWebhookList({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'webhook_list',
    'List all webhook subscriptions.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      await ensureInitialized();
      const hooks = await brain.getWebhookManager().list();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: hooks.length,
            webhooks: hooks.map((h) => ({
              id: h.id,
              url: h.url,
              events: h.events,
              active: h.active,
              failCount: h.failCount,
              description: h.description,
            })),
          }),
        }],
      };
    }
  );
}

function registerIndexStatus({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'index_status',
    'Get the vector index status — how it was loaded (disk cache or full rebuild), entry count, and persistence info.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      await ensureInitialized();
      // Reconcile first, so this reports the index as it stands rather than as it
      // was loaded — several engram processes share one database.
      await brain.syncIndexFromStore();
      const status = brain.getIndexStatus();
      const origin = status.loadedFrom === 'disk'
        ? `Index loaded from disk cache (${status.incrementalCount} added incrementally, ${status.initDurationMs}ms)`
        : `Index built from database (${status.initDurationMs}ms)`;
      const synced = status.externalSyncCount > 0
        ? `; ${status.externalAdded} added and ${status.externalRemoved} dropped across ${status.externalSyncCount} sync(s) with other processes`
        : '';
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            ...status,
            message: `${status.entryCount} entries. ${origin}${synced}`,
          }),
        }],
      };
    }
  );
}

function registerEmbeddingStatus({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'embedding_status',
    'Get the status of the embedding model — shows current model, dimension, and how many memories need re-embedding.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      await ensureInitialized();
      const status = await brain.embeddingStatus();
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            ...status,
            message: status.needsReEmbed
              ? `${status.staleCount + status.legacyCount} memories need re-embedding (${status.staleCount} stale, ${status.legacyCount} legacy)`
              : `All ${status.totalEmbedded} memories are up-to-date with model ${status.currentModel}`,
          }),
        }],
      };
    }
  );
}

function registerReEmbed({ server, brain, ensureInitialized, syncEngine }: ToolContext, maintenance: Maintenance): void {
  server.tool(
    're_embed',
    'Re-embed memories with the current embedding model. Use after switching models to update stale vectors. Can be slow for large stores.',
    {
      onlyStale: z.boolean().optional().default(true).describe('If true, only re-embed memories with a different or missing model ID. Default: true.'),
      batchSize: z.number().min(1).max(100).optional().default(32).describe('Batch size for processing. Default: 32.'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ onlyStale, batchSize }) => {
      await ensureInitialized();
      const result = await maintenance.reEmbed(onlyStale, batchSize);
      if (result.processed > 0) syncEngine?.notifyWrite();
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            ...result,
            model: brain.getEmbeddingModel(),
            message: result.failed > 0
              ? `Re-embedded ${result.processed} memories (${result.failed} failed) in ${result.durationMs}ms`
              : `Re-embedded ${result.processed} memories in ${result.durationMs}ms`,
          }),
        }],
      };
    }
  );
}

function registerGetContradictionTasks({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'get_contradiction_tasks',
    'Get unverified possible contradictions with memory excerpts. Similarity and heuristic signals are not proof of a conflict.',
    { limit: z.number().int().min(1).max(100).optional().default(20) },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ limit }) => {
      try {
        await ensureInitialized();
        const tasks = await brain.getContradictionTasks(limit);
        return {
          content: [{
            type: 'text' as const, text: JSON.stringify({
              tasks: tasks.map((task) => ({
                ...task,
                source: { ...task.source, content: task.source.content.slice(0, 500), truncated: task.source.content.length > 500 },
                target: { ...task.target, content: task.target.content.slice(0, 500), truncated: task.target.content.length > 500 },
              }))
            })
          }]
        };
      } catch (err: unknown) {
        console.error('[engram-mcp] get_contradiction_tasks failed:', err);
        throw err;
      }
    }
  );
}

function registerCompleteContradictionCheck({ server, brain, ensureInitialized, syncEngine }: ToolContext): void {
  server.tool(
    'complete_contradiction_check',
    'Record a judgment of a candidate: none permanently dismisses it; contradiction confirms it. An optional strategy also resolves it. keep_newest archives the older memory and applies when the newer memory fully replaces it.',
    {
      sourceId: z.string().min(1), targetId: z.string().min(1),
      verdict: z.enum(['contradiction', 'none']),
      strategy: z.enum(['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual']).optional(),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ sourceId, targetId, verdict, strategy }) => {
      try {
        await ensureInitialized();
        if (verdict === 'none' && strategy) throw new Error('strategy requires verdict contradiction');
        await brain.completeContradictionCheck(sourceId, targetId, verdict);
        syncEngine?.notifyWrite();
        const resolution = strategy ? await brain.resolveContradiction(sourceId, targetId, strategy) : undefined;
        if (resolution?.resolved) syncEngine?.notifyWrite();
        return { content: [{ type: 'text' as const, text: JSON.stringify({ sourceId, targetId, verdict, resolution }) }] };
      } catch (err: unknown) {
        console.error('[engram-mcp] complete_contradiction_check failed:', err);
        throw err;
      }
    }
  );
}

function registerGetDistillTasks({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'get_distill_tasks',
    'Get pending raw sessions for extracting durable facts, preferences, decisions, and workflows. Session content is limited to 6000 characters.',
    {
      limit: z.number().int().min(1).max(100).optional().default(20).describe('Maximum number of pending sessions to return'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ limit }) => {
      try {
        await ensureInitialized();
        const { getPendingDistillSessions }: typeof StoreModule = await import(storeModulePath);
        const sessions = (await getPendingDistillSessions(brain)).slice(0, limit);
        const tasks = sessions.map((session) => ({
          id: session.id, date: session.createdAt, namespace: session.namespace,
          content: session.content.slice(0, 6000),
        }));
        return {
          content: [{
            type: 'text' as const, text: tasks.length === 0
              ? 'No pending sessions to distill.'
              : `${tasks.length} distillation task(s). complete_distill accepts { id, facts }; facts: [] archives a session without retaining facts. global: true is only for facts about the user that hold in every project.\n\n${JSON.stringify(tasks, null, 2)}`,
          }]
        };
      } catch (err: unknown) {
        console.error('[engram-mcp] get_distill_tasks failed:', err);
        throw err;
      }
    }
  );
}

function registerCompleteDistill({ server, brain, ensureInitialized, syncEngine, clientSource }: ToolContext): void {
  server.tool(
    'complete_distill',
    'Store facts extracted from a pending session, then archive the raw session after all facts are stored. An empty facts array archives without retaining facts. On failure the session stays pending; stored facts may be reused by deduplication on retry.',
    {
      id: z.string().min(1).describe('Full raw session memory ID from get_distill_tasks'),
      facts: z.array(z.object({
        content: z.string().trim().min(1).describe('The durable fact to store'),
        type: z.enum(['episodic', 'semantic', 'procedural']).optional().default('semantic'),
        importance: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        global: z.boolean().optional().describe('true only for facts about the user that hold in every project.'),
      })).max(100).describe('Extracted facts; at most 100, or [] when nothing is worth retaining'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ id, facts }) => {
      try {
        await ensureInitialized();
        const { getPendingDistillSessions }: typeof StoreModule = await import(storeModulePath);
        const session = (await getPendingDistillSessions(brain)).find((memory) => memory.id === id);
        if (!session) throw new Error('Pending session not found in your scope');
        const storedIds: string[] = [];
        // Report policy-discarded facts and carry on so the session can finish.
        const discardedIds: string[] = [];
        for (const { global, ...fact } of facts) {
          const result = await brain.store({ ...fact, source: clientSource(), namespace: global ? null : session.namespace ?? undefined });
          syncEngine?.notifyWrite();
          if (result.memory.id === id) {
            throw new Error('Fact was not retained separately from the raw session; session remains pending');
          }
          (result.discarded ? discardedIds : storedIds).push(result.memory.id);
        }
        await brain.forget(id);
        syncEngine?.notifyWrite();
        return {
          content: [{
            type: 'text' as const, text: JSON.stringify({
              id, storedIds, discardedIds, archived: true, message: 'Facts stored and raw session archived',
            })
          }]
        };
      } catch (err: unknown) {
        console.error('[engram-mcp] complete_distill failed:', err);
        throw err;
      }
    }
  );
}

function registerRequestReflection({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'request_reflection',
    'Get prompts for reasoning over memory patterns, knowledge gaps, trends, and contradictions. Engram selects and summarizes relevant memories for each reflection type.',
    {},
    async () => {
      await ensureInitialized();
      const tasks = await brain.getReflectionTasks();
      if (tasks.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Not enough qualifying memories to reflect on yet (need at least 3).' }],
        };
      }
      const payload = tasks.map((t) => ({
        type: t.type,
        relatedMemoryIds: t.relatedMemoryIds,
        prompt: t.prompt,
      }));
      return {
        content: [{
          type: 'text' as const,
          text: `${tasks.length} reflection task(s). store_reflection accepts { type, insight, relatedMemoryIds } for insights supported by these memories.\n\n${JSON.stringify(payload, null, 2)}`,
        }],
      };
    }
  );
}

function registerStoreReflection({ server, brain, ensureInitialized, syncEngine }: ToolContext): void {
  server.tool(
    'store_reflection',
    'Store an insight generated from a reflection task as a semantic memory tagged reflection:<type>. Confidence (0-1) describes support from the memories. Empty or NO_INSIGHT results are not stored.',
    {
      type: z.enum(['pattern', 'knowledge_gap', 'trend', 'contradiction_summary']).describe('The reflection type this insight answers'),
      insight: z.string().min(1).describe('The insight text (1-3 concise sentences)'),
      relatedMemoryIds: z.array(z.string()).optional().default([]).describe('IDs of the memories this insight is drawn from (from the task)'),
      confidence: z.number().min(0).max(1).optional().describe('How strongly the memories support this insight (0-1)'),
    },
    async ({ type, insight, relatedMemoryIds, confidence }) => {
      await ensureInitialized();
      const stored = await brain.storeReflection({ type, insight, relatedMemoryIds, confidence });
      if (!stored) {
        return {
          content: [{ type: 'text' as const, text: 'Insight was empty or marked NO_INSIGHT — nothing stored.' }],
        };
      }
      syncEngine?.notifyWrite();
      return {
        content: [{ type: 'text' as const, text: `Stored ${type} reflection (${stored.id}).` }],
      };
    }
  );
}

function registerGetReflections({ server, brain, ensureInitialized }: ToolContext): void {
  server.tool(
    'get_reflections',
    'Retrieve stored reflection insights — patterns, knowledge gaps, trends, and contradiction summaries generated by the reflection engine.',
    {
      limit: z.number().int().min(1).max(100).optional().default(20).describe('Maximum number of reflections to return'),
      type: z.enum(['pattern', 'knowledge_gap', 'trend', 'contradiction_summary']).optional().describe('Filter by reflection type'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ limit, type }) => {
      await ensureInitialized();
      // Type filtering happens in SQL so LIMIT applies after it. Filtering the
      // already-limited rows in memory could return nothing while matching
      // reflections existed just past the limit.
      const filtered = await brain.getReflections(limit, type);
      if (filtered.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No reflection insights found.' }],
        };
      }
      const text = filtered
        .map((m) => {
          const meta = JSON.parse(m.metadata ?? '{}');
          return `[${meta.reflectionType ?? 'unknown'}] ${m.content}`;
        })
        .join('\n\n');
      return {
        content: [{ type: 'text' as const, text: `${filtered.length} reflections:\n\n${text}` }],
      };
    }
  );
}
