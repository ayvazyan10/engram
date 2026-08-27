# Configuration

All Engram components are configured via environment variables. No config files required — defaults work for local development out of the box.

---

## API Server (`apps/server`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4901` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database file path |
| `NODE_ENV` | `development` | `production` enables stricter logging |
| `ENGRAM_NAMESPACE_MODE` | `none` | `none` disables namespaces, `filter` enables optional scoping/overrides, `isolated` enforces one fixed namespace |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace value for `filter` or `isolated`; required by `isolated` |
| `ENGRAM_DECAY_INTERVAL` | `3600000` | Decay sweep interval in milliseconds (0 = disabled) |
| `ENGRAM_DECAY_THRESHOLD` | `0.05` | Retention score below which memories are archived (0–1) |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` | Path to persist the vector index for fast startup |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model used for vectorization |

Namespace behavior is opt-in:

- `none` (default): namespace inputs are ignored and new memories are stored in the shared pool.
- `filter`: the configured namespace scopes normal reads and writes, while per-memory overrides and `crossNamespace` remain available.
- `isolated`: `ENGRAM_NAMESPACE` is required; overrides and cross-namespace search are rejected.

For backwards compatibility, an existing configuration that has `ENGRAM_NAMESPACE` but no `ENGRAM_NAMESPACE_MODE` is treated as `filter`. When both variables are absent, the mode is `none` and the shared-memory behavior is unchanged.

Isolated mode also stores its vector cache in a namespace-specific file by appending a short namespace hash to `ENGRAM_INDEX_PATH`. This prevents one isolated process from loading another namespace's cached vectors.

### Example

```bash
PORT=4901 \
HOST=0.0.0.0 \
ENGRAM_DB_PATH=/data/engram.db \
ENGRAM_NAMESPACE_MODE=isolated \
ENGRAM_NAMESPACE=prod \
ENGRAM_DECAY_INTERVAL=1800000 \
ENGRAM_EMBEDDING_MODEL=Xenova/bge-small-en-v1.5 \
NODE_ENV=production \
  node apps/server/dist/index.js
```

---

## MCP Server (`packages/mcp`)

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database file path |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace for memory isolation |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model (must match the API server if sharing a database) |

The MCP server runs as a stdio process — it shares a database file with the REST API server. Both must point to the same `ENGRAM_DB_PATH`.

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/path/to/neuralcore/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/path/to/neuralcore/packages/core/engram.db",
        "ENGRAM_NAMESPACE": "claude",
        "ENGRAM_EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2"
      }
    }
  }
}
```

---

## CLI (`packages/cli`)

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database file path |
| `ENGRAM_INDEX_PATH` | `{ENGRAM_DB_PATH}.index` | Path to persisted vector index |

The CLI creates a `NeuralBrain` instance with `defaultSource: 'cli'`. It reads the index from `ENGRAM_INDEX_PATH` for fast startup and writes it back on shutdown.

### Example

```bash
ENGRAM_DB_PATH=/data/engram.db \
ENGRAM_INDEX_PATH=/data/engram.db.index \
  engram stats
```

---

## Ollama Proxy (`adapters/ollama`)

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_PROXY_PORT` | `11435` | Proxy listen port |
| `OLLAMA_TARGET` | `http://localhost:11434` | Real Ollama server URL |
| `ENGRAM_API` | `http://localhost:4901` | Engram REST API base URL |
| `ENGRAM_MAX_TOKENS` | `1500` | Max tokens to inject per request |

### Example

```bash
OLLAMA_PROXY_PORT=11435 \
OLLAMA_TARGET=http://localhost:11434 \
ENGRAM_API=http://localhost:4901 \
ENGRAM_MAX_TOKENS=2000 \
  node adapters/ollama/dist/proxy.js
```

---

## Database

### SQLite (development)

Default for local development. Zero configuration — the file is created automatically on first run.

```bash
ENGRAM_DB_PATH=./engram.db
```

**Pragmas applied automatically:**

```sql
PRAGMA journal_mode = WAL;      -- concurrent reads during writes
PRAGMA synchronous = NORMAL;    -- safe + fast
PRAGMA cache_size = 10000;      -- 10k page cache (~40MB)
PRAGMA foreign_keys = ON;       -- enforce FK constraints
```

WAL mode is critical for performance — it allows reads to proceed concurrently with a write, enabling high-throughput batch inserts.

### PostgreSQL

PostgreSQL is not supported as a primary storage backend. Engram uses SQLite
for all local operations.

For multi-device synchronization, Engram can replicate data through a shared
PostgreSQL instance. See [Cloud Sync](CLOUD-SYNC.md) for setup instructions.

---

## Embedder

