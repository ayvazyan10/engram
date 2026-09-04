# REST API Reference

Base URL: `http://localhost:4901`

Interactive Swagger UI: `http://localhost:4901/docs`

All request and response bodies are JSON. All endpoints return standard HTTP status codes.

---

## Authentication & request policy

Everything in this section applies to `/api/*` on every endpoint below.

### API key

Authentication is **off by default** — the local-first shape. Set `ENGRAM_API_KEY` on the server to turn it on; every `/api/*` route then requires the key, and so do `/docs/json` and `/docs/yaml`.

| | |
|---|---|
| **Header** | `X-API-Key: <key>` or `Authorization: Bearer <key>` |
| **Exempt** | `GET /api/health` (so container probes keep working) |
| **Also exempt** | The dashboard bundle and the SPA fallback — a browser cannot attach a header to a top-level navigation, so gating them would make the page that lets a user supply a key unreachable. No data is served outside `/api/` |
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

Only `/api/*` is guarded — the dashboard shell and `/docs` stay reachable under any Host, because they hold no data.

### CORS and WebSocket origins

Browser origins are allowlisted, not reflected. Defaults cover `http://localhost:{PORT}`, `http://127.0.0.1:{PORT}`, `:4902` and the Vite dev server on `:5173`; override with `ENGRAM_ALLOWED_ORIGINS`. Requests with **no** `Origin` (CLI, MCP, curl) are allowed. A disallowed origin is refused at the Socket.io handshake with a 403 before any transport exists.

### Rate limits

Per-client-address fixed windows on `/api/*`. Static assets and the SPA fallback are exempt. A request is charged against every tier it matches, so a heavy call also spends global budget.

| Tier | Default limit | Applies to |
|---|---|---|
| `global` | 1000 / 60s | Every `/api/*` request |
| `heavy` | 300 / 60s | `POST /api/memory`, `/api/memory/batch`, `/api/memory/bulk/tag`, `/api/memory/bulk/archive`, `POST /api/search`, `POST /api/recall`, and `GET /api/recall/stream`. `GET /api/memory` is a plain list and stays global-only |
| `whole-store` | 30 / 60s | `POST /api/consolidate`, `/api/decay`, `/api/embeddings/backfill`, `/api/embeddings/re-embed`, `/api/index/rebuild`, `/api/index/save`, `/api/sync/trigger` |

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

The seven whole-store routes above hold a process-wide guard: starting one while the same operation is running returns `409` rather than interleaving two passes over the store.

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

Check if the server is running.

**Response `200`**
```json
{
  "status": "ok",
  "version": "0.5.0",
  "uptime": 268.962066517
}
```

---

### `GET /api/stats`

Brain memory statistics.

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
| `minClusterSize` | integer | — | Min episodes to form a cluster (default: 3) |
| `threshold` | number 0–1 | — | Similarity threshold for clustering (default: 0.6) |

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

> **Breaking change.** Before this release the response was flat, and it mixed two scopes without saying so: `dailyGrowth` and `hourlyActivity` were windowed while `total`, `byType`, `bySource` and `topConcepts` were all-time. On a live store the windowed aggregates summed to 87 against a `total` of 651 in the same payload. Every field has moved under `window` / `windowed` / `allTime`, and **`byType`, `bySource` and `topConcepts` are now windowed** where they used to be all-time. Read `allTime.total` for the old `total`.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `days` | integer 1–365 | Length of the window in UTC calendar days, default 30 |

`days` is the **only** accepted query parameter. Any other key is a `400` rather than being ignored — `?day=90`, one letter short, used to return `200` with a 30-day window the caller read as 90.

```
GET /api/analytics?day=90
```
```json
{
  "error": "Bad Request",
  "message": "Unknown query parameter: day. Allowed: days."
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
- Generates a 384-dim embedding
- Adds to vector index and knowledge graph
- **Auto-links** to top-3 most similar existing memories (creates `relates_to` edges)
- **Auto-extracts** a concept label if none provided
- **Contradiction detection** — checks for conflicting memories and returns any found

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | The memory text |
| `type` | `episodic` \| `semantic` \| `procedural` | — | Defaults to `episodic` |
| `source` | string | — | Originating system (e.g. `claude-code`) |
| `importance` | number 0–1 | — | Manual importance override |
| `concept` | string | — | Semantic memories: concept label |
| `tags` | string[] | — | Categorization tags |
| `sessionId` | string | — | Group related episodic memories |
| `metadata` | object | — | Arbitrary JSON metadata |

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
    "tags": ["ui", "preferences"],
    "source": null,
    "createdAt": "2026-03-21T10:00:00.000Z"
  },
  "contradictions": {
    "count": 1,
    "items": [
      {
        "id": "contra-uuid",
        "existingMemoryId": "existing-uuid",
        "newMemoryId": "a1b2c3d4-...",
        "confidence": 0.82,
        "explanation": "Conflicts with existing preference for light mode"
      }
    ]
  }
}
```

