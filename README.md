<div align="center">

<img src="https://raw.githubusercontent.com/your-org/engram/main/apps/web/public/logo.svg" alt="Engram Logo" width="80" height="80">

# Engram

**Universal AI Brain — persistent memory and cognition layer for any AI model**

[![CI](https://github.com/your-org/engram/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/engram/actions/workflows/ci.yml)
[![npm @engram/core](https://img.shields.io/npm/v/@engram/core?label=%40engram%2Fcore&color=6366f1)](https://www.npmjs.com/package/@engram/core)
[![npm @engram/mcp](https://img.shields.io/npm/v/@engram/mcp?label=%40engram%2Fmcp&color=6366f1)](https://www.npmjs.com/package/@engram/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![pnpm 9+](https://img.shields.io/badge/pnpm-9%2B-orange)](https://pnpm.io)

[**Quick Start**](#quick-start) · [**Docs**](docs/) · [**Live Demo**](#live-demo) · [**Integrations**](#integrations) · [**Contributing**](CONTRIBUTING.md)

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

## How it works

Every time an AI connected to Engram receives a query:

1. **Embeds** the query into a 384-dimensional semantic vector *(locally — no API, no cost)*
2. **Searches** its vector index for similar past memories
3. **Expands** via the knowledge graph to retrieve related concepts
4. **Scores** candidates by semantic similarity + recency + importance + access frequency
5. **Injects** the assembled context into the AI's prompt

The AI responds with awareness of everything it has ever learned. After the exchange, the response is stored as a new memory — the brain grows continuously.

---

## Memory model

Engram mirrors how the human brain organizes knowledge:

| Type | What it stores | Example |
|---|---|---|
| **Episodic** | Events, conversations, timestamped interactions | *"User asked about deployment on 2026-03-15"* |
| **Semantic** | Facts, knowledge, concepts + knowledge graph | `concept: TypeScript` → *"typed superset of JavaScript"* |
| **Procedural** | Patterns, skills, trigger→action rules | *"When user asks about DB migrations → use drizzle-kit generate"* |
| **Working** | Dynamically assembled context for a query | *(assembled at query time, not stored)* |

---

## Integrations

```
Claude Code ──MCP────────→ ┐
Ollama ──────proxy────────→ │  Engram  →  SQLite / PostgreSQL
OpenClaw ────REST─────────→ │  REST :3001
Any app ─────REST─────────→ ┘
```

| Integration | Method | How |
|---|---|---|
| **Claude Code** | MCP (native tools) | `store_memory`, `recall_context`, `add_knowledge`, … |
| **Ollama** | Transparent HTTP proxy | Point client at `:11435` instead of `:11434` |
| **OpenClaw** | REST adapter | `EngramClient` or `withMemory()` wrapper |
| **Any app** | Direct REST API | `POST /api/recall` + `POST /api/memory` |

---

## Quick start

### Prerequisites

- Node.js 22+
- pnpm 9+

### Install

```bash
git clone https://github.com/your-org/engram
cd engram
pnpm install
```

### Build

```bash
pnpm turbo run build
```

### Run

```bash
# API server (port 3001)
ENGRAM_DB_PATH=./engram.db node apps/server/dist/index.js

# Dashboard (port 5173)
pnpm --filter @engram/web dev
```

### Store your first memory

```bash
curl -X POST http://localhost:3001/api/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers TypeScript over JavaScript", "type": "semantic", "concept": "preferences"}'
```

### Ask the brain

```bash
curl -X POST http://localhost:3001/api/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "What language does the user prefer?"}'
```

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
        "ENGRAM_DB_PATH": "/path/to/engram/packages/core/engram.db"
      }
    }
  }
}
```

Restart Claude Code. You now have `store_memory`, `recall_context`, `search_memory`, `add_knowledge`, `memory_stats`, and `forget` available as native tools.

**Recommended session workflow:**
```
Start  → recall_context(task description)   # load relevant past context
During → store_memory(decisions, findings)  # grow the brain
End    → store_memory(session summary)      # persist what happened
```

---

## Packages

| Package | Description | npm |
|---|---|---|
| `@engram/core` | The Brain — memory engine, embeddings, graph, retrieval | [![npm](https://img.shields.io/npm/v/@engram/core?color=6366f1)](https://npmjs.com/package/@engram/core) |
| `@engram/mcp` | MCP Server for Claude Code integration | [![npm](https://img.shields.io/npm/v/@engram/mcp?color=6366f1)](https://npmjs.com/package/@engram/mcp) |
| `@engram/server` | Fastify REST API + Socket.io WebSocket | — |
| `@engram/web` | React 3D visualization dashboard | — |
| `@engram/vis` | Force-directed layout + animation helpers | [![npm](https://img.shields.io/npm/v/@engram/vis?color=6366f1)](https://npmjs.com/package/@engram/vis) |
| `@engram/adapter-ollama` | Transparent Ollama memory proxy | — |
| `@engram/adapter-openclaw` | OpenClaw REST adapter | — |

---

## Live demo

```bash
# Load 67 demo memories with 34 knowledge graph connections
cd packages/core && npx tsx scripts/demo.ts

# Open the 3D visualization
pnpm --filter @engram/web dev
# → http://localhost:5173
```

Five visualization modes: **Cosmos** · **Nebula** · **Neural Net** · **Galaxy** · **Clusters**

---

## Performance

| Metric | Target | Approach |
|---|---|---|
| Memory write | > 10,000 records/sec | SQLite WAL + batch transactions |
| Recall latency p99 | < 100ms | Cached embeddings + HNSW index |
| Search p99 | < 50ms | Pre-indexed vectors |
| Embedding | 2× compressed | FP16 (Float32→Int16) |
| Dashboard | > 30 FPS | InstancedMesh + postprocessing |

Embeddings run **locally** using ONNX Runtime WASM — no OpenAI API, no cost, no data leaving your machine.

---

## Documentation

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, component overview |
| [docs/API.md](docs/API.md) | Full REST API reference |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Claude Code, Ollama, OpenClaw setup |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Monorepo, build system, contributing |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variables, database, tuning |

Interactive Swagger UI: `http://localhost:3001/docs`

---

## Contributing

We welcome contributions of all kinds — bug fixes, new integrations, adapters for other AI tools, visualization improvements, and documentation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where help is especially welcome:

- **New adapters** — LM Studio, llama.cpp, Anthropic API, OpenAI API
- **PostgreSQL + pgvector** — production database support
- **Mobile / browser** — lightweight browser-side memory client
- **Importance learning** — adaptive importance scoring based on usage patterns

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built with ♥ for the open AI ecosystem</sub>
</div>