The embedder runs locally via ONNX Runtime WASM — no GPU, no external API calls. The model downloads automatically on the first embed call (~25 MB).

| Setting | Value | Notes |
|---|---|---|
| Model | `Xenova/all-MiniLM-L6-v2` | 384-dim, 23M params, fast |
| Runtime | ONNX Runtime WASM | Runs in Node.js, no GPU required |
| Cache dir | `./models` (relative to CWD) | Downloaded on first use (~23 MB) |
| Quantization | FP32 internally, FP16 stored | 2x storage compression |

### `ENGRAM_EMBEDDING_MODEL`

Set this environment variable on any component (server, MCP, CLI) to override the default model. After changing the model, run a re-embed to update existing vectors.

### Supported models

| Model | Dimensions | Approximate size | Notes |
|---|---|---|---|
| `Xenova/all-MiniLM-L6-v2` | 384 | 23 MB | **Default** — fast, good quality |
| `Xenova/bge-small-en-v1.5` | 384 | 33 MB | BGE small, comparable quality |
| `Xenova/bge-base-en-v1.5` | 768 | 110 MB | BGE base, higher quality |
| `Xenova/gte-small` | 384 | 33 MB | GTE small |
| `Xenova/gte-base` | 768 | 110 MB | GTE base, higher quality |

After switching models, all existing embeddings become stale. Use the re-embed endpoint to update them:

```bash
# Check status
curl http://localhost:4901/api/embeddings/status

# Re-embed stale memories
curl -X POST http://localhost:4901/api/embeddings/re-embed \
  -H 'Content-Type: application/json' \
  -d '{ "onlyStale": true, "batchSize": 32 }'
```

### Pre-downloading the model

```bash
cd packages/core
node -e "
const { embed } = await import('./dist/embedding/Embedder.js');
await embed('warm up');
console.log('Model cached.');
"
```

---

## Memory Decay

Memory decay follows an Ebbinghaus forgetting curve. Memories lose retention over time and are archived once they fall below the threshold. The API server runs automatic decay sweeps on a timer.

### Decay policy defaults

| Parameter | Default | Description |
|---|---|---|
| `halfLifeDays` | `7` | Ebbinghaus half-life in days |
| `archiveThreshold` | `0.05` | Retention score below which a memory is archived |
| `decayIntervalMs` | `3600000` (1 hour) | How often the auto-sweep runs (0 = disabled) |
| `batchSize` | `200` | Memories evaluated per batch |
| `importanceDecayRate` | `0.01` | Daily importance reduction rate for unused memories |
| `importanceFloor` | `0.05` | Minimum importance value after decay |

Override the interval and threshold at the server level via `ENGRAM_DECAY_INTERVAL` and `ENGRAM_DECAY_THRESHOLD` environment variables. Fine-grained control is available at runtime through the MCP `decay_policy` tool or the REST API `PUT /api/decay/policy`.

### Protection rules

Certain memories are shielded from decay and archival:

| Rule | Condition |
|---|---|
| `high-importance-semantic` | Semantic memories with importance >= 0.8 |
| `high-confidence-procedural` | Procedural memories with confidence >= 0.9 |
| `recently-accessed` | Any memory accessed within the last 24 hours |
| `pinned-or-protected` | Memories tagged `pinned` or `protected` |

Protection rules are evaluated during each sweep. Protected memories skip the decay calculation entirely.

### Auto-consolidation

After each decay sweep, the engine can automatically consolidate clusters of old episodic memories into semantic summaries.

| Parameter | Default | Description |
|---|---|---|
| `consolidation.enabled` | `true` | Whether auto-consolidation runs after each sweep |
| `consolidation.minClusterSize` | `3` | Minimum episodic memories required to form a cluster |
| `consolidation.similarityThreshold` | `0.6` | Similarity threshold for clustering |
| `consolidation.minEpisodicAgeMs` | `86400000` (24 hours) | Only consolidate episodes older than this |

---

## Contradiction Detection

When a new memory is stored, the contradiction detector finds highly similar existing memories and analyzes their content for conflicting statements.

### Configuration defaults

| Parameter | Default | Description |
|---|---|---|
| `enabled` | `true` | Enable contradiction checking on every store |
| `similarityThreshold` | `0.65` | Minimum embedding similarity to consider two memories same-topic |
| `confidenceThreshold` | `0.4` | Minimum contradiction confidence to flag |
| `maxCandidates` | `10` | Maximum candidate memories to evaluate per store |
| `defaultStrategy` | `keep_both` | Default resolution strategy when auto-resolving |
| `autoResolve` | `false` | Automatically resolve contradictions using the default strategy |

### Resolution strategies

