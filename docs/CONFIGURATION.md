# Configuration

All Engram components are configured via environment variables. Defaults work for local development out of the box.

One exception to "environment variables only": the CLI keeps `~/.engram/config.json` (see [CLI](#cli-packagescli)) and **derives the server's environment from it**. When you start the server with `engram start`, the config file's values for `PORT`, `HOST`, `ENGRAM_DB_PATH`, `ENGRAM_INDEX_PATH`, `ENGRAM_EMBEDDING_MODEL` and `ENGRAM_NAMESPACE_MODE` override whatever your shell exported. `ENGRAM_SYNC_ENCRYPTION_KEY` is the one variable passed straight through. Running `node apps/server/dist/index.js` yourself uses the environment as written.

---

## API Server (`apps/server`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4901` | HTTP server port |
| `HOST` | `127.0.0.1` | Bind address. **Loopback only by default** — set `0.0.0.0` to accept connections from other machines, and read [Security](#security) before you do |
| `ENGRAM_DB_PATH` | `{cwd}/engram.db` | SQLite database file path. A blank value counts as unset |
| `ENGRAM_NAMESPACE_MODE` | `none` | `none` disables namespaces, `filter` enables optional scoping/overrides, `isolated` enforces one fixed namespace. A blank value counts as unset; any **other** unrecognised value aborts startup |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace value for `filter` or `isolated`; required by `isolated`, which aborts startup without it |
| `ENGRAM_DECAY_INTERVAL` | `3600000` | Decay sweep interval in milliseconds (0 = disabled). Must be 0–2147483647; a finite value outside that range aborts startup |
| `ENGRAM_DECAY_THRESHOLD` | `0.05` | Retention score below which memories are archived. Must be 0–1; a finite value outside that range aborts startup |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` | Path to persist the vector index for fast startup |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model used for vectorization |
| `ENGRAM_BATCH_CONCURRENCY` | `16` | How many `POST /api/memory/batch` items may embed at once. Raise it when the embedder is remote and latency-bound |
| `ENGRAM_DATABASE` | *(unset)* | Legacy backend selector. Setting it to `postgresql` aborts startup by design — see [Database](#database) |

Security-related variables (`ENGRAM_API_KEY`, host and origin allowlists, rate limits, headers) have their own section: [Security](#security). Cloud-sync variables are in [Cloud Sync](#cloud-sync).

`NODE_ENV` is **not read by any Engram code**. It appears in `docker-compose.yml` and `ecosystem.config.cjs` only as a conventional marker; the Fastify log level is fixed at `warn`.

Namespace behavior is opt-in:

- `none` (default): namespace inputs are ignored and new memories are stored in the shared pool.
- `filter`: the configured namespace scopes normal reads and writes, while per-memory overrides and `crossNamespace` remain available.
- `isolated`: `ENGRAM_NAMESPACE` is required; overrides and cross-namespace search are rejected.

For backwards compatibility, an existing configuration that has `ENGRAM_NAMESPACE` but no `ENGRAM_NAMESPACE_MODE` is treated as `filter`. When both variables are absent, the mode is `none` and the shared-memory behavior is unchanged.

Isolated mode also stores its vector cache in a namespace-specific file by appending a short namespace hash to `ENGRAM_INDEX_PATH`. This prevents one isolated process from loading another namespace's cached vectors.

### Example

```bash
PORT=4901 \
HOST=127.0.0.1 \
ENGRAM_DB_PATH=/data/engram.db \
ENGRAM_NAMESPACE_MODE=isolated \
ENGRAM_NAMESPACE=prod \
ENGRAM_DECAY_INTERVAL=1800000 \
ENGRAM_EMBEDDING_MODEL=Xenova/bge-small-en-v1.5 \
  node apps/server/dist/index.js
```

---

## MCP Server (`packages/mcp`)

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database file path. **Not** the current directory: under a desktop host the cwd belongs to the app, so a database there is one nobody chose and nobody can find. A blank value counts as unset, and the resolved path is written back into the environment |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace for memory isolation |
| `ENGRAM_NAMESPACE_MODE` | `none` (`filter` when `ENGRAM_NAMESPACE` is set) | Same three modes as the API server |
| `ENGRAM_SOURCE` | `mcp-client` | Client identifier stamped on every stored memory (`claude-code`, `cursor`, `windsurf`, …) |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model (must match the API server if sharing a database) |
| `ENGRAM_SYNC_URL`, `ENGRAM_SYNC_MODE`, `ENGRAM_SYNC_INTERVAL`, `ENGRAM_SYNC_ENCRYPTION_KEY` | *(see [Cloud Sync](#cloud-sync))* | The MCP server **validates** these strictly and refuses to start on a bad value, where the REST server does not |

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
| `ENGRAM_HOME` | `~/.engram` | Root of the CLI's own state directory |

The CLI does not read `ENGRAM_DB_PATH` or `ENGRAM_INDEX_PATH` itself — it reads `${ENGRAM_HOME}/config.json` and **exports** those variables into the server process it starts.

**`${ENGRAM_HOME}` layout**

| Path | Contents |
|---|---|
| `config.json` | The CLI's configuration, mode `0600`. Keys: `dbPath`, `port`, `host`, `namespace`, `namespaceMode`, `embeddingModel`, `indexPath`, `repoPath`, `syncUrl`, `syncInterval`, `syncMode`, `deviceName` |
| `engram.db` | Default database (`dbPath`), with `engram.db.index` beside it |
| `server.pid` | PID of the detached server started by `engram start` |
| `logs/server.log` | Detached server output |
| `build.json` | `{ rev, builtAt }` — the git revision a build last **completed** for. `engram update` and `engram doctor` compare it against `HEAD` of the checkout, so a checkout with no recorded build always rebuilds |
| `repo/` | The clone `engram setup` creates (`repoPath`) |

Read and change configuration with `engram configure show`, `engram configure set <key> <value>` and `engram configure path`. Data commands (`store`, `search`, `recall`, `stats`, …) talk to the running server over HTTP at `http://<host>:<port>` from that same file.

### Example

```bash
engram configure set dbPath /data/engram.db
engram configure set indexPath /data/engram.db.index
engram stats
```

---

## Ollama Proxy (`adapters/ollama`)

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_PROXY_PORT` | `11435` | Proxy listen port. `0` asks the OS for a free port and the startup banner reports it |
| `ENGRAM_PROXY_HOST` | `127.0.0.1` | Bind address. **Loopback only by default** — the proxy has no authentication, so a wider bind hands any peer on the network an open endpoint that drives your GPU. Set `0.0.0.0` to opt in; the banner says which mode is active |
| `OLLAMA_TARGET` | `http://localhost:11434` | Real Ollama server URL. Parsed at startup — an unparseable URL exits non-zero |
| `ENGRAM_API` | `http://localhost:4901` | Engram REST API base URL |
| `ENGRAM_MAX_TOKENS` | `1500` | Max tokens to inject per request |
| `ENGRAM_MAX_BODY_BYTES` | `10485760` (10 MiB) | Ceiling on a buffered request body. Over the limit the proxy answers `413 Payload Too Large` and destroys the socket rather than draining a body it has already refused |
| `ENGRAM_TOOL_RETRY` | `true` | Retry a failed tool call once with an instruction. Disabled only by the exact string `false` |
| `ENGRAM_UPSTREAM_TIMEOUT_MS` | `300000` | Per-request timeout against the upstream Ollama server |

A failure to bind exits **non-zero**. An idle process that later exits 0 reads as success to a supervisor and hides the failure.

### Example

```bash
OLLAMA_PROXY_PORT=11435 \
ENGRAM_PROXY_HOST=127.0.0.1 \
OLLAMA_TARGET=http://localhost:11434 \
ENGRAM_API=http://localhost:4901 \
ENGRAM_MAX_TOKENS=2000 \
ENGRAM_MAX_BODY_BYTES=10485760 \
  node adapters/ollama/dist/proxy.js
```

---

## Security

Engram's defaults are local-first: the API server binds `127.0.0.1`, authentication is off, and nothing is published beyond the machine. Everything below is what you change when that stops being true. `docker-compose.yml` publishes API, dashboard and Postgres on loopback only for the same reason.

### Authentication

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_API_KEY` | *(unset — open)* | Shared secret. When set, every `/api/*` route plus `/docs/json` and `/docs/yaml` requires `X-API-Key: <key>` or `Authorization: Bearer <key>`, and the Socket.io handshake requires the same value as `auth.token`. `GET /api/health` stays open for container probes |

**Set-but-empty aborts startup.** `ENGRAM_API_KEY=""` — exactly what a host templating an untouched optional field produces — used to disable authentication while every config file still said a key was configured. Unset the variable to run open; give it a real value to run closed. Whitespace-only counts as empty.

The dashboard's static bundle and the SPA fallback are served without the key: a browser cannot attach a header to a top-level navigation, so gating them would make the page that lets a user enter the key unreachable. Every read and write lives under `/api/`. With a key set, the dashboard asks for it in the UI and holds it in the browser session — it is never built into the bundle.

### Host allowlist

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_ALLOWED_HOSTS` | *(empty)* | Comma-separated hostnames allowed in the `Host` header on `/api/*`. `*` disables the check |

This is the DNS-rebinding defense. Without any configuration:

- **Any IP literal passes**, v4 or v6 — a rebind needs a *name* whose answer can change, so LAN access by address keeps working.
- **`localhost` and `*.localhost` pass** (RFC 6761), covering the local-first default and container healthchecks.
- **Every other hostname is refused with `403`.** A deployment reached by name — behind a reverse proxy, or as `api` on a Docker network — must list it here.

Ports are stripped before matching and comparison is case-insensitive, so list bare hostnames (`engram.example.com`, not `engram.example.com:4901`). Only `/api/*` is guarded; the dashboard shell and `/docs` stay reachable under any Host because they hold no data.

### Browser origins

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_ALLOWED_ORIGINS` | `http://localhost:{PORT}`, `http://127.0.0.1:{PORT}`, `http://localhost:4902`, `http://127.0.0.1:4902`, `http://localhost:5173`, `http://127.0.0.1:5173` | Comma-separated browser origins allowed for CORS **and** for the WebSocket handshake |

Matching is exact and case-sensitive; there is no wildcard. Requests with **no** `Origin` header — CLI, MCP, curl — are allowed, because non-browser clients send none. A disallowed origin is refused during the Socket.io handshake, before any transport exists, not merely denied response headers.

### Rate limiting

Fixed windows keyed by client address, on `/api/*` only. Static assets and the SPA fallback are exempt. A request is charged against every tier it matches, so a heavy call also spends global budget.

| Variable | Default | Tier |
|---|---|---|
| `ENGRAM_RATE_LIMIT_WINDOW_MS` | `60000` | Window length, shared by all three tiers |
| `ENGRAM_RATE_LIMIT_MAX` | `1000` | `global` — every `/api/*` request |
| `ENGRAM_RATE_LIMIT_HEAVY_MAX` | `300` | `heavy` — anything that embeds text or runs a search |
| `ENGRAM_RATE_LIMIT_WHOLE_STORE_MAX` | `30` | `whole-store` — the full-store passes |
| `ENGRAM_RATE_LIMIT_DISABLED` | `false` | Set to exactly `true` to turn the limiter off |

`heavy` covers `POST /api/memory`, `/api/memory/batch`, `/api/memory/bulk/tag`, `/api/memory/bulk/archive`, `POST /api/search`, `POST /api/recall` and `GET /api/recall/stream`. `GET /api/memory` is a plain list and stays global-only.

`whole-store` covers `POST /api/consolidate`, `/api/decay`, `/api/embeddings/backfill`, `/api/embeddings/re-embed`, `/api/index/rebuild`, `/api/index/save` and `/api/sync/trigger`. These also hold a process-wide single-flight guard: starting one while it is already running returns `409` rather than letting two passes interleave.

Setting a tier's limit to `0` disables that tier. A non-numeric value falls back to the default.

Exceeding a tier returns `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. Those headers appear only on the `429`.

### Response headers

Every response — route handlers, the static bundle and the SPA fallback alike — carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`. A header already set by a route or a proxy is never overwritten.

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_CSP` | *(the built-in policy)* | Replaces the whole `Content-Security-Policy` value. `off` sends no CSP header at all; blank or unset uses the default |
| `ENGRAM_HSTS_MAX_AGE` | *(none)* | Seconds for `Strict-Transport-Security: max-age=<n>; includeSubDomains`. Off by default — the server speaks HTTP, and a wrong value is sticky in the browser for its whole max-age |

The default policy is written against what the built dashboard actually loads, not copied from a template:

```
default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';
script-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net;
img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:;
connect-src 'self' https://cdn.jsdelivr.net ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:*
```

Two entries are load-bearing rather than decorative: `blob:` in `script-src` is what lets the 3D text labels bootstrap their worker (`importScripts` on a blob URL is governed by `script-src`, not `worker-src`), and `cdn.jsdelivr.net` is where that same library fetches its unicode font index at runtime. A fork that adds its own CDN should override `ENGRAM_CSP` rather than lose either.

### Known limitation — realtime and namespaces

Every Socket.io broadcast reaches every connected socket. In `filter` mode a memory stored into another namespace is still broadcast to all of them, and `recall:chunk` streams one caller's results to every listener. Under the single-shared-key model this is not a privilege boundary being crossed — every socket is the same principal as every HTTP caller — but **multi-tenant deployments must not treat the `/neural` namespace as a tenant boundary.**

---

## Cloud Sync

Full setup, conflict resolution and encryption details are in [CLOUD-SYNC.md](CLOUD-SYNC.md). The variables:

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_SYNC_URL` | *(unset — sync off)* | PostgreSQL connection string. Must use the `postgres://` / `postgresql://` scheme, and must require TLS — `sslmode=require` is appended automatically when absent |
| `ENGRAM_SYNC_MODE` | `auto` | `auto` (interval + debounce on write), `manual` (explicit only), `off` |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval in milliseconds, `auto` mode only |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(unset — plaintext)* | Passphrase for end-to-end encryption of synced rows. Passed byte-for-byte and **never trimmed**: trimming would derive a different key and orphan every row already encrypted |
| `ENGRAM_SYNC_ALLOW_UNENCRYPTED` | `false` | Set to exactly `true` to permit a non-TLS Postgres connection. Local development only. The CLI sets this for you when the configured URL contains `sslmode=disable` |

The MCP server validates `ENGRAM_SYNC_MODE` and `ENGRAM_SYNC_INTERVAL` and refuses to start on a bad value. **The REST server does not** — an unrecognised mode silently disables the scheduler, and a non-numeric interval yields `NaN`, which degenerates into a sync attempt roughly every millisecond. Set both carefully, or set neither.

A wrong passphrase is caught at sync time, not startup, and surfaces as `WRONG_PASSPHRASE`.

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
for all local operations. `ENGRAM_DATABASE=postgresql` fails fast rather than
degrading quietly.

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

A model that is not in this table is accepted, but its dimension is **assumed to be 384**. If the real width differs, the vectors it produces will not match the stored index — check `GET /api/embeddings/status` after switching.

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
| `reflected` | A reflection insight is stored |

### HMAC signing

If a `secret` is provided when subscribing, every delivery includes an `X-Engram-Signature` header with an HMAC-SHA256 digest of the JSON body:

```
X-Engram-Signature: sha256=<hex-digest>
```

Verify the signature on your server to confirm the payload came from Engram.

The secret is **write-only**. Reads report a `hasSecret` boolean instead of the value, because handing the signing key back to anyone with API read access lets them forge deliveries your server would accept. A lost secret is rotated by re-subscribing.

### Target validation

Webhook URLs come from the API, so they are attacker-supplyable, and deliveries are issued by the server itself. Before a subscription is stored the target is resolved and refused if it lands on loopback, link-local (cloud metadata), RFC1918, CGNAT, multicast or reserved space — for IPv4 and IPv6 alike, including the mapped and translated IPv6 spellings of a private IPv4 address.

At delivery time the socket is pinned to the address that was validated, connection pooling is off so a socket cannot outlive the check that authorised it, and **redirects are not followed at all** — a `302` to an internal address is an ordinary failed delivery.

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_WEBHOOK_ALLOW_PRIVATE` | `false` | Set to exactly `true` to allow private and loopback targets. This disables both the address check and the pinning |
| `ENGRAM_WEBHOOK_MAX_CONCURRENCY` | `32` | Ceiling on concurrent background deliveries |

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
{ "memories": [...] }  # up to 1000 at a time
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

1. Lower `dpr` in `<Canvas>` (change `[1, 1.5]` to `[1, 1]`)
2. Disable bloom: reduce `intensity` in `<Bloom>` to 0
3. Raise `minStrength` on `GET /api/graph/edges` so fewer edges are drawn

Nodes are drawn with two instanced meshes and every edge with a single `LineSegments`, so draw-call count does not scale with the store — switching views does not change it.

---

## Ports

| Port | Service | Description |
|---|---|---|
| `4901` | API Server | Engram REST API + Swagger docs at `/docs` + 3D Dashboard |
| `4902` | Dashboard | Standalone dashboard container (`docker compose`). The API server also serves the built dashboard on `4901`, so this is optional |
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

Alternatively, use the `ecosystem.config.cjs` in the repository root:

```bash
pm2 start ecosystem.config.cjs
```

### Monitoring

```bash
pm2 status          # overview of all processes
pm2 logs engram-api # tail API server logs
pm2 monit           # real-time CPU/memory dashboard
```
