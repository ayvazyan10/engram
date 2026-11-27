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
│ stdio        │  │ adapter-ollama   │  │   Fastify 5           │
│ 15 default   │  │ :11435 → :11434  │  │   + HTTP MCP /mcp    │
│ tools        │  │ recall / store ──┼─►│   + Socket.io /neural │
└──────┬───────┘  └──────────────────┘  └──────────┬────────────┘
       │                                            │
       └──────────────┬─────────────────────────────┘
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
       │  │  (scan)  │  │  (BFS)   │              │
       │  └──────────┘  └──────────┘              │
       │                                           │
       │  ┌──────────────────────────────────────┐ │
       │  │       Embedder (@xenova/transformers) │ │
       │  │ paraphrase-multilingual-MiniLM-L12-v2 │ │
       │  │       ONNX — local inference          │ │
       │  └──────────────────────────────────────┘ │
       └──────────────────┬───────────────────────┘
                          │
                          ▼
           ┌──────────────────────────┐
           │  SQLite (primary)        │
           │  Optional PostgreSQL     │
           │  sync target             │
           └──────────────────────────┘

           Dashboard connects to the REST API
           ┌──────────────────────────┐
           │  React Dashboard :4901   │
           │  @engram-ai-memory/web                 │
           │  Atlas: Canvas + D3      │
           │  Socket.io (real-time)   │
           └──────────────────────────┘
```

---

## Monorepo structure

```
neuralCore/
├── packages/
│   ├── core/               @engram-ai-memory/core      — The Brain
│   ├── mcp/                @engram-ai-memory/mcp       — Stdio server and shared MCP tools
│   ├── cli/                @engram-ai-memory/cli       — Setup, server, data and sync commands
│   ├── mcpb/               @engram-ai-memory/desktop-extension — Claude Desktop bundle
│   └── vis/                @engram-ai-memory/vis       — Visualization helpers
│
├── apps/
│   ├── server/             @engram-ai-memory/server    — REST API + WebSocket
│   └── web/                @engram-ai-memory/web       — Atlas dashboard
│
├── adapters/
│   └── ollama/             @engram-ai-memory/adapter-ollama
│
├── plugins/engram/         Claude Code plugin and hooks
├── scripts/               Hook and migration verification scripts
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
const brain = new NeuralBrain();  // dbPath defaults to ENGRAM_DB_PATH, then ~/.engram/engram.db
await brain.initialize();  // loads the vector index and knowledge graph

