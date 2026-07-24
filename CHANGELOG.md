# Changelog

All notable changes to Engram are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

---

## [0.3.1] — 2026-07-25

The published `0.3.0` was frozen on 2026-07-17, before a full codebase audit. This
release ships the accumulated reliability, correctness and security fixes to npm.
No API changes — a drop-in upgrade.

### Fixed — data integrity (silent-but-serious)

- **`@engram-ai-memory/core`** — `search()` discarded the similarity it ranked by, so every consumer saw `0%` scores. Similarity is now returned on each hit.
- **`@engram-ai-memory/core`** — FP16 embedding codec dropped the implicit mantissa bit, corrupting the small components of every persisted vector. Subnormals are now packed correctly.
- **`@engram-ai-memory/core`** — Importance decay recompounded on every sweep (memories hit the floor in ~2 days instead of ~45). Decay now checkpoints against `updatedAt`.
- **`@engram-ai-memory/core`** — `void db.update(...)` never executed (Drizzle builders are lazy PromiseLikes), so access counts stayed 0 and decay archived active memories. All such writes are now awaited with atomic SQL increments.
- **`@engram-ai-memory/server`** — `POST /api/memory/batch` silently dropped `importance`, `source`, `tags`, `concept` and `namespace`. All per-item fields are now honoured.

### Fixed — atomicity

- **`@engram-ai-memory/core`** — `store()`, `forget()`/`consolidate()` and `resolveContradiction()` are now single transactions; a failure part-way through no longer leaves partial state.

### Added — security

- **`@engram-ai-memory/server`** — Webhook SSRF guard: delivery to loopback/private addresses is rejected unless `ENGRAM_WEBHOOK_ALLOW_PRIVATE=true`.
- **`@engram-ai-memory/server`** — CORS is now an allowlist (`ENGRAM_ALLOWED_ORIGINS`) instead of reflecting any origin.
- **`@engram-ai-memory/server`** — Optional bearer/`X-API-Key` auth via `ENGRAM_API_KEY` (timing-safe compare); unset keeps the local-first open default.

### Fixed — other

- **`@engram-ai-memory/mcp`** — `GET /api/graph/:id` now honours its `depth` parameter and returns edges in both directions.
- **`@engram-ai-memory/server`** — `ENGRAM_DATABASE=postgresql` now fails fast with an explanatory error instead of appearing to connect and breaking on the first write (the PostgreSQL backend is not implemented).
- **`@engram-ai-memory/cli`** — `engram start` verifies the port actually bound before printing success; `engram status` verifies the pidfile PID is alive and owns the port.
- **`@engram-ai-memory/adapter-ollama`** — OpenAI-compatible `/v1/chat/completions` interception and one-shot tool-call retry (`ENGRAM_TOOL_RETRY`, default `true`).
- **`@engram-ai-memory/cli`** — `dev` script changed to `tsc --watch` so `turbo run dev` no longer aborts the workspace.
- **`@engram-ai-memory/server`** — Dashboard static path resolves against `process.cwd()`, fixing serving from a non-root working directory.

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