| Strategy | Behavior |
|---|---|
| `keep_newest` | Archive the old memory, keep the new one |
| `keep_oldest` | Keep the old memory, archive the new one |
| `keep_important` | Keep whichever memory has higher importance |
| `keep_both` | Keep both memories, link with a `contradicts` graph edge |
| `manual` | Flag for human review, take no action |

### Runtime configuration

Update contradiction detection settings at runtime via the REST API:

```bash
curl -X PUT http://localhost:4901/api/contradictions/config \
  -H 'Content-Type: application/json' \
  -d '{
    "enabled": true,
    "similarityThreshold": 0.7,
    "confidenceThreshold": 0.5,
    "autoResolve": false
  }'
```

---

## Webhooks

Subscribe external systems to memory events via HTTP callbacks.

### Events

| Event | Fires when |
|---|---|
| `stored` | A new memory is stored |
| `forgotten` | A memory is archived |
| `decayed` | A decay sweep completes |
| `consolidated` | Episodic memories are consolidated into semantic |
| `contradiction` | A contradiction is detected on store |

### HMAC signing

If a `secret` is provided when subscribing, every delivery includes an `X-Engram-Signature` header with an HMAC-SHA256 digest of the JSON body:

```
X-Engram-Signature: sha256=<hex-digest>
```

Verify the signature on your server to confirm the payload came from Engram.

### Retry policy

- **Max retries:** 3 attempts per delivery
- **Backoff:** Exponential — 500 ms, 1 s, 2 s
- **Timeout:** 10 seconds per attempt
- **Auto-disable:** After 10 consecutive failures, the webhook is automatically deactivated

### Example subscription

```bash
curl -X POST http://localhost:4901/api/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/engram-hook",
    "events": ["stored", "contradiction"],
    "secret": "my-hmac-secret",
    "description": "Production event sink"
  }'
```

---

## Plugins

Plugins extend the brain by hooking into key lifecycle events. Register plugins programmatically via `brain.registerPlugin()`.

### Manifest format

```typescript
const myPlugin: EngramPlugin = {
  id: 'my-org/my-plugin',     // unique identifier
  name: 'My Plugin',          // human-readable name
  version: '1.0.0',           // semver
  description: 'Optional description',
  hooks: {
    onStore:    async (ctx) => { /* ... */ },
    onRecall:   async (ctx) => { /* ... */ },
    onForget:   async (ctx) => { /* ... */ },
    onDecay:    async (ctx) => { /* ... */ },
    onStartup:  async (ctx) => { /* ... */ },
    onShutdown: async (ctx) => { /* ... */ },
  },
};
```

### Hooks

| Hook | Context | Fires when |
|---|---|---|
| `onStore` | `{ memory, contradictions }` | After a memory is stored |
| `onRecall` | `{ query, memoriesUsed, latencyMs, context }` | After recall completes |
| `onForget` | `{ memoryId }` | When a memory is archived |
| `onDecay` | `{ scannedCount, archivedCount, decayedCount, consolidatedCount, durationMs }` | After a decay sweep |
| `onStartup` | `{ entryCount, loadedFrom, initDurationMs }` | When the brain initializes |
| `onShutdown` | `{ entryCount }` | When the brain shuts down |

### Registration

```typescript
import { NeuralBrain } from '@engram-ai-memory/core';

const brain = new NeuralBrain({ dbPath: './engram.db' });
brain.registerPlugin(myPlugin);
await brain.initialize();
```

Plugins run in registration order. Errors in one plugin are caught and logged — they never break other plugins or the brain itself.

---

## Index Persistence

