# Changelog

All notable changes to Engram are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

## [0.6.5] — 2026-09-03

Published as `@engram-ai-memory/core` 0.6.2, `@engram-ai-memory/mcp` 0.6.3 and `@engram-ai-memory/cli` 0.6.5.

### Fixed

- **`@engram-ai-memory/core`** — `better-sqlite3` moves from `^11.9.1` to `^12.11.1`, because 11.x publishes prebuilt binaries only for Node ABIs 108 through 131, which stops at Node 23. On Node 24 `prebuild-install` found no binary and fell through to a `node-gyp` source build, so installing Engram required a full C++ toolchain — Visual Studio Build Tools on Windows, which a reported install did not have and could not finish. 12.11.1 ships prebuilds for Node 22 and 24 on every supported platform, `win32-arm64` included, so nothing is compiled locally. The bundled SQLite moves 3.49.2 to 3.53.2; none of its announced behaviour changes touch the API this package uses.

- **`@engram-ai-memory/cli`** — A failed `pnpm install` during `engram setup` or `engram update` said only `Install failed. Check the output above for details.` The install inherits the terminal, so its output cannot be parsed here — but two causes account for nearly every report, and both end in the same unexplained `ELIFECYCLE` line. Both are now named with their fix: a Node version with no prebuilt native binary, quoting the version actually running, and a Windows file lock from a running Engram process, which `engram stop` clears.

## [0.6.4] — 2026-09-02

### Fixed

- **`@engram-ai-memory/cli`** — `engram setup` and `engram update` refreshed the global CLI with a bare `npm install -g .`, which resolves whatever `npm config get prefix` reports. That is not necessarily the prefix the running binary lives under: a CLI installed under `~/.npm-global` on a machine whose npm config still points at `/usr` produced an `EACCES` on `/usr/lib/node_modules`, and the printed advice resolved the same wrong prefix and failed identically. The prefix is now derived from the resolved path of the running module, covering both the POSIX `<prefix>/lib/node_modules` and Windows `<prefix>/node_modules` layouts, and falls back to the previous prefix-less command when the CLI is not running from a global install. The executed command and the advice printed on failure are built from that one value, so they can no longer disagree.

- **`@engram-ai-memory/cli`** — Both global-install call sites captured npm's output with `stdio: 'pipe'` and then discarded it in a bare `catch`, so a permissions failure and a network failure were indistinguishable single warning lines. npm's own last lines are now shown, bounded so they cannot bury the fix line beneath them.

- **`@engram-ai-memory/cli`** — Reading the new revision for the closing banner could turn a completed update into a bare stack trace. The update has already happened by that point, so a git failure there now degrades to a warning.

### Changed

- **`@engram-ai-memory/cli`** — `engram update` no longer reports success it did not have. A failed global-CLI refresh or a server that does not come back replaces the green banner with a summary naming what did not happen, and exits `1`. An unattended run could previously not tell a clean update from one that left the server down.

- **`@engram-ai-memory/cli`** — When the server was not running before an update, `engram update` said nothing at all and ended on a green banner that read as "restarted fine". It now states that there was nothing to restart and how to start it. This is not treated as a failure: a stopped server is a choice.

- **`@engram-ai-memory/cli`** — The `--non-interactive` option on `engram setup` is documented as accepted for script compatibility. Setup has no prompt to suppress, and removing the option would break scripts that pass it, since unknown options are rejected.

## [0.6.3] — 2026-09-02

### Fixed

- **`@engram-ai-memory/cli`** — `engram update` and `engram setup` could hang on a credential prompt nobody could see. Git writes that prompt straight to the tty even when stdout is piped, so a stale entry in a credential helper turned a `git fetch` — or the initial clone — into an invisible password question instead of an error. Every git call now runs with terminal prompts disabled, with `GIT_ASKPASS` and `SSH_ASKPASS` removed from the environment rather than blanked (git execs whatever the variable holds, so an empty program name is worse than none), and with stdin closed.

- **`@engram-ai-memory/cli`** — Any failed fetch was reported as `Could not reach the remote repository. Check your connection.`, including the HTTP 401 git had already named. Failures are now classified as auth, not-found, network or unknown, each with its own guidance. Auth is matched before the network wording on purpose: a rejected credential surfaces as `RPC failed; HTTP 401 curl 22 ...`, which would otherwise send users off debugging their connection.

