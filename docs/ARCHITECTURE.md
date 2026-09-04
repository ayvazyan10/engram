# Architecture

Engram is a **monorepo** composed of a core brain engine, integration interfaces, and a visualization dashboard. This document covers the system design, data flow, and how the components interact.

---

## High-level overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients / Consumers                       │
│                                                                  │
│  Claude Code       Ollama Client                    Custom App │
│  (MCP client)      (any chat UI)                    (REST)     │
└────────┬──────────────────┬─────────────────────────────┬───────┘
         │ stdio MCP        │ HTTP :11435                 │ HTTP REST
         ▼                  ▼                             ▼
┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐
│  MCP Server  │  │  Ollama Proxy    │  │   REST API :4901      │
│  @engram-ai-memory/mcp     │  │  @engram-ai-memory/adapter-    │  │   @engram-ai-memory/server          │
│              │  │  ollama          │  │   Fastify 5           │
│ 18 MCP tools │  │  :11435→:11434   │  │   + Socket.io /neural │
└──────┬───────┘  └────────┬─────────┘  └──────────┬────────────┘
       │                   │                        │
       └──────────────┬────┘────────────────────────┘
                      │  NeuralBrain API
                      ▼
       ┌──────────────────────────────────────────┐
       │           @engram-ai-memory/core               │
       │                                           │
       │  ┌──────────┐  ┌──────────┐  ┌────────┐  │
       │  │ Episodic │  │ Semantic │  │ Proced.│  │
       │  │ Memory   │  │ Memory   │  │ Memory │  │
       │  └──────────┘  └──────────┘  └────────┘  │
       │                                           │
       │  ┌──────────────────────────────────────┐ │
       │  │         ContextAssembler              │ │
       │  │  embed → search → expand → score     │ │
       │  │  → truncate → log → return           │ │
       │  └──────────────────────────────────────┘ │
       │                                           │
       │  ┌──────────┐  ┌──────────┐              │
       │  │  Vector  │  │Knowledge │              │
       │  │  Search  │  │  Graph   │              │
       │  │  (HNSW)  │  │  (BFS)   │              │
       │  └──────────┘  └──────────┘              │
       │                                           │
       │  ┌──────────────────────────────────────┐ │
       │  │       Embedder (@xenova/transformers) │ │
       │  │       all-MiniLM-L6-v2, 384-dim       │ │
       │  │       WASM — runs 100% locally        │ │
       │  └──────────────────────────────────────┘ │
       └──────────────────┬───────────────────────┘
                          │
                          ▼
           ┌──────────────────────────┐
           │  SQLite (dev)            │
           │  PostgreSQL + pgvector   │
           │  (prod)                  │
           └──────────────────────────┘
                          │
                          ▼
           ┌──────────────────────────┐
           │  React Dashboard :4901   │
           │  @engram-ai-memory/web                 │
           │  React Three Fiber (3D)  │
           │  Socket.io (real-time)   │
           └──────────────────────────┘
```

---

## Monorepo structure

```
neuralCore/
├── packages/
│   ├── core/               @engram-ai-memory/core      — The Brain
│   ├── mcp/                @engram-ai-memory/mcp       — Claude Code MCP server
│   └── vis/                @engram-ai-memory/vis       — Visualization helpers
│
├── apps/
│   ├── server/             @engram-ai-memory/server    — REST API + WebSocket
│   └── web/                @engram-ai-memory/web       — 3D dashboard
│
├── adapters/
│   └── ollama/             @engram-ai-memory/adapter-ollama
│
└── tooling/
    ├── tsconfig/           shared TypeScript configs
    └── eslint-config/      shared ESLint config
```

Build orchestration: **Turborepo** — `dependsOn: ["^build"]` ensures `@engram-ai-memory/core` always builds before packages that depend on it.

---

## Core brain (`@engram-ai-memory/core`)

### NeuralBrain class

The single entry point for all integrations.

```typescript
const brain = new NeuralBrain({ dbPath: './engram.db' });
await brain.initialize();  // loads HNSW index + knowledge graph into memory

