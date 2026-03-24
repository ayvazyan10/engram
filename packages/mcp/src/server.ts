#!/usr/bin/env node
/**
 * Engram MCP Server
 *
 * Exposes Engram brain capabilities as MCP tools for Claude Code
 * and any MCP-compatible AI client.
 *
 * Run: node dist/server.js
 * Or add to ~/.claude/settings.json:
 *   { "mcpServers": { "engram": { "command": "node", "args": ["/path/to/dist/server.js"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NeuralBrain } from '@engram/core';
import { z } from 'zod';

const brain = new NeuralBrain({
  dbPath: process.env['ENGRAM_DB_PATH'],
  defaultSource: 'claude-code',
  namespace: process.env['ENGRAM_NAMESPACE'] || undefined,
});

const server = new McpServer({
  name: 'engram',
  version: '0.1.0',
});

// ─── Tool: store_memory ───────────────────────────────────────────────────────
server.tool(
  'store_memory',
  'Store a new memory in the AI brain. Use this to remember important information, events, facts, or learned patterns.',
  {
    content: z.string().describe('The content to store as a memory'),
    type: z
      .enum(['episodic', 'semantic', 'procedural'])
      .optional()
      .default('episodic')
      .describe(
        'Memory type: episodic (events/conversations), semantic (facts/knowledge), procedural (patterns/skills)'
      ),
    source: z.string().optional().describe('Source system storing this memory'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    importance: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Importance score 0.0–1.0 (default varies by type)'),
    concept: z.string().optional().describe('For semantic memories: the concept name'),
    sessionId: z.string().optional().describe('Session ID to group related episodic memories'),
    namespace: z.string().optional().describe('Override namespace for this memory'),
  },
  async ({ content, type, source, tags, importance, concept, sessionId, namespace }) => {
    await ensureInitialized();

    const result = await brain.store({
      content,
      type,
      source: source ?? 'claude-code',
      tags,
      importance,
      concept,
      sessionId,
      namespace,
    });

    const response: Record<string, unknown> = {
      id: result.memory.id,
      type: result.memory.type,
      importance: result.memory.importance,
      message: 'Memory stored successfully',
    };

    if (result.contradictions.hasContradictions) {
      response.contradictions = {
        count: result.contradictions.contradictions.length,
        items: result.contradictions.contradictions.map((c) => ({
          existingMemoryId: c.existingMemoryId,
          confidence: c.confidence,
          signals: c.signals.map((s) => s.type),
          suggestedStrategy: c.suggestedStrategy,
        })),
      };
      response.message = `Memory stored with ${result.contradictions.contradictions.length} contradiction(s) detected`;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response),
        },
      ],
    };
  }
);

// ─── Tool: search_memory ──────────────────────────────────────────────────────
server.tool(
  'search_memory',
  'Search through stored memories using semantic similarity. Returns the most relevant memories for a query.',
  {
    query: z.string().describe('The search query'),
    topK: z.number().int().min(1).max(50).optional().default(10).describe('Number of results'),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.3)
      .describe('Minimum similarity threshold (0.0–1.0)'),
    types: z
      .array(z.enum(['episodic', 'semantic', 'procedural']))
      .optional()
      .describe('Filter by memory type'),
    crossNamespace: z.boolean().optional().default(false).describe('If true, search across all namespaces'),
  },
  async ({ query, topK, threshold, types, crossNamespace }) => {
    await ensureInitialized();

    const memories = await brain.search(query, { topK, threshold, types, crossNamespace });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            count: memories.length,
            results: memories.map((m) => ({
              id: m.id,
              type: m.type,
              content: m.content,
              summary: m.summary,
              importance: m.importance,
              source: m.source,
              createdAt: m.createdAt,
            })),
          }),
        },
      ],
    };
  }
);

// ─── Tool: recall_context ─────────────────────────────────────────────────────
server.tool(
  'recall_context',
  'Assemble the most relevant context from all memories for a given query. Returns formatted context ready to use in AI prompts. This is the primary tool for giving AI models access to their memories.',
  {
    query: z.string().describe('The query or topic to recall context for'),
    maxTokens: z
      .number()
      .int()
      .min(100)
      .max(8000)
      .optional()
      .default(2000)
      .describe('Maximum context tokens to return'),
    types: z
      .array(z.enum(['episodic', 'semantic', 'procedural']))
      .optional()
      .describe('Filter by memory types to include'),
    sources: z
      .array(z.string())
      .optional()
      .describe('Filter by source systems (e.g. ["claude-code", "ollama"])'),
    crossNamespace: z.boolean().optional().default(false).describe('If true, recall from all namespaces'),
    progressive: z.boolean().optional().default(false).describe('If true, return memories grouped by recall phase (vector, graph) with scores'),
  },
  async ({ query, maxTokens, types, sources, crossNamespace, progressive }) => {
    await ensureInitialized();

    if (progressive) {
      // Collect chunks from streaming recall
      const phases = {
        vector: [] as Array<{ id: string; type: string; score: string; source: string | null }>,
        graph: [] as Array<{ id: string; type: string; score: string; source: string | null }>,
      };
      let finalContext = '';
      let latencyMs = 0;

      for await (const chunk of brain.recallStream(query, {
        maxTokens,
        types,
        sources,
        source: 'claude-code',
        crossNamespace,
      })) {
        if (chunk.phase === 'complete' && 'context' in chunk) {
          finalContext = chunk.context;
          latencyMs = chunk.latencyMs;
        } else if ('memory' in chunk) {
          const p = chunk.phase as 'vector' | 'graph';
          phases[p]?.push({
            id: chunk.memory.id,
            type: chunk.memory.type,
            score: chunk.memory.score.toFixed(3),
            source: chunk.memory.source,
          });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              context: finalContext,
              memoriesUsed: phases.vector.length + phases.graph.length,
              latencyMs,
              phases: {
                vector: { count: phases.vector.length, memories: phases.vector },
                graph: { count: phases.graph.length, memories: phases.graph },
              },
            }),
          },
        ],
      };
    }

    const result = await brain.recall(query, {
      maxTokens,
      types,
      sources,
      source: 'claude-code',
      crossNamespace,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            context: result.context,
            memoriesUsed: result.memories.length,
            latencyMs: result.latencyMs,
            memories: result.memories.map((m) => ({
              id: m.id,
              type: m.type,
              score: m.score.toFixed(3),
              source: m.source,
            })),
          }),
        },
      ],
    };
  }
);

// ─── Tool: add_knowledge ──────────────────────────────────────────────────────
server.tool(
  'add_knowledge',
  'Add a semantic fact or knowledge entry to the brain. Use for storing persistent facts and concepts.',
  {
    concept: z.string().describe('The concept or entity name (e.g. "TypeScript", "User")'),
    content: z.string().describe('The fact or knowledge content'),
    tags: z.array(z.string()).optional().describe('Categorization tags'),
    importance: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.7)
      .describe('Importance 0.0–1.0'),
  },
  async ({ concept, content, tags, importance }) => {
    await ensureInitialized();

    const { memory } = await brain.store({
      type: 'semantic',
      concept,
      content,
      tags,
      importance,
      source: 'claude-code',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ id: memory.id, concept, message: 'Knowledge stored' }),
        },
      ],
    };
  }
);

// ─── Tool: memory_stats ───────────────────────────────────────────────────────
server.tool(
  'memory_stats',
  'Get statistics about the current state of the AI brain memory system.',
  {},
  async () => {
    await ensureInitialized();
    const stats = await brain.stats();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats),
        },
      ],
    };
  }
);

// ─── Tool: forget ─────────────────────────────────────────────────────────────
server.tool(
  'forget',
  'Archive (soft-delete) memories from the brain. The memories are not permanently deleted but are excluded from future recall.',
  {
    ids: z.array(z.string()).describe('Memory IDs to archive'),
    reason: z.string().optional().describe('Reason for forgetting (logged only)'),
  },
  async ({ ids, reason }) => {
    await ensureInitialized();

    for (const id of ids) {
      await brain.forget(id);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            archived: ids.length,
            reason: reason ?? 'not specified',
            message: `Archived ${ids.length} memory(ies)`,
          }),
        },
      ],
    };
  }
);

// ─── Tool: decay_sweep ───────────────────────────────────────────────────────
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
  async ({ dryRun }) => {
    await ensureInitialized();

    const result = await brain.runDecaySweep(dryRun);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...result,
            mode: dryRun ? 'dry-run' : 'live',
            message: dryRun
              ? `Dry run: would archive ${result.archivedCount} memories, decay ${result.decayedCount}, consolidate ${result.consolidatedCount}`
              : `Archived ${result.archivedCount} memories, decayed ${result.decayedCount}, consolidated ${result.consolidatedCount} in ${result.durationMs}ms`,
          }),
        },
      ],
    };
  }
);

// ─── Tool: decay_policy ──────────────────────────────────────────────────────
server.tool(
  'decay_policy',
  'View or update the memory decay policy configuration. Controls how aggressively memories are forgotten and when auto-consolidation runs.',
  {
    action: z
      .enum(['get', 'update'])
      .describe("'get' to view current policy, 'update' to modify it"),
    halfLifeDays: z.number().min(1).optional().describe('Ebbinghaus half-life in days'),
    archiveThreshold: z.number().min(0).max(1).optional().describe('Retention score below which memories are archived'),
    importanceDecayRate: z.number().min(0).max(1).optional().describe('Daily importance reduction rate'),
    importanceFloor: z.number().min(0).max(1).optional().describe('Minimum importance after decay'),
    consolidationEnabled: z.boolean().optional().describe('Enable/disable auto-consolidation'),
  },
  async ({ action, halfLifeDays, archiveThreshold, importanceDecayRate, importanceFloor, consolidationEnabled }) => {
    await ensureInitialized();

    if (action === 'update') {
      const updates: Record<string, unknown> = {};
      if (halfLifeDays !== undefined) updates.halfLifeDays = halfLifeDays;
      if (archiveThreshold !== undefined) updates.archiveThreshold = archiveThreshold;
      if (importanceDecayRate !== undefined) updates.importanceDecayRate = importanceDecayRate;
      if (importanceFloor !== undefined) updates.importanceFloor = importanceFloor;
      if (consolidationEnabled !== undefined) {
        updates.consolidation = { enabled: consolidationEnabled };
      }
      brain.updateDecayPolicy(updates as any);
    }

    const policy = brain.getDecayPolicy();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            policy: {
              halfLifeDays: policy.halfLifeDays,
              archiveThreshold: policy.archiveThreshold,
              decayIntervalMs: policy.decayIntervalMs,
              batchSize: policy.batchSize,
              importanceDecayRate: policy.importanceDecayRate,
              importanceFloor: policy.importanceFloor,
              consolidation: policy.consolidation,
              protectionRuleCount: policy.protectionRules.length,
            },
            message: action === 'update' ? 'Policy updated' : 'Current policy',
          }),
        },
      ],
    };
  }
);

// ─── Tool: check_contradictions ───────────────────────────────────────────────
server.tool(
  'check_contradictions',
  'Check a memory for contradictions with existing memories, or list all unresolved contradictions.',
  {
    memoryId: z.string().optional().describe('Memory ID to check. If omitted, lists all unresolved contradictions.'),
  },
  async ({ memoryId }) => {
    await ensureInitialized();

    if (memoryId) {
      const result = await brain.checkContradictions(memoryId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...result,
              message: result.hasContradictions
                ? `Found ${result.contradictions.length} contradiction(s) for memory ${memoryId}`
                : `No contradictions found for memory ${memoryId}`,
            }),
          },
        ],
      };
    }

    // List all unresolved contradictions
    const contradictions = await brain.getContradictions();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
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
        },
      ],
    };
  }
);

// ─── Tool: resolve_contradiction ─────────────────────────────────────────────
server.tool(
  'resolve_contradiction',
  'Resolve a contradiction between two memories using a strategy: keep_newest (archive old), keep_oldest (archive new), keep_important (archive lower importance), keep_both (keep both, edge remains), manual (no action).',
  {
    sourceId: z.string().describe('ID of the first memory in the contradiction'),
    targetId: z.string().describe('ID of the second memory in the contradiction'),
    strategy: z
      .enum(['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual'])
      .describe('Resolution strategy'),
  },
  async ({ sourceId, targetId, strategy }) => {
    await ensureInitialized();

    const result = await brain.resolveContradiction(sourceId, targetId, strategy);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...result,
            strategy,
            message: result.resolved
              ? `Contradiction resolved via ${strategy}. Kept: ${result.keptId}, Archived: ${result.archivedId ?? 'none'}`
              : 'Contradiction not resolved (manual review or memories not found)',
          }),
        },
      ],
    };
  }
);

// ─── Tool: plugin_list ───────────────────────────────────────────────────────
server.tool(
  'plugin_list',
  'List all registered Engram plugins with their hooks and metadata.',
  {},
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

// ─── Tool: list_tags ─────────────────────────────────────────────────────────
server.tool(
  'list_tags',
  'Get all tags with memory counts (tag cloud), or get memories for a specific tag.',
  {
    tag: z.string().optional().describe('If provided, returns memories with this tag. If omitted, returns the tag cloud.'),
    limit: z.number().min(1).max(200).optional().default(50).describe('Max memories to return when filtering by tag.'),
  },
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

// ─── Tool: tag_memory ────────────────────────────────────────────────────────
server.tool(
  'tag_memory',
  'Add or remove a tag on a memory.',
  {
    memoryId: z.string().describe('Memory ID to tag/untag'),
    tag: z.string().describe('Tag string to add or remove'),
    action: z.enum(['add', 'remove']).default('add').describe('Whether to add or remove the tag'),
  },
  async ({ memoryId, tag, action }) => {
    await ensureInitialized();

    const tags = action === 'add'
      ? await brain.addTag(memoryId, tag)
      : await brain.removeTag(memoryId, tag);

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

// ─── Tool: webhook_subscribe ──────────────────────────────────────────────────
server.tool(
  'webhook_subscribe',
  'Subscribe a URL to receive HTTP callbacks when memory events occur. Events: stored, forgotten, decayed, consolidated, contradiction.',
  {
    url: z.string().url().describe('The HTTP(S) URL to receive webhook POST requests'),
    events: z.array(z.enum(['stored', 'forgotten', 'decayed', 'consolidated', 'contradiction'])).describe('Events to subscribe to'),
    secret: z.string().optional().describe('Shared secret for HMAC-SHA256 signature verification'),
    description: z.string().optional().describe('Human-readable description of this webhook'),
  },
  async ({ url, events, secret, description }) => {
    await ensureInitialized();
    const hook = await brain.getWebhookManager().subscribe({ url, events, secret, description });
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...hook, message: `Webhook subscribed: ${hook.id}` }) }],
    };
  }
);

// ─── Tool: webhook_list ──────────────────────────────────────────────────────
server.tool(
  'webhook_list',
  'List all webhook subscriptions.',
  {},
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

// ─── Tool: index_status ──────────────────────────────────────────────────────
server.tool(
  'index_status',
  'Get the vector index status — how it was loaded (disk cache or full rebuild), entry count, and persistence info.',
  {},
  async () => {
    await ensureInitialized();
    const status = brain.getIndexStatus();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...status,
            message: status.loadedFrom === 'disk'
              ? `Index loaded from disk cache (${status.entryCount} entries, ${status.incrementalCount} added incrementally, ${status.initDurationMs}ms)`
              : `Index built from database (${status.entryCount} entries, ${status.initDurationMs}ms)`,
          }),
        },
      ],
    };
  }
);

// ─── Tool: embedding_status ──────────────────────────────────────────────────
server.tool(
  'embedding_status',
  'Get the status of the embedding model — shows current model, dimension, and how many memories need re-embedding.',
  {},
  async () => {
    await ensureInitialized();
    const status = await brain.embeddingStatus();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...status,
            message: status.needsReEmbed
              ? `${status.staleCount + status.legacyCount} memories need re-embedding (${status.staleCount} stale, ${status.legacyCount} legacy)`
              : `All ${status.totalEmbedded} memories are up-to-date with model ${status.currentModel}`,
          }),
        },
      ],
    };
  }
);

// ─── Tool: re_embed ──────────────────────────────────────────────────────────
server.tool(
  're_embed',
  'Re-embed memories with the current embedding model. Use after switching models to update stale vectors. Can be slow for large stores.',
  {
    onlyStale: z.boolean().optional().default(true).describe('If true, only re-embed memories with a different or missing model ID. Default: true.'),
    batchSize: z.number().min(1).max(100).optional().default(32).describe('Batch size for processing. Default: 32.'),
  },
  async ({ onlyStale, batchSize }) => {
    await ensureInitialized();
    const result = await brain.reEmbed(onlyStale, batchSize);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...result,
            model: brain.getEmbeddingModel(),
            message: result.failed > 0
              ? `Re-embedded ${result.processed} memories (${result.failed} failed) in ${result.durationMs}ms`
              : `Re-embedded ${result.processed} memories in ${result.durationMs}ms`,
          }),
        },
      ],
    };
  }
);

// ─── Initialization ───────────────────────────────────────────────────────────

let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = brain.initialize();
  }
  await initPromise;
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Engram MCP server running on stdio');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
