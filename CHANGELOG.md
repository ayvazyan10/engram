# Changelog

All notable changes to Engram are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

### Removed

- OpenClaw support has been removed: both the TypeScript adapter and standalone plugin are no longer part of the workspace or documentation.

### Added

- Namespace behavior is now explicit through `namespaceMode`: `none` (the default), `filter`, or `isolated`. `none` ignores namespace inputs; `filter` preserves optional scoping and overrides; `isolated` requires one fixed namespace and rejects overrides and cross-namespace queries.

### Changed

- **`@engram-ai-memory/core`** — The persisted index header now carries the embedding model id and a CRC-32 over the entry payload, and `deserialize()` refuses an index whose model or checksum does not match, or whose entry count disagrees with the payload length — `count` sits outside the CRC, so a lowered count would otherwise parse a prefix of the entries with a valid checksum (format version 2). A refused load leaves the in-memory index untouched. Previously only the dimension was checked, so an index built by a different model — two models can share a dimension — loaded silently and every query scored against vectors it could not be compared to; a truncated file could likewise load as if intact. `IndexMetadata` gained an `embeddingModel` field, `VectorSearch` takes an optional model id as its second constructor argument and exposes `setModelId()`, and `NeuralBrain` passes the active model through. Version 1 files are rejected rather than migrated: the index is a cache, so the first startup after upgrading rebuilds it from the database. No action is needed on upgrade, and switching embedding models no longer requires deleting the index by hand.

### Added

- **`@engram-ai-memory/core`** — `VectorSearch.saveToDiskAsync()` and `NeuralBrain.saveIndexAsync()` persist the vector index without blocking the event loop. `reEmbed()`, `rebuildIndex()` and `POST /api/index/save` now use them — previously each ran a synchronous, full-index `writeFileSync` inside a live request handler. The synchronous `saveToDisk()`/`saveIndex()` remain for callers that cannot await, such as `shutdown()`.

  Every save — synchronous or not — now writes to a temp sibling and renames it over the target, so an interrupted save leaves the previous index readable instead of a truncated one. Entries are serialized before the first await, so each caller persists a snapshot from the moment of its own call.

  Because the synchronous write used to serialize concurrent callers just by blocking the event loop, async saves needed that ordering back explicitly: they are queued per instance, and a write whose snapshot has been superseded by a newer save steps aside instead of renaming over it. Without both, two overlapping saves — a re-embed racing an explicit index save, or a re-embed still in flight when `shutdown()` runs during a restart — could silently discard the fresher snapshot while every caller still saw success.

  Note that the index is not fsynced: the rename is atomic against a process crash, but a power loss can still revert to the previous snapshot. That is acceptable because the index is a cache rebuildable from SQLite, and a missing or corrupt one already falls back to a full rebuild.

### Fixed

- **`@engram-ai-memory/core`** — `reEmbed()` updated SQLite and the in-memory index but never wrote the vector index to disk, leaving that to `shutdown()`. Since `deserialize()` validates only the dimension, a restart — or another process persisting its own index over the same file — silently resurrected the pre-re-embed vectors. Refreshed vectors are now saved as soon as the run finishes (best-effort: an unconfigured path or an unwritable disk no longer fails the re-embed). Note that processes sharing one `ENGRAM_DB_PATH` still default to a single `<db>.index` file; give each its own `ENGRAM_INDEX_PATH` when running more than one.

---

## [0.3.2] — 2026-07-25

### Added

- **`@engram-ai-memory/cli`** — `engram setup` now wires up Claude Code automatic memory end to end. It registers the MCP server at **user scope** (`~/.claude.json`) so it loads in every session without the manual approval a project-scope `~/.mcp.json` entry needs, and installs two hooks: a `UserPromptSubmit` recall hook that injects relevant long-term memories on each prompt (relevance-gated, fail-open) and a `SessionEnd` hook that stores a session summary. Detected automatically when `~/.claude` is present; opt out with `--no-claude-hooks`. Hooks are shipped as templates (`packages/cli/templates/`) and installed to `~/.engram/hooks/`. `engram doctor` reports their status.

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