## [0.6.2] — 2026-08-28

Published as `@engram-ai-memory/core` 0.6.1 and `@engram-ai-memory/cli` / `@engram-ai-memory/mcp` 0.6.2.

### Fixed

- **`@engram-ai-memory/core`** — Pull pagination skipped rows. The cursor was a strict `>` on `server_updated_at` alone, so whenever many rows shared one timestamp — a bulk migration, a mass `device_id` update — the rows past a page boundary at that timestamp were stepped over and never pulled. Pulls now use a composite `(server_updated_at, id)` cursor — `ts > cursor OR (ts = cursor AND id > lastId)` — with `id` as the secondary sort for deterministic ordering, `drainPullBatches()` carries both halves of the cursor between batches, and a guard breaks the loop if the composite cursor fails to advance.

- **`@engram-ai-memory/core`** — Rows written before per-row device attribution existed carry a `NULL` `device_id`, and the pull filter (`device_id IS NULL OR device_id <> ours`) can never recognise one as the local device's own, so every such row was re-pulled and re-applied on every sync cycle — a sync loop pinned at 100% CPU. `PgSyncClient.backfillNullDeviceIds()` now stamps the connecting device's id onto the orphan rows in `memories`, `memory_connections` and `sessions`. It runs once per connection lifetime from `ensureConnected()`, right after migrations and before the first push or pull, never from the per-cycle sync path, and is idempotent — a no-op once no `NULL` rows remain.

## [0.6.1] — 2026-08-28

### Fixed

- **`@engram-ai-memory/cli`**, **`@engram-ai-memory/mcp`** — The `0.6.0` publish of both packages went out with the workspace-internal `workspace:*` range on `@engram-ai-memory/core` rather than a resolved version, so neither installed from npm. Republished as `0.6.1` with no code changes; `@engram-ai-memory/core` stays at `0.6.0`.

## [0.6.0] — 2026-08-28

### Added

- **Multi-device cloud sync** — Engram now replicates memories, sessions, and connections across devices through a shared PostgreSQL instance. SQLite remains the local-first primary backend; Postgres is purely a sync target. Enable with `ENGRAM_SYNC_URL`. See [docs/CLOUD-SYNC.md](docs/CLOUD-SYNC.md).

- **`@engram-ai-memory/core`** — `SyncEngine` orchestrates push/pull replication with configurable modes (`auto`, `manual`, `off`), exponential backoff on errors, embedding model compatibility checks, and a concurrency guard. `PgSyncClient` handles batched upserts (500 rows) with Last-Write-Wins conflict resolution and MAX-merge for counters. Cursor-based pull with a 5-minute overlap window catches late-committed transactions.

- **`@engram-ai-memory/core`** — PostgreSQL schema (`packages/core/src/db/pg/`) with Drizzle ORM: `memories`, `sessions`, `memory_connections` tables plus a `sync_metadata` table for device registration and embedding model tracking. `server_updated_at` column with a `BEFORE UPDATE` trigger provides a reliable pull cursor independent of device clocks.

- **`@engram-ai-memory/cli`** — `engram cloud` command group: `connect`, `disconnect`, `status`, `sync`, `devices`. Config file permissions set to `0600` to protect connection strings.

- **`@engram-ai-memory/mcp`** — SyncEngine integration: writes from `store_memory`, `add_knowledge`, `forget`, `tag_memory`, `decay_sweep`, `resolve_contradiction`, `store_reflection`, and `re_embed` all notify the sync engine for debounced replication.

- **`@engram-ai-memory/server`** — SyncEngine lifecycle in the REST server. New routes: `GET /api/sync/status`, `POST /api/sync/trigger`. All 15 mutation routes across memory, tags, analytics, graph, contradictions, health, and embeddings notify the sync engine.

- **`@engram-ai-memory/server`** — Socket.io `/neural` namespace now requires API key authentication (timing-safe comparison) when `ENGRAM_API_KEY` is set. Backward compatible — unauthenticated connections still work when no key is configured.

- **Smithery / MCPB** — `syncUrl` and `syncMode` added to configuration schemas for both distribution channels.