When no contradictions are detected, `contradictions` is `{ "count": 0, "items": [] }`.

---

### `POST /api/memory/batch`

Bulk store memories in a single transaction. High-throughput path.

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

The `contradictions` field reports how many contradictions were detected across the batch. Use `GET /api/contradictions` to retrieve details.

`memories` accepts at most **1000** items. Every item is embedded, so the fan-out is bounded — 16 embeds in flight at a time by default, tunable with `ENGRAM_BATCH_CONCURRENCY`. `ids` come back in the order the memories were submitted.

---

### `GET /api/memory`

List memories with optional filters.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `type` | `episodic` \| `semantic` \| `procedural` | Filter by type |
| `source` | string | Filter by source |
| `limit` | integer 1–200 | Default: 50 |
| `offset` | integer >= 0 | Default: 0 |

**Example**
```
GET /api/memory?type=semantic&source=claude-code&limit=10&offset=0
```

**Response `200`**
```json
{
  "count": 10,
  "memories": [
    {
      "id": "uuid",
      "type": "semantic",
      "content": "...",
      "concept": "TypeScript",
      "importance": 0.8,
      "source": "claude-code",
      "tags": ["programming"],
      "createdAt": "2026-03-21T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/memory/:id`

Get a single memory by ID. Returns the full memory record including all fields.

**Response `200`**
```json
{
  "id": "a1b2c3d4-...",
  "type": "semantic",
  "content": "User prefers dark mode in all applications",
  "concept": "user preferences",
  "importance": 0.8,
  "source": "claude-code",
  "tags": ["ui", "preferences"],
  "sessionId": null,
  "metadata": {},
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

Archive (soft-delete) a memory. Sets `archivedAt` timestamp; the memory remains in the database but is excluded from search and recall.

**Response `204`** — no body.

---

### `PATCH /api/memory/:id`

Edit a memory in place.

**Request body** — every field optional; unknown keys are rejected.

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

Semantic vector search across all memories. Returns memories ranked by cosine similarity to the query embedding.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Natural language search query |
| `topK` | integer (max 50) | — | Number of results, default 10 |
| `threshold` | number 0–1 | — | Minimum similarity score, default 0.3 |
| `types` | string[] | — | Filter to specific memory types |
| `sources` | string[] | — | Filter to specific sources |

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
  "count": 3,
  "latencyMs": 28,
  "results": [
    {
      "id": "uuid",
      "type": "procedural",
      "content": "For Drizzle ORM: always use drizzle-kit generate → migrate...",
      "importance": 0.9,
      "similarity": 0.87
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
| `query` | string | yes | The user's message or question |
| `maxTokens` | integer | — | Token budget for context, default 2000 |
| `types` | string[] | — | Restrict to memory types |
| `sources` | string[] | — | Restrict to sources |
| `sessionId` | string | — | Include session-specific memories |

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
  "context": "## Relevant memories\n\n[PROCEDURAL] Database migration workflow...\n[SEMANTIC] Drizzle ORM...",
  "memories": [
    { "id": "uuid", "type": "procedural", "score": 0.91 },
    { "id": "uuid2", "type": "semantic", "score": 0.78 }
  ],
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

### `GET /api/recall/stream`

Server-Sent Events (SSE) endpoint for streaming recall results as they become available. Useful for UIs that want to show progressive recall.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | The recall query |
| `maxTokens` | integer | — | Token budget, default 2000 |

**Example**
```
GET /api/recall/stream?query=deployment+best+practices&maxTokens=1500
```

**SSE event stream**

```
event: vector
data: {"memories":[{"id":"uuid","type":"procedural","score":0.91}],"count":5}

event: graph
data: {"memories":[{"id":"uuid3","type":"semantic","score":0.72}],"count":2}

