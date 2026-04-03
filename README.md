<div align="center">

<img src="https://github.com/ayvazyan10/engram/blob/master/apps/web/public/logo.svg" alt="Engram Logo" width="80" height="80">

# Engram

**Universal AI Brain — persistent memory and cognition layer for any AI model**

[![CI](https://github.com/ayvazyan10/engram/actions/workflows/ci.yml/badge.svg)](https://github.com/ayvazyan10/engram/actions/workflows/ci.yml)
[![npm @engram-ai-memory/core](https://img.shields.io/npm/v/@engram-ai-memory/core?label=%40engram-ai-memory%2Fcore&color=6366f1)](https://www.npmjs.com/package/@engram-ai-memory/core)
[![npm @engram-ai-memory/mcp](https://img.shields.io/npm/v/@engram-ai-memory/mcp?label=%40engram-ai-memory%2Fmcp&color=6366f1)](https://www.npmjs.com/package/@engram-ai-memory/mcp)
[![Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![pnpm 9+](https://img.shields.io/badge/pnpm-9%2B-orange)](https://pnpm.io)

[**Quick Start**](#quick-start) · [**Features**](#features) · [**CLI**](#cli) · [**Docs**](docs/) · [**Live Demo**](#live-demo) · [**Integrations**](#integrations) · [**Contributing**](CONTRIBUTING.md)

</div>

---

## What is Engram?

Engram gives any AI model **human-like memory** that persists across sessions, systems, and restarts. Connect it once and every AI you use — Claude Code, Ollama, OpenClaw, or any custom integration — shares a single, growing brain.

Most AI tools forget everything the moment a session ends. Engram solves this by acting as a universal memory backend: it stores what your AIs learn, retrieves the right memories at the right time, and presents them as context — automatically.

```
┌─ You tell Claude Code about your stack  ──→  stored as semantic memory
└─ Next day, different tool, new session  ──→  Engram recalls it automatically
```

---

## Features

| Feature | Description |
|---|---|
| **3 Memory Types** | Episodic (events), Semantic (facts + knowledge graph), Procedural (trigger→action patterns) |
| **7-Step Recall Pipeline** | Embed → Vector search → Graph expand → Score → Rank → Truncate → Log |
| **Memory Decay & GC** | Ebbinghaus forgetting curve, auto-archive stale memories, episodic→semantic consolidation |
| **Namespace Isolation** | Isolated memory workspaces per project/agent, opt-in cross-namespace recall |
| **Contradiction Detection** | Auto-detect conflicting memories, 5 resolution strategies (keep_newest/oldest/important/both/manual) |
| **Embedding Upgradability** | Swap embedding models, store model ID alongside vectors, batch re-embedding pipeline |
| **Streaming Recall** | SSE endpoint — high-confidence memories first, graph-expanded backfill later |
| **Index Persistence** | Save/load vector index to disk for fast startup (27-37x speedup) |
| **CLI Tool** | `engram store/search/recall/stats/forget/export/import` from the terminal |
| **Import/Export** | Full backup & restore as JSON or NDJSON via CLI or API |
| **Webhooks** | Subscribe external systems to memory events (stored, forgotten, decayed, consolidated, contradiction) |
| **Tagging & Collections** | Tag cloud, filter by tag, prefix-based collections (e.g. `project:alpha`) |
| **Plugin System** | 6 lifecycle hooks (onStore, onRecall, onForget, onDecay, onStartup, onShutdown) |
| **Importance Learning** | Auto-boost importance when recalled, decay when unused |
| **Observability** | Debug endpoints, scoring breakdowns, Swagger UI at `/docs` |

---

## How it works

Every time an AI connected to Engram receives a query:

1. **Embeds** the query into a 384-dimensional semantic vector *(locally — no API, no cost)*
2. **Searches** its vector index for similar past memories
3. **Expands** via the knowledge graph to retrieve related concepts
4. **Scores** candidates by semantic similarity + recency + importance + access frequency
5. **Checks** for contradictions with existing memories
6. **Injects** the assembled context into the AI's prompt

The AI responds with awareness of everything it has ever learned. After the exchange, the response is stored as a new memory — the brain grows continuously.

---

## Memory model

| Type | What it stores | Example |
|---|---|---|
| **Episodic** | Events, conversations, timestamped interactions | *"User asked about deployment on 2026-03-15"* |
| **Semantic** | Facts, knowledge, concepts + knowledge graph | `concept: TypeScript` → *"typed superset of JavaScript"* |
| **Procedural** | Patterns, skills, trigger→action rules | *"When user asks about DB migrations → use drizzle-kit generate"* |
| **Working** | Dynamically assembled context for a query | *(assembled at query time, not stored)* |

---

## Integrations

```
Claude Code    ──MCP──────────→ ┐
Claude Desktop ──extension────→ │  Engram  →  SQLite / PostgreSQL
Ollama         ──proxy────────→ │  REST :4901
OpenClaw       ──REST─────────→ │  WebSocket :4901/neural
Any app        ──REST─────────→ │
CLI            ──direct───────→ ┘
```

| Integration | Method | How |
|---|---|---|
| **Claude Code** | MCP (18 native tools) | `store_memory`, `recall_context`, `check_contradictions`, … |
| **Claude Desktop** | 1-click Desktop Extension | [Smithery](https://smithery.ai/skills/ayvazyan10/engram) or `.mcpb` from releases |
| **Ollama** | Transparent HTTP proxy | Point client at `:11435` instead of `:11434` |
| **OpenClaw** | REST adapter | `EngramClient` or `withMemory()` wrapper |
| **Any app** | Direct REST API | `POST /api/recall` + `POST /api/memory` |
| **Terminal** | CLI | `engram recall "what was the last decision?"` |

---

## Quick start

### One-command install

```bash
# Install the CLI globally
npm i -g @engram-ai-memory/cli

# Run the setup wizard — clones, builds, configures everything
engram setup

# Start the server (API + 3D dashboard on :4901)
engram start
```

That's it. Open http://localhost:4901 for the dashboard, `/docs` for Swagger UI.

### CLI commands

```bash
engram setup       # Clone, build, configure, set up Claude Code MCP
engram start       # Start the server (background)
engram stop        # Stop the server
engram doctor      # Health checks
engram status      # Server status + memory count
engram configure   # View/set config (port, dbPath, namespace, etc.)
```

### Manual install (alternative)

```bash
git clone https://github.com/ayvazyan10/engram
cd engram
pnpm install
pnpm turbo run build
node apps/server/dist/index.js
```

### Store your first memory

```bash
curl -X POST http://localhost:4901/api/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers TypeScript over JavaScript", "type": "semantic", "concept": "preferences"}'
```

### Ask the brain

```bash
curl -X POST http://localhost:4901/api/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "What language does the user prefer?"}'
```

---

## CLI

Install the CLI globally for terminal access:

```bash
npm i -g @engram-ai-memory/cli
```

```bash
# Store a memory
engram store "User prefers TypeScript" --type semantic --importance 0.8

# Search
engram search "TypeScript" --top 5

# Recall context (pipeable)
engram recall "what languages does the user prefer?" --raw

# Stats
engram stats

# Export/import
engram export > backup.json
engram import < backup.json

# Forget
engram forget a1b2c3d4-...
```

Set `ENGRAM_DB_PATH` to point at your database file.

---

## Claude Code (MCP) setup

Add Engram as a native tool in Claude Code — no API calls, no wrappers:

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/path/to/engram/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/path/to/engram/engram.db"
      }
    }
  }
}
```

Restart Claude Code. **18 tools** are now available:

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `forget` |
| **Stats & Health** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `check_contradictions`, `resolve_contradiction` |
| **Tags** | `list_tags`, `tag_memory` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |

### Auto-store conversations (optional)

Add a Claude Code hook to automatically save conversation summaries to engram when a session ends:

```bash
# Copy the hook script
cp scripts/claude-code-hook.sh ~/.claude/hooks/engram-session-end.sh
chmod +x ~/.claude/hooks/engram-session-end.sh
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/engram-session-end.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

Every session now auto-stores a summary to engram — the brain grows without manual effort.

---

## Claude Desktop Extension (1-click install)

The fastest way to get Engram into Claude Desktop — no manual JSON editing required.

### Via Smithery

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

Go to [smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram), click **Install**, optionally set your database path and namespace, and Smithery configures Claude Desktop automatically.

### Via .mcpb Desktop Extension

Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest) and open it in Claude Desktop (File → Open Extension). The bundle auto-installs `@engram-ai-memory/mcp` to `~/.engram/mcp/` on first launch — no setup required.

> **How the bootstrap works:** on first run the `.mcpb` bundle installs `@engram-ai-memory/mcp@<version>` via npm into `~/.engram/mcp/`. A marker file prevents re-installation on subsequent launches. All 18 MCP tools are then available in Claude Desktop.

---

## Packages

| Package | Description | npm |
|---|---|---|
| `@engram-ai-memory/core` | The Brain — memory engine, embeddings, graph, retrieval, decay, contradictions, plugins | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/core?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/core) |
| `@engram-ai-memory/mcp` | MCP Server — 18 tools for Claude Code and MCP-compatible clients | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/mcp?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/mcp) |
| `@engram-ai-memory/cli` | CLI — store, search, recall, stats, export, import from the terminal | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/cli?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/cli) |
| `@engram-ai-memory/server` | Fastify REST API + Socket.io WebSocket (40+ endpoints) | — |
| `@engram-ai-memory/web` | React 3D visualization dashboard (Three.js) | — |
| `@engram-ai-memory/vis` | Force-directed layout + animation helpers | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/vis?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/vis) |
| `@engram-ai-memory/adapter-ollama` | Transparent Ollama memory proxy (:11435) | — |
| `@engram-ai-memory/adapter-openclaw` | OpenClaw REST adapter | — |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4901` | API server port |
| `HOST` | `0.0.0.0` | Bind address |
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database path |
| `ENGRAM_NAMESPACE` | *(none)* | Scope all operations to a namespace |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` | Persistent vector index path |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Override embedding model |
| `ENGRAM_DECAY_INTERVAL` | `3600000` | Auto-decay sweep interval (ms) |
| `ENGRAM_DECAY_THRESHOLD` | `0.05` | Retention score below which memories are archived |
| `OLLAMA_PROXY_PORT` | `11435` | Ollama proxy listen port |
| `ENGRAM_TOOL_RETRY` | `true` | Auto-retry failed tool calls once with an instruction (proxy) |

---

## Ports

| Service | Port | Purpose |
|---|---|---|
| Engram API | **4901** | REST + WebSocket + Swagger UI |
| Dashboard | **4901** | 3D visualization (served from API server) |
| Ollama Proxy | **11435** | Memory injection proxy → Ollama |

All ports are in the 49xx range to avoid conflicts with common dev services (3000, 5173, 8080, etc.).

---

## Live demo

```bash
# Load demo memories with knowledge graph connections
cd packages/core && npx tsx scripts/demo.ts

# Open the 3D visualization
# → http://localhost:4901
```

Five visualization modes: **Cosmos** · **Nebula** · **Neural Net** · **Galaxy** · **Clusters**

---

## Performance

| Metric | Value | Approach |
|---|---|---|
| Recall latency (100 memories) | ~18ms p50 | HNSW index + importance scoring |
| Store throughput | ~120 mem/s | SQLite WAL + auto-linking |
| Embedding | 8ms/text | Local ONNX/WASM (all-MiniLM-L6-v2) |
| Cold startup (1k memories) | ~1.2s | Full DB scan + index build |
| Cached startup (1k memories) | ~45ms | Persisted index (27x faster) |
| Storage per memory | ~1.3 KB | FP16 compressed (2x reduction) |
| Dashboard | > 30 FPS | InstancedMesh + postprocessing |

Embeddings run **locally** using ONNX Runtime WASM — no OpenAI API, no cost, no data leaving your machine.

---

## Documentation

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, component overview |
| [docs/API.md](docs/API.md) | Full REST API reference (40+ endpoints) |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Claude Code, Ollama, OpenClaw, webhooks, plugins |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Monorepo, build system, contributing |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variables, database, tuning |

Interactive Swagger UI: `http://localhost:4901/docs`

Marketing site & interactive docs: [engram.am](https://engram.am)

---

## Contributing

We welcome contributions of all kinds — bug fixes, new integrations, adapters for other AI tools, visualization improvements, and documentation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where help is especially welcome:

- **New adapters** — LM Studio, llama.cpp, Anthropic API, OpenAI API
- **Mobile / browser** — lightweight browser-side memory client
- **Multi-modal embeddings** — images, audio alongside text
- **pgvector native search** — use PostgreSQL's vector index instead of in-memory HNSW

---

## Usage examples

### Example 1 — Session start: recall relevant context

```
User: "Continue working on the auth refactor"
Claude: [calls recall_context("auth refactor current status")]
→ Returns past decisions, code patterns, and session notes about auth
```

Tool: `recall_context` · Input: `{ "query": "auth refactor current status", "maxTokens": 1500 }` · Output: formatted context block with matched memories and scores.

### Example 2 — Store a decision

```
User: "Always use drizzle-kit migrate, never drizzle-kit push — it broke prod once"
Claude: [calls store_memory with type "procedural", importance 0.95]
→ Next session: search_memory("database migrations") surfaces this rule automatically
```

Tool: `store_memory` → `search_memory` · Demonstrates cross-session persistence.

### Example 3 — Contradiction detection

```
User (day 1): "Production runs on PostgreSQL 15"
User (day 30): "We migrated prod to SQLite WAL last month"
Claude: [store_memory returns contradictions detected]
→ calls resolve_contradiction(strategy: "keep_newest")
```

Tool: `store_memory` + `resolve_contradiction` · Engram flags the conflict with 0.87 confidence and archives the stale belief.

---

## Privacy policy

Engram is local-first and privacy-preserving by design:

- **No data leaves your machine.** All memories are stored in a local SQLite database (`~/.engram/engram.db` by default).
- **All embeddings run on-device.** The `all-MiniLM-L6-v2` model runs locally via `@xenova/transformers` — no external embedding API calls.
- **No telemetry.** Engram does not collect usage statistics, crash reports, or any analytics.
- **Webhooks are opt-in.** If you configure webhooks, memory events are sent to your chosen URL — fully under your control.

Full privacy policy: **https://engram.am/privacy**

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built with ♥ for the open AI ecosystem by <a href="https://github.com/ayvazyan10">Razmik Ayvazyan</a></sub>
</div>