await brain.store({ content, type, concept, tags, importance });
const result = await brain.recall(query, { maxTokens: 2000 });
const memories = await brain.search(query, { topK: 10, threshold: 0.3 });
await brain.forget(id);
const consolidated = await brain.consolidate(3, 0.6);  // episodic → semantic
const stats = await brain.stats();
```

### Neural behavior on store

Every `brain.store()` call does more than just insert a record:

1. **Embed** — content is converted to a 384-dim vector
2. **Index** — vector added to in-memory search index, node added to graph
3. **Auto-link** — finds top-3 most similar existing memories (threshold ≥ 0.5), creates bidirectional `relates_to` edges. The knowledge graph grows organically with every store.
4. **Auto-concept** — if no `concept` is provided, extracts a short topic label (2–5 words) from the content via `extractConcept()`.

### Memory consolidation

`brain.consolidate(minClusterSize, threshold)` merges clusters of similar episodic memories into semantic summaries — like sleep consolidation in the human brain. Original episodes are archived (soft-deleted). Available via `POST /api/consolidate`.

### Memory types

Each type is handled by a dedicated class that applies type-specific defaults:

| Class | Default importance | Key fields |
|---|---|---|
| `EpisodicMemory` | 0.5 | `eventAt`, `sessionId`, `source` |
| `SemanticMemory` | 0.7 | `concept`, knowledge graph edges |
| `ProceduralMemory` | 0.5 | `triggerPattern`, `actionPattern` |

### Embedder

Uses `@xenova/transformers` with the `Xenova/all-MiniLM-L6-v2` model.

- **Inference**: ONNX Runtime WASM — runs entirely in Node.js, zero network calls, no API keys
- **Dimensions**: 384 float32 values per embedding
- **Storage**: FP16 compression — `Float32Array` → `Int16Array` (50% size reduction)
- **Lazy loading**: model loads on first embed call, cached for the process lifetime

### Vector search (`VectorSearch`)

- In-memory HNSW-lite index (custom implementation)
- Cosine similarity for distance metric
- `upsert(id, embedding)` — adds or updates a vector
- `search(embedding, topK, threshold)` — returns IDs and similarity scores
- Index is rebuilt from DB on `brain.initialize()`

### Knowledge graph (`KnowledgeGraph`)

- Adjacency list stored in memory, sourced from `memory_connections` table
- `expand(id, depth)` — BFS traversal up to `depth` hops, returns all reachable node IDs
- Relationship types: `is_a`, `has_property`, `causes`, `relates_to`, `contradicts`, `part_of`, `follows`

### Context assembler (`ContextAssembler`)

The 7-step recall pipeline:

```
1. embed(query)                      → query vector
2. vectorSearch(queryVec, topK=20)   → candidate IDs + similarity scores
3. graphExpand(candidates, depth=2)  → expand via knowledge graph
4. db.select(allCandidateIds)        → load full memory records
5. importanceScore(candidates)       → rank by similarity + recency + importance + accessFreq
6. truncate(ranked, maxTokens)       → cut to fit token budget
7. logAssembly(result)               → write to context_assemblies table
```

**Importance scoring weights:**

| Signal | Weight |
|---|---|
| Semantic similarity | 0.45 |
| Recency (Ebbinghaus decay) | 0.25 |
| Stored importance score | 0.20 |
| Access frequency | 0.10 |

Ebbinghaus decay: `R = e^(-t/S)` where `t` = days since last access, `S` = 7-day half-life.

---

## Database schema

Four tables managed by **Drizzle ORM** with SQLite as the primary backend. PostgreSQL is used only as a sync replication target for multi-device setups — see [Cloud Sync](CLOUD-SYNC.md).

### `memories`

Core table. All three memory types share one table with type-specific nullable fields.

```
id              TEXT PRIMARY KEY
type            TEXT  — 'episodic' | 'semantic' | 'procedural'
content         TEXT  — full text content
summary         TEXT  — auto-generated short summary
embedding       BLOB  — FP16-packed Float32[384]
embedding_dim   INT   — 384
importance      REAL  — 0.0–1.0, Ebbinghaus-decayed over time
confidence      REAL  — 0.0–1.0
access_count    INT
last_accessed_at DATETIME

-- Episodic only
event_at        DATETIME
session_id      TEXT
source          TEXT  — 'claude-code' | 'ollama' | custom client id

-- Semantic only
concept         TEXT  — concept label

-- Procedural only
trigger_pattern TEXT
action_pattern  TEXT