event: complete
data: {"context":"## Relevant memories\n\n...","totalMemories":7,"latencyMs":62}
```

| Event | Description |
|---|---|
| `vector` | Fired when vector search results are ready |
| `graph` | Fired when graph expansion results are ready |
| `complete` | Final assembled context with all pipeline steps applied |

---

## Decay & Retention

### `POST /api/decay`

Run a decay sweep across all memories. Reduces importance scores based on time since last access, memory type, and access frequency. Memories that fall below the archive threshold are soft-deleted.

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
  "decayed": 8,
  "archived": 2,
  "dryRun": true,
  "details": [
    {
      "id": "uuid",
      "previousImportance": 0.6,
      "newImportance": 0.42,
      "archived": false
    },
    {
      "id": "uuid2",
      "previousImportance": 0.15,
      "newImportance": 0.05,
      "archived": true
    }
  ]
}
```

---

### `GET /api/decay/policy`

Retrieve the current decay policy configuration.

**Response `200`**
```json
{
  "enabled": true,
  "halfLifeDays": {
    "episodic": 14,
    "semantic": 90,
    "procedural": 180
  },
  "archiveThreshold": 0.05,
  "accessBoost": 0.1,
  "cronSchedule": "0 3 * * *"
}
```

---

### `PUT /api/decay/policy`

Update the decay policy configuration.

**Request body**
```json
{
  "enabled": true,
  "halfLifeDays": {
    "episodic": 7,
    "semantic": 60,
    "procedural": 120
  },
  "archiveThreshold": 0.1
}
```

All fields are optional; only provided fields are updated.

`protectionRules` is **refused** rather than ignored: a rule carries a predicate function, which JSON cannot express. Configure protection rules in-process.

**Response `200`** — the updated policy object (same shape as `GET`).

**Response `400`**
```json
{ "error": "protectionRules cannot be set over HTTP: a rule needs a predicate function, which JSON cannot express. Configure them in-process instead." }
```

---

## Contradiction Detection

### `GET /api/contradictions`

List all unresolved contradictions.

**Response `200`**
```json
{
  "count": 3,
  "contradictions": [
    {
      "id": "contra-uuid",
      "memoryA": "uuid-1",
      "memoryB": "uuid-2",
      "confidence": 0.85,
      "explanation": "Memory A says user prefers dark mode; Memory B says user prefers light mode",
      "detectedAt": "2026-03-24T14:30:00.000Z",
      "resolved": false
    }
  ]
}
```

---

### `POST /api/contradictions/check/:id`

Manually trigger contradiction checking for a specific memory against all other memories.

**Response `200`**
```json
{
  "memoryId": "uuid",
  "contradictions": [
    {
      "id": "contra-uuid",
      "conflictingMemoryId": "uuid-2",
      "confidence": 0.78,
      "explanation": "Conflicting information about preferred framework"
    }
  ],
  "count": 1
}
```

---

### `POST /api/contradictions/resolve`

Resolve one or more contradictions using a resolution strategy.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `contradictionId` | string | yes | ID of the contradiction to resolve |
| `strategy` | string | yes | Resolution strategy (see below) |
| `manualContent` | string | — | Required when strategy is `manual` |

**Strategies**

| Strategy | Behavior |
|---|---|
| `keep_newest` | Archive the older memory, keep the newer one |
| `keep_oldest` | Archive the newer memory, keep the older one |
| `keep_important` | Archive the less important memory |
| `keep_both` | Mark as resolved without archiving either memory |
| `manual` | Archive both and create a new memory from `manualContent` |

**Request**
```json
{
  "contradictionId": "contra-uuid",
  "strategy": "keep_newest"
}
```

**Response `200`**
```json
{
  "resolved": true,
  "contradictionId": "contra-uuid",
  "strategy": "keep_newest",
  "kept": "uuid-2",
  "archived": "uuid-1"
}
```

**Request (manual strategy)**
```json
{
  "contradictionId": "contra-uuid",
  "strategy": "manual",
  "manualContent": "User prefers dark mode on desktop and light mode on mobile"
}
```

**Response `200`**
```json
{
  "resolved": true,
  "contradictionId": "contra-uuid",
  "strategy": "manual",
  "archived": ["uuid-1", "uuid-2"],
  "newMemoryId": "uuid-3"
}
```

---

### `GET /api/contradictions/config`

Retrieve the contradiction detection configuration.