- **End-to-end encryption for cloud sync** — memory rows can now be encrypted client-side before they reach Postgres, using AES-256-GCM with scrypt key derivation (`N=2^15, r=8, p=1`). Enable with `ENGRAM_SYNC_ENCRYPTION_KEY`. See [docs/CLOUD-SYNC.md](docs/CLOUD-SYNC.md#8-end-to-end-encryption).

- **`@engram-ai-memory/cli`** — `engram cloud encrypt <passphrase>` initializes encryption on a sync target: generates a salt, derives the key, and stores a verification sentinel in Postgres.

- **`@engram-ai-memory/core`** — `EncryptionManager` class derives and holds the AES-256 key for a sync connection and exposes `encryptRow`/`decryptRow`/`tryDecryptRow` for encrypting and decrypting memory rows (content, summary, metadata, tags, embedding) on the push and pull paths.

- **`@engram-ai-memory/core`** — `sync_metadata` PostgreSQL table stores the encryption salt and sentinel, shared across every device syncing against the same database.

- **`ENGRAM_SYNC_ENCRYPTION_KEY` environment variable** — when set, `SyncEngine` derives the encryption key on connect and encrypts every push / decrypts every pull automatically. Unset keeps push/pull byte-for-byte unchanged from before encryption existed.

- **Sentinel verification** — a fixed plaintext encrypted under the derived key is stored alongside the salt, so a device with the wrong passphrase fails fast with a clear `WRONG_PASSPHRASE` error instead of silently pushing or pulling undecryptable data.

### Changed

- **`@engram-ai-memory/server`** — Socket.io setup extracted into `setupRealtime()` for testability — tests can attach Socket.io to a Fastify-controlled server without side effects from `start()`.

- **`docs/CONFIGURATION.md`** — PostgreSQL section rewritten: no longer describes Postgres as a primary storage backend (it was never functional as one). Now points to Cloud Sync documentation.

### Security

- **Password redaction** — `redactSyncUrl()` masks credentials in all connection string surfaces: error messages, sync status responses, and log output. Tested with 10 unit/integration tests.

- **TLS enforcement** — `validateSyncUrl()` rejects non-TLS PostgreSQL connections unless `ENGRAM_SYNC_ALLOW_UNENCRYPTED=true` is explicitly set.

- **Socket.io auth** — `/neural` WebSocket namespace validates `auth.token` against `ENGRAM_API_KEY` using constant-time comparison. Tested with 4 integration tests.

- **End-to-end encryption at rest** — when `ENGRAM_SYNC_ENCRYPTION_KEY` is set, all synced data (content, summary, metadata, tags, embeddings) is encrypted client-side before it leaves the device, so it's encrypted at rest in PostgreSQL, not just in transit.

- **Zero-knowledge design** — the encryption key is derived from the passphrase locally and never sent to or stored in Postgres; the server/database operator can only ever see ciphertext, never memory content.

- **Per-field random nonces** — every field and embedding gets its own random 12-byte nonce on each encryption, preventing ciphertext correlation across rows or across repeated encryptions of the same plaintext.

## [0.4.1] — 2026-08-13

### Fixed

- **`@engram-ai-memory/mcp`**, **`@engram-ai-memory/server`** — An empty `ENGRAM_NAMESPACE_MODE` aborted startup with `ENGRAM_NAMESPACE_MODE must be one of: none, filter, isolated`. Both read the variable with `??`, which only falls back on an absent variable, but a host that templates an untouched optional config field — the Claude Desktop extension among them — passes an empty string instead of omitting it. An empty value is now treated as unset, the same as before namespace modes existed.

- **`@engram-ai-memory/cli`** — A hand-edited `~/.engram/config.json` carrying an empty or unrecognised `namespaceMode` was exported verbatim into the MCP server's environment, moving the crash above into a child process. Unrecognised values now fall back to the legacy derivation (`filter` when a namespace is set, otherwise `none`).

- **`@engram-ai-memory/server`** — `POST /api/graph/connections` rejected a self-connection with 404. The namespace pre-check matched the returned row count against a literal 2, and naming the same memory as source and target returns one row. The endpoint ids are now deduplicated before the comparison.

- **`@engram-ai-memory/server`** — `GET /api/sessions` returned nothing for sessions recorded before v0.4.0 once `filter` mode was enabled: those rows predate the `namespace` column and carry `NULL`. `filter` mode is soft scoping, so it now shows them alongside the namespaced ones; `isolated` mode still excludes them.

### Changed

- **`@engram-ai-memory/vis`** — Added a `files` allowlist so the published tarball carries `dist` only, matching the other packages.

- **`@engram-ai-memory/server`** — The package version had been left at `0.3.2`, and `GET /api/health` and the Swagger document read it straight from `package.json`, so both reported a release two versions behind the running code.

- **Release pipeline** — `Release` now checks for the `NPM_TOKEN` secret before building and fails in seconds with an actionable message when it is missing, which is how v0.4.0 failed: npm reported it as `ENEEDAUTH` only at the end, from inside the publish loop. It also builds and validates the `.mcpb` Desktop Extension bundle and creates the GitHub release with the bundle attached and the notes taken from this file, and accepts a manual run that exercises everything except publishing.

- **Release pipeline** — `CI` did not run on any namespaced branch. Its push filter was `'*'`, which stops at a slash and therefore never matched `fix/…` or `agent/…`, and its pull-request filter named a `main` branch this repository does not have — it is `master`. Together those meant a branch could be developed, opened as a pull request and merged without a single check; PR #4 was. Both filters are corrected, and CI now validates the Desktop Extension manifest, whose schema rejects keys that look reasonable.

## [0.4.0] — 2026-08-12

### Added

- Namespace behavior is now explicit through `namespaceMode`: `none` (the default), `filter`, or `isolated`. `none` ignores namespace inputs; `filter` preserves optional scoping and overrides; `isolated` requires one fixed namespace and rejects overrides and cross-namespace queries.

- **`@engram-ai-memory/core`** — `VectorSearch.saveToDiskAsync()` and `NeuralBrain.saveIndexAsync()` persist the vector index without blocking the event loop. `reEmbed()`, `rebuildIndex()` and `POST /api/index/save` now use them — previously each ran a synchronous, full-index `writeFileSync` inside a live request handler. The synchronous `saveToDisk()`/`saveIndex()` remain for callers that cannot await, such as `shutdown()`.

  Every save — synchronous or not — now writes to a temp sibling and renames it over the target, so an interrupted save leaves the previous index readable instead of a truncated one. Entries are serialized before the first await, so each caller persists a snapshot from the moment of its own call.

  Because the synchronous write used to serialize concurrent callers just by blocking the event loop, async saves needed that ordering back explicitly: they are queued per instance, and a write whose snapshot has been superseded by a newer save steps aside instead of renaming over it. Without both, two overlapping saves — a re-embed racing an explicit index save, or a re-embed still in flight when `shutdown()` runs during a restart — could silently discard the fresher snapshot while every caller still saw success.

  Note that the index is not fsynced: the rename is atomic against a process crash, but a power loss can still revert to the previous snapshot. That is acceptable because the index is a cache rebuildable from SQLite, and a missing or corrupt one already falls back to a full rebuild.

### Changed

- **BREAKING** — Namespaces are now opt-in, and the default `none` mode ignores namespace inputs entirely. Before this release, a per-call `namespace` was honoured even when the brain had none configured: `store({ content, namespace: 'x' })`, `POST /api/memory` with a `namespace` field, and the MCP `store_memory` tool's `namespace` argument all wrote that value to the row. Under the default they are silently dropped and the memory lands in the shared pool. Callers that relied on per-call namespaces must set `namespaceMode: 'filter'` (`ENGRAM_NAMESPACE_MODE=filter`) to keep the old behavior. A configuration that already sets `namespace`/`ENGRAM_NAMESPACE` without a mode is upgraded to `filter` automatically and is unaffected. Stored rows are never rewritten — only how new writes are stamped changes.

- **`@engram-ai-memory/core`** — The persisted index header now carries the embedding model id and a CRC-32 over the entry payload, and `deserialize()` refuses an index whose model or checksum does not match, or whose entry count disagrees with the payload length — `count` sits outside the CRC, so a lowered count would otherwise parse a prefix of the entries with a valid checksum (format version 2). A refused load leaves the in-memory index untouched. Previously only the dimension was checked, so an index built by a different model — two models can share a dimension — loaded silently and every query scored against vectors it could not be compared to; a truncated file could likewise load as if intact. `IndexMetadata` gained an `embeddingModel` field, `VectorSearch` takes an optional model id as its second constructor argument and exposes `setModelId()`, and `NeuralBrain` passes the active model through. Version 1 files are rejected rather than migrated: the index is a cache, so the first startup after upgrading rebuilds it from the database. No action is needed on upgrade, and switching embedding models no longer requires deleting the index by hand.

### Removed

- OpenClaw support has been removed: both the TypeScript adapter and standalone plugin are no longer part of the workspace or documentation.

### Fixed

- **`@engram-ai-memory/core`** — `reEmbed()` updated SQLite and the in-memory index but never wrote the vector index to disk, leaving that to `shutdown()`. Since `deserialize()` validates only the dimension, a restart — or another process persisting its own index over the same file — silently resurrected the pre-re-embed vectors. Refreshed vectors are now saved as soon as the run finishes (best-effort: an unconfigured path or an unwritable disk no longer fails the re-embed). Note that processes sharing one `ENGRAM_DB_PATH` still default to a single `<db>.index` file; give each its own `ENGRAM_INDEX_PATH` when running more than one.

---

## [0.3.2] — 2026-07-25

### Added

- **`@engram-ai-memory/cli`** — `engram setup` now wires up Claude Code automatic memory end to end. It registers the MCP server at **user scope** (`~/.claude.json`) so it loads in every session without the manual approval a project-scope `~/.mcp.json` entry needs, and installs two hooks: a `UserPromptSubmit` recall hook that injects relevant long-term memories on each prompt (relevance-gated, fail-open) and a `SessionEnd` hook that stores a session summary. Detected automatically when `~/.claude` is present; opt out with `--no-claude-hooks`. Hooks are shipped as templates (`packages/cli/templates/`) and installed to `~/.engram/hooks/`. `engram doctor` reports their status.

---

## [0.3.1] — 2026-07-25

The published `0.3.0` was frozen on 2026-07-17, before a full codebase audit. This
release ships the accumulated reliability, correctness and security fixes to npm.
No API changes — a drop-in upgrade.

### Fixed — data integrity (silent-but-serious)

- **`@engram-ai-memory/core`** — `search()` discarded the similarity it ranked by, so every consumer saw `0%` scores. Similarity is now returned on each hit.
- **`@engram-ai-memory/core`** — FP16 embedding codec dropped the implicit mantissa bit, corrupting the small components of every persisted vector. Subnormals are now packed correctly.
- **`@engram-ai-memory/core`** — Importance decay recompounded on every sweep (memories hit the floor in ~2 days instead of ~45). Decay now checkpoints against `updatedAt`.
- **`@engram-ai-memory/core`** — `void db.update(...)` never executed (Drizzle builders are lazy PromiseLikes), so access counts stayed 0 and decay archived active memories. All such writes are now awaited with atomic SQL increments.
- **`@engram-ai-memory/server`** — `POST /api/memory/batch` silently dropped `importance`, `source`, `tags`, `concept` and `namespace`. All per-item fields are now honoured.

### Fixed — atomicity

- **`@engram-ai-memory/core`** — `store()`, `forget()`/`consolidate()` and `resolveContradiction()` are now single transactions; a failure part-way through no longer leaves partial state.

### Added — security

- **`@engram-ai-memory/server`** — Webhook SSRF guard: delivery to loopback/private addresses is rejected unless `ENGRAM_WEBHOOK_ALLOW_PRIVATE=true`.
- **`@engram-ai-memory/server`** — CORS is now an allowlist (`ENGRAM_ALLOWED_ORIGINS`) instead of reflecting any origin.
- **`@engram-ai-memory/server`** — Optional bearer/`X-API-Key` auth via `ENGRAM_API_KEY` (timing-safe compare); unset keeps the local-first open default.

### Fixed — other

- **`@engram-ai-memory/mcp`** — `GET /api/graph/:id` now honours its `depth` parameter and returns edges in both directions.
- **`@engram-ai-memory/server`** — `ENGRAM_DATABASE=postgresql` now fails fast with an explanatory error instead of appearing to connect and breaking on the first write (the PostgreSQL backend is not implemented).
- **`@engram-ai-memory/cli`** — `engram start` verifies the port actually bound before printing success; `engram status` verifies the pidfile PID is alive and owns the port.
- **`@engram-ai-memory/adapter-ollama`** — OpenAI-compatible `/v1/chat/completions` interception and one-shot tool-call retry (`ENGRAM_TOOL_RETRY`, default `true`).
- **`@engram-ai-memory/cli`** — `dev` script changed to `tsc --watch` so `turbo run dev` no longer aborts the workspace.
- **`@engram-ai-memory/server`** — Dashboard static path resolves against `process.cwd()`, fixing serving from a non-root working directory.

---

## [0.1.0] — 2026-03-21

### Added

- **`@engram-ai-memory/core`** — NeuralBrain class with full Episodic / Semantic / Procedural memory model
- **`@engram-ai-memory/core`** — Local ONNX embeddings via `@xenova/transformers` (`all-MiniLM-L6-v2`, 384-dim, no API required)
- **`@engram-ai-memory/core`** — HNSW-lite in-memory vector index with cosine similarity search
- **`@engram-ai-memory/core`** — Knowledge graph with BFS traversal (depth-configurable)
- **`@engram-ai-memory/core`** — Context assembler: embed → vector search → graph expand → score → truncate → inject
- **`@engram-ai-memory/core`** — Importance scoring: semantic similarity + recency + importance weight + access frequency
- **`@engram-ai-memory/core`** — Ebbinghaus forgetting curve importance decay
- **`@engram-ai-memory/core`** — FP16 embedding compression (Float32[384] → Int16[384], 2× storage reduction)
- **`@engram-ai-memory/core`** — Drizzle ORM schema: `memories`, `memory_connections`, `sessions`, `context_assemblies`
- **`@engram-ai-memory/core`** — SQLite WAL mode (>10,000 memory writes/sec)
- **`@engram-ai-memory/mcp`** — MCP Server for Claude Code: `store_memory`, `recall_context`, `search_memory`, `add_knowledge`, `memory_stats`, `forget`
- **`@engram-ai-memory/server`** — Fastify 5 REST API on port 4901 with Swagger UI at `/docs`
- **`@engram-ai-memory/server`** — Socket.io WebSocket on `/neural` namespace: `memory:stored`, `memory:activated`, `graph:updated`
- **`@engram-ai-memory/server`** — Batch memory endpoint: `POST /api/memory/batch` (up to 200 per request)
- **`@engram-ai-memory/web`** — React 3D visualization dashboard with React Three Fiber
- **`@engram-ai-memory/web`** — 5 visualization modes: Cosmos, Nebula, Neural Net, Galaxy, Clusters
- **`@engram-ai-memory/web`** — Bloom + Vignette postprocessing via `@react-three/postprocessing`
- **`@engram-ai-memory/web`** — Real-time memory updates via Socket.io
- **`@engram-ai-memory/adapter-ollama`** — Transparent HTTP proxy: intercepts Ollama requests, injects memory context, stores exchanges
- **`@engram-ai-memory/adapter-openclaw`** — `EngramClient` class + `withMemory()` wrapper for OpenClaw integration
- **`@engram-ai-memory/vis`** — Force-directed layout, animation engine, color mapper for visualization
- Demo seed script: 67 memories + 34 knowledge graph connections across AI/ML, architecture, and project history topics
- Full documentation: ARCHITECTURE, API, INTEGRATIONS, DEVELOPMENT, CONFIGURATION
- CI workflow (GitHub Actions): build → typecheck → test on every push/PR
- Release workflow: publish `@engram-ai-memory/core`, `@engram-ai-memory/mcp`, `@engram-ai-memory/vis` to npm on version tag
- Docker Compose: PostgreSQL 16 + pgvector + API + dashboard

### Performance (measured on M2 / SQLite WAL)

- Memory write: >10,000 records/sec (batch)
- Recall latency: <20ms p50, <100ms p99
- Embedding: ~150ms first call (model load), <5ms subsequent
- Dashboard: >60 FPS at 67 neurons

---

[Unreleased]: https://github.com/ayvazyan10/engram/compare/v0.6.5...HEAD
[0.6.5]: https://github.com/ayvazyan10/engram/releases/tag/v0.6.5
[0.6.4]: https://github.com/ayvazyan10/engram/releases/tag/v0.6.4
[0.6.3]: https://github.com/ayvazyan10/engram/releases/tag/v0.6.3
[0.6.2]: https://github.com/ayvazyan10/engram/releases/tag/v0.6.2
[0.6.1]: https://github.com/ayvazyan10/engram/releases/tag/v0.6.1
[0.6.0]: https://github.com/ayvazyan10/engram/releases/tag/v0.6.0
[0.4.1]: https://github.com/ayvazyan10/engram/releases/tag/v0.4.1
[0.4.0]: https://github.com/ayvazyan10/engram/releases/tag/v0.4.0
[0.1.0]: https://github.com/ayvazyan10/engram/releases/tag/v0.1.0