-- Common
metadata        TEXT  JSON object
tags            TEXT  JSON array
created_at      DATETIME
updated_at      DATETIME
archived_at     DATETIME  — soft delete (NULL = active)
```

### `memory_connections`

Knowledge graph edges.

```
id              TEXT PRIMARY KEY
source_id       TEXT → memories.id  CASCADE DELETE
target_id       TEXT → memories.id  CASCADE DELETE
relationship    TEXT — is_a | has_property | causes | relates_to | contradicts | part_of | follows
strength        REAL — 0.0–1.0
bidirectional   INT  — 0 | 1
metadata        TEXT JSON
created_at      DATETIME
```

### `sessions`

Groups episodic memories from a single interaction.

```
id          TEXT PRIMARY KEY
source      TEXT
context     TEXT JSON
namespace   TEXT
started_at  DATETIME
ended_at    DATETIME
```

### `context_assemblies`

Audit log of every recall operation.

```
id                TEXT PRIMARY KEY
query             TEXT
query_embedding   BLOB
assembled_context TEXT JSON
source            TEXT
session_id        TEXT
namespace         TEXT
latency_ms        INT
created_at        DATETIME
```

---

## REST API server (`@engram-ai-memory/server`)

Built with **Fastify 5** for high throughput and automatic JSON schema validation.

- Routes registered at `/api` prefix
- **Socket.io** namespace `/neural` broadcasts memory, contradiction, recall and embedding events
- Swagger UI served at `/docs`
- Binds `127.0.0.1` by default; the built dashboard is served from the same origin

Five middlewares run on every request, in this order, and the order is deliberate — reject a rebound `Host` before spending a rate-limit slot on it, and rate-limit before the key check so a flood of wrong-key requests is bounded too:

1. **Error handler** — 4xx bodies pass through (they describe the caller's own input); 5xx bodies are replaced with a fixed string so driver text and filesystem paths never reach a caller
2. **Security headers** — CSP and friends on every response, including static assets and the SPA fallback, via `onSend`
3. **CORS** — explicit origin allowlist, no credentials. A no-`Origin` request (CLI, MCP, curl) is allowed; the WebSocket allowlist is enforced in `allowRequest`, because a CORS callback cannot refuse an upgrade
4. **Host allowlist** — `/api/*` only, the REST half of the DNS-rebinding defense
5. **Rate limiting** — three tiers keyed by client address, `/api/*` only
6. **API key** — only when `ENGRAM_API_KEY` is set; `/api/health` and everything outside `/api/` stay open

Whole-store operations additionally hold a process-wide single-flight guard, so two concurrent index rebuilds cannot interleave a `clear()` with the other's writes.

See [API.md](API.md) for full endpoint reference and [CONFIGURATION.md](CONFIGURATION.md#security) for the knobs.

---

## Visualization dashboard (`@engram-ai-memory/web`)

Built with **React 19 + Vite 6**. Three-dimensional neural graph rendered with **React Three Fiber** and **@react-three/drei**.

### 3D views

Position is not decorative. Every node's coordinate comes from `GET /api/graph/layout` — a PCA projection of that memory's stored embedding into three components, computed server-side and cached on a fingerprint of the store. Two nodes near each other mean two memories near each other. The three views are framings over that one layout, not separate scatter functions:

| View | Framing |
|---|---|
| Cosmos | The projection as it is, free orbit — global structure |
| Neural Net | The projection with type pulled apart along X — bands you can compare, similarity still governing within a band |
| Clusters | The projection folded into three per-type volumes |

Nebula and Galaxy were removed. Nebula was Cosmos with a larger radius and the type colours discarded; Galaxy encoded nothing in position at all.

Edges come from `GET /api/graph/edges` in one bulk request, which reports how many connections exist versus how many are renderable, so the scene key can state what it is not showing.

Beside the 3D canvas the dashboard has Timeline, Analytics and Reflections views.

### Real-time updates

The dashboard connects to `ws://localhost:4901/neural` via Socket.io. When a memory is stored via the API, it appears in the graph within the next render cycle.

### State management

Zustand stores:

- `neuralStore` — neurons, connections, selection state, WebSocket connection status
- `memoryStore` — memory records, search results, recall context
- `viewStore` — active visualization variant and theme
- `authStore` — whether the server is demanding an API key, and whether this session has supplied one

When `ENGRAM_API_KEY` is set on the server, the key is entered in the dashboard UI and held in the browser session — read per request and re-read by the socket on every reconnect attempt. It is **never** built into the bundle. The static assets and the SPA shell are served without it, because a browser cannot attach a header to a top-level navigation.

---

## Adapter pattern

Adapters are thin wrappers that call Engram's REST API. They follow a consistent pattern:

1. **Before AI processes request**: call `/api/recall` with the user's query → get context string
2. **Inject context**: prepend to system prompt
3. **After AI responds**: call `/api/memory` to store the exchange as an episodic memory

This pattern works for any AI system. The Ollama adapter is a transparent HTTP proxy; other clients can use the REST API directly.

---

## Migration workflow

**Never use `drizzle-kit push`** — it can cause data loss on existing databases.

Always:

```bash
# 1. Edit packages/core/src/db/schema.ts
# 2. Generate migration SQL
pnpm db:generate

# 3. Review the generated SQL in packages/core/src/db/migrations/
# 4. Apply migration
pnpm db:migrate
```