**Response `200`**
```json
{
  "enabled": true,
  "confidenceThreshold": 0.7,
  "autoResolve": false,
  "autoResolveStrategy": "keep_newest",
  "checkOnStore": true
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
  "autoResolveStrategy": "keep_important"
}
```

All fields are optional; only provided fields are updated.

**Response `200`** — the updated config object (same shape as `GET`).

---

## Embedding Management

### `GET /api/embeddings/status`

Check the status of the embedding model and memory coverage.

**Response `200`**
```json
{
  "model": "all-MiniLM-L6-v2",
  "dimensions": 384,
  "totalMemories": 101,
  "embeddedMemories": 101,
  "pendingMemories": 0,
  "status": "ready"
}
```

---

### `POST /api/embeddings/re-embed`

Re-generate embeddings for all memories. Useful after switching embedding models.

**Request body**
```json
{
  "batchSize": 50
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `batchSize` | integer | — | Memories per batch, default 50 |

**Response `202`**
```json
{
  "status": "started",
  "totalMemories": 101,
  "estimatedTimeMs": 5200
}
```

Progress is reported via the `embedding:progress` WebSocket event.

Once the run finishes, the refreshed vectors are written to the persisted index file, so a restart cannot fall back to the pre-re-embed vectors. When several processes share one `ENGRAM_DB_PATH` they also share the default `<db>.index` path — give each its own `ENGRAM_INDEX_PATH` so they do not overwrite each other's index.

---

### `POST /api/embeddings/backfill`

Generate embeddings only for memories that are missing them.

**Response `200`**
```json
{
  "backfilled": 3,
  "alreadyEmbedded": 98,
  "latencyMs": 150
}
```

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
  "indexPath": "/data/engram.db.index",
  "indexFileExists": true,
  "incrementalCount": 0,
  "initDurationMs": 62,
  "externalSyncCount": 1,
  "externalAdded": 27,
  "externalRemoved": 0,
  "externalSkipped": 0
}
```

| Field | Meaning |
|---|---|
| `loadedFrom` | `disk` (cache hit), `database` (full rebuild) or `not_loaded` |
| `entryCount` | Vectors in the index right now |
| `incrementalCount` | Memories added at startup on top of the disk cache |
| `initDurationMs` | How long initialization took |
| `externalSyncCount` | Reconciles that pulled in another process's work |
| `externalAdded` / `externalRemoved` | Entries added / dropped by those reconciles |
| `externalSkipped` | Memories left unindexed because their vector came from a different embedding model — non-zero means a re-embed is due |

---

### `POST /api/index/rebuild`

Rebuild the vector index from scratch using all current embeddings.

**Response `200`**
```json
{
  "status": "rebuilt",
  "size": 101,
  "latencyMs": 820
}
```

---

### `POST /api/index/save`

Persist the current in-memory index to disk.

The write is asynchronous and atomic — it goes to a temporary file that is renamed over the target, so an interrupted save leaves the previous index readable rather than truncated.

**Response `200`**
```json
{
  "status": "saved",
  "path": "data/brain.hnsw",
  "sizeBytes": 158720
}
```

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
| `events` | string[] | yes | One or more of `stored`, `forgotten`, `decayed`, `consolidated`, `contradiction`, `reflected` |
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

Remove a webhook subscription.

**Response `204`** — no body.

---

### `POST /api/webhooks/:id/test`

Send a test payload to the webhook endpoint to verify connectivity. Retries follow the normal delivery policy, so a failing endpoint is contacted up to three times before the result comes back.

**Response `200`**
```json
{
  "webhookId": "f696a516-24d4-4d75-946b-ca431629c34f",
  "url": "https://example.com/hook",
  "success": false,
  "statusCode": 405,
  "error": "HTTP 405: Method Not Allowed",
  "attempts": 3
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
  "tags": [
    { "tag": "programming", "count": 24 },
    { "tag": "preferences", "count": 8 },
    { "tag": "architecture", "count": 12 }
  ]
}
```

---

### `GET /api/tags/:tag`

List all memories with a specific tag.

**Response `200`**
```json
{
  "tag": "programming",
  "count": 24,
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

List all collections (named groupings of tags).

**Response `200`**
```json
{
  "collections": [
    {
      "name": "dev-tools",
      "tags": ["programming", "tooling", "editor"],
      "memoryCount": 38
    }
  ]
}
```

---

### `POST /api/memory/:id/tags`

Add tags to a memory.

**Request body**
```json
{
  "tags": ["new-tag", "another-tag"]
}
```

**Response `200`**
```json
{
  "id": "uuid",
  "tags": ["existing-tag", "new-tag", "another-tag"]
}
```

---

### `DELETE /api/memory/:id/tags/:tag`

Remove a single tag from a memory.

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
  "plugins": [
    {
      "id": "custom-agent-memory",
      "name": "Custom Agent Memory Plugin",
      "version": "1.0.0",
      "active": true,
      "hooks": ["onStore", "onRecall"]
    }
  ]
}
```

