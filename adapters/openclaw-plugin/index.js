/**
 * OpenClaw × Engram Memory Plugin
 *
 * Connects OpenClaw agents to Engram's persistent semantic memory.
 * Provides six tools: memory_recall, memory_store, engram_search,
 * memory_forget, memory_list, memory_stats.
 * Optionally injects relevant memories before each agent turn (autoRecall).
 *
 * Config (plugins.entries.engram.config in openclaw.json):
 *   url        — Engram API base URL (default: http://localhost:4901)
 *   source     — source tag stored with memories (default: "openclaw")
 *   autoRecall — inject memories before agent turns (default: true)
 *   maxTokens  — max context tokens for recall (default: 1500)
 */

const engramPlugin = {
  id: "engram",
  name: "Memory (Engram)",
  description: "Persistent semantic memory via Engram REST API",
  kind: "memory",

  register(api) {
    api.logger?.info?.(`engram: registrationMode=${api.registrationMode}`);
    const cfg = api.pluginConfig ?? {};
    const baseUrl = cfg.url ?? process.env.ENGRAM_API ?? "http://localhost:4901";
    const baseSource = cfg.source ?? "openclaw";
    const maxTokens = cfg.maxTokens ?? 2000;
    const autoRecall = cfg.autoRecall !== false;

    // Per-agent source namespace: "openclaw:main", "openclaw:web-dev", etc.
    function agentSource(event) {
      const agentId = event?.agentId ?? event?.agent ?? event?.from ?? null;
      return agentId ? `${baseSource}:${agentId}` : baseSource;
    }

    // -------------------------------------------------------------------------
    // HTTP helpers
    // -------------------------------------------------------------------------

    async function engramGet(path) {
      const res = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Engram HTTP ${res.status}`);
      return res.json();
    }

    async function engramPost(path, body) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        let detail = "";
        try { detail = ` — ${JSON.stringify(await res.json())}`; } catch {}
        throw new Error(`Engram HTTP ${res.status}${detail}`);
      }
      return res.json();
    }

    // -------------------------------------------------------------------------
    // Tool: memory_recall
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "memory_recall",
        label: "Memory Recall",
        description:
          "Recall relevant context from Engram long-term memory. Use when you need to remember past conversations, user preferences, or prior decisions.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to look up in memory" },
            maxTokens: {
              type: "number",
              description: "Max context tokens to return (default: 1500)",
            },
          },
          required: ["query"],
        },
        async execute(_id, params) {
          const { query, maxTokens: mt = maxTokens } = params;
          try {
            const result = await engramPost("/api/recall", {
              query,
              maxTokens: mt,
              source,
            });
            const count = result.memories?.length ?? 0;
            if (!result.context || count === 0) {
              return {
                content: "No relevant memories found." ,
                details: { count: 0 },
              };
            }
            return {
              content: result.context ,
              details: { count, latencyMs: result.latencyMs },
            };
          } catch (err) {
            return {
              content: `Memory unavailable: ${err.message}` ,
            };
          }
        },
      },
      { name: "memory_recall" },
    );

    // -------------------------------------------------------------------------
    // Tool: memory_store
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information to Engram long-term memory. Use for preferences, decisions, facts, and key context that should persist across sessions.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Information to store" },
            type: {
              type: "string",
              enum: ["episodic", "semantic", "procedural"],
              description:
                "Memory type: episodic (events/conversations), semantic (facts/knowledge), procedural (how-to steps). Default: semantic",
            },
            importance: {
              type: "number",
              description: "Importance score 0–1 (default: 0.7)",
            },
          },
          required: ["content"],
        },
        async execute(_id, params, context) {
          const { content, type: memType = "semantic" } = params;
          // Normalize importance: accept 0–1 or 1–5 scale (old convention)
          let importance = params.importance ?? 0.7;
          if (importance > 1) importance = Math.min(importance / 5, 1);
          const src = agentSource(context ?? {});
          try {
            const result = await engramPost("/api/memory", {
              content,
              type: memType,
              importance,
              source: src,
            });
            return {
              content: `Stored (id: ${result.id}, type: ${result.type})`,
              details: { id: result.id, type: result.type },
            };
          } catch (err) {
            return {
              content: `Store failed: ${err.message}` ,
            };
          }
        },
      },
      { name: "memory_store" },
    );

    // -------------------------------------------------------------------------
    // Tool: engram_search
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "engram_search",
        label: "Engram Search",
        description: "Semantic vector search across all Engram memories.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            topK: { type: "number", description: "Max results (default: 10)" },
            threshold: {
              type: "number",
              description: "Similarity threshold 0–1 (default: 0.3)",
            },
          },
          required: ["query"],
        },
        async execute(_id, params) {
          const { query, topK = 10, threshold = 0.3 } = params;
          try {
            const result = await engramPost("/api/search", { query, topK, threshold });
            const results = result.results ?? [];
            if (results.length === 0) {
              return {
                content: "No results found." ,
                details: { count: 0 },
              };
            }
            const text = results
              .map(
                (r, i) =>
                  `${i + 1}. [${r.type ?? "memory"}] ${r.content} (${((r.score ?? 0) * 100).toFixed(0)}%)`,
              )
              .join("\n");
            return {
              content: `${results.length} results:\n\n${text}` ,
              details: { count: results.length },
            };
          } catch (err) {
            return {
              content: `Search failed: ${err.message}` ,
            };
          }
        },
      },
      { name: "engram_search" },
    );

    // -------------------------------------------------------------------------
    // Tool: memory_forget
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description:
          "Delete (archive) a memory from Engram by its ID. Use to remove duplicates or outdated information.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Memory ID to delete" },
          },
          required: ["id"],
        },
        async execute(_id, params) {
          const { id } = params;
          try {
            const res = await fetch(`${baseUrl}/api/memory/${encodeURIComponent(id)}`, {
              method: "DELETE",
              signal: AbortSignal.timeout(5000),
            });
            if (res.status === 204 || res.ok) {
              return { content: `Deleted memory ${id}` };
            }
            return { content: `Failed to delete ${id}: HTTP ${res.status}` };
          } catch (err) {
            return { content: `Delete failed: ${err.message}` };
          }
        },
      },
      { name: "memory_forget" },
    );

    // -------------------------------------------------------------------------
    // Tool: memory_list
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "memory_list",
        label: "Memory List",
        description:
          "List all memories stored in Engram with optional filtering. Returns IDs, types, content previews, and importance scores. Use to audit, deduplicate, or browse memories.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["episodic", "semantic", "procedural"],
              description: "Filter by memory type (optional)",
            },
            source: {
              type: "string",
              description: "Filter by source tag (optional)",
            },
            limit: {
              type: "number",
              description: "Max results to return (default: 50, max: 200)",
            },
            offset: {
              type: "number",
              description: "Offset for pagination (default: 0)",
            },
          },
        },
        async execute(_id, params) {
          const { type, source, limit = 50, offset = 0 } = params;
          try {
            const qs = new URLSearchParams();
            if (type) qs.set("type", type);
            if (source) qs.set("source", source);
            qs.set("limit", String(Math.min(limit, 200)));
            qs.set("offset", String(offset));
            const result = await engramGet(`/api/memory?${qs}`);
            const memories = result.memories ?? [];
            if (memories.length === 0) {
              return {
                content: `No memories found (total: ${result.count ?? 0})`,
                details: { count: 0, total: result.count ?? 0 },
              };
            }
            const text = memories
              .map(
                (m, i) =>
                  `${offset + i + 1}. [${m.type}] id=${m.id} imp=${m.importance ?? "?"} src=${m.source ?? "?"}\n   ${(m.content ?? "").slice(0, 120)}`,
              )
              .join("\n");
            return {
              content: `${result.count ?? memories.length} total memories (showing ${memories.length} from offset ${offset}):\n\n${text}`,
              details: { count: memories.length, total: result.count ?? memories.length },
            };
          } catch (err) {
            return { content: `List failed: ${err.message}` };
          }
        },
      },
      { name: "memory_list" },
    );

    // -------------------------------------------------------------------------
    // Tool: memory_stats
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "memory_stats",
        label: "Memory Stats",
        description:
          "Get Engram brain statistics: total memory count, breakdown by type (episodic/semantic/procedural), by source, graph edges, and index size.",
        parameters: {
          type: "object",
          properties: {},
        },
        async execute() {
          try {
            const stats = await engramGet("/api/stats");
            const lines = [
              `Total memories: ${stats.total}`,
              `By type: episodic=${stats.byType?.episodic ?? 0}, semantic=${stats.byType?.semantic ?? 0}, procedural=${stats.byType?.procedural ?? 0}`,
              `Graph: ${stats.graphNodes ?? 0} nodes, ${stats.graphEdges ?? 0} edges`,
              `Index size: ${stats.indexSize ?? 0}`,
            ];
            if (stats.bySource) {
              const sources = Object.entries(stats.bySource)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              lines.push(`By source: ${sources}`);
            }
            return {
              content: lines.join("\n"),
              details: stats,
            };
          } catch (err) {
            return { content: `Stats failed: ${err.message}` };
          }
        },
      },
      { name: "memory_stats" },
    );

    // -------------------------------------------------------------------------
    // Auto-recall: inject relevant memories before each agent turn
    // -------------------------------------------------------------------------

    if (autoRecall) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 10) return;
        try {
          const src = agentSource(event);
          const halfTokens = Math.min(Math.floor(maxTokens / 2), 1000);

          // Phase 1: Agent-specific memories (higher priority)
          const agentResult = src !== baseSource
            ? await engramPost("/api/recall", {
                query: event.prompt,
                maxTokens: halfTokens,
                source: src,
              }).catch(() => null)
            : null;

          // Phase 2: Cross-agent shared memories
          const sharedResult = await engramPost("/api/recall", {
            query: event.prompt,
            maxTokens: halfTokens,
          });

          // Combine: agent-specific first, then shared
          const parts = [];
          if (agentResult?.context && agentResult.memories?.length > 0) {
            parts.push(agentResult.context);
          }
          if (sharedResult?.context && sharedResult.memories?.length > 0) {
            parts.push(sharedResult.context);
          }

          if (parts.length > 0) {
            const totalMemories = (agentResult?.memories?.length ?? 0) + (sharedResult?.memories?.length ?? 0);
            api.logger?.info(
              `engram: injecting ${totalMemories} memories (agent-specific + shared) into context`,
            );
            return { prependContext: parts.join("\n\n") };
          }
        } catch {
          // Engram unavailable — degrade silently
        }
      }, { name: "engram-auto-recall" });
    }

    // -------------------------------------------------------------------------
    // Auto-store: combine user + assistant into one episodic memory per exchange
    // -------------------------------------------------------------------------

    // Buffer: per-session last user message, awaiting the assistant reply
    const pendingUserMsg = new Map(); // sessionKey → { text, timestamp }

    api.on("message_received", async (event) => {
      api.logger?.info?.("engram: message_received hook fired");
      const text = event.text ?? event.content ?? event.body ?? "";
      if (!text || text.length < 3) return;
      const key = event.sessionKey ?? event.chatId ?? "default";
      pendingUserMsg.set(key, { text: text.slice(0, 1000), ts: Date.now() });

      // Store user message immediately (don't rely on message_sent pairing)
      try {
        await engramPost("/api/memory", {
          content: `User: ${text.slice(0, 1000)}`,
          type: "episodic",
          importance: 0.5,
          source: agentSource(event),
          sessionId: key,
        });
        api.logger?.info?.("engram: stored user message");
      } catch {
        // Engram unavailable — skip silently
      }
    }, { name: "engram-message-received" });

    api.on("message_sent", async (event) => {
      api.logger?.info?.("engram: message_sent hook fired");
      const assistantText = event.text ?? event.content ?? event.body ?? "";
      if (!assistantText || assistantText.length < 5) return;

      const key = event.sessionKey ?? event.chatId ?? "default";
      const pending = pendingUserMsg.get(key);
      const src = agentSource(event);

      // Combine user + assistant into one exchange, or store assistant-only
      let content;
      let importance = 0.5;
      if (pending && (Date.now() - pending.ts) < 120_000) {
        content = `User: ${pending.text}\nAssistant: ${assistantText.slice(0, 1000)}`;
        // Deeper conversations (longer exchanges) get higher importance
        importance = Math.min(0.5 + (pending.text.length + assistantText.length) / 5000, 0.8);
        pendingUserMsg.delete(key);
      } else {
        content = `Assistant: ${assistantText.slice(0, 1000)}`;
      }

      try {
        await engramPost("/api/memory", {
          content,
          type: "episodic",
          importance,
          source: src,
          sessionId: key,
        });
        api.logger?.info?.(`engram: stored exchange (source: ${src}, importance: ${importance.toFixed(2)})`);
      } catch (err) {
        api.logger?.warn?.(`engram: auto-store failed: ${err.message}`);
      }
    }, { name: "engram-auto-store" });

    // Flush unbuffered user messages after 2 minutes with no reply
    setInterval(() => {
      const now = Date.now();
      for (const [key, pending] of pendingUserMsg) {
        if (now - pending.ts > 120_000) {
          engramPost("/api/memory", {
            content: `User: ${pending.text}`,
            type: "episodic",
            importance: 0.4,
            source: baseSource,
            sessionId: key,
          }).catch(() => {});
          pendingUserMsg.delete(key);
        }
      }
    }, 60_000);

    // -------------------------------------------------------------------------
    // Service: health check on startup
    // -------------------------------------------------------------------------

    api.registerService({
      id: "engram",
      start: async () => {
        try {
          const health = await engramGet("/api/health");
          api.logger.info(
            `engram: connected to ${baseUrl} (status: ${health.status}, version: ${health.version ?? "unknown"})`,
          );
        } catch {
          api.logger.warn(
            `engram: server not reachable at ${baseUrl} — tools will degrade gracefully`,
          );
        }
      },
      stop: () => {
        api.logger.info("engram: stopped");
      },
    });
  },
};

export default engramPlugin;
