# Changelog

All notable changes to Engram are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [0.1.0] — 2026-03-21

### Added

- **`@engram/core`** — NeuralBrain class with full Episodic / Semantic / Procedural memory model
- **`@engram/core`** — Local ONNX embeddings via `@xenova/transformers` (`all-MiniLM-L6-v2`, 384-dim, no API required)
- **`@engram/core`** — HNSW-lite in-memory vector index with cosine similarity search
- **`@engram/core`** — Knowledge graph with BFS traversal (depth-configurable)
- **`@engram/core`** — Context assembler: embed → vector search → graph expand → score → truncate → inject
- **`@engram/core`** — Importance scoring: semantic similarity + recency + importance weight + access frequency
- **`@engram/core`** — Ebbinghaus forgetting curve importance decay
- **`@engram/core`** — FP16 embedding compression (Float32[384] → Int16[384], 2× storage reduction)
- **`@engram/core`** — Drizzle ORM schema: `memories`, `memory_connections`, `sessions`, `context_assemblies`
- **`@engram/core`** — SQLite WAL mode (>10,000 memory writes/sec)
- **`@engram/mcp`** — MCP Server for Claude Code: `store_memory`, `recall_context`, `search_memory`, `add_knowledge`, `memory_stats`, `forget`
- **`@engram/server`** — Fastify 5 REST API on port 3001 with Swagger UI at `/docs`
- **`@engram/server`** — Socket.io WebSocket on `/neural` namespace: `memory:stored`, `memory:activated`, `graph:updated`
- **`@engram/server`** — Batch memory endpoint: `POST /api/memory/batch` (up to 200 per request)
- **`@engram/web`** — React 3D visualization dashboard with React Three Fiber
- **`@engram/web`** — 5 visualization modes: Cosmos, Nebula, Neural Net, Galaxy, Clusters
- **`@engram/web`** — Bloom + Vignette postprocessing via `@react-three/postprocessing`
- **`@engram/web`** — Real-time memory updates via Socket.io
- **`@engram/adapter-ollama`** — Transparent HTTP proxy: intercepts Ollama requests, injects memory context, stores exchanges
- **`@engram/adapter-openclaw`** — `EngramClient` class + `withMemory()` wrapper for OpenClaw integration
- **`@engram/vis`** — Force-directed layout, animation engine, color mapper for visualization
- Demo seed script: 67 memories + 34 knowledge graph connections across AI/ML, architecture, and project history topics
- Full documentation: ARCHITECTURE, API, INTEGRATIONS, DEVELOPMENT, CONFIGURATION
- CI workflow (GitHub Actions): build → typecheck → test on every push/PR
- Release workflow: publish `@engram/core`, `@engram/mcp`, `@engram/vis` to npm on version tag
- Docker Compose: PostgreSQL 16 + pgvector + API + dashboard

### Performance (measured on M2 / SQLite WAL)

- Memory write: >10,000 records/sec (batch)
- Recall latency: <20ms p50, <100ms p99
- Embedding: ~150ms first call (model load), <5ms subsequent
- Dashboard: >60 FPS at 67 neurons

---

[0.1.0]: https://github.com/ayvazyan10/engram/releases/tag/v0.1.0