---

### `GET /api/plugins/:id`

Get details for a specific plugin.

**Response `200`** — plugin object (same shape as list items, plus `config` field).

---

### `DELETE /api/plugins/:id`

Unregister a plugin.

**Response `204`** — no body.

---

## Knowledge Graph

### `GET /api/graph/:id`

Get the knowledge graph neighborhood for a memory node.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `depth` | integer (max 4) | Traversal depth, default 2 |

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

One 3D coordinate per memory, derived from that memory's stored embedding by a PCA projection into three components. This is what the dashboard's 3D views are drawn from — position means semantic proximity, not a hash of the id.

The projection is computed server-side (the vectors live there, and 651 × 384 floats is about a megabyte a browser has no reason to download) and cached on a fingerprint of the memory set — row count plus the newest `createdAt`/`updatedAt` plus the active namespace — so any store, edit, archive or delete invalidates it and nothing else does.

Nodes are scoped exactly as `GET /api/memory` scopes its list: archived memories are excluded, and the configured namespace applies.

No query parameters. Unknown ones are ignored.

**Response `200`**
```json
{
  "method": "pca3",
  "halfExtent": 42,
  "count": 651,
  "projected": 651,
  "unprojected": 0,
  "explainedVariance": [0.24093698985178116, 0.09472036395954171, 0.046422251410887],
  "fingerprint": "m:651:2026-09-04T12:59:20.787Z:2026-09-04T11:27:59.722Z:-",
  "generatedAt": "2026-09-04T16:23:26.925Z",
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
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
| `method` | `pca3` \| `fallback` | `fallback` when the store is too small to fit three components, or holds no usable embeddings at all |
| `halfExtent` | number | Half-width of the world box every coordinate is scaled into. Fixed at `42` so camera framing is stable across refits |
| `count` | integer | Nodes returned |
| `projected` | integer | Nodes placed by the projection |
| `unprojected` | integer | Nodes with no usable embedding, parked on a shell just outside the box (`projected: false` on the node). `count === projected + unprojected` |
| `explainedVariance` | number[3] | Fraction of total variance each component captures. `[0.24, 0.09, 0.05]` above is 38.1% in three components |
| `fingerprint` | string | Cache key for this projection. Unchanged between two calls means the same coordinates |
| `generatedAt` | ISO instant | When the cached projection was computed — not when this request was served |
| `embeddingModel` | string \| null | The model the vectors were produced with |
| `computeMs` | integer | Wall time of the projection that filled the cache. `157` cold on 651 memories; a cache hit returns in ~4 ms and reports the same number |

**Nodes**

| Field | Type | Description |
|---|---|---|
| `id`, `type`, `importance`, `source`, `accessCount`, `createdAt`, `lastAccessedAt` | — | Straight from the memory record |
| `label` | string | `concept` if set, otherwise `content`, whitespace-collapsed and cut to 80 characters |
| `x`, `y`, `z` | number | Coordinates in `[-halfExtent, halfExtent]` |
| `projected` | boolean | `false` when the position is a deterministic placeholder rather than a projection |

The projection is deterministic for a given store but **not invariant**: the basis is fitted, so adding a memory perturbs every coordinate by O(1/N). Sign is canonicalised so a refit cannot mirror the scene.

**`fallback`**

When `pca3` cannot fit — fewer usable vectors than components, or none at all — `method` is `fallback`, `projected` is `0`, `unprojected` equals `count`, `explainedVariance` is `[0, 0, 0]`, and every node gets a stable hash-derived position inside the box. The response shape is otherwise identical.

---

### `GET /api/graph/edges`

Every connection whose **both** endpoints are memories the caller can see, strongest first, in one request. This replaces walking `GET /api/graph/:id` per node, which surfaced a biased handful of edges.

The response reports its own denominators, so a client can state what it is not showing rather than truncating in silence.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `minStrength` | number 0–1 | Keep only edges at or above this strength. Default `0` |
| `limit` | integer 1–20000 | Maximum edges returned. Default `20000` |

Unlike `GET /api/analytics`, an unrecognised query key here is silently ignored rather than refused.

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
| `stored` | integer | Non-deleted connection rows, **including** edges onto archived memories |
| `matching` | integer | Edges passing `minStrength` |
| `returned` | integer | Edges in `edges` |
| `truncated` | boolean | `true` when `limit` cut the result — `returned < matching` |
| `minStrength`, `limit` | — | Echoed back as applied |

`stored - total` is the honest gap: on the store above, 3,099 of 8,492 connections are renderable and the remaining 5,393 point at archived memories, which have no node to draw an edge to. Self-loops are also excluded. A client showing an edge count should say which of the two numbers it means.

Ordering is by `strength` descending, then `id`, so a `limit` drops the weakest edges rather than an arbitrary slice of insertion order.

Results are cached on a fingerprint combining the memory set and the connection set, so any write to either invalidates the cache.

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

Create a new session to group episodic memories.

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

List all sessions, ordered by most recent.

**Response `200`**
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "source": "claude-code",
      "context": {
        "project": "neuralCore",
        "task": "architecture review"
      },
      "memoryCount": 12,
      "createdAt": "2026-03-24T09:00:00.000Z"
    }
  ]
}
```