await brain.store({ content, type, concept, tags, importance });
const result = await brain.recall(query, { maxTokens: 2000 });
const memories = await brain.search(query, { topK: 10, threshold: 0.3 });
await brain.forget(id);
const consolidated = await brain.consolidate(3, 0.6);  // episodic → semantic
const stats = await brain.stats();
```

### Neural behavior on store

`brain.store()` applies these operations to a new memory:

1. **Embed** — build the embedding text for the memory type and generate a vector in the active model’s dimension.
2. **Index** — add the new vector and graph node. An eligible near-duplicate in the same namespace and type can instead merge tags and importance into the existing record.
3. **Auto-link** — select up to three neighbours at similarity ≥ 0.5 and commit their bidirectional `relates_to` edges with the new memory. The contradiction detector can also nominate a pair for the connected model to verify.
4. **Auto-concept** — if no `concept` is supplied, `extractConcept()` derives a label of up to five words when possible, before embedding.

### Memory consolidation

`brain.consolidate(minClusterSize, threshold)` merges clusters of similar episodic memories into semantic summaries — like sleep consolidation in the human brain. Original episodes are archived (soft-deleted). Available via `POST /api/consolidate`.

### Memory types

The dedicated memory classes have their own defaults. `brain.store()` also considers the source: for `claude-code` and `ollama`, episodic, semantic and procedural importance default to 0.75, 0.85 and 0.8 respectively. For other sources the defaults are 0.5, 0.7 and 0.5.

| Class | Default importance | Key fields |
|---|---|---|
| `EpisodicMemory` | 0.5 | `eventAt`, `sessionId`, `source` |
| `SemanticMemory` | 0.7 | `concept`, knowledge graph edges |
| `ProceduralMemory` | 0.6 | `triggerPattern`, `actionPattern` |

### Embedder

Uses `@xenova/transformers` with the default `Xenova/paraphrase-multilingual-MiniLM-L12-v2` model (384-dim, ~118 MB quantized, multilingual).

- **Inference**: local ONNX inference in Node.js. Uncached models download on first use. No API key is required.
- **Dimensions**: 384 float32 values for the default model. Known widths are listed in `Embedder.ts`, and the brain probes unknown models.
- **Storage**: FP16 compression — each float32 becomes two little-endian bytes in a `Buffer`.
- **Lazy loading**: model loads on first embed call, cached for the process lifetime

### Vector search (`VectorSearch`)

- Exact in-memory search scans the eligible vectors
- Cosine similarity for distance metric
- `upsert({ id, vector, type, namespace })` — adds or updates a vector
- `search(embedding, topK, threshold)` — returns IDs and similarity scores
- On `brain.initialize()`, a compatible disk cache is reconciled against live SQLite rows. Otherwise the index loads from stored vectors.

### Knowledge graph (`KnowledgeGraph`)

- Adjacency list stored in memory, sourced from `memory_connections` table
- `expand(seedIds, maxDepth, relationshipTypes?)` — BFS from one or more seeds. Returns neighbours with depth, strength and relationship, sorted by strength then depth.
- Relationship types: `is_a`, `has_property`, `causes`, `relates_to`, `contradicts`, `part_of`, `follows`

### Context assembler (`ContextAssembler`)

The 7-step recall pipeline:

```
1. embed(query)                      → query vector
2. search(queryVec, topK=20)          → vector candidates, optionally fused with FTS5/BM25 via RRF
3. graphExpand(first 10, depth=2)    → expand the leading candidates via the graph
4. db.select(allCandidateIds)        → load full memory records
5. importanceScore(candidates)       → rank by similarity + recency + importance + accessFreq
6. select(ranked, maxTokens)         → keep the first hit, then skip entries that exceed the remaining budget
7. finalize(result)                  → recheck visibility and normally record access and the context assembly
```

**Importance scoring weights:**

| Signal | Weight |
|---|---|
| Semantic similarity | 0.45 |
| Recency (Ebbinghaus decay) | 0.25 |
| Stored importance score | 0.20 |
| Access frequency | 0.10 |

Recency decays as `2^(-t/7)`, where `t` is days since last access, or since creation for a memory that has never been accessed.

---

## Database schema

SQLite is the primary store. `runSqliteMigrations()` creates seven application tables: the four below plus `webhooks`, `local_meta` and `sync_state`. It also creates the `memories_fts` FTS5 index and its maintenance triggers. The Drizzle schema supplies the TypeScript types. PostgreSQL is an optional replication target with its own migrations under `packages/core/src/db/pg/migrations/` — see [Cloud Sync](CLOUD-SYNC.md).

### `memories`

Core table. All three memory types share one table with type-specific nullable fields.

```
id              TEXT PRIMARY KEY
type            TEXT  — 'episodic' | 'semantic' | 'procedural'
content         TEXT  — full text content
summary         TEXT  — optional short summary
embedding       BLOB  — FP16-packed vector
embedding_dim   INT   — model width (default 384)
embedding_model TEXT  — model ID
importance      REAL  — 0.0–1.0, can decrease during decay sweeps
confidence      REAL  — 0.0–1.0
access_count    INT
last_accessed_at TEXT

-- Event and provenance
event_at        TEXT
session_id      TEXT
source          TEXT  — 'claude-code' | 'ollama' | custom client id

-- Topic label
concept         TEXT  — concept label

-- Procedural only
trigger_pattern TEXT
action_pattern  TEXT