The vector index can be persisted to disk for fast startup. Instead of re-scanning the entire database on each boot, the index loads from a binary cache file and incrementally adds only the new memories.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_INDEX_PATH` | `{ENGRAM_DB_PATH}.index` | Path to the persisted index binary file |

### Behavior

- **Startup:** If the index file exists, the index is deserialized from disk. Any memories in the database that are not in the cached index are added incrementally.
- **Shutdown:** The index is serialized and written to the index file automatically.
- **Incremental sync:** Only new memories (by ID) are embedded and added after loading from cache.
- **Cross-process sync:** Every read path (`search`, `recall`, `stats`, `GET /api/index/status`, the `index_status` MCP tool) first reconciles the in-memory index with memories committed by *other* processes, adding what is missing and dropping what was archived. Detection uses SQLite's `PRAGMA data_version`, which moves only for another connection's commits — so a process's own writes cost nothing, and when nothing external has changed the check is a single pragma read with no query at all. Without this, a memory stored through the REST server stayed invisible to `search` in the MCP server until that process restarted, even though `stats` already counted it.
- **Invalidation:** A cached index is refused — and rebuilt from the database instead — when its format version, dimension, embedding model or checksum does not match, or when its entry count disagrees with the payload length. Nothing needs to be deleted by hand after switching embedding models, and a truncated or corrupted file cannot be loaded as if it were intact.

> Give every process its own `ENGRAM_INDEX_PATH` when more than one runs against the same database. Sharing the default `<db>.index` means they overwrite each other's index, and during a rolling deploy processes on different format versions will each reject and rewrite what the other wrote. Nothing is lost — the database stays authoritative — but a large index gets rebuilt repeatedly for as long as the mix lasts.

> **Known limits of cross-process sync.** It relies on `PRAGMA data_version`, which SQLite reports per *connection*: two `NeuralBrain` instances sharing one connection inside a single process will not see each other's writes this way (engram itself creates one brain per process, so this does not arise in normal deployments). Graph edges are synced only where one endpoint is a newly arrived memory — an edge created externally between two memories this process already held is picked up on the next restart.

### Binary format

Magic bytes `ENGR`, then a header of `version`, `dimension`, `entry count`, the `embedding model` id, and a CRC-32 over the entry payload, followed by packed entry data (ID + type + namespace + FP32 vectors).

The model id and checksum exist so an index can be validated rather than trusted: two models can produce vectors of the same dimension, so dimension alone cannot tell whether a cached index is comparable to what the running model emits.

Saves are atomic — the file is written to a temp sibling and renamed over the target — so an interrupted save leaves the previous index readable. The payload is not fsynced, so a power loss can revert to the previous snapshot; that is acceptable because the index is a cache rebuildable from the database.

### Checking index status

```bash
curl http://localhost:4901/api/index/status
```

Returns `loadedFrom` (`disk` or `database`), entry count, incremental count, and init duration.

---

## Performance Tuning

### Write throughput

For batch imports (>1000 records), use the batch endpoint:

```bash
POST /api/memory/batch
{ "memories": [...] }  # up to 200 at a time
```

The batch endpoint wraps all inserts in a single SQLite transaction, achieving 10,000+ records/sec on WAL-mode SQLite.

### Recall latency

Target: p99 < 100 ms. If you are exceeding this:

| Check | Command |
|---|---|
| Index size | `GET /api/stats` -> `indexSize` |
| DB size | `ls -lh packages/core/engram.db` |
| Slow query log | Set `logger: { level: 'debug' }` in Fastify |

**Tuning options:**

```bash
# Increase SQLite cache (each page is ~4 KB)
PRAGMA cache_size = 20000;  # ~80 MB

# Reduce topK in vector search for faster recall
POST /api/recall { "query": "...", "maxTokens": 1000 }
# Lower maxTokens = fewer candidates = faster
```

### Vector index

The in-memory vector index rebuilds from the database on server start unless a persisted index file exists (see [Index Persistence](#index-persistence)). For very large databases (>100k memories), always use index persistence to avoid slow startup.

### Dashboard performance

The 3D visualization targets 30 FPS. If performance drops with many neurons:

1. Switch to **Neural Net** or **Clusters** view (fewer draw calls)
2. Reduce `count` in `<Stars>` component
3. Lower `dpr` in `<Canvas>` (change `[1, 1.5]` to `[1, 1]`)
4. Disable bloom: reduce `intensity` in `<Bloom>` to 0

---

## Ports

| Port | Service | Description |
|---|---|---|
| `4901` | API Server | Engram REST API + Swagger docs at `/docs` + 3D Dashboard |
| `4902` | Dev only | Vite dev server for `apps/web` (not needed in production) |
| `11435` | Ollama Proxy | Transparent memory-injecting proxy for Ollama |

WebSocket is served on the same port as the API server (`4901`) under the `/neural` namespace.

---

## Process Management (PM2)

For production deployments, use PM2:

```bash
npm install -g pm2

# Start API server
pm2 start apps/server/dist/index.js \
  --name engram-api \
  --env production \
  -- \
  --NODE_ENV=production \
  --ENGRAM_DB_PATH=/data/engram.db

# Start dashboard (optional)
pm2 start apps/dashboard/dist/index.js \
  --name engram-dashboard \
  --env production

# Start Ollama proxy (optional)
pm2 start adapters/ollama/dist/proxy.js \
  --name engram-ollama-proxy

# Save and enable auto-restart
pm2 save
pm2 startup
```

Alternatively, use the provided `ecosystem.config.js` if present:

```bash
pm2 start ecosystem.config.js
```

### Monitoring

```bash
pm2 status          # overview of all processes
pm2 logs engram-api # tail API server logs
pm2 monit           # real-time CPU/memory dashboard
```
