# REST API Reference

Base URL: `http://localhost:4901`

Interactive Swagger UI: `http://localhost:4901/docs`

REST bodies are JSON except for the recall event stream and responses with no body. The server uses Fastify’s default 1 MiB request-body limit. Each REST `GET` also accepts `HEAD` for headers only.

---

## Authentication & request policy

Everything in this section applies to `/api/*` on every endpoint below.

### API key

Authentication is **off by default** — the local-first shape. Set `ENGRAM_API_KEY` on the server to turn it on; every `/api/*` route then requires the key, and so do `/mcp`, `/docs/json` and `/docs/yaml`.

| | |
|---|---|
| **Header** | `X-API-Key: <key>` or `Authorization: Bearer <key>` |
| **Exempt** | `GET` and `HEAD /api/health` (so container probes keep working) |
| **Also exempt** | The dashboard bundle and the SPA fallback — a browser cannot attach a header to a top-level navigation, so gating them would make the page that lets a user supply a key unreachable. |
| **WebSocket** | Same key as `auth.token` in the Socket.io handshake: `io('/neural', { auth: { token: '<key>' } })` |

**Response `401`**
```json
{ "error": "Unauthorized" }
```

`ENGRAM_API_KEY` set to an **empty** value aborts startup rather than silently running unauthenticated. Unset it to run open.

### Host allowlist

`/api/*` requests are refused unless the `Host` header is allowlisted — the DNS-rebinding defense. Without configuration, **IP literals (v4 and v6) and `localhost` / `*.localhost` always pass**; any other hostname must be listed in `ENGRAM_ALLOWED_HOSTS` (comma-separated). A deployment reached by name through a reverse proxy must set it. `ENGRAM_ALLOWED_HOSTS=*` turns the check off.

Ports are stripped before matching and comparison is case-insensitive, so list bare hostnames. A missing or unparseable `Host` is refused.

**Response `403`**
```json
{
  "error": "Forbidden",
  "message": "Host header is not allowlisted. Set ENGRAM_ALLOWED_HOSTS to the hostname this server is reached by (comma-separated, '*' to disable)."
}
```

The Host check covers `/api/*`, `/mcp` and Socket.io handshakes. The dashboard shell and `/docs` are outside this Host guard.

### CORS and WebSocket origins

Browser origins are allowlisted, not reflected. Defaults cover `http://localhost:{PORT}`, `http://127.0.0.1:{PORT}`, `:4902` and the Vite dev server on `:5173`; override with `ENGRAM_ALLOWED_ORIGINS`. Requests with **no** `Origin` (CLI, MCP, curl) are allowed. A disallowed origin is refused at the Socket.io handshake with a 403 before any transport exists. `/mcp` and non-GET `/api/*` requests with a disallowed Origin return `403` with `{ "error": "Forbidden origin" }`.

### Rate limits

Per-client-address fixed windows on `/api/*` and `/mcp`. Static assets and the SPA fallback are exempt. A request is charged against every tier it matches, so a heavy call also spends global budget.

| Tier | Default limit | Applies to |
|---|---|---|
| `global` | 1000 / 60s | Every `/api/*` and `/mcp` request |
| `heavy` | 300 / 60s | `POST /api/memory`, `/api/memory/batch`, `/api/memory/bulk/tag`, `/api/memory/bulk/archive`, `/api/contradictions/bulk/resolve`, `POST /api/search`, `POST /api/recall`, `POST /api/recall/explain`, `GET /api/recall/stream`, and `POST /api/memory/:id/redact`. `GET /api/memory` is a plain list and stays global-only |
| `whole-store` | 30 / 60s | `POST /api/consolidate`, `/api/decay`, `/api/embeddings/backfill`, `/api/embeddings/re-embed`, `/api/index/rebuild`, `/api/index/save`, `/api/sync/trigger`, `/api/map/rebuild`, and all `GET`/`HEAD /api/review/*` reads |

Window and limits are configurable — see [CONFIGURATION.md](CONFIGURATION.md#security). Set a tier's limit to `0` to disable it, or `ENGRAM_RATE_LIMIT_DISABLED=true` to turn the limiter off entirely.

**Response `429`**
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for the 'whole-store' tier. Retry in 60s."
}
```

Sent with `Retry-After` (seconds), `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0` and `X-RateLimit-Reset` (Unix seconds). These headers appear **only** on the 429 — successful responses carry none.

### Single-flight whole-store operations

The whole-store writes above hold a process-wide guard for each operation. Starting the same operation while it is running returns `409`. Decay and consolidation share a guard, including scheduled decay and the HTTP MCP `decay_sweep` tool. HTTP MCP `re_embed` shares the REST re-embed guard.

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Operation 'index-save' is already in progress. Retry once it finishes."
}
```

### Security headers

