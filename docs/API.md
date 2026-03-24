# REST API Reference

Base URL: `http://localhost:4901`

Interactive Swagger UI: `http://localhost:4901/docs`

All request and response bodies are JSON. All endpoints return standard HTTP status codes.

---

## Health & Stats

### `GET /api/health`

Check if the server is running.

**Response `200`**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 42.3
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
    "openclaw": 12,
    "demo": 34
  },
  "indexSize": 101,
  "graphNodes": 101,
  "graphEdges": 350
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

---

### `GET /api/memory`

List memories with optional filters.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `type` | `episodic` \| `semantic` \| `procedural` | Filter by type |
| `source` | string | Filter by source |
| `limit` | integer (max 200) | Default: 50 |
| `offset` | integer | Default: 0 |

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
  "statusCode": 404,
  "code": "MEMORY_NOT_FOUND",
  "error": "Not Found",
  "message": "Memory not found"
}
```

---

### `DELETE /api/memory/:id`

Archive (soft-delete) a memory. Sets `archivedAt` timestamp; the memory remains in the database but is excluded from search and recall.

**Response `204`** — no body.

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

**Response `200`** — the updated policy object (same shape as `GET`).

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

Check the status of the HNSW vector index.

**Response `200`**
```json
{
  "type": "hnsw",
  "size": 101,
  "dimensions": 384,
  "efConstruction": 200,
  "M": 16,
  "lastRebuilt": "2026-03-24T03:00:00.000Z",
  "savedToDisk": true
}
```

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

### `GET /api/webhooks`

List all registered webhook subscriptions.

**Response `200`**
```json
{
  "webhooks": [
    {
      "id": "wh-uuid",
      "url": "https://example.com/hook",
      "events": ["memory:stored", "memory:contradiction"],
      "active": true,
      "createdAt": "2026-03-20T12:00:00.000Z"
    }
  ]
}
```

---

### `POST /api/webhooks`

Subscribe a new webhook endpoint.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | The URL to receive POST callbacks |
| `events` | string[] | yes | Events to subscribe to |
| `secret` | string | — | Shared secret for HMAC signature verification |

**Request**
```json
{
  "url": "https://example.com/hook",
  "events": ["memory:stored", "memory:contradiction"],
  "secret": "whsec_abc123"
}
```

**Response `201`**
```json
{
  "id": "wh-uuid",
  "url": "https://example.com/hook",
  "events": ["memory:stored", "memory:contradiction"],
  "active": true,
  "createdAt": "2026-03-25T10:00:00.000Z"
}
```

---

### `GET /api/webhooks/:id`

Get a single webhook subscription by ID.

**Response `200`** — webhook object (same shape as list items).

---

### `DELETE /api/webhooks/:id`

Remove a webhook subscription.

**Response `204`** — no body.

---

### `POST /api/webhooks/:id/test`

Send a test payload to the webhook endpoint to verify connectivity.

**Response `200`**
```json
{
  "delivered": true,
  "statusCode": 200,
  "latencyMs": 120
}
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
      "id": "openclaw-memory",
      "name": "OpenClaw Memory Plugin",
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
      "targetId": "target-uuid",
      "relationship": "implements",
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
  "relationship": "uses",
  "strength": 0.95,
  "bidirectional": false
}
```

**Response `201`** — created connection object.

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

All error responses follow a standard shape:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "error": "Bad Request",
  "message": "Field 'content' is required"
}
```

| Field | Type | Description |
|---|---|---|
| `statusCode` | integer | HTTP status code |
| `code` | string | Machine-readable error code |
| `error` | string | HTTP status text |
| `message` | string | Human-readable description |

### Common Error Codes

| Code | Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing or invalid request fields |
| `MEMORY_NOT_FOUND` | 404 | Memory ID does not exist |
| `CONTRADICTION_NOT_FOUND` | 404 | Contradiction ID does not exist |
| `WEBHOOK_NOT_FOUND` | 404 | Webhook ID does not exist |
| `PLUGIN_NOT_FOUND` | 404 | Plugin ID does not exist |
| `SESSION_NOT_FOUND` | 404 | Session ID does not exist |
| `INDEX_BUSY` | 409 | Index rebuild already in progress |
| `EMBEDDING_BUSY` | 409 | Re-embedding already in progress |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
