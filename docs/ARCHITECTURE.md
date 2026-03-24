# Architecture

Engram is a **monorepo** composed of a core brain engine, integration interfaces, and a visualization dashboard. This document covers the system design, data flow, and how the components interact.

---

## High-level overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients / Consumers                       │
│                                                                  │
│  Claude Code       Ollama Client      OpenClaw       Custom App │
│  (MCP client)      (any chat UI)      (agent)        (REST)     │
└────────┬──────────────────┬──────────────┬──────────────┬───────┘
         │ stdio MCP        │ HTTP :11435  │ HTTP REST    │ HTTP REST
         ▼                  ▼              ▼              ▼
┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐
│  MCP Server  │  │  Ollama Proxy    │  │   REST API :4901      │
│  @engram/mcp     │  │  @engram/adapter-    │  │   @engram/server          │
│              │  │  ollama          │  │   Fastify 5           │
│ 18 MCP tools │  │  :11435→:11434   │  │   + Socket.io /neural │
└──────┬───────┘  └────────┬─────────┘  └──────────┬────────────┘
       │                   │                        │
       └──────────────┬────┘────────────────────────┘
                      │  NeuralBrain API
                      ▼
       ┌──────────────────────────────────────────┐
       │           @engram/core               │
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
           │  React Dashboard :4902   │
           │  @engram/web                 │
           │  React Three Fiber (3D)  │
           │  Socket.io (real-time)   │
           └──────────────────────────┘
```

---

## Monorepo structure

```
neuralCore/
├── packages/
│   ├── core/               @engram/core      — The Brain
│   ├── mcp/                @engram/mcp       — Claude Code MCP server
│   └── vis/                @engram/vis       — Visualization helpers
│
├── apps/
│   ├── server/             @engram/server    — REST API + WebSocket
│   └── web/                @engram/web       — 3D dashboard
│
├── adapters/
│   ├── ollama/             @engram/adapter-ollama
│   └── openclaw/           @engram/adapter-openclaw
│
└── tooling/
    ├── tsconfig/           shared TypeScript configs
    └── eslint-config/      shared ESLint config
```

Build orchestration: **Turborepo** — `dependsOn: ["^build"]` ensures `@engram/core` always builds before packages that depend on it.

---

## Core brain (`@engram/core`)

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

Four tables managed by **Drizzle ORM** with SQLite in development, PostgreSQL + pgvector in production.

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
source          TEXT  — 'claude-code' | 'ollama' | 'openclaw' | ...

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
latency_ms        INT
created_at        DATETIME
```

---

## REST API server (`@engram/server`)

Built with **Fastify 5** for high throughput and automatic JSON schema validation.

- Routes registered at `/api` prefix
- **Socket.io** namespace `/neural` broadcasts `memory:stored` events
- Swagger UI served at `/docs`
- CORS enabled for all origins (configurable)

See [API.md](API.md) for full endpoint reference.

---

## Visualization dashboard (`@engram/web`)

Built with **React 19 + Vite 6**. Three-dimensional neural graph rendered with **React Three Fiber** and **@react-three/drei**.

### 5 visualization views

| View | Layout | Style |
|---|---|---|
| Cosmos | Fibonacci sphere | Metallic + orbital rings, bloom |
| Nebula | Wider sphere | Ghost orbs, high bloom |
| Neural Net | 3 columns by type | Neon green, grid floor |
| Galaxy | Spiral arms | Star-like, fast rotation |
| Clusters | 3 type clouds | Plasma glow |

### Real-time updates

The dashboard connects to `ws://localhost:4901/neural` via Socket.io. When a memory is stored via the API, it appears in the graph within the next render cycle.

### State management

Two Zustand stores:

- `neuralStore` — neurons, connections, selection state, WebSocket connection status
- `memoryStore` — memory records, search results, recall context
- `viewStore` — active visualization variant and theme

---

## Adapter pattern

Adapters are thin wrappers that call Engram's REST API. They follow a consistent pattern:

1. **Before AI processes request**: call `/api/recall` with the user's query → get context string
2. **Inject context**: prepend to system prompt
3. **After AI responds**: call `/api/memory` to store the exchange as an episodic memory

This pattern works for any AI system. The Ollama adapter is a transparent HTTP proxy; the OpenClaw adapter is an importable library.

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
