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
  },
  async ({ content, type, source, tags, importance, concept, sessionId }) => {
    await ensureInitialized();

    const memory = await brain.store({
      content,
      type,
      source: source ?? 'claude-code',
      tags,
      importance,
      concept,
      sessionId,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: memory.id,
            type: memory.type,
            importance: memory.importance,
            message: 'Memory stored successfully',
          }),
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
  },
  async ({ query, topK, threshold, types }) => {
    await ensureInitialized();

    const memories = await brain.search(query, { topK, threshold, types });

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
  },
  async ({ query, maxTokens, types, sources }) => {
    await ensureInitialized();

    const result = await brain.recall(query, {
      maxTokens,
      types,
      sources,
      source: 'claude-code',
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

    const memory = await brain.store({
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
