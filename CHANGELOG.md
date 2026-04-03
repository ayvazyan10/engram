# Changelog

All notable changes to Engram are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

### Added

- **`@engram-ai-memory/adapter-ollama`** — OpenAI-compatible API interception: proxy now also intercepts `/v1/chat/completions` in addition to `/api/chat` and `/api/generate`, enabling memory injection for any client using the OpenAI-compatible Ollama endpoint
- **`@engram-ai-memory/adapter-ollama`** — Tool-call retry: when a model responds with plain text instead of a tool call (detected via `finish_reason`), the proxy automatically retries once with an explicit instruction message; controlled via `ENGRAM_TOOL_RETRY` env var (default: `true`)

### Fixed

- **`@engram-ai-memory/cli`** — `dev` script was `tsx src/cli.ts` which exits with code 1 (CLI with no arguments), causing `turbo run dev` to abort the entire workspace; changed to `tsc --watch` consistent with other packages
- **`@engram-ai-memory/server`** — Dashboard static path resolved relative to `__dirname` instead of `process.cwd()`, fixing serving when the server is started from a non-root working directory

---

## [0.1.0] — 2026-03-21

### Added

- **`@engram-ai-memory/core`** — NeuralBrain class with full Episodic / Semantic / Procedural memory model
- **`@engram-ai-memory/core`** — Local ONNX embeddings via `@xenova/transformers` (`all-MiniLM-L6-v2`, 384-dim, no API required)
- **`@engram-ai-memory/core`** — HNSW-lite in-memory vector index with cosine similarity search
- **`@engram-ai-memory/core`** — Knowledge graph with BFS traversal (depth-configurable)
- **`@engram-ai-memory/core`** — Context assembler: embed → vector search → graph expand → score → truncate → inject
- **`@engram-ai-memory/core`** — Importance scoring: semantic similarity + recency + importance weight + access frequency
- **`@engram-ai-memory/core`** — Ebbinghaus forgetting curve importance decay
- **`@engram-ai-memory/core`** — FP16 embedding compression (Float32[384] → Int16[384], 2× storage reduction)
- **`@engram-ai-memory/core`** — Drizzle ORM schema: `memories`, `memory_connections`, `sessions`, `context_assemblies`
- **`@engram-ai-memory/core`** — SQLite WAL mode (>10,000 memory writes/sec)
- **`@engram-ai-memory/mcp`** — MCP Server for Claude Code: `store_memory`, `recall_context`, `search_memory`, `add_knowledge`, `memory_stats`, `forget`
- **`@engram-ai-memory/server`** — Fastify 5 REST API on port 4901 with Swagger UI at `/docs`
- **`@engram-ai-memory/server`** — Socket.io WebSocket on `/neural` namespace: `memory:stored`, `memory:activated`, `graph:updated`
- **`@engram-ai-memory/server`** — Batch memory endpoint: `POST /api/memory/batch` (up to 200 per request)
- **`@engram-ai-memory/web`** — React 3D visualization dashboard with React Three Fiber
- **`@engram-ai-memory/web`** — 5 visualization modes: Cosmos, Nebula, Neural Net, Galaxy, Clusters
- **`@engram-ai-memory/web`** — Bloom + Vignette postprocessing via `@react-three/postprocessing`
- **`@engram-ai-memory/web`** — Real-time memory updates via Socket.io
- **`@engram-ai-memory/adapter-ollama`** — Transparent HTTP proxy: intercepts Ollama requests, injects memory context, stores exchanges
- **`@engram-ai-memory/adapter-openclaw`** — `EngramClient` class + `withMemory()` wrapper for OpenClaw integration
- **`@engram-ai-memory/vis`** — Force-directed layout, animation engine, color mapper for visualization
- Demo seed script: 67 memories + 34 knowledge graph connections across AI/ML, architecture, and project history topics
- Full documentation: ARCHITECTURE, API, INTEGRATIONS, DEVELOPMENT, CONFIGURATION
- CI workflow (GitHub Actions): build → typecheck → test on every push/PR
- Release workflow: publish `@engram-ai-memory/core`, `@engram-ai-memory/mcp`, `@engram-ai-memory/vis` to npm on version tag
- Docker Compose: PostgreSQL 16 + pgvector + API + dashboard

### Performance (measured on M2 / SQLite WAL)

- Memory write: >10,000 records/sec (batch)
- Recall latency: <20ms p50, <100ms p99
- Embedding: ~150ms first call (model load), <5ms subsequent
- Dashboard: >60 FPS at 67 neurons

---

[0.1.0]: https://github.com/ayvazyan10/engram/releases/tag/v0.1.0
