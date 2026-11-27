# Configuration

Engram’s servers and hooks read environment variables. The CLI also has a configuration file. Defaults work for local development out of the box.

The CLI keeps `~/.engram/config.json` by default (see [CLI](#cli-packagescli)). `engram start` inherits the shell environment, then sets `PORT`, `HOST`, `ENGRAM_DB_PATH`, `ENGRAM_INDEX_PATH`, `ENGRAM_EMBEDDING_MODEL` and `ENGRAM_NAMESPACE_MODE` from that file. Configured namespace and sync settings also take precedence. Other variables, including `ENGRAM_API_KEY` and `ENGRAM_SYNC_ENCRYPTION_KEY`, pass through. Running `node apps/server/dist/index.js` directly uses the environment as written.

---

## API Server (`apps/server`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4901` | HTTP server port, 0–65535 (0 requests a free port) |
| `HOST` | `127.0.0.1` | Bind address. **Loopback only by default** — set `0.0.0.0` to accept connections from other machines, and read [Security](#security) before you do |
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database file. Blank selects the default, `~` and `~/` expand, and relative environment paths resolve from the user’s home directory. |
| `ENGRAM_NAMESPACE_MODE` | `filter` with `ENGRAM_NAMESPACE`, otherwise `none` | `none` disables namespaces, `filter` enables optional scoping/overrides, `isolated` enforces one fixed namespace. `engram start` passes `none` for the CLI's `project` mode, so the server and dashboard see every project. A blank value counts as unset; any **other** unrecognised value aborts startup |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace for `filter` or `isolated`. `isolated` requires a nonblank name. |
| `ENGRAM_DECAY_INTERVAL` | `3600000` | Decay sweep interval in whole milliseconds. Use 0 to disable or 1000–2147483647 to enable. Negative, fractional or nonnumeric input warns and uses the default. Other out-of-range integers abort startup. |
| `ENGRAM_DECAY_THRESHOLD` | `0.05` | Retention score below which memories are archived, from 0 to 1. Invalid values warn and use the default. |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` with an explicit DB path | Vector cache file. A directly launched REST server with both paths unset uses an in-memory index. |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Embedding model used for vectorization |
| `ENGRAM_HYBRID_SEARCH` | `false` | Opt in to vector + FTS5 BM25 retrieval fused by RRF with `1` or `true`; explicit `NeuralBrain` config `hybridSearch` overrides the environment |
| `ENGRAM_DEDUP_THRESHOLD` | `0.97` | Minimum cosine similarity for merging a compatible memory of the same type and namespace on store. Accepts values greater than 0 and at most 1. |
| `ENGRAM_DATABASE` | *(unset)* | Legacy backend selector. Setting it to `postgresql` aborts startup by design — see [Database](#database) |

Security-related variables (`ENGRAM_API_KEY`, host and origin allowlists, rate limits, headers) have their own section: [Security](#security). Cloud-sync variables are in [Cloud Sync](#cloud-sync).

The Fastify log level is fixed at `warn`. `NODE_ENV` appears in the deployment configuration and does not select an Engram log level.

One database file is shared by default: `~/.engram/engram.db`. The CLI resolves relative `dbPath` values from the user’s home directory too. Programmatic `NeuralBrain` callers can pass a relative path from their working directory.

`ENGRAM_NAMESPACE_MODE` values:

- `project` (default for stdio MCP and CLI setup): inside a git repository, scopes to the main repository's absolute top-level path, so linked worktrees share one namespace. This comes from `git rev-parse --path-format=absolute --git-common-dir` with a trailing `/.git` removed; a bare common directory is used as-is. Older git versions fall back to `--show-toplevel`. It behaves like `filter`: reads return the project's own memories plus global (NULL namespace) memories. Outside a git repository it uses `filter` scoped to the resolved current working directory, except at a filesystem root (`/` or a Windows drive root) or exactly the user's home directory, where it uses `filter` without a namespace (global memories only). If no directory is supplied and the process cannot read its working directory, project detection falls back to global scope. SessionStart then skips project recall and can still show a version notice. An explicit `ENGRAM_NAMESPACE` wins. A fresh `engram setup` writes `project`; setup preserves an existing configured mode.
- `none`: reads are not scoped. A memory stored with an explicit namespace keeps it; one stored without a namespace goes to the shared pool (NULL).
- `filter`: the configured namespace scopes normal reads and writes, while per-memory overrides and `crossNamespace` remain available.
- `isolated`: `ENGRAM_NAMESPACE` is required; overrides and cross-namespace search are rejected.

`engram start` maps CLI `project` mode to `none`, so the REST server and dashboard see every project. A directly launched REST server accepts `none`, `filter` or `isolated`.

Memories created before namespace support have a NULL namespace. Clients in `project` or `filter` mode can read them. A `filter` or `project` client can read other projects only with `crossNamespace: true`. It can never forget, update, tag or resolve another project's memories; its own and global memories it can. `store_memory` with `global: true` stores a memory for all projects — use it for preferences, identity and working style — and is rejected in `isolated` mode.

**Namespaces are scoping, not security.** Anything that must stay secret belongs in a separate database file. To merge stray database files, export from one and import into the other. `engram export` reads through the running REST server, so start it on the stray file first, then restart it on the target:

```bash
engram export -f json > ~/.engram/engram-export.json
engram import --dry-run < ~/.engram/engram-export.json
engram import < ~/.engram/engram-export.json
```

`-f ndjson` is also available. `engram import` reads JSON/NDJSON backups from stdin. It ignores original IDs and timestamps and reports new and merged records separately. For file imports use `engram import --from <format> <path>` with `markdown`, `chatgpt` or `claude`. `--dry-run` previews without writing.

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
| `ENGRAM_NAMESPACE` | *(none)* | Namespace for memory isolation; an explicit value wins over `project` detection |
| `ENGRAM_NAMESPACE_MODE` | `project` | `project`, `none`, `filter` or `isolated` (see [Namespace behavior](#api-server-appsserver)) |
| `ENGRAM_SOURCE` | MCP client name, then `mcp-client` | Default source for tool writes. A tool can supply its own source. |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Embedding model (must match the API server if sharing a database) |
| `ENGRAM_ADMIN_TOOLS` | *(unset)* | Set to exactly `1` to expose 11 admin tools in addition to the 15 default tools, including `re_embed`, `index_status` and `decay_policy`. |
| `ENGRAM_GLOBAL_RULES` | *(unset)* | Set to `0` to skip the startup refresh of the configured client’s global memory rules. |
| `ENGRAM_SYNC_URL`, `ENGRAM_SYNC_MODE`, `ENGRAM_SYNC_INTERVAL`, `ENGRAM_SYNC_ENCRYPTION_KEY` | *(see [Cloud Sync](#cloud-sync))* | Both MCP and REST validate the sync mode and interval on startup. |

The standalone MCP server uses stdio. Point it at the REST server’s `ENGRAM_DB_PATH` to share memories. The REST server also serves the same tools over Streamable HTTP at `POST /mcp`, using its own brain and namespace configuration.

```json
// ~/.claude.json — NOT ~/.claude/settings.json, which is for Claude Code settings;
// `engram doctor` warns when an mcpServers entry is found there.
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/path/to/engram/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-code",
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
| `ENGRAM_API_KEY` | *(unset)* | Sent with CLI requests to a keyed REST server. |
| `ENGRAM_RECALL_MIN_SIM` | `0.5` | Claude Code prompt hook installed by the CLI: minimum similarity from 0 to 1. Invalid input skips recall. |
| `ENGRAM_API` | Configured server URL | Overrides the REST base URL for the installed Claude Code prompt and session-end hooks. |
| `CODEX_HOME` | `~/.codex` | Directory for the managed Codex `AGENTS.md` rules. CLI setup writes the MCP entry to `~/.codex/config.toml`. |

The CLI reads `dbPath` and `indexPath` from `${ENGRAM_HOME}/config.json` and exports them to the server it starts. Its one-shot cloud commands also use the configured database directly.

`engram setup` and `engram update` manage a marked block in supported clients' global instruction files by default. Pass `--no-global-rules` to skip the CLI write. MCP startup also refreshes the rules for its configured `ENGRAM_SOURCE`. Set `ENGRAM_GLOBAL_RULES=0` to disable rule writes by both the CLI and MCP server. Setup records this setting when given the flag. In a local Claude Code setup, PostToolUse mirrors project memory files after edits, and SessionEnd captures summaries on `/clear` and skips `resume`. See [client paths and hook details](INTEGRATIONS.md#setup).

**`${ENGRAM_HOME}` layout**

| Path | Contents |
|---|---|
| `config.json` | The CLI's configuration, mode `0600`. Keys: `dbPath`, `port`, `host`, `namespace`, `namespaceMode`, `embeddingModel`, `indexPath`, `repoPath`, `syncUrl`, `syncInterval`, `syncMode`, `deviceName` |
| `engram.db` | Default database (`dbPath`), with `engram.db.index` beside it |
| `hooks/` | Claude Code hook scripts installed by local setup |
| `server.pid` | PID of the detached server started by `engram start` |
| `logs/server.log` | Detached server output |
| `build.json` | `{ rev, builtAt }` — the git revision a build last **completed** for. `engram update` and `engram doctor` compare it against `HEAD` of the checkout, so `doctor` can report a stale build and `update` can rebuild it |
| `repo/` | The clone `engram setup` creates (`repoPath`). `engram setup --npx` skips the clone and build |

Read and change configuration with `engram configure show`, `engram configure set <key> <value>` and `engram configure path`. Data commands (`store`, `search`, `recall`, `stats`, …) talk to the running server over HTTP at `http://<host>:<port>` from that same file.

`embeddingModel` defaults to `''` (empty string), meaning automatic model selection.

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
| `OLLAMA_PROXY_PORT` | `11435` | Proxy listen port, 0–65535. `0` asks the OS for a free port and the startup banner reports it |
| `ENGRAM_PROXY_HOST` | `127.0.0.1` | Bind address. **Loopback only by default** — the proxy has no authentication, so a wider bind hands any peer on the network an open endpoint that drives your GPU. Set `0.0.0.0` to opt in; the banner says which mode is active |
| `ENGRAM_UPSTREAM` | `OLLAMA_TARGET`, then `http://localhost:11434` | Preferred upstream URL. Without an explicit port, HTTP uses 80 and HTTPS uses 443. |
| `OLLAMA_TARGET` | `http://localhost:11434` | Legacy upstream URL. With this setting an omitted HTTP port defaults to 11434. |
| `ENGRAM_API` | `http://localhost:4901` | Engram REST API base URL |
| `ENGRAM_API_KEY` | *(none)* | Sent as `X-API-Key` to the Engram REST API when set |
| `ENGRAM_MAX_TOKENS` | `1500` | Max tokens to inject per request, 1–32000. Invalid input warns and uses the default. |
| `ENGRAM_MAX_BODY_BYTES` | `10485760` (10 MiB) | Positive integer ceiling on a buffered request body. Over the limit the proxy answers `413 Payload Too Large` and destroys the socket rather than draining a body it has already refused |
| `ENGRAM_TOOL_RETRY` | `true` | Retry a missed tool call on an eligible buffered chat request. Only the exact string `false` disables it. A failed retry preserves the first reply. |
| `ENGRAM_UPSTREAM_TIMEOUT_MS` | `300000` | Upstream timeout in whole milliseconds, 1–2147483647. Invalid input warns and uses the default. |

A failure to bind exits **non-zero**. An idle process that later exits 0 reads as success to a supervisor and hides the failure. The proxy returns `403` for an untrusted Host or Origin.

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
| `ENGRAM_API_KEY` | *(unset — open)* | Shared secret. When set, every `/api/*` route plus `/mcp`, `/docs/json` and `/docs/yaml` requires `X-API-Key: <key>` or `Authorization: Bearer <key>`, and the Socket.io handshake requires the same value as `auth.token`. `GET /api/health` stays open for container probes |

**Set-but-empty aborts startup.** `ENGRAM_API_KEY=""` — exactly what a host templating an untouched optional field produces — used to disable authentication while every config file still said a key was configured. Unset the variable to run open; give it a real value to run closed. Whitespace-only counts as empty.

The dashboard's static bundle and the SPA fallback are served without the key: a browser cannot attach a header to a top-level navigation, so gating them would make the page that lets a user enter the key unreachable. MCP clients can also read and write through `/mcp`. With a key set, the dashboard asks for it in the UI and holds it in the browser session — it is never built into the bundle.

### Host allowlist

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_ALLOWED_HOSTS` | *(empty)* | Comma-separated hostnames allowed in the `Host` header on `/api/*`, `/mcp` and the Socket.io handshake. `*` disables the check |

This is the DNS-rebinding defense. Without any configuration:

- **Any IP literal passes**, v4 or v6 — a rebind needs a *name* whose answer can change, so LAN access by address keeps working.
- **`localhost` and `*.localhost` pass** (RFC 6761), covering the local-first default and container healthchecks.
- **Every other hostname is refused with `403`.** A deployment reached by name — behind a reverse proxy, or as `api` on a Docker network — must list it here.

Ports are stripped before matching and comparison is case-insensitive, so list bare hostnames (`engram.example.com`, not `engram.example.com:4901`). The dashboard shell and Swagger UI remain reachable under other hostnames.

### Browser origins

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_ALLOWED_ORIGINS` | `http://localhost:{PORT}`, `http://127.0.0.1:{PORT}`, `http://localhost:4902`, `http://127.0.0.1:4902`, `http://localhost:5173`, `http://127.0.0.1:5173` | Comma-separated browser origins allowed for CORS **and** for the WebSocket handshake |

Matching is exact and case-sensitive; there is no wildcard. Requests with **no** `Origin` header — CLI, MCP, curl — are allowed, because non-browser clients send none. A disallowed origin is refused during the Socket.io handshake, before any transport exists, not merely denied response headers. The HTTP server also returns `403` for a disallowed Origin on `/mcp` or a non-GET `/api/*` request.

### Rate limiting

Fixed windows keyed by client address, on `/api/*` and `/mcp`. Static assets and the SPA fallback are exempt. A request is charged against every tier it matches, so a heavy call also spends global budget.

| Variable | Default | Tier |
|---|---|---|
| `ENGRAM_RATE_LIMIT_WINDOW_MS` | `60000` | Window length, shared by all three tiers |
| `ENGRAM_RATE_LIMIT_MAX` | `1000` | `global` — every `/api/*` and `/mcp` request |
| `ENGRAM_RATE_LIMIT_HEAVY_MAX` | `300` | `heavy` — anything that embeds text or runs a search |
| `ENGRAM_RATE_LIMIT_WHOLE_STORE_MAX` | `30` | `whole-store` — the full-store passes |
| `ENGRAM_RATE_LIMIT_DISABLED` | `false` | Set to exactly `true` to turn the limiter off |

`heavy` covers `POST /api/memory`, `/api/memory/batch`, `/api/memory/bulk/tag`, `/api/memory/bulk/archive`, `/api/contradictions/bulk/resolve`, `/api/memory/:id/redact`, `/api/recall/explain`, `POST /api/search`, `POST /api/recall` and `GET /api/recall/stream`. `GET /api/memory` is a plain list and stays global-only.

`whole-store` covers `POST /api/consolidate`, `/api/decay`, `/api/embeddings/backfill`, `/api/embeddings/re-embed`, `/api/index/rebuild`, `/api/index/save`, `/api/map/rebuild` and `/api/sync/trigger`, plus `GET`/`HEAD` under `/api/review/`. Maintenance operations use process-wide guards. For example, a second index rebuild returns `409` while the first is running.

Setting a tier's limit to `0` disables that tier. A non-numeric value falls back to the default.

Exceeding a tier returns `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. Those headers appear only on the `429`.

### Response headers

Every response — route handlers, the static bundle and the SPA fallback alike — carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`. A header already set by a route or a proxy is never overwritten.

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_CSP` | *(the built-in policy)* | Replaces the whole `Content-Security-Policy` value. `off` sends no CSP header at all; blank or unset uses the default |
| `ENGRAM_HSTS_MAX_AGE` | *(none)* | Seconds for `Strict-Transport-Security: max-age=<n>; includeSubDomains`. Off by default — the server speaks HTTP, and a wrong value is sticky in the browser for its whole max-age |

The server currently sends this default policy:

```
default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';
script-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net;
img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:;
connect-src 'self' https://cdn.jsdelivr.net ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:*
```

Atlas serves its Archivo fonts locally. The default policy still permits blob scripts and the listed font/CDN origins from the previous dashboard; those allowances are not required by Atlas's map labels. Override the full policy with `ENGRAM_CSP` to customize it.

### Known limitation — realtime and namespaces

Every Socket.io broadcast reaches every connected socket. In `filter` mode a memory stored into another namespace is still broadcast to all of them, and `recall:chunk` streams one caller's results to every listener. Under the single-shared-key model this is not a privilege boundary being crossed — every socket is the same principal as every HTTP caller — but **multi-tenant deployments must not treat the `/neural` namespace as a tenant boundary.**

---

## Cloud Sync

Full setup, conflict resolution and encryption details are in [CLOUD-SYNC.md](CLOUD-SYNC.md). The variables:

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_SYNC_URL` | *(unset — sync off)* | PostgreSQL connection string using `postgres://` or `postgresql://`. Direct connections add `sslmode=require` when absent unless the development override is set |
| `ENGRAM_SYNC_MODE` | `auto` | `auto` (interval + debounce on write), `manual` (explicit only), `off` (scheduler stopped, explicit sync available) |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval in milliseconds, `auto` mode only |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(unset — plaintext)* | Passphrase for end-to-end encryption of synced rows. Passed byte-for-byte and **never trimmed**: trimming would derive a different key and orphan every row already encrypted |
| `ENGRAM_SYNC_ALLOW_UNENCRYPTED` | `false` | Set to exactly `true` to permit a non-TLS Postgres connection. Local development only. The CLI sets this for you when the configured URL explicitly sets `sslmode=disable` |

Both servers reject unknown sync modes and intervals outside 1–2147483647 whole milliseconds. The REST server rejects an empty or whitespace-only `ENGRAM_SYNC_ENCRYPTION_KEY`. Stdio MCP treats an empty string as unset and rejects whitespace-only keys. Direct connections supply the TLS default. `engram cloud connect` requires an explicit `sslmode=require` by default, and duplicate `sslmode` parameters are rejected.

A wrong passphrase is caught at sync time, not startup, and surfaces as `WRONG_PASSPHRASE`.

---

## Database

### SQLite

SQLite is the primary database in every deployment. The default file is created automatically on first run.

```bash
ENGRAM_DB_PATH=~/.engram/engram.db
```

**Pragmas applied automatically:**

```sql
PRAGMA journal_mode = WAL;      -- concurrent reads during writes
PRAGMA synchronous = NORMAL;    -- safe + fast
PRAGMA cache_size = 10000;      -- 10k page cache (~40MB)
PRAGMA busy_timeout = 5000;    -- wait up to 5 seconds for a lock
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

The embedder runs locally via ONNX Runtime — no GPU, no external API calls. The model downloads automatically on the first embed call (~118 MB quantized).

| Setting | Value | Notes |
|---|---|---|
| Model | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384-dim, multilingual |
| Runtime | ONNX Runtime via `@xenova/transformers` | Runs in Node.js, no GPU required |
| Cache dir | `.cache` inside the `@xenova/transformers` package | Reused after the first download |
| Quantization | Quantized ONNX weights, FP16 stored | 2x storage compression |

### `ENGRAM_EMBEDDING_MODEL`

Set this variable for directly launched MCP, REST and one-shot CLI sync. For `engram start`, set the CLI’s `embeddingModel`. Without an explicit model the brain prefers the most common labelled model among live embeddings, or `Xenova/all-MiniLM-L6-v2` for a store with only unlabelled vectors. Unlabelled and other-model vectors stay out of vector search until repaired.

### Supported models

| Model | Dimensions | Approximate size | Notes |
|---|---|---|---|
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 384 | ~118 MB quantized | **Default** — multilingual |
| `Xenova/all-MiniLM-L6-v2` | 384 | — | Legacy database fallback |
| `Xenova/all-MiniLM-L12-v2` | 384 | — | Known 384-dimensional model |
| `Xenova/bge-small-en-v1.5` | 384 | 33 MB | BGE small, comparable quality |
| `Xenova/bge-base-en-v1.5` | 768 | 110 MB | BGE base, higher quality |
| `Xenova/gte-small` | 384 | 33 MB | GTE small |
| `Xenova/gte-base` | 768 | 110 MB | GTE base, higher quality |

For an unlisted model, the brain measures the width of a probe embedding before initializing the index.

After switching models, re-embed live memories whose existing vectors have a missing or stale model label or an incompatible dimension:

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
node --input-type=module -e "
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
| `decayConflictWindowMs` | `3600000` (1 hour) | Core policy window for backdating decay edits during sync conflict resolution. |

Override the interval and threshold at the server level via `ENGRAM_DECAY_INTERVAL` and `ENGRAM_DECAY_THRESHOLD` environment variables. Fine-grained control is available at runtime through the MCP admin tool `decay_policy` (`ENGRAM_ADMIN_TOOLS=1`) or the REST API `PUT /api/decay/policy`. Policy updates persist in the local database and take precedence over startup defaults. Protection-rule predicates stay process-local. `POST /api/decay` with `{"dryRun":true}` previews counts without writing, consolidating or sending notifications.

### Protection rules

Certain memories are shielded from decay and archival:

| Rule | Condition |
|---|---|
| `high-importance-semantic` | Semantic memories with importance >= 0.8 |
| `high-confidence-procedural` | Procedural memories with confidence >= 0.9 |
| `recently-accessed` | Any memory accessed within the last 24 hours |
| `pinned-or-protected` | Memories tagged `pinned` or `protected` |
| `ai-client-source` | Source is `claude-code`, `ollama` or `rest-api` |

Protection rules are evaluated during each sweep. Protected memories skip the decay calculation entirely. Memories tagged `pending-distill` are also protected, even with custom protection rules.

### Auto-consolidation

After each live decay sweep, the engine can automatically consolidate clusters of old episodic memories into semantic summaries.

| Parameter | Default | Description |
|---|---|---|
| `consolidation.enabled` | `true` | Whether auto-consolidation runs after each sweep |
| `consolidation.minClusterSize` | `3` | Minimum episodic memories required to form a cluster |
| `consolidation.similarityThreshold` | `0.6` | Similarity threshold for clustering |
| `consolidation.minEpisodicAgeMs` | `86400000` (24 hours) | Only consolidate episodes older than this |

---

## Contradiction Detection

When a new memory is stored, the heuristic detector nominates **unverified candidates**, not established contradictions. The MCP client's own model calls `get_contradiction_tasks`, judges each pair, and submits `complete_contradiction_check` with `contradiction` or `none`. Only confirmed pairs appear in contradiction lists/counts, dashboard graphs/maps, or recall graph traversal.

Candidates use existing `memory_connections` rows with relationship `contradicts` and metadata status `candidate`; strength holds confidence, and metadata retains signals and suggestedStrategy. Only explicit status `confirmed` is visible as a contradiction. Legacy edges with absent/null status are candidates too, requiring no migration. Dismissal sets status `dismissed` plus a deletion tombstone; later detector nominations of the same pair in either direction cannot resurrect it. SQLite is the query backend; PostgreSQL sync stores the same metadata and tombstone fields unchanged.

### Configuration defaults

| Parameter | Default | Description |
|---|---|---|
| `enabled` | `true` | Enable contradiction checking on every store |
| `similarityThreshold` | `0.65` | Minimum embedding similarity to consider two memories same-topic |
| `confidenceThreshold` | `0.4` | Minimum contradiction confidence to flag |
| `maxCandidates` | `10` | Maximum candidate memories to evaluate per store |
| `defaultStrategy` | `keep_both` | Fallback suggestion for candidates. Destructive strategies require confidence above 0.7. |
| `autoResolve` | `false` | Legacy core option; never acts on unverified candidates |

### Resolution strategies

| Strategy | Behavior |
|---|---|
| `keep_newest` | Archive the old memory, keep the new one |
| `keep_oldest` | Keep the old memory, archive the new one |
| `keep_important` | Keep whichever memory has higher importance |
| `keep_both` | Keep both memories and tombstone the resolved edge |
| `manual` | Leave the pair unresolved for human review |

`keep_newest` archives the older memory: use it only when the newer memory fully replaces it.

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
| `decayed` | A live sweep archives or consolidates at least one memory |
| `consolidated` | Episodic memories are consolidated into semantic |
| `contradiction` | A candidate is confirmed by the connected model |
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
| `ENGRAM_WEBHOOK_MAX_CONCURRENCY` | `32` | Maximum concurrent background event dispatches. A positive integer is required. At capacity, additional events are dropped |

### Retry policy

- **Max attempts:** 3 per delivery
- **Backoff:** 500 ms before the second attempt and 1 s before the third for retryable failures
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
    onReflect:  async (ctx) => { /* ... */ },
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
| `onReflect` | `{ insights, types }` | After a reflection insight is stored |

### Registration

```typescript
import { NeuralBrain } from '@engram-ai-memory/core';

const brain = new NeuralBrain({ dbPath: '~/.engram/engram.db' });
brain.registerPlugin(myPlugin);
await brain.initialize();
```

Plugins run in registration order. Errors in one plugin are caught and logged — they never break other plugins or the brain itself.

---

## Index Persistence

The vector index can be persisted to disk. Startup checks cached entries against live SQLite rows and reuses compatible vectors.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` when the brain receives a DB path, otherwise none | Path to the persisted index binary file |

### Behavior

- **Startup:** Load a valid cache, scan the live rows in scope, refresh missing or edited vectors and remove obsolete entries.
- **Shutdown:** A configured index file is saved when the initialized brain shuts down.
- **Incremental sync:** The index uses stored embeddings compatible with the active model and dimension. Rows without a stored vector are skipped.
- **Cross-process sync:** Search, recall, stats and index status reconcile the index before reading it. SQLite’s `PRAGMA data_version` detects other connections’ commits and `total_changes()` detects writes on this connection, including cloud pulls. If both counters are unchanged, Engram skips the row scan.
- **Invalidation:** A cached index is refused — and rebuilt from the database instead — when its format version, dimension, embedding model or checksum does not match, or when its entry count disagrees with the payload length. Nothing needs to be deleted by hand after switching embedding models, and a truncated or corrupted file cannot be loaded as if it were intact.

> Give every process its own `ENGRAM_INDEX_PATH` when more than one runs against the same database. Sharing the default `<db>.index` means they overwrite each other's index, and during a rolling deploy processes on different format versions will each reject and rewrite what the other wrote. Nothing is lost — the database stays authoritative — but a large index gets rebuilt repeatedly for as long as the mix lasts.

> **Graph changes.** Pulled connection changes carry a local revision. Reconciliation picks up added, confirmed or deleted edges even when the sync changed no memory rows.

### Binary format

Little-endian magic number `0x454e4752` (bytes `52 47 4e 45`), then a header of `version`, `dimension`, `entry count`, the `embedding model` id, and a CRC-32 over the entry payload, followed by packed entry data (ID + type + namespace + FP32 vectors).

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

For batch imports, use the batch endpoint:

```bash
POST /api/memory/batch
{ "memories": [...] }  # up to 1000 at a time
```

The batch endpoint embeds inputs in batches, then stores them in order so each record can deduplicate or link against earlier records. Each new memory and its auto-links commit together. A later failure can leave earlier records committed. The previously quoted throughput of 10,000+ records/sec on WAL-mode SQLite is unverified for this path.

### Recall latency

Target: p99 < 100 ms. If you are exceeding this:

| Check | Command |
|---|---|
| Index size | `GET /api/stats` -> `indexSize` |
| DB size | `ls -lh ~/.engram/engram.db` |
| Recall latency | `POST /api/recall` → `latencyMs` |

**Tuning options:**

```bash
# On the SQLite connection being tuned (about 80 MB with 4 KB pages)
PRAGMA cache_size = 20000;

# Limit the amount of context returned by recall
POST /api/recall { "query": "...", "maxTokens": 1000 }
# maxTokens sets the output budget after candidate retrieval and ranking.
```

### Vector index

The in-memory vector index rebuilds from the database on server start unless a persisted index file exists (see [Index Persistence](#index-persistence)). For very large databases (>100k memories), always use index persistence to avoid slow startup.

### Dashboard performance

Atlas draws its memory map with Canvas and D3. `GET /api/map` computes and caches the layout on the server per project scope; small additions are placed near their neighbours without moving existing points. `POST /api/map/rebuild` forces a full layout. See [Atlas Map](API.md#atlas-map) for cache and rebuild behavior.

The Map switcher at `#/?view=sky|landscape|river|pulse` also offers **Sky** (a WebGL memory sky), **Landscape** (retention terrain with a Now / +7 / +30 / +90-day decay preview), **River** (braided history by region) and **Pulse** (a read-only recall explanation of ranks, graph pulls, token budget and exclusions). All four views load on demand, with three.js loaded only for Sky and Landscape.

Insights and its charts load on demand. After a web build, `pnpm --filter @engram-ai-memory/web check:bundle` enforces gzip JavaScript budgets of 200 KB initially, 125 KB for lazy Insights (including charts) and 220 KB for lazy 3D views (Sky and Landscape).

---

## Ports

| Port | Service | Description |
|---|---|---|
| `4901` | API Server | Engram REST API + Swagger docs at `/docs` + Atlas dashboard |
| `4902` | Dashboard | Standalone dashboard container (`docker compose`). A source build can serve `apps/web/dist` on `4901`. The API image does not include the dashboard bundle |
| `11435` | Ollama Proxy | Transparent memory-injecting proxy for Ollama |

WebSocket is served on the same port as the API server (`4901`) under the `/neural` namespace.

---

## Process Management (PM2)

For production deployments, use PM2:

```bash
npm install -g pm2

# Start API server
ENGRAM_DB_PATH=/data/engram.db pm2 start apps/server/dist/index.js \
  --name engram-api

# The API server also serves the built Atlas dashboard from apps/web/dist.

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
