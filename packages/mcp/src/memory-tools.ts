import { z } from 'zod';
import type { ToolContext } from './tools.js';

/** Core memory registrations, shared by both transports. */
export function registerMemoryTools({
  server, brain, ensureInitialized, syncEngine, clientSource,
}: ToolContext): void {
// ─── Tool: store_memory ───────────────────────────────────────────────────────
server.tool(
  'store_memory',
  'Store information to persistent memory. Call AUTOMATICALLY for: user preferences, project decisions, tech stack, bug fixes, useful commands, corrections, workflow patterns. Do not ask — just store.',
  {
    content: z.string().min(1).describe('The content to store as a memory'),
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
    namespace: z.string().optional().describe('Override namespace in filter mode; ignored in none mode and restricted in isolated mode'),
    global: z.boolean().optional().describe('Store globally across projects; rejected in isolated mode'),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async ({ content, type, source, tags, importance, concept, sessionId, namespace, global }) => {
    await ensureInitialized();

    const result = await brain.store({
      content,
      type,
      source: source ?? clientSource(),
      tags,
      importance,
      concept,
      sessionId,
      namespace: global ? null : namespace,
    });
    syncEngine?.notifyWrite();

    const response: Record<string, unknown> = {
      id: result.memory.id,
      type: result.memory.type,
      importance: result.memory.importance,
      deduplicated: result.deduplicated ?? false,
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

// ─── Tool: update_memory ──────────────────────────────────────────────────────
server.tool(
  'update_memory',
  'Correct a stale fact or edit an existing memory by its full ID or unique prefix of at least 8 characters.',
  {
    id: z.string().describe('Memory ID or unique prefix (at least 8 characters)'),
    content: z.string().min(1).optional().describe('Replacement memory content'),
    importance: z.number().min(0).max(1).optional().describe('Importance score 0.0–1.0'),
    tags: z.array(z.string()).optional().describe('Replacement tags'),
    concept: z.string().optional().describe('Replacement concept name'),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async ({ id, ...updates }) => {
    await ensureInitialized();
    const memory = await brain.updateMemory(id, updates);
    syncEngine?.notifyWrite();
    return {
      content: [{ type: 'text', text: JSON.stringify({
        id: memory.id, content: memory.content, importance: memory.importance,
        tags: JSON.parse(memory.tags), concept: memory.concept,
        message: 'Memory updated successfully',
      }) }],
    };
  }
);

// ─── Tool: search_memory ──────────────────────────────────────────────────────
server.tool(
  'search_memory',
  'Search memories by semantic similarity. Use BEFORE answering questions about past decisions, project details, or anything discussed previously.',
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
    since: z.string().datetime({ offset: true }).optional().describe('Inclusive event date lower bound (falls back to creation date)'),
    until: z.string().datetime({ offset: true }).optional().describe('Inclusive event date upper bound (falls back to creation date)'),
    tags: z.array(z.string()).optional().describe('Require all of these tags'),
    crossNamespace: z.boolean().optional().default(false).describe('Search every project in filter mode; rejected in isolated mode'),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ query, topK, threshold, types, since, until, tags, crossNamespace }) => {
    await ensureInitialized();

    const memories = await brain.search(query, { topK, threshold, types, since, until, tags, crossNamespace });

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
  'CALL FIRST in every conversation. Loads relevant memories — past decisions, preferences, project context, session notes. Returns formatted context ready for use.',
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
    since: z.string().datetime({ offset: true }).optional().describe('Inclusive event date lower bound (falls back to creation date)'),
    until: z.string().datetime({ offset: true }).optional().describe('Inclusive event date upper bound (falls back to creation date)'),
    tags: z.array(z.string()).optional().describe('Require all of these tags'),
    crossNamespace: z.boolean().optional().default(false).describe('Search every project in filter mode; rejected in isolated mode'),
    progressive: z.boolean().optional().default(false).describe('If true, return memories grouped by recall phase (vector, graph) with scores'),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ query, maxTokens, types, sources, since, until, tags, crossNamespace, progressive }) => {
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
        since,
        until,
        tags,
        source: clientSource(),
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
      since,
      until,
      tags,
      source: clientSource(),
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
  'Store a named fact (e.g., "TypeScript: project uses TS 5.7 strict"). Use for reusable knowledge — the concept field acts as a label for retrieval.',
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
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async ({ concept, content, tags, importance }) => {
    await ensureInitialized();

    const { memory } = await brain.store({
      type: 'semantic',
      concept,
      content,
      tags,
      importance,
      source: clientSource(),
    });
    syncEngine?.notifyWrite();

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

}