---

## WebSocket Events

Connect to the `/neural` namespace via Socket.io:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4901/neural');
```

### Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `memory:stored` | server → client | `{ id, type, source }` | A new memory was stored |
| `memory:contradiction` | server → client | `{ contradictionId, memoryA, memoryB, confidence }` | A contradiction was detected |
| `memory:contradiction_resolved` | server → client | `{ contradictionId, strategy, kept, archived }` | A contradiction was resolved |
| `memory:decayed` | server → client | `{ id, previousImportance, newImportance, archived }` | A memory's importance was reduced by decay |
| `recall:chunk` | server → client | `{ memories, phase }` | Partial recall results (vector or graph phase) |
| `recall:complete` | server → client | `{ context, totalMemories, latencyMs }` | Full recall pipeline finished |
| `embedding:progress` | server → client | `{ processed, total, percent }` | Batch re-embedding progress update |
| `embedding:complete` | server → client | `{ total, latencyMs }` | Batch re-embedding finished |

### Example

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4901/neural');

socket.on('memory:stored', ({ id, type, source }) => {
  console.log(`New ${type} memory from ${source}: ${id}`);
});

socket.on('memory:contradiction', ({ contradictionId, confidence }) => {
  console.log(`Contradiction detected (${confidence}): ${contradictionId}`);
});

socket.on('recall:chunk', ({ memories, phase }) => {
  console.log(`Recall ${phase}: ${memories.length} memories`);
});

socket.on('recall:complete', ({ context, latencyMs }) => {
  console.log(`Recall complete in ${latencyMs}ms`);
});

socket.on('embedding:progress', ({ processed, total, percent }) => {
  console.log(`Re-embedding: ${percent}% (${processed}/${total})`);
});
```

---

## Error Format

There are two error bodies, and which one you get depends on where the error was raised.

**Framework errors** — schema validation, an unmatched route, anything that reaches the error handler with a status code:

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

Some handler errors add a `message` alongside `error` (the `403`, `429` and strict-query `400` bodies above do). There is **no** `code` field on any response — machine-readable dispatch goes on the HTTP status.

| Field | Type | Description |
|---|---|---|
| `statusCode` | integer | HTTP status code. Present on framework errors only |
| `error` | string | HTTP status text on framework errors; a short human-readable summary on handler errors |
| `message` | string | Human-readable description. Not always present on handler errors |

4xx messages are passed through, because they describe the caller's own input and are the only way to know what to fix. **5xx messages are not**: an internal failure always answers with the same fixed string, with the real detail written to the server log instead.

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
| `400` | Schema validation failed, an unknown query key or body key was sent, or a value the handler rejects |
| `401` | `ENGRAM_API_KEY` is set and the request did not present it |
| `403` | The `Host` header is not allowlisted |
| `404` | The memory, contradiction, webhook, plugin or session does not exist — or exists outside the configured namespace |
| `409` | A whole-store operation is already running, or a duplicate connection was posted |
| `413` | Body over the size limit (Ollama proxy only) |
| `429` | A rate-limit tier was exhausted |
| `500` | Unexpected server error. The body never carries detail — read the server log |