-- Common
metadata        TEXT  JSON object
tags            TEXT  JSON array
namespace       TEXT  — NULL = global
device_id       TEXT  — last content writer
created_at      TEXT
updated_at      TEXT
archived_at     TEXT  — soft delete (NULL = active)
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
created_at      TEXT
updated_at      TEXT
deleted_at      TEXT — deletion tombstone
device_id       TEXT
```

### `sessions`

Groups episodic memories from a single interaction.

```
id          TEXT PRIMARY KEY
source      TEXT
context     TEXT JSON
namespace   TEXT
started_at  TEXT
ended_at    TEXT
updated_at  TEXT
deleted_at  TEXT — deletion tombstone
device_id   TEXT
```

### `context_assemblies`

Local recall history. A recall with no candidates or `touch: false` skips the audit insert, as does a read-only recall explanation.

```
id                TEXT PRIMARY KEY
query             TEXT
query_embedding   BLOB
assembled_context TEXT JSON
source            TEXT
session_id        TEXT
namespace         TEXT
latency_ms        INT
created_at        TEXT
```

---

## REST API server (`@engram-ai-memory/server`)

Built with **Fastify 5** for high throughput and automatic JSON schema validation.

- REST routes registered at `/api`; stateless Streamable HTTP MCP at `POST /mcp` shares the server’s brain and tools
- **Socket.io** namespace `/neural` broadcasts memory, contradiction, recall and embedding events
- Swagger UI served at `/docs`
- Binds `127.0.0.1` by default; the built dashboard is served from the same origin

The server installs the following handlers in order. Host and Origin checks run before rate limiting, which runs before the API-key check:

1. **Error handler** — preserves the caller-facing 4xx message. For unhandled 5xx errors it logs details and sends a fixed message.
2. **Security headers** — CSP and friends on every response, including static assets and the SPA fallback, via `onSend`
3. **CORS** — explicit origin allowlist, no credentials. A no-`Origin` request (CLI, MCP, curl) is allowed; the WebSocket allowlist is enforced in `allowRequest`, because a CORS callback cannot refuse an upgrade
4. **Host allowlist** — checks `/api/*` and `/mcp`. A separate Origin check also covers `/mcp` and non-GET API requests.
5. **Rate limiting** — three tiers keyed by client address. `/mcp` uses the global tier.
6. **API key** — when configured, gates `/api/*` except `/api/health`, plus `/mcp`, `/docs/json` and `/docs/yaml`.

Whole-store operations additionally hold a process-wide single-flight guard, so two concurrent index rebuilds cannot interleave a `clear()` with the other's writes.

See [API.md](API.md) for full endpoint reference and [CONFIGURATION.md](CONFIGURATION.md#security) for the knobs.

---

## Atlas dashboard (`@engram-ai-memory/web`)

Built with **React 19 + Vite 6**, **Canvas + D3** for the memory map, **three.js** loaded on demand for Sky and Landscape, and **Recharts** loaded on demand for Insights.

### Views

| View | What it shows |
|---|---|
| Map | Memories in named regions, Meaning / Faults / Time lenses, search pins, and Recent / Regions / Results lists |
| Recall | A numbered route on the map and the exact context your AI would receive, with ranking and token-budget decisions |
| Review | Contradictions, near-duplicates, fading-but-important memories and possible secrets; word diffs, keyboard triage, bulk actions and Redact |
| Timeline | Memories grouped by local day, paginated with a stable time anchor and a jump-to-date control |
| Insights | Numbers (charts and tables, 7/30/90 days, all projects) and Reflections (reports and cycle status) |
| Settings | Light/dark/system colour mode, connection steps, server and database health, index and embeddings, and read-only decay and sync status |

The Map switcher lazily loads **Sky** (a WebGL memory sky), **Landscape** (retention terrain with a Now / +7 / +30 / +90-day decay preview), **River** (braided history by region, with brush-to-zoom and region following) and **Pulse** (recall ranks, inferred graph threads, token budget and exclusions) at `#/?view=sky|landscape|river|pulse`.

`GET /api/map` projects embeddings into two dimensions, refines positions with similarity links and groups memories into named regions. The server caches layouts per scope and supplies retention and protection values. Region renames are saved on the device. Recall and Pulse use `POST /api/recall/explain`, which previews context without changing access counts, decay timestamps or audit rows.

The memory sheet opens over any route with `?m=<id>` for inspection, editing, tags and connections. Archive and memory-sheet contradiction resolutions wait six seconds before being sent, with Undo by button or ⌘Z / Ctrl+Z. Welcome offers client setup instructions and waits for the first memory.

A desktop rail and phone bottom navigation share hash routes and a persistent All / Global / project scope. The command palette opens with ⌘K / Ctrl+K. The map has keyboard navigation and an accessible list; dialogs and sheets manage focus.

### Real-time updates

The dashboard connects to the `/neural` Socket.io namespace on its own origin. Memory events refresh the shared records and map.

### State management

Zustand stores:

- `neuralStore` — open memory, contradiction pairs and WebSocket connection status
- `memoryStore` — memory records, search results and project scope
- `mapStore` — map data, lens, region selection and local region names
- `routeStore` — active hash route and query parameters
- `analyticsStore` — Insights data and time range
- `reflectionStore` — reflection insights and cycle status
- `authStore` — whether the server is demanding an API key, and whether this session has supplied one

When `ENGRAM_API_KEY` is set on the server, the key is entered in the dashboard UI and held in the browser session — read per request and re-read by the socket on every reconnect attempt. It is **never** built into the bundle. The static assets and the SPA shell are served without it, because a browser cannot attach a header to a top-level navigation.

---

## Adapter pattern

Adapters are thin wrappers that call Engram's REST API. They follow a consistent pattern:

1. **Before AI processes request**: call `/api/recall` with the user's query → get context string
2. **Inject context**: prepend to system prompt
3. **After AI responds**: call `/api/memory` to store the exchange as an episodic memory

This pattern works for any AI system. The Ollama adapter intercepts `/api/chat`, `/api/generate` and OpenAI-compatible `/v1/chat/completions`. Streamed replies over the 1 MiB capture limit are forwarded in full and skip automatic storage. Other clients can use the REST API directly.

---

## Migration workflow

**Never use `drizzle-kit push`** — it can cause data loss on existing databases.

Always:

```bash
# 1. Update packages/core/src/db/schema.ts and runSqliteMigrations() in db/adapter.ts
# 2. Generate tooling SQL for schema-parity checks
pnpm db:generate

# 3. Review the generated SQL in packages/core/src/db/migrations/
# 4. Apply it to a fresh tooling database (runtime upgrades run on connection open)
ENGRAM_DB_PATH="$(mktemp)" pnpm db:migrate
```