Every response — including the dashboard bundle and the SPA fallback — carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`. An existing header is never overwritten. Override the CSP with `ENGRAM_CSP`, or `ENGRAM_CSP=off` to send none; `Strict-Transport-Security` is opt-in via `ENGRAM_HSTS_MAX_AGE`.

---

## Health & Stats

### `GET /api/health`

Check if the server is running. `version` comes from the server package.

**Response `200`**
```json
{
  "status": "ok",
  "version": "0.9.0",
  "uptime": 268.962066517
}
```

---

### `GET /api/stats`

Brain memory statistics. `dbPath` abbreviates the home directory as `~`. When at least two named embedding models are present, `mixedEmbeddingModels` gives `counts` (model/count pairs) and a `remediation` string.

**Response `200`**
```json
{
  "total": 101,
  "byType": {
    "episodic": 28,
    "semantic": 52,
    "procedural": 21
  },
  "bySource": {
    "claude-code": 40,
    "ollama": 15,
    "custom-agent": 12,
    "demo": 34
  },
  "byNamespace": [{ "namespace": null, "count": 101 }],
  "dbPath": "~/.engram/engram.db",
  "indexSize": 101,
  "graphNodes": 101,
  "graphEdges": 350,
  "namespace": null,
  "namespaceMode": "none"
}
```

---

### `POST /api/consolidate`

Consolidate episodic memories into semantic summaries. Clusters similar episodes by vector similarity, merges each cluster into a single semantic memory, and archives the originals. Like sleep consolidation in the brain.

**Request body**
```json
{
  "minClusterSize": 3,
  "threshold": 0.6
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `minClusterSize` | number ≥ 2 | — | Min episodes to form a cluster (default: 3) |
| `threshold` | number 0–1 | — | Similarity threshold for clustering (default: 0.6) |

Returned `content` is limited to the first 200 characters.

**Response `200`**
```json
{
  "consolidated": 2,
  "memories": [
    {
      "id": "a1b2c3d4-...",
      "concept": "deployment workflow",
      "content": "When deploying → run migrations first..."
    }
  ]
}
```

---

## Analytics

### `GET /api/analytics`

Aggregated memory statistics, scoped to an explicit time window.

Every number under `windowed` is computed over `window` — the last `days` UTC calendar days, ending with today. The only figures that are not are under `allTime`, which says so in its name. No number sits outside a container that names its scope.

`excludesArchived` is `true` for the whole payload: archived memories are counted nowhere, including in the past days of the growth series.

> **Breaking change in v0.7.0.** In earlier versions the response was flat, and it mixed two scopes without saying so: `dailyGrowth` and `hourlyActivity` were windowed while `total`, `byType`, `bySource` and `topConcepts` were all-time. On a live store the windowed aggregates summed to 87 against a `total` of 651 in the same payload. Every field has moved under `window` / `windowed` / `allTime`, and **`byType`, `bySource` and `topConcepts` are now windowed** where they used to be all-time. Read `allTime.total` for the old `total`.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `days` | integer 1–365 | Length of the window in UTC calendar days, default 30 |
| `global` | `true` | Only null-namespace memories; rejected in isolated mode |

Any other key is a `400` rather than being ignored — `?day=90`, one letter short, used to return `200` with a 30-day window the caller read as 90.

```
GET /api/analytics?day=90
```
```json
{
  "error": "Bad Request",
  "message": "Unknown query parameter: day. Allowed: days, global."
}
```

**Response `200`**

```json
{
  "window": {
    "days": 1,
    "start": "2026-09-04",
    "end": "2026-09-04",
    "startedAt": "2026-09-04T00:00:00.000Z",
    "endsBefore": "2026-09-05T00:00:00.000Z",
    "generatedAt": "2026-09-04T16:43:50.905Z",
    "timezone": "UTC"
  },
  "excludesArchived": true,
  "windowed": {
    "total": 7,
    "avgImportance": 0.5810046963955026,
    "byType": { "episodic": 1, "semantic": 6 },
    "bySource": { "claude-code": 3, "consolidation": 3, "mission-control": 1 },
    "sourceCount": 3,
    "conceptCount": 6,
    "topConcepts": [
      { "concept": "<redacted>", "count": 2, "avgImportance": 0.39177330555555556 },
      { "concept": "<redacted>", "count": 1, "avgImportance": 0.43703173603395057 }
    ],
    "topConceptsLimit": 20,
    "baseline": 644,
    "dailyGrowth": [
      { "date": "2026-09-04", "count": 7, "cumulative": 651 }
    ],
    "hourlyActivity": [
      { "hour": 2, "dayOfWeek": 5, "count": 1 },
      { "hour": 6, "dayOfWeek": 5, "count": 2 },
      { "hour": 8, "dayOfWeek": 5, "count": 1 },
      { "hour": 10, "dayOfWeek": 5, "count": 2 },
      { "hour": 11, "dayOfWeek": 5, "count": 1 }
    ],
    "weekdayCoverage": [ 0, 0, 0, 0, 0, 1, 0 ]
  },
  "allTime": {
    "total": 651,
    "avgImportance": 0.8122686535225514,
    "conceptCount": 228,
    "sourceCount": 15
  }
}
```

*(`?days=1` on a 651-memory store, verbatim from the running server except for the two `concept` strings, which are real memory text and are withheld here. `topConcepts` returned six entries; two are shown.)*

**`window`**

| Field | Type | Description |
|---|---|---|
| `days` | integer | Window length actually used |
| `start` / `end` | `YYYY-MM-DD` | Inclusive first and last calendar day. Label charts from these |
| `startedAt` / `endsBefore` | ISO instant | The same interval half-open: `>= startedAt`, `< endsBefore` |
| `generatedAt` | ISO instant | When the response was computed. The last day of the window is today and is partial — this is the hour to cut at |
| `timezone` | `"UTC"` | Every bucket and boundary is UTC |

**`windowed`**

| Field | Type | Description |
|---|---|---|
| `total` | integer | Memories created inside the window and still active |
| `avgImportance` | number \| **null** | Mean importance. `null`, never `0`, when the scope holds no memories |
| `byType` | `{ type: count }` | Complete for the window — not a top-N |
| `bySource` | `{ source: count }` | Complete for the window, never truncated. A `NULL` source appears as `"unknown"` |
| `sourceCount` | integer | Distinct sources in the window, counting `"unknown"` as one |
| `conceptCount` | integer | Distinct concepts in the window. **This is the statistic** — not `topConcepts.length` |
| `topConcepts` | array | Ranked page of at most `topConceptsLimit`, by `count` desc then concept name. The name tiebreak is what keeps a polling dashboard from reshuffling |
| `topConceptsLimit` | integer | The page size (`20`). A page size, not a statistic |
| `baseline` | integer | Still-active memories created *before* the window opened. Seeds `cumulative` |
| `dailyGrowth` | array | One point per day — see below |
| `hourlyActivity` | array | Sparse 7×24 heatmap — see below |
| `weekdayCoverage` | integer[7] | How many times each weekday falls in the window, indexed 0 = Sunday. A 30-day window holds five of one weekday and four of another; divide by this for a rate |

**`allTime`** carries only `total`, `avgImportance`, `conceptCount` and `sourceCount`, over every active memory regardless of date.

**`dailyGrowth`**

`length === window.days`, always — contiguous, ascending, zero-filled. Days with no memories are present with `count: 0`, so a client never has to work out which days were dropped and never splines through a gap it invented.

| Field | Type | Description |
|---|---|---|
| `date` | `YYYY-MM-DD` | The UTC day |
| `count` | integer | Memories created that day and still active — a rate |
| `cumulative` | integer | Memories still active **now** that were created on or before that day, seeded by `baseline` |

`cumulative` is deliberately not "the size of the store that day". Because `excludesArchived` applies to the past too, a store that forgets a lot draws a curve flatter in the past than it really was. `sum(dailyGrowth[].count) + baseline === dailyGrowth[last].cumulative`, and `sum(count) === windowed.total`.

**`hourlyActivity`**

Sparse over a fixed 7×24 grid the client already knows, so an absent cell is unambiguously zero rather than an interpolated one.

| Field | Type | Description |
|---|---|---|
| `hour` | integer 0–23 | UTC hour |
| `dayOfWeek` | integer 0–6 | **0 = Sunday**, matching SQLite's `strftime('%w')` |
| `count` | integer | Memories created in that cell |

**Response `400`** — `days` outside `1..365`, or not an integer.

```json
{ "statusCode": 400, "error": "Bad Request", "message": "querystring/days must be <= 365" }
```

---

## Memory CRUD

### `POST /api/memory`

Store a new memory. The brain automatically:
- Generates an embedding with the active model
- Adds to vector index and knowledge graph
- **Auto-links** to up to three namespace-scoped neighbors with cosine similarity ≥ 0.5 (creates `relates_to` edges)
- **Auto-extracts** a concept label if none provided
- **Contradiction detection** — returns heuristic candidates for verification

The Claude Code PostToolUse hook posts semantic memories with source `claude-code`, the `memory-file` and `memory-file:<basename>` tags, and the file path relative to `~/.claude/projects/` in `metadata.claudeMemoryFile`. Saving the same file in the same namespace replaces its content and returns the existing memory ID with `deduplicated: true`.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | nonempty string | yes | The memory text |
| `type` | `episodic` \| `semantic` \| `procedural` | — | Defaults to `episodic` |
| `source` | string | — | Originating system, default `rest-api` |
| `importance` | number 0–1 | — | Defaults for episodic/semantic/procedural are 0.5/0.7/0.5, or 0.75/0.85/0.8 for `claude-code` and `ollama` |
| `concept` | string | — | Semantic memories: concept label |
| `tags` | string[] | — | Categorization tags |
| `sessionId` | string | — | Group related episodic memories |
| `metadata` | object | — | Arbitrary JSON metadata |
| `triggerPattern`, `actionPattern` | string | — | Procedural trigger and action |
| `namespace` | string or null | — | Override the write namespace (`null` for global). Isolated mode returns `400` for a conflicting override |

**Request**
```json
{
  "content": "User prefers dark mode in all applications",
  "type": "semantic",
  "concept": "user preferences",
  "tags": ["ui", "preferences"],
  "importance": 0.8
}
```

**Response `201`** — `StoreResult`
```json
{
  "memory": {
    "id": "a1b2c3d4-...",
    "type": "semantic",
    "content": "User prefers dark mode in all applications",
    "concept": "user preferences",
    "importance": 0.8,
    "tags": "[\"ui\",\"preferences\"]",
    "source": "rest-api",
    "createdAt": "2026-03-21T10:00:00.000Z"
  },
  "deduplicated": false,
  "contradictions": {
    "hasContradictions": true,
    "candidatesChecked": 3,
    "latencyMs": 4,
    "contradictions": [{
      "newMemoryId": "a1b2c3d4-...",
      "existingMemoryId": "existing-uuid",
      "similarity": 0.85,
      "confidence": 0.82,
      "signals": [{ "type": "negation", "description": "Opposing statements", "weight": 0.5 }],
      "suggestedStrategy": "keep_newest"
    }]
  }
}
```

`memory` is the stored row without its embedding (selected fields shown). `deduplicated` indicates reuse of an existing record. For ordinary stores, an eligible nearest match of the same type and namespace merges tags and keeps the higher importance. `ENGRAM_DEDUP_THRESHOLD` sets the cosine threshold (greater than 0 and at most 1, default 0.97). `StoreResult` can also carry `discarded: true` for a record archived during storage. Heuristic results are unverified candidates. With no candidates, `hasContradictions` is false and the inner `contradictions` array is empty.

---

### `POST /api/memory/batch`

Bulk store memories in order. Each store commits separately.

**Request body**
```json
{
  "memories": [
    { "content": "First memory", "type": "episodic" },
    { "content": "Second memory", "type": "semantic", "importance": 0.9 }
  ]
}
```

**Response `201`**
```json
{
  "count": 2,
  "latencyMs": 45,
  "ids": ["uuid-1", "uuid-2"],
  "contradictions": 1
}
```

The legacy `contradictions` field reports how many stored memories nominated candidates across the batch. MCP `get_contradiction_tasks` returns pending pairs; `GET /api/contradictions` returns only confirmed pairs.

Each item requires nonempty `content`. Optional fields are `type` (default `episodic`), `source`, `importance` (0–1), `tags` (string array), `concept`, and `namespace` (string). Isolated mode checks the entire batch for a conflicting namespace before writing and returns `400` on a mismatch.

The batch is embedded together and stored in order; `memories` accepts at most **1000** items and `ids` come back in submission order.

---

### `GET /api/memory`

List live memories newest first. `count` is the page length. Unknown query keys or invalid values return `400`.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `type` | `episodic` \| `semantic` \| `procedural` | Filter by type |
| `source` | string | Filter by source |
| `namespace` | string | Exact namespace; intersects the brain's configured scope |
| `global` | `true` | Only memories with a null namespace; bypasses the active filter namespace, intersects the explicit `namespace`, and returns `400` in isolated mode |
| `before` | ISO date-time | Exclusive `createdAt < before`; timezone offsets normalize to UTC |
| `tag` | string | Exact tag membership (case-sensitive) |
| `limit` | integer 1–200 | Default: 50 |
| `offset` | integer >= 0 | Default: 0 |

**Example**
```
GET /api/memory?type=semantic&source=claude-code&limit=10&offset=0
```

**Response `200`**
```json
{
  "count": 1,
  "memories": [
    {
      "id": "uuid",
      "type": "semantic",
      "content": "...",
      "concept": "TypeScript",
      "importance": 0.8,
      "source": "claude-code",
      "tags": "[\"programming\"]",
      "createdAt": "2026-03-21T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/memory/:id`

Get a visible memory by exact ID, including archived records. This and the list, store, patch, search, graph and tag-read routes omit `embedding` from memory rows. `tags` and `metadata` are JSON-encoded strings. The row also includes `summary`, `embeddingDim`, `embeddingModel`, `confidence`, `accessCount`, `lastAccessedAt`, `eventAt`, `triggerPattern`, `actionPattern`, `namespace`, `updatedAt` and `deviceId`.

**Response `200`**
```json
{
  "id": "a1b2c3d4-...",
  "type": "semantic",
  "content": "User prefers dark mode in all applications",
  "concept": "user preferences",
  "importance": 0.8,
  "source": "claude-code",
  "tags": "[\"ui\",\"preferences\"]",
  "sessionId": null,
  "metadata": "{}",
  "createdAt": "2026-03-21T10:00:00.000Z",
  "archivedAt": null
}
```

**Response `404`**
```json
{
  "error": "Memory not found"
}
```

---

### `DELETE /api/memory/:id`

Archive (soft-delete) a memory by exact ID. An unknown, inaccessible or already archived ID returns `404` with `{ "error": "Memory not found" }`. Sets `archivedAt` timestamp; the memory remains in the database but is excluded from search and recall.

**Response `204`** — no body.

---

### `PATCH /api/memory/:id`

Edit a memory in place.

**Request body** — supply at least one of these fields. The schema strips extra keys.

| Field | Type | Description |
|---|---|---|
| `content` | string (min 1) | New content |
| `importance` | number 0–1 | New importance |
| `tags` | string[] | Replaces the tag list |
| `concept` | string | New concept |

Changing `content` **re-embeds** the memory and updates the vector index in the same request, so search cannot go on matching the old text.

**Response `200`** — the updated memory record.

**Response `404`**
```json
{ "error": "Memory not found" }
```

---

### `POST /api/memory/bulk/tag`

Add one tag to many memories.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `ids` | string[] (max 1000) | yes | Memory IDs |
| `tag` | string (min 1) | yes | Tag to add |

Memories that already carry the tag, do not exist, or fall outside the configured namespace are skipped rather than failing the request.

**Response `200`**
```json
{ "modified": 0, "total": 0 }
```

`total` is how many ids were submitted; `modified` is how many rows actually changed.

---

### `POST /api/memory/bulk/archive`

Archive many memories at once.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `ids` | string[], 1–1000 items | yes | Memory IDs |

`ids` must be an array of non-empty strings, and no other key is accepted — both are enforced before schema coercion, so `{"ids":"abc"}` is a `400` rather than three phantom archives.

Unknown or already-archived ids are counted as not archived and fire no webhook.

**Response `200`**
```json
{ "archived": 0, "total": 1 }
```

**Response `400`**
```json
{ "error": "Bad Request", "message": "'ids' must be an array." }
```
```json
{ "error": "Bad Request", "message": "Unknown property: foo. Allowed: ids." }
```

---

## Search & Recall

### `POST /api/search`

Search visible memories by retrieval relevance. Each result is a memory row plus `score` (cosine similarity). With hybrid search enabled, keyword matches can rank even below `threshold`.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Nonempty natural language search query |
| `topK` | integer 1–50 | — | Number of results, default 10 |
| `threshold` | number 0–1 | — | Minimum similarity score, default 0.3 |
| `types` | string[] | — | Filter to specific memory types |
| `sources` | string[] | — | Filter to specific sources |
| `since`, `until` | date-time string | — | Inclusive bounds on `eventAt`, falling back to `createdAt` |
| `tags` | string[] | — | Require every exact tag |
| `crossNamespace` | boolean | — | Search across projects in filter mode, default false; `400` in isolated mode if true |
| `namespace` | string | — | Narrow results to one exact project path |
| `global` | true | — | Narrow results to memories with namespace NULL |

Omit both project fields for all results allowed by the brain's current scope. Sending both `namespace` and `global` returns `400`. These filters only narrow results; configured namespace isolation and `crossNamespace` behavior are unchanged.

**Request**
```json
{
  "query": "database migration patterns",
  "topK": 5,
  "threshold": 0.4,
  "types": ["procedural", "semantic"]
}
```

**Response `200`**
```json
{
  "count": 1,
  "latencyMs": 28,
  "results": [
    {
      "id": "uuid",
      "type": "procedural",
      "content": "For Drizzle ORM: always use drizzle-kit generate → migrate...",
      "importance": 0.9,
      "score": 0.87
    }
  ]
}
```

---

### `POST /api/recall`

Assemble working memory context for AI injection. This is the primary endpoint used by all adapters. Runs the full 7-step recall pipeline and returns a formatted context string ready to prepend to a system prompt.

**7-step pipeline:**
1. Embed the query
2. Vector search (top-K nearest)
3. Graph expansion (follow edges from vector hits)
4. Recency weighting
5. Importance weighting
6. Deduplication
7. Token-budget packing

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Nonempty message or question |
| `maxTokens` | integer | — | Token budget 1–32000, default 2000 |
| `types` | string[] | — | Restrict to memory types |
| `sources` | string[] | — | Restrict to sources |
| `sessionId` | string | — | Session ID for recall history |
| `source` | string | — | Source for recall history, default `rest-api` |
| `touch` | boolean | — | Update access statistics and record the recall, default true |
| `since`, `until` | date-time string | — | Inclusive event/creation date bounds |
| `tags` | string[] | — | Require every exact tag |
| `crossNamespace` | boolean | — | Default false; rejected in isolated mode if true |
| `namespace`, `global` | string, literal `true` | — | Select one exact namespace or only global memories. Sending both returns `400` |

**Request**
```json
{
  "query": "How should I handle database schema changes?",
  "maxTokens": 1500
}
```

**Response `200`**
```json
{
  "context": "[NEURAL MEMORY CONTEXT]\n\n[KNOWLEDGE]\n• [a1b2c3d4 · 2026-03-21] Use migrations.\n\n[END MEMORY CONTEXT]",
  "memories": [{
    "id": "a1b2c3d4-...", "type": "semantic", "content": "Use migrations.",
    "summary": null, "score": 0.91, "similarity": 0.87,
    "source": "rest-api", "createdAt": "2026-03-21T10:00:00.000Z"
  }],
  "latencyMs": 43
}
```

The `context` string is ready to inject as a system prompt prefix:

```
You have access to relevant memories from your knowledge base:

{context}

---

User: {user_message}
```

---

### `POST /api/recall/explain`

Preview the context assembled before `onRecall` plugins can modify it, with ranking, context positions and budget decisions. Uses the same retrieval, graph expansion, filters and hybrid-search setting as `/api/recall`. Embeds the query but performs no database writes: access counts, last-access timestamps and recall audit rows stay unchanged, and recall plugin hooks are not called. Uses the same `heavy` rate-limit tier as `/api/recall` (300 requests per 60 seconds by default, shared with other heavy endpoints).

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Nonempty recall query |
| `maxTokens` | integer | — | 1–32000, default 2000 |
| `types` | string[] | — | `episodic`, `semantic`, `procedural` |
| `sources` | string[] | — | Restrict sources; a null source matches an empty string |
| `since`, `until` | string | — | Inclusive ISO date-time bounds on `eventAt`, falling back to `createdAt` |
| `tags` | string[] | — | Require every exact tag |
| `namespace` | string | — | Narrow to this exact project within the configured access scope |
| `global` | boolean | — | Must be `true`; narrow to NULL namespaces; mutually exclusive with `namespace` |
| `crossNamespace` | boolean | — | Default false; allow cross-project retrieval in filter mode; forbidden in isolated mode |

**Request**
```json
{ "query": "How do we deploy?", "maxTokens": 1500, "namespace": "/code/api" }
```

**Response `200`**
```typescript
{
  context: string;
  latencyMs: number;
  budget: { maxTokens: number; usedTokens: number };
  candidates: number;
  items: Array<{
    id: string;
    rank: number;
    position: number | null;
    offset: number | null;
    section: 'knowledge' | 'patterns' | 'events';
    type: 'semantic' | 'procedural' | 'episodic';
    source: string | null;
    via: 'vector' | 'graph';
    similarity: number;
    score: number;
    chars: number;
    tokens: number;
    included: boolean;
    reason?: 'over_budget';
  }>;
}
```

`items` are in score order; `rank` starts at 1. Included items have a one-based `position` in the context text (knowledge, patterns, then events; score order within each section). `offset` is the zero-based JavaScript string offset (UTF-16 code units) of the item's bullet in `context`. Both are null for omitted items. `via: 'vector'` includes hybrid retrieval hits when enabled; `graph` identifies expansion-only hits.

`chars` counts the rendered summary, or content when summary is null; `tokens = ceil(chars / 4)`. `budget.usedTokens = ceil(sum of included chars / 4)`, excluding headings, citations and other formatting, exactly as recall budgets today. Recall always includes its top memory, so used tokens can exceed the requested budget. Oversized later items get `included: false, reason: 'over_budget'`; smaller lower-ranked items may still fit. With filters, recall also caps inclusion at its existing topK of 20; candidates beyond that cap are omitted without an over-budget reason. `candidates` counts all scored candidates after filters, before budget/topK selection. No matches returns empty context/items and zero used tokens/candidates.

**Errors:** `400` for malformed or unknown body fields, conflicting project filters, or isolated-mode cross-namespace access; `401` for missing/invalid authentication when configured; `429` when rate limited.

---

### `GET /api/recall/stream`

Server-Sent Events (SSE) endpoint for streaming recall results as they become available. Useful for UIs that want to show progressive recall.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | The recall query |
| `maxTokens` | integer | — | Token budget 1–32000, default 2000 |
| `types`, `sources` | string | — | Comma-separated memory types or sources |
| `since`, `until` | date-time string | — | Inclusive event/creation date bounds |
| `tags` | string[] | — | Repeat `tags` for each required tag |
| `crossNamespace` | boolean | — | Default false; rejected in isolated mode if true |

Unknown query keys return `400`.

**Example**
```
GET /api/recall/stream?query=deployment+best+practices&maxTokens=1500
```

**SSE event stream**

```
event: vector
data: {"phase":"vector","memory":{"id":"uuid","type":"procedural","content":"Run migrations","summary":null,"score":0.91,"similarity":0.87,"source":"rest-api","createdAt":"2026-03-21T10:00:00.000Z"},"rank":1,"contextSoFar":"…"}

event: complete
data: {"phase":"complete","context":"…","memories":[{"id":"uuid","type":"procedural","content":"Run migrations","summary":null,"score":0.91,"similarity":0.87,"source":"rest-api","createdAt":"2026-03-21T10:00:00.000Z"}],"latencyMs":62}
```

| Event | Description |
|---|---|
| `vector` | Fired when vector search results are ready |
| `graph` | One frame per selected graph-expansion memory, with the same fields as `vector` |
| `complete` | Final assembled context with all pipeline steps applied |
| `error` | If streaming fails after headers, `{"error":"Recall stream failed"}` ends the stream |

---

## Decay & Retention

### `POST /api/decay`

Run a decay sweep over live memories in scope. Protection rules and the `pending-distill` tag exempt memories. Unprotected memories below the retention threshold are archived; other eligible memories lose importance according to elapsed time and the decay policy.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `dryRun` | boolean | — | Preview what would be decayed without applying changes (default: false) |

**Request**
```json
{
  "dryRun": true
}
```

**Response `200`**
```json
{
  "scannedCount": 15,
  "archivedCount": 2,
  "archivedIds": ["uuid-1", "uuid-2"],
  "decayedCount": 8,
  "protectedCount": 5,
  "consolidatedCount": 0,
  "newSemanticIds": [],
  "durationMs": 12
}
```

A preview computes counts and archive IDs without writing or running consolidation. An omitted body runs a live sweep. Unknown fields or a non-boolean `dryRun` return `400`.

---

### `GET /api/decay/policy`

Retrieve the current decay policy configuration.

**Response `200`**
```json
{
  "halfLifeDays": 7,
  "archiveThreshold": 0.05,
  "decayIntervalMs": 3600000,
  "batchSize": 200,
  "importanceDecayRate": 0.01,
  "importanceFloor": 0.05,
  "consolidation": {
    "enabled": true, "minClusterSize": 3,
    "similarityThreshold": 0.6, "minEpisodicAgeMs": 86400000
  },
  "protectionRuleCount": 5
}
```

---

### `PUT /api/decay/policy`

Update the decay policy configuration.

**Request body**
```json
{
  "halfLifeDays": 14,
  "archiveThreshold": 0.1,
  "consolidation": { "enabled": false }
}
```

All fields are optional. `halfLifeDays` accepts 1–36500. `archiveThreshold`, `importanceDecayRate` and `importanceFloor` accept 0–1. `batchSize` is an integer from 1–100000. `decayIntervalMs` is 0 (disable) or an integer from 1000–2147483647. Changing it reschedules the timer. Inside `consolidation`, `enabled` is boolean, `minClusterSize` an integer from 2–10000, `similarityThreshold` a number from 0–1 and `minEpisodicAgeMs` a number from 0 through `Number.MAX_SAFE_INTEGER`. Invalid bounds return `400`.

`protectionRules` is **refused** rather than ignored: a rule carries a predicate function, which JSON cannot express. Configure protection rules in-process.

**Response `200`** — the serialized policy plus `"message": "Decay policy updated"`.

**Response `400`**
```json
{ "error": "protectionRules cannot be set over HTTP: a rule needs a predicate function, which JSON cannot express. Configure them in-process instead." }
```

---

## Contradiction Detection

### `GET /api/contradictions`

List live confirmed unresolved contradiction edges with both memories in scope, ordered by edge ID.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `limit` | integer 1–1000 | Default: 200 |
| `offset` | integer >= 0 | Default: 0 |
| `namespace` | string | Exact namespace for both ends, intersected with the brain's scope |
| `global` | `true` | Both ends must have a null namespace |

Unknown/repeated query parameters or invalid bounds return 400. Archived memories and tombstoned edges are excluded. `count` is this page's length; `total` is the SQL count before pagination.

**Response `200`**
```json
{
  "count": 1,
  "total": 3,
  "contradictions": [{
    "edgeId": "edge-uuid",
    "confidence": 0.85,
    "metadata": {},
    "source": { "id": "uuid-1", "content": "First fact", "type": "semantic", "importance": 0.7, "createdAt": "2026-03-24T14:30:00.000Z" },
    "target": { "id": "uuid-2", "content": "Second fact", "type": "semantic", "importance": 0.7, "createdAt": "2026-03-24T14:31:00.000Z" }
  }]
}
```

---

### `POST /api/contradictions/check/:id`

Check a specific memory for unverified candidates. `200` returns the inner check result from `POST /api/memory`.

**Response `200`**
```json
{ "hasContradictions": false, "contradictions": [], "candidatesChecked": 3, "latencyMs": 4 }
```

**Response `404`** — `{ "error": "Memory not found" }` for a missing, archived or inaccessible memory. A record without an embedding raises an internal error (`500`).

---

### `POST /api/contradictions/resolve`

Resolve a contradiction between two memories using the core resolution path.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceId` | string | yes | Exact ID of one memory in the pair |
| `targetId` | string | yes | Exact ID of the other memory |
| `strategy` | string | yes | Resolution strategy (see below) |

**Strategies**

| Strategy | Behavior |
|---|---|
| `keep_newest` | Archive the older memory, keep the newer one |
| `keep_oldest` | Archive the newer memory, keep the older one |
| `keep_important` | Archive the less important memory |
| `keep_both` | Mark as resolved without archiving either memory |
| `manual` | Leave unresolved for human review (`resolved: false`) |

**Request**
```json
{
  "sourceId": "uuid-1",
  "targetId": "uuid-2",
  "strategy": "keep_newest"
}
```

**Response `200`**
```json
{
  "resolved": true,
  "keptId": "uuid-2",
  "archivedId": "uuid-1"
}
```

`keep_both` returns `keptId` without `archivedId`. Resolution requires a confirmed edge and two live, accessible memories. With a live candidate edge, an archived endpoint, or `manual`, `resolved` is false. Identical IDs return `400`; a missing live contradiction edge returns `404` (`Contradiction not found`). If the edge exists but core cannot access an endpoint, its exception goes through the generic `500` handler.

---

### `POST /api/contradictions/bulk/resolve`

Resolve up to 500 contradiction pairs. Items run sequentially in request order through the same core resolution, sync notification and realtime event path as the single endpoint. Each item commits independently; a failure does not roll back earlier successes or stop later items.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | array | yes | 1–500 resolution items |
| `items[].sourceId` | string | yes | Exact memory ID, matching the single endpoint |
| `items[].targetId` | string | yes | Exact ID of the other memory |
| `items[].strategy` | string | yes | One of the five strategies listed above |

Uses pair IDs, not `edgeId`. Both memories must be visible under the brain's namespace configuration, just like single resolution and bulk memory writes. A missing live edge returns `Contradiction not found` per item; equal IDs return `sourceId and targetId must differ`. If a live edge exists but a memory is missing or inaccessible, the item reports `Memory not found`. Uses existing API authentication and the `heavy` plus `global` rate tiers: this is a bounded batch of writes like bulk archive/tag, rather than a whole-store scan. Normal `401`/`429` responses apply.

**Request**
```json
{
  "items": [
    { "sourceId": "uuid-1", "targetId": "uuid-2", "strategy": "keep_both" },
    { "sourceId": "missing", "targetId": "uuid-3", "strategy": "keep_newest" }
  ]
}
```

**Response `200`** (including partial failure)
```json
{
  "results": [
    { "ok": true },
    { "ok": false, "error": "Contradiction not found" }
  ],
  "summary": { "total": 2, "resolved": 1, "failed": 1 }
}
```

`results` matches input order. `ok` means core returned `resolved: true`; `manual` and already archived endpoints return `Contradiction not resolved`. Unexpected per-item failures return `Failed to resolve contradiction` without exposing internal details. Duplicate pairs follow the single endpoint's behavior. Invalid bodies (including an invalid strategy, empty list or more than 500 items) return `400` before any writes.

---

### `GET /api/contradictions/config`

Retrieve the contradiction detection configuration.

**Response `200`**
```json
{
  "enabled": true,
  "similarityThreshold": 0.65,
  "confidenceThreshold": 0.4,
  "maxCandidates": 10,
  "defaultStrategy": "keep_both",
  "autoResolve": false
}
```

---

### `PUT /api/contradictions/config`

Update contradiction detection configuration.

**Request body**
```json
{
  "enabled": true,
  "confidenceThreshold": 0.8,
  "autoResolve": true,
  "defaultStrategy": "keep_important"
}
```

Supply at least one field from `GET`. `enabled` and `autoResolve` are booleans, both thresholds are numbers from 0–1, `maxCandidates` is an integer from 1–50 and `defaultStrategy` accepts the five resolution strategies above. Unknown keys or invalid bounds return `400`. The legacy `autoResolve` flag does not resolve an unverified candidate.

**Response `200`** — the updated config object (same shape as `GET`).

---

## Embedding Management

### `GET /api/embeddings/status`

Check the status of embeddings on live memories in scope. `mixedEmbeddingModels` has the same optional shape as in `GET /api/stats`. `dimensionMismatchCount` counts vectors whose stored length differs from the active dimension.

**Response `200`**
```json
{
  "currentModel": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "currentDimension": 384,
  "totalEmbedded": 101,
  "currentModelCount": 101,
  "staleCount": 0,
  "legacyCount": 0,
  "dimensionMismatchCount": 0,
  "needsReEmbed": false
}
```

---

### `POST /api/embeddings/re-embed`

Re-generate existing embeddings for live memories in scope. Useful after switching embedding models.

**Request body**
```json
{
  "batchSize": 50
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `batchSize` | integer 1–100 | — | Memories per batch, default 32 |
| `onlyStale` | boolean | — | Default true: repair missing/different model labels or mismatched dimensions. False processes every existing embedding in scope |

**Response `200`** — returned when processing finishes.
```json
{
  "total": 3, "processed": 3, "failed": 0, "failedIds": [], "durationMs": 150,
  "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "message": "Re-embedded 3 memories in 150ms"
}
```

Progress is reported via the `embedding:progress` WebSocket event.

After updating vectors, the server attempts to save the refreshed index when persistence is configured. The completed re-embed still succeeds if that cache write fails. When several processes share one `ENGRAM_DB_PATH` they also share the default `<db>.index` path — give each its own `ENGRAM_INDEX_PATH` so they do not overwrite each other's index.

---

### `POST /api/embeddings/backfill`

Stamp live rows in scope whose model label is null with the current model ID. The operation does not generate vectors.

**Response `200`** — the embedding status object plus `message` (`Backfilled legacy memories with model: <model>`).

---

## Vector Index

### `GET /api/index/status`

Check the status of the vector index.

Reconciles with memories committed by other processes before answering, so the
entry count reflects the index as it stands rather than as it was loaded at
startup.

**Response `200`**
```json
{
  "loadedFrom": "disk",
  "entryCount": 568,
  "dimension": 384,
  "persisted": true,
  "indexFileName": "engram.db.index",
  "indexFileExists": true,
  "incrementalCount": 0,
  "initDurationMs": 62,
  "externalSyncCount": 1,
  "externalAdded": 27,
  "externalRemoved": 0,
  "externalRefreshed": 0,
  "externalSkipped": 0,
  "dimensionMismatched": 0
}
```

| Field | Meaning |
|---|---|
| `loadedFrom` | `disk` (cache hit), `database` (full rebuild) or `not_loaded` |
| `entryCount` | Vectors in the index right now |
| `persisted`, `indexFileName` | Whether persistence is configured, and the filename (null when disabled) |
| `externalRefreshed` | Entries refreshed after their stored vector changed |
| `dimensionMismatched` | Vectors rejected for incompatible dimensions since the last full index pass |
| `incrementalCount` | Memories added at startup on top of the disk cache |
| `initDurationMs` | How long initialization took |
| `externalSyncCount` | Reconciles that pulled in another process's work |
| `externalAdded` / `externalRemoved` | Entries added / dropped by those reconciles |
| `externalSkipped` | Memories left unindexed because their vector came from a different embedding model — non-zero means a re-embed is due |

---

### `POST /api/index/rebuild`

Rebuild the vector index from scratch using all current embeddings.

**Response `200`** — current index status plus `message` (`Index rebuilt: <count> entries in <ms>ms`).

---

### `POST /api/index/save`

Persist the current in-memory index to disk.

The write is asynchronous and atomic — it goes to a temporary file that is renamed over the target, so an interrupted save leaves the previous index readable rather than truncated.

**Response `200`** — current index status plus `"message": "Index saved"`.

---

## Webhooks

Webhook events are `stored`, `forgotten`, `decayed`, `consolidated`, `contradiction` and `reflected`. These are **not** the Socket.io event names — see [WebSocket Events](#websocket-events) for those.

A subscription's `secret` is write-only. It is supplied on subscribe, kept for the signer, and **never serialized back out** — reads report a `hasSecret` boolean instead, because handing the HMAC key back to anyone with read access lets them forge deliveries the receiver would accept. A lost secret is rotated by re-subscribing.

Target URLs are checked against an SSRF guard before the subscription is stored: loopback, link-local (cloud metadata), RFC1918 and other non-global addresses are refused unless `ENGRAM_WEBHOOK_ALLOW_PRIVATE=true`. At delivery time the connection is pinned to the address that was validated, connection pooling is off, and **redirects are never followed** — a `302` is an ordinary failed delivery.

### `GET /api/webhooks`

List all registered webhook subscriptions.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `activeOnly` | boolean | Only subscriptions that have not been auto-disabled. Default `false` |

**Response `200`**
```json
{
  "count": 1,
  "webhooks": [
    {
      "id": "f696a516-24d4-4d75-946b-ca431629c34f",
      "url": "https://example.com/hook",
      "events": ["stored", "contradiction"],
      "active": true,
      "description": "doc probe",
      "hasSecret": true,
      "createdAt": "2026-09-04T16:35:14.104Z",
      "lastTriggeredAt": null,
      "failCount": 0
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `active` | boolean | Auto-disabled after 10 consecutive delivery failures |
| `hasSecret` | boolean | Whether an HMAC secret is configured. `true` exactly when a delivery would be signed |
| `failCount` | integer | Consecutive failures; reset by a successful delivery |

---

### `POST /api/webhooks`

Subscribe a new webhook endpoint.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | The URL to receive POST callbacks |
| `events` | string[] | yes | Array of `stored`, `forgotten`, `decayed`, `consolidated`, `contradiction`, `reflected` |
| `secret` | string | — | Shared secret for the `X-Engram-Signature` HMAC. Write-only |
| `description` | string | — | Free-text label |

**Request**
```json
{
  "url": "https://example.com/hook",
  "events": ["stored", "contradiction"],
  "secret": "whsec_abc123",
  "description": "doc probe"
}
```

**Response `201`**
```json
{
  "id": "f696a516-24d4-4d75-946b-ca431629c34f",
  "url": "https://example.com/hook",
  "events": ["stored", "contradiction"],
  "active": true,
  "description": "doc probe",
  "hasSecret": true,
  "createdAt": "2026-09-04T16:35:14.104Z",
  "lastTriggeredAt": null,
  "failCount": 0
}
```

Note the response carries `hasSecret`, not the secret you sent.

**Response `400`** — the URL failed the SSRF guard.
```json
{ "error": "Webhook URL resolves to a private or loopback address (127.0.0.1). Set ENGRAM_WEBHOOK_ALLOW_PRIVATE=true to allow it." }
```

---

### `GET /api/webhooks/:id`

Get a single webhook subscription by ID.

**Response `200`** — webhook object (same shape as list items).

**Response `404`**
```json
{ "error": "Webhook not found" }
```

---

### `DELETE /api/webhooks/:id`

Remove a webhook subscription. An unknown ID returns `404` with `{ "error": "Webhook not found" }`.

**Response `204`** — no body.

---

### `POST /api/webhooks/:id/test`

Send a test payload to the webhook endpoint to verify connectivity. Retryable failures (including HTTP 408, 429 and 5xx) get up to three attempts. Other non-2xx HTTP responses end the test immediately.

**Response `200`**
```json
{
  "webhookId": "f696a516-24d4-4d75-946b-ca431629c34f",
  "url": "https://example.com/hook",
  "success": false,
  "statusCode": 405,
  "error": "HTTP 405: Method Not Allowed",
  "attempts": 1
}
```

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Whether the endpoint answered 2xx |
| `statusCode` | integer | Present when a response was received |
| `error` | string | Present when the delivery failed |
| `attempts` | integer | Delivery attempts made |

**Response `404`** — an unknown id is a 404, not a `success: false` delivery report.
```json
{ "error": "Webhook not found" }
```

---

## Tags & Collections

### `GET /api/tags`

List all tags in use, with memory counts.

**Response `200`**
```json
{
  "count": 3,
  "tags": [
    { "tag": "programming", "count": 24 },
    { "tag": "preferences", "count": 8 },
    { "tag": "architecture", "count": 6 }
  ]
}
```

---

### `GET /api/tags/:tag`

List visible live memories with a specific tag (selected row fields shown). The optional integer query parameters are `limit` (1–200, default 50) and `offset` (≥ 0, default 0). Unknown keys or invalid bounds return `400`. `count` is the page length.

**Response `200`**
```json
{
  "tag": "programming",
  "count": 1,
  "memories": [
    {
      "id": "uuid",
      "type": "semantic",
      "content": "TypeScript strict mode should always be enabled...",
      "importance": 0.85
    }
  ]
}
```

---

### `GET /api/collections`

List tag groups by prefix before the first colon. Unprefixed tags belong to `default`. `totalMemories` counts each memory once per group.

**Response `200`**
```json
{
  "count": 1,
  "collections": [
    {
      "name": "project",
      "prefix": "project",
      "tags": [{ "tag": "project:engram", "count": 38 }],
      "totalMemories": 38
    }
  ]
}
```

---

### `POST /api/memory/:id/tags`

Add one tag to a memory. A missing or inaccessible memory returns `404` with `{ "error": "Memory not found" }`.

**Request body**
```json
{
  "tag": "new-tag"
}
```

**Response `200`**
```json
{
  "id": "uuid",
  "tags": ["existing-tag", "new-tag"]
}
```

---

### `DELETE /api/memory/:id/tags/:tag`

Remove a single tag from a memory. A missing or inaccessible memory returns `404` with `{ "error": "Memory not found" }`.

**Response `200`**
```json
{
  "id": "uuid",
  "tags": ["remaining-tag"]
}
```

---

## Plugins

### `GET /api/plugins`

List all registered plugins.

**Response `200`**
```json
{
  "count": 1,
  "plugins": [
    {
      "id": "custom-agent-memory",
      "name": "Custom Agent Memory Plugin",
      "version": "1.0.0",
      "description": "Optional plugin description",
      "registeredAt": "2026-03-24T09:00:00.000Z",
      "hooks": ["onStore", "onRecall"]
    }
  ]
}
```

---

### `GET /api/plugins/:id`

Get details for a specific plugin.

**Response `200`** — plugin object (same shape as list items). An unknown ID returns `404` with `{ "error": "Plugin not found" }`.

---

### `DELETE /api/plugins/:id`

Unregister a plugin. An unknown ID returns `404` with `{ "error": "Plugin not found" }`.

**Response `204`** — no body.

---

## Atlas Review

Review reads accept `namespace` and `global=true`. The global selector bypasses the active filter namespace and returns `400` in isolated mode. Pair queues require **both** ends in scope. Archived memories and tombstoned edges are excluded. These endpoints use the existing authentication; all Review GET/HEAD requests consume the `whole-store` and `global` rate tiers because reads share a whole-store scan. Dismiss uses `global`; redact uses `heavy` and `global`. Normal 401/429 responses apply.

### `GET /api/review/summary`

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `namespace` | string | Exact project namespace |
| `global` | `true` | Only null-namespace memories |

**Response `200`**
```json
{ "contradictions": 4, "duplicates": 3, "fading": 2, "secrets": 1, "fingerprint": "sha256-hex" }
```

Counts exclude dismissals. `secrets` counts memories, not individual findings. The fingerprint covers visible memory data, edges, dismissals, and decay eligibility. The app caches the most recently requested snapshot by this fingerprint; current retention is refreshed on reads.

### `GET /api/review/:queue`

`queue` is `contradictions`, `duplicates`, `fading`, or `secrets`; other values return 404.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `namespace` | string | Exact project namespace |
| `global` | `true` | Only null-namespace memories |
| `limit` | integer 1–200 | Default: 50 |
| `offset` | integer >= 0 | Default: 0 |

**Response `200`**: `{ total: number, items: (PairItem | SingleItem)[] }`. `total` is before pagination, after scope and dismissal filters; an offset past the end returns an empty `items` array. Unknown/repeated query keys or invalid values return 400 on both read endpoints.

```typescript
type MemoryLite = {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  content: string; concept: string | null; summary: string | null;
  importance: number; createdAt: string;
};
type PairItem = {
  kind: 'pair'; a: MemoryLite; b: MemoryLite;
  edgeId: string; strength: number; sharedWordRatio: number;
};
type SingleItem = {
  kind: 'single'; memory: MemoryLite; retention: number;
  reason: 'fading-but-important' | 'possible-secret';
  findings?: {
    rule: string; field: 'content' | 'concept' | 'summary';
    start: number; end: number; length: number; preview: string;
  }[];
};
```

- `contradictions`: confirmed unresolved `contradicts` edges, ordered by edge ID.
- `duplicates`: existing live `relates_to` edges with strength >= 0.95, ordered by edge ID; no new similarity computation. `sharedWordRatio` is the intersection/union of lowercase word sets in the masked content (0 for empty sets).
- `fading`: not protected by the current decay policy, importance >= 0.6, and server retention < twice `archiveThreshold`; importance descending, then memory ID.
- `secrets`: at least one finding in content, concept, or summary, ordered by memory ID. Findings use UTF-16 offsets into the **original** field, with exclusive `end` and `length = end - start`.

Detected spans in **every Review queue's** content, concept, and summary are replaced with `[REDACTED]`. Findings expose only rule, field, offsets, length, and a masked preview (for example `ghp_****Ef12`), never the matched value or surrounding text. Embeddings, tags, source, and arbitrary metadata are omitted from `MemoryLite`.

**Secret rule names**

| Rule | Detects |
|---|---|
| `github-token` | `gh[pousr]_` tokens and `github_pat_` tokens |
| `gitlab-token` | `glpat-` tokens |
| `aws-access-key` | `AKIA` and `ASIA` access key IDs |
| `ai-api-key` | OpenAI `sk-` and Anthropic `sk-ant-` style keys |
| `cloudflare-api-token` | `cfat_` tokens |
| `cloudflare-tunnel-token` | Base64 JSON tunnel credentials containing string `a`, `t`, and `s` fields |
| `slack-token` | `xox[abprs]-` tokens |
| `stripe-key` | `sk_live_` and `rk_live_` keys |
| `jwt` | Three-part `eyJ…` tokens |
| `private-key` | PEM private-key blocks, including incomplete blocks through end of field |
| `url-credentials` | Username/password credentials in URLs |
| `keyword-assignment` | Password, passwd, passphrase, pass, secret, API key, token, access key, or пароль assignments; values of at least six characters |
| `keyword-entropy` | 32+ character runs, at least ten distinct characters and entropy >= 3.5 bits/character, within 40 characters of a secret keyword |

Placeholders such as `your-api-key`, `your_api_key`, `xxx`, `<token>`, `${TOKEN}`, `***`, `example`, `sk-...`, `[REDACTED]`, and `user:password@` are excluded. UUIDs are excluded from generic detection; git SHAs and other high-entropy strings require a nearby keyword. Findings retain overlapping rule matches; redaction replaces an overlapping span once.

### `POST /api/review/dismiss`

**Request body**
```json
{ "queue": "duplicates", "ids": ["uuid-1", "uuid-2"] }
```

`queue` is `duplicates`, `fading`, or `secrets`. Duplicates require two distinct IDs; single queues require one. IDs must identify live, accessible memories. Returns **204**, with no body; 400 for an invalid body and 404 for unknown, archived, or inaccessible IDs.

Dismissals persist in the existing `local_meta` row `review.dismissed.v1` as queue/ID keys (pair IDs sorted). This is the simplest existing device-local metadata storage: no migration, memory tag pollution, or sync change. Repeating a dismissal is idempotent. Dismissals survive app restarts and memory edits and affect both counts and lists.

Use `POST /api/contradictions/resolve` (or `/api/contradictions/bulk/resolve` for up to 500 pairs) with `keep_both` for “not a contradiction”; `DELETE /api/memory/:id` to keep only the other duplicate; `POST /api/memory/:id/tags` with `pinned` to protect a fading memory; and existing `/api/memory/bulk/archive` and `/api/memory/bulk/tag` for batches (up to 1000 IDs).

### `POST /api/memory/:id/redact`

**Request body**
```json
{ "rules": ["github-token", "ai-api-key"] }
```

Send `{}` for all rules. `rules` is an optional array of rule names from the table above; an empty array selects none. Unknown fields, unknown rule names, duplicate rules, or a non-array `rules` value return 400.

The server rescans the live memory, replaces each selected secret span with exactly `[REDACTED]`, and calls the same core update path as `PATCH /api/memory/:id` for content, concept, and summary. It updates sync timestamps/device attribution, schedules sync, and re-embeds when the normal embedding text changes. It does not archive or purge any rows, including old archived copies. Dismissal does not prevent explicit redaction.

**Response `200`**
```json
{ "id": "uuid-1", "redacted": 3 }
```

`redacted` counts replaced spans across all three fields. No memory text or secret is returned. Missing, archived, inaccessible, or prefix-only IDs return 404; no selected findings returns 409 `{ "error": "Nothing to redact" }`.

---

## Atlas Map

The dashboard's Map switcher adds four lazy views at `#/?view=sky|landscape|river|pulse`: **Sky** (a WebGL memory sky), **Landscape** (retention terrain with a Now / +7 / +30 / +90-day decay preview), **River** (braided history by region) and **Pulse** (recall ranks, graph pulls, token budget and exclusions). Pulse uses the existing read-only `POST /api/recall/explain` endpoint; these hash routes select dashboard views, not API endpoints.

### `GET /api/map`

Returns a cached 2D map of live memories visible to this brain. Coordinates lie in `[-1, 1]`. PCA-2 is refined with a deterministic force layout over existing `relates_to` links with strength ≥ 0.5; `fallback` indicates insufficient usable embeddings.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | Exact project namespace, intersected with the brain's configured scope |
| `global` | `true` | Select only memories with a null namespace, as on `GET /api/memory` |

Unknown query parameters and invalid values return `400`. In isolated mode `global=true` returns `400`. Otherwise combining `namespace` and `global=true` intersects both filters and returns an empty map.

**Response `200`**
```json
{
  "fingerprint": "m:1:…",
  "generatedAt": "2026-10-19T12:00:00.000Z",
  "computeMs": 12.4,
  "method": "fallback",
  "explainedVariance": [0, 0],
  "embeddingModel": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "nodes": [{
    "id": "memory-id", "x": 0.2, "y": -0.3,
    "type": "semantic", "importance": 0.7, "retention": 0.42,
    "protected": false, "createdAt": "2026-10-18T12:00:00.000Z",
    "lastAccessedAt": null, "namespace": null, "source": "rest-api",
    "isReflection": false, "regionId": "memory-id",
    "degree": 0, "contradictCount": 0, "label": "Database connections"
  }],
  "regions": [{
    "id": "memory-id", "name": "Database · Connections",
    "autoName": "Database · Connections", "count": 1,
    "x": 0.2, "y": -0.3, "reflectionShare": 0,
    "contradictions": 0, "newThisWeek": 1, "topTags": ["database"]
  }]
}
```

`method` is `pca2+knn` or `fallback`; `explainedVariance` contains the two PCA variance fractions. `embeddingModel`, `source`, `namespace` and `lastAccessedAt` can be null. Labels are at most 80 characters. Retention and protection use core's active decay policy and are refreshed on each response. `degree` counts incident visible live connections; `contradictCount` counts only confirmed contradiction edges. Unverified candidates (including legacy edges with no status) are excluded from graph, map, and scene data.

Regions use Louvain communities, with communities smaller than eight merged into their nearest neighbour. On a full layout, the ID is the member nearest the region centroid (the squared-distance medoid). Between full layouts, a surviving previous region ID is reused when possible. Names rank terms within the visible scope, preferring tags and concepts and falling back to content when those provide no usable words. They ignore stopwords, short and numeric tokens, and `reflection*` / `mc:*` metadata. A dominant two-word phrase keeps its reading order; otherwise the top two terms are joined. Labels use title case, with suffixes to distinguish duplicate names. `name` equals `autoName`; custom names belong to the client and are never persisted by the server. `contradictions` counts distinct incident contradiction edges once per region, and `newThisWeek` covers the trailing seven days.

The layout is cached per project scope. New memories below the recompute threshold are placed at their similarity-weighted neighbour centroid without moving existing points. Unlinked inserts use deterministic fallback positions. A full layout runs when the count changes by at least 10% relative to its last full run, or on rebuild; recomputes use previous positions and Procrustes alignment. `generatedAt` and `computeMs` describe the last layout update, not the current request.

**Response `503`** — first computation in progress, or the map computation slot is busy for another scope. Retry after the indicated delay.
```json
{ "error": "map not ready", "retryAfterMs": 250 }
```

An empty store returns `nodes: []`, `regions: []`, `method: "fallback"`, and zero explained variance after the first computation.

---

### `POST /api/map/rebuild`

Force and await a full map recomputation. Accepts the same optional `namespace` / `global=true` query as `GET /api/map`; the body may be omitted or `{}`. Unknown body fields return `400`.

**Response `204`** — rebuilt successfully, no body.

Uses the `whole-store` rate tier and `runExclusive('map')`. Concurrent map computation returns `409`; normal authentication and `429` rate limits apply.

---

## Knowledge Graph

### `GET /api/graph/:id`

Get the knowledge graph neighborhood for a memory node.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `depth` | integer 1–4 | Traversal depth in either direction, default 2 |

An unknown query key or invalid depth returns `400`. A missing or inaccessible root returns `404` with `{ "error": "Memory not found" }`. `node` and `neighbors` contain memory rows without embeddings (selected fields shown).

**Response `200`**
```json
{
  "node": {
    "id": "uuid",
    "type": "semantic",
    "concept": "Engram"
  },
  "connections": [
    {
      "id": "conn-uuid",
      "sourceId": "uuid",
      "targetId": "target-uuid",
      "relationship": "relates_to",
      "strength": 0.9
    }
  ],
  "neighbors": [
    {
      "id": "target-uuid",
      "type": "semantic",
      "concept": "MCP Protocol"
    }
  ]
}
```

---

### `GET /api/graph/layout`

One 3D coordinate per memory, derived from that memory's stored embedding by a PCA projection into three components. This endpoint remains available to API clients; the Atlas dashboard uses the 2D projection from `GET /api/map`.

The projection is computed server-side (the vectors live there, and 651 × 384 floats is about a megabyte a browser has no reason to download) and cached on a fingerprint of the memory set — row count, newest creation/update timestamps, summed access counts, active namespace and global selector. A recall that increments an access count can refresh the layout.

Nodes are scoped exactly as `GET /api/memory` scopes its list: archived memories are excluded, and the configured namespace applies.

The only query parameter is optional `global=true`, which selects null-namespace memories. An unknown key, invalid value or global request in isolated mode returns `400`.

**Response `200`**
```json
{
  "method": "pca3",
  "halfExtent": 42,
  "count": 651,
  "projected": 651,
  "unprojected": 0,
  "explainedVariance": [0.24093698985178116, 0.09472036395954171, 0.046422251410887],
  "fingerprint": "m:651:2026-09-04T12:59:20.787Z:2026-09-04T11:27:59.722Z:812:-:global=false",
  "generatedAt": "2026-09-04T16:23:26.925Z",
  "embeddingModel": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "computeMs": 157,
  "nodes": [
    {
      "id": "017a0632-0300-49f8-b49a-7c51037716a9",
      "type": "procedural",
      "label": "good-stories.us W3 Total Cache purge after plugin edits",
      "importance": 0.8,
      "source": "claude-code",
      "accessCount": 8,
      "createdAt": "2026-08-10T17:46:53.023Z",
      "lastAccessedAt": "2026-08-16T16:22:20.900Z",
      "x": 24.601694929485824,
      "y": -11.06036758257762,
      "z": 3.5952843911098022,
      "projected": true
    }
  ]
}
```

*(`nodes` holds one entry per memory — 651 here; one is shown.)*

| Field | Type | Description |
|---|---|---|
| `method` | `pca3` \| `fallback` | `fallback` with fewer than four usable vectors, inconsistent dimensions or zero variance in the fit |
| `halfExtent` | number | Half-width of the box used for the PCA projection. Fixed at `42` so camera framing is stable across refits |
| `count` | integer | Nodes returned |
| `projected` | integer | Nodes placed by the projection |
| `unprojected` | integer | Nodes with no usable embedding, parked on a shell just outside the box (`projected: false` on the node). `count === projected + unprojected` |
| `explainedVariance` | number[3] | Fraction of total variance each component captures. `[0.24, 0.09, 0.05]` above is 38.1% in three components |
| `fingerprint` | string | Cache key for this projection. Unchanged between two calls means the same coordinates |
| `generatedAt` | ISO instant | When the cached projection was computed — not when this request was served |
| `embeddingModel` | string \| null | The active embedding model reported by the brain |
| `computeMs` | integer | Wall time of the projection that filled the cache. `157` cold on 651 memories; a cache hit returns in ~4 ms and reports the same number |

**Nodes**

| Field | Type | Description |
|---|---|---|
| `id`, `type`, `importance`, `source`, `accessCount`, `createdAt`, `lastAccessedAt` | — | Straight from the memory record |
| `label` | string | `concept` if set, otherwise `content`, whitespace-collapsed and cut to 80 characters |
| `x`, `y`, `z` | number | Projected coordinates in `[-halfExtent, halfExtent]`; shell coordinates can extend beyond the box |
| `projected` | boolean | `false` when the position is a deterministic placeholder rather than a projection |

The projection is deterministic for a given store but **not invariant**: the basis is fitted, so adding a memory can change existing coordinates. Each fitted component uses a canonical sign.

**`fallback`**

When `pca3` cannot fit, `method` is `fallback`, `projected` is `0`, `unprojected` equals `count`, `explainedVariance` is `[0, 0, 0]`, and every node gets a stable hash-derived position inside the box. The response shape is otherwise identical.

---

### `GET /api/graph/edges`

Every connection whose **both** endpoints are memories the caller can see, strongest first, in one request. This replaces walking `GET /api/graph/:id` per node, which surfaced a biased handful of edges.

The response reports its own denominators, so a client can state what it is not showing rather than truncating in silence.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `minStrength` | number 0–1 | Keep only edges at or above this strength. Default `0` |
| `global` | `true` | Only null-namespace endpoints; rejected in isolated mode |
| `limit` | integer 1–20000 | Maximum edges returned. Default `20000` |

An unrecognised query key returns `400`.

**Response `200`**
```json
{
  "total": 3099,
  "stored": 8492,
  "matching": 1049,
  "returned": 2,
  "truncated": true,
  "minStrength": 0.9,
  "limit": 2,
  "edges": [
    {
      "id": "029feba3-aa67-4efc-abf8-b639985a3519",
      "sourceId": "ce02fd6e-0d9c-4186-bd45-d4479ee8f90a",
      "targetId": "88adc7a4-9e52-4fe7-8c06-138ffb55d5f3",
      "relationship": "relates_to",
      "strength": 1
    },
    {
      "id": "0300fb19-e0a4-47a2-b82a-570e825aec38",
      "sourceId": "23b70a4e-ad9d-4920-a949-cfbefa116e37",
      "targetId": "7a173c83-c6f9-4414-ac87-938be163a862",
      "relationship": "contradicts",
      "strength": 1
    }
  ]
}
```

*(`?minStrength=0.9&limit=2` on the same store.)*

| Field | Type | Description |
|---|---|---|
| `total` | integer | **Renderable** edges in the store, before this request's filter |
| `stored` | integer | Non-deleted graph-visible connection rows before endpoint filtering, including edges onto archived or out-of-scope memories |
| `matching` | integer | Edges passing `minStrength` |
| `returned` | integer | Edges in `edges` |
| `truncated` | boolean | `true` when `limit` cut the result — `returned < matching` |
| `minStrength`, `limit` | — | Echoed back as applied |

`stored - total` is the number of non-renderable edges: 5,393 in the example. This includes edges with archived or out-of-scope endpoints and self-loops. A client showing an edge count should say which of the two numbers it means.

Ordering is by `strength` descending, then `id`, so a `limit` drops the weakest edges rather than an arbitrary slice of insertion order.

Results are cached on a fingerprint combining the memory set and the connection set, using row counts and timestamps. Memory access counts and scope are also part of the key.

**Response `400`** — `minStrength` outside `0..1`, or `limit` outside `1..20000`.

```json
{ "statusCode": 400, "error": "Bad Request", "message": "querystring/limit must be <= 20000" }
```

---

### `POST /api/connections`

Create a typed connection between two memories.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceId` | string | yes | Source memory ID |
| `targetId` | string | yes | Target memory ID |
| `relationship` | string | yes | Relationship type (see below) |
| `strength` | number 0–1 | — | Connection strength, default 1.0 |
| `bidirectional` | boolean | — | Default false |

**Relationship types**

| Type | Meaning |
|---|---|
| `is_a` | Taxonomic: "A is a B" |
| `has_property` | Attribute: "A has property B" |
| `causes` | Causal: "A causes B" |
| `relates_to` | Generic association |
| `contradicts` | Conflicting information |
| `part_of` | Composition |
| `follows` | Temporal/logical sequence |

**Request**
```json
{
  "sourceId": "uuid-transformer",
  "targetId": "uuid-attention",
  "relationship": "relates_to",
  "strength": 0.95,
  "bidirectional": false
}
```

**Response `201`** — created connection object, re-read from the database. A connection that had been forgotten and occupies the same `(sourceId, targetId, relationship)` slot is resurrected and keeps its **original** `id`, so read the `id` from this response rather than assuming a fresh one.

**Response `404`** — either endpoint does not exist, or is outside the configured namespace.

```json
{ "error": "Memory not found" }
```

**Response `409`** — a live connection with the same `(sourceId, targetId, relationship)` already exists.

```json
{ "error": "Connection already exists" }
```

---

## Sessions

### `POST /api/sessions`

Create a new session to group episodic memories. `source` (string) is required; `context` (JSON object) is optional.

**Request body**
```json
{
  "source": "claude-code",
  "context": {
    "project": "neuralCore",
    "task": "architecture review"
  }
}
```

**Response `201`**
```json
{
  "id": "session-uuid"
}
```

---

### `GET /api/sessions`

List up to 100 sessions, newest `startedAt` first. A configured namespace selects that project's sessions, plus null-namespace sessions in filter mode.

**Response `200`**
```json
[{
  "id": "session-uuid",
  "source": "claude-code",
  "context": "{\"project\":\"neuralCore\",\"task\":\"architecture review\"}",
  "namespace": null,
  "startedAt": "2026-03-24T09:00:00.000Z",
  "endedAt": null,
  "updatedAt": "2026-03-24T09:00:00.000Z",
  "deletedAt": null,
  "deviceId": "device-uuid"
}]
```

---

## Reflections

### `GET /api/reflections`

List stored insights in scope. Optional query parameters are `limit` (integer 1–200, default 20) and `type` (`pattern`, `knowledge_gap`, `trend`, `contradiction_summary`). Unknown keys or invalid values return `400`.

**Response `200`** — `{ count, reflections }`. Each item has `id`, `type`, `content`, `importance`, `tags` (string array), `createdAt`, and `confidence` when present in metadata.

---

### `GET /api/reflection/status`

Get the reflection scheduler state. The connected MCP client generates the insights.

**Response `200`**
```json
{ "enabled": true, "due": false, "counter": 0, "threshold": 10 }
```

---

### `GET /api/reflection/config`

Get the active reflection configuration.

**Response `200`** (defaults)
```json
{
  "enabled": true, "storeCountThreshold": 10, "triggerOnDecay": true,
  "types": ["pattern", "knowledge_gap", "trend", "contradiction_summary"],
  "maxMemoriesToAnalyze": 50, "minImportance": 0.3
}
```

---

### `PUT /api/reflection/config`

**Request body** — supply one or more fields from `GET`. `enabled` and `triggerOnDecay` are booleans. `storeCountThreshold` is an integer from 1–1000000 and `maxMemoriesToAnalyze` an integer from 1–100000. `minImportance` is a number from 0–1. `types` is a nonempty array of distinct reflection types.

**Response `200`** — the updated config. Unknown fields, an empty object or invalid values return `400`.

---

## Cloud Sync

### `GET /api/sync/status`

**Response `200`** — `{ "enabled": false }` without a sync engine. When enabled, the object also includes `state` (`idle`, `pushing`, `pulling`, `error`), `deviceId`, `pendingPushCount`, and nullable strings `lastSyncAt`, `lastError`, `pullCursor` and `embeddingModel`.

---

### `POST /api/sync/trigger`

Run one push/pull cycle. No parameters.

**Response `200`**
```json
{
  "success": true,
  "pushed": { "memories": 1, "connections": 0, "sessions": 0 },
  "pulled": { "memories": 0, "connections": 0, "sessions": 0 },
  "conflicts": 0, "durationMs": 42
}
```

**Errors** — `404` with `{ "error": "Cloud sync is not configured" }` without a sync engine, `409` for an overlapping manual trigger, or `500` with `{ "error": "Sync failed. See the server log for details." }` on a sync failure.

---

## MCP

### `POST /mcp`

Stateless Streamable HTTP MCP over the REST server’s brain. Send a JSON-RPC 2.0 request with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. After initialization, send the negotiated `MCP-Protocol-Version`. There is no session ID.

**Request**
```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "list_tags", "arguments": {} } }
```

**Response `200`** — JSON-RPC response. `tools/list` returns `result.tools`. A tool call returns a text item in `result.content`; object outputs below are JSON encoded in its `text`. A tool error can set `result.isError`. An accepted notification returns `202` with no body. Invalid JSON-RPC or an unsupported protocol version can return `400`, an incompatible `Accept` header `406`, and an unsupported content type `415`. A transport failure before headers can return `500` with JSON-RPC error `-32603`.

`GET /mcp` and `DELETE /mcp` return `405`, `Allow: POST` and `{ "jsonrpc": "2.0", "id": null, "error": { "code": -32000, "message": "Method not allowed" } }`. The Host, Origin, API key and global rate checks apply first.

### MCP tools

The stdio and HTTP transports share the following 15 default tools. For `search_memory` and `recall_context`, `since`/`until` are inclusive on event time (creation time if absent), all supplied tags must match, and `crossNamespace: true` is refused in isolated mode. `?` marks optional input or output fields. Memory types are `episodic`, `semantic` and `procedural`. Reflection types and resolution strategies are the values listed under Reflections and Contradiction Detection above. Source attribution defaults to `ENGRAM_SOURCE`, then the MCP client's name, then `mcp-client`.

| Tool | Parameters | Returns |
|---|---|---|
| `store_memory` | `content` nonempty string; `type?` memory type (episodic), `source?`, `concept?`, `sessionId?`, `namespace?` strings, `tags?` string[], `importance?` number 0–1 (same defaults as REST store), `global?` boolean | `{ id, type, importance, deduplicated, message, contradictionCandidates? }`. Global true overrides namespace; conflicting writes are refused in isolated mode. Candidates have `count` and `items` with `existingMemoryId`, `content` (first 500 characters), `createdAt`, `confidence`, signal names and `suggestedStrategy`. |
| `update_memory` | `id` string (full ID or unique prefix ≥ 8 characters), plus at least one of `content?` nonempty string, `importance?` number 0–1, `tags?` string[], `concept?` string | `{ id, content, importance, tags, concept, message }` with the replacement values and parsed tags |
| `search_memory` | `query` string; `topK?` integer 1–50 (10), `threshold?` number 0–1 (0.3), `types?` memory type[], `since?`, `until?` ISO date-time strings with timezone, `tags?` string[], `crossNamespace?` boolean (false) | `{ count, results }`. Each hit has `id`, `type`, `content` (first 500 characters), `summary`, `importance`, `source`, `createdAt`. |
| `recall_context` | `query` string; `maxTokens?` integer 100–8000 (2000), `types?` memory type[], `sources?`, `tags?` string[], `since?`, `until?` ISO date-time strings with timezone, `crossNamespace?`, `progressive?` booleans (false) | Formatted context text, or `No relevant memories found.` Progressive mode assembles the final text from streaming recall. |
| `add_knowledge` | `concept`, `content` strings; `tags?` string[], `importance?` number 0–1 (0.7) | `{ id, concept, message }` for a semantic memory |
| `forget` | `ids` string[] (full IDs or unique prefixes ≥ 8 characters), `reason?` string (reported as `not specified` if omitted) | `{ archived, notFound, reason, message }`. Valid IDs are archived once. Missing or ambiguous IDs set `isError`. |
| `list_tags` | `tag?` string, `limit?` number 1–200 (50) | Tag cloud `{ count, tags: [{ tag, count }], message }`. With a tag: `{ tag, count, memories }` with `id`, `type`, `content` (first 200 characters), `importance`, `source`. |
| `tag_memory` | `memoryId`, `tag` strings; `action?` string (`add` by default, or `remove`) | `{ id, tags, message }` |
| `get_contradiction_tasks` | `limit?` integer 1–100 (20) | `{ tasks }` with `source` and `target` (`id`, `content` up to 500 characters, `truncated`, `createdAt`, `source`), `confidence`, signal names and optional `suggestedStrategy` |
| `complete_contradiction_check` | `sourceId`, `targetId` nonempty strings, `verdict` string (`contradiction` or `none`), `strategy?` resolution strategy (only with `contradiction`) | `{ sourceId, targetId, verdict, resolution? }`; `resolution` has `resolved`, `keptId?`, `archivedId?` |
| `get_distill_tasks` | `limit?` integer 1–100 (20) | Text with a JSON array of `{ id, date, namespace, content }` (up to 6000 characters each), or `No pending sessions to distill.` |
| `complete_distill` | `id` nonempty session ID string, `facts` array (0–100). Each fact takes nonblank `content` string, `type?` memory type (semantic), `importance?` number 0–1, `tags?` string[], `global?` boolean. | `{ id, storedIds, discardedIds, archived: true, message }`. Stores facts before archiving the pending session. An empty array archives it without facts. |
| `request_reflection` | None | Text with a JSON array of `{ type, relatedMemoryIds, prompt }` tasks, or a message when too few memories qualify |
| `store_reflection` | `type` reflection type, `insight` nonempty string, `relatedMemoryIds?` string[] (empty), `confidence?` number 0–1 (computed if omitted) | Text with the stored ID, or a message when no insight was stored (including blank or `NO_INSIGHT` text) |
| `get_reflections` | `limit?` integer 1–100 (20), `type?` reflection type | Text with a count and `[type]` insights, or `No reflection insights found.` |

Set `ENGRAM_ADMIN_TOOLS=1` on the server for these 11 additional tools.

| Tool | Parameters | Returns |
|---|---|---|
| `memory_stats` | None | The core stats object as in `GET /api/stats`, with the database path as returned by core |
| `decay_sweep` | `dryRun?` boolean (false) | The `POST /api/decay` result plus `mode` (`dry-run` or `live`) and `message` |
| `decay_policy` | `action` string (`get` or `update`); `halfLifeDays?` number 1–36500, `archiveThreshold?`, `importanceDecayRate?`, `importanceFloor?` numbers 0–1, `consolidationEnabled?` boolean | `{ policy, message }`, with the policy fields from `GET /api/decay/policy` |
| `check_contradictions` | `memoryId?` string | With ID: `POST /api/contradictions/check/:id` result plus `message`. Without: `{ count, contradictions, message }` for confirmed pairs; each has `confidence`, `metadata`, `source` and `target` (`id`, `type`, `content` up to 200 characters). |
| `resolve_contradiction` | `sourceId`, `targetId` strings, `strategy` resolution strategy | `{ resolved, keptId?, archivedId?, strategy, message }` |
| `plugin_list` | None | `{ count, plugins, message }`; items match `GET /api/plugins` |
| `webhook_subscribe` | `url` HTTP(S) URL string, `events` string[] of webhook event names, `secret?`, `description?` strings | Public subscription as in `POST /api/webhooks`, plus `message` |
| `webhook_list` | None | `{ count, webhooks }`; each entry has `id`, `url`, `events`, `active`, `failCount`, `description` |
| `index_status` | None | Core index status with `indexPath` (string or null) and `message`. The other counters match `GET /api/index/status`; `persisted` and `indexFileName` are REST fields. |
| `embedding_status` | None | `GET /api/embeddings/status` fields plus `message` |
| `re_embed` | `onlyStale?` boolean (true), `batchSize?` number 1–100 (32) | `{ total, processed, failed, failedIds, durationMs, model, message }` |

---

## WebSocket Events

Connect to the `/neural` namespace via Socket.io. Broadcasts reach all connected sockets in that namespace, including clients using different project scopes:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4901/neural');
```

### Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `memory:stored` | server → client | Memory row without `embedding` | `POST /api/memory` completed |
| `memory:contradiction` | — | — | No longer emitted; stores queue candidates for verification |
| `memory:contradiction_resolved` | server → client | `{ sourceId, targetId, strategy, keptId?, archivedId? }` | REST single or bulk resolution succeeded |
| `memory:decayed` | server → client | Decay sweep result | Scheduled sweep archived or consolidated memories |
| `recall:chunk` | server → client | `{ phase, memory, rank, contextSoFar }` | One memory from a streaming recall |
| `recall:complete` | server → client | `{ phase: "complete", context, memories, latencyMs }` | Streaming recall finished |
| `embedding:progress` | server → client | `{ processed, total, failed, failedIds, durationMs }` | Batch re-embedding progress |
| `embedding:complete` | server → client | Same fields as `embedding:progress` | REST re-embedding finished |

### Example

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4901/neural');

socket.on('memory:stored', ({ id, type, source }) => {
  console.log(`New ${type} memory from ${source}: ${id}`);
});

socket.on('memory:contradiction_resolved', ({ sourceId, targetId, strategy }) => {
  console.log(`Resolved ${sourceId} / ${targetId} via ${strategy}`);
});

socket.on('recall:chunk', ({ memory, phase }) => {
  console.log(`Recall ${phase}: ${memory.id}`);
});

socket.on('recall:complete', ({ context, latencyMs }) => {
  console.log(`Recall complete in ${latencyMs}ms`);
});

socket.on('embedding:progress', ({ processed, total }) => {
  console.log(`Re-embedding: ${processed}/${total}`);
});
```

---

## Error Format

REST errors use the framework or route-specific forms below. A NUL character in a synchronized text column (for example, memory `content` or session `source`) returns `400` and names the column. `/mcp` protocol errors use JSON-RPC.

**Framework errors** — schema validation or an exception that reaches the error handler with a status code:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "body must have required property 'content'"
}
```

**Handler errors** — a route answering for itself:

```json
{
  "error": "Memory not found"
}
```

With the dashboard installed, unmatched API routes return `404` with `{ "error": "Not Found", "statusCode": 404 }`. Some handler errors add a `message` alongside `error` (the `403`, `429` and strict-query `400` bodies above do). These REST errors have no `code` field — machine-readable dispatch goes on the HTTP status.

| Field | Type | Description |
|---|---|---|
| `statusCode` | integer | HTTP status code. Present on framework errors and the dashboard’s unmatched API route response |
| `error` | string | HTTP status text on framework errors; a short human-readable summary on handler errors |
| `message` | string | Human-readable description. Not always present on handler errors |

4xx messages are passed through, because they describe the caller's own input and are the only way to know what to fix. **5xx messages are not**: an exception reaching the error handler answers with the same fixed string, with the real detail written to the server log instead.

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "An internal error occurred. See the server log for details."
}
```

### Common statuses

| Status | Meaning |
|---|---|
| `400` | Schema validation failed or a handler rejected the input (including unknown keys on strict routes) |
| `401` | `ENGRAM_API_KEY` is set and the request did not present it |
| `403` | The Host or Origin is refused |
| `404` | Resource or route not found, or cloud sync is not configured for a manual trigger |
| `409` | A whole-store operation is already running, a connection already exists or there is nothing to redact |
| `413` | Request body exceeds the server’s body limit |
| `429` | A rate-limit tier was exhausted |
| `500` | Unexpected server error; details go to the server log |
| `503` | Atlas map computation is pending or busy |
