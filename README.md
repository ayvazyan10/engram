<div align="center">

<img src="https://github.com/ayvazyan10/engram/blob/master/apps/web/public/logo.svg" alt="Engram Logo" width="80" height="80">

# Engram

**Universal AI Brain — persistent memory and cognition layer for any AI model**

[![CI](https://github.com/ayvazyan10/engram/actions/workflows/ci.yml/badge.svg)](https://github.com/ayvazyan10/engram/actions/workflows/ci.yml)
[![npm @engram-ai-memory/core](https://img.shields.io/npm/v/@engram-ai-memory/core?label=%40engram-ai-memory%2Fcore&color=6366f1)](https://www.npmjs.com/package/@engram-ai-memory/core)
[![npm @engram-ai-memory/mcp](https://img.shields.io/npm/v/@engram-ai-memory/mcp?label=%40engram-ai-memory%2Fmcp&color=6366f1)](https://www.npmjs.com/package/@engram-ai-memory/mcp)
[![Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![pnpm 9+](https://img.shields.io/badge/pnpm-9%2B-orange)](https://pnpm.io)

[**Quick Start**](#quick-start) · [**Features**](#features) · [**CLI**](#cli) · [**Docs**](docs/) · [**Live Demo**](#live-demo) · [**Integrations**](#integrations) · [**Contributing**](CONTRIBUTING.md)

</div>

---

## What is Engram?

Engram gives any AI model **human-like memory** that persists across sessions, systems, and restarts. Connect it once and every AI you use — Claude Code, Ollama, or any custom integration — shares a single, growing brain.

Most AI tools forget everything the moment a session ends. Engram solves this by acting as a universal memory backend: it stores what your AIs learn, retrieves the right memories at the right time, and presents them as context — automatically.

```
┌─ You tell Claude Code about your stack  ──→  stored as semantic memory
└─ Next day, different tool, new session  ──→  Engram recalls it automatically
```

---

## Features

| Feature | Description |
|---|---|
| **3 Memory Types** | Episodic (events), Semantic (facts + knowledge graph), Procedural (trigger→action patterns) |
| **7-Step Recall Pipeline** | Embed → Vector search → Graph expand → Score → Rank → Truncate → Log |
| **Memory Decay & GC** | Ebbinghaus forgetting curve, auto-archive stale memories, episodic→semantic consolidation |
| **Memory Reflection** | AI-driven insight engine — the AI connected over MCP reasons over your memories to surface patterns, knowledge gaps, trends, and contradictions. Engram runs no LLM of its own — no API keys, no external calls. |
| **Atlas dashboard** | Map, Recall, Review, Timeline, Insights and Settings; light/dark and ⌘K command palette |
| **Optional Namespaces** | Disabled by default; enable filtering or strict isolation per project/agent |
| **Contradiction Detection** | Heuristics nominate candidates; the connected AI verifies them before using 5 resolution strategies (keep_newest/oldest/important/both/manual) |
| **Embedding Upgradability** | Swap embedding models, store model ID alongside vectors, batch re-embedding pipeline |
| **Streaming Recall** | SSE endpoint — high-confidence memories first, graph-expanded backfill later |
| **Index Persistence** | Save/load vector index to disk for fast startup (27-37x speedup) |
| **CLI Tool** | `engram store/search/recall/stats/forget/export/import/reflections/cloud` from the terminal |
| **Import/Export** | Full backup & restore as JSON or NDJSON via CLI or API |
| **Webhooks** | Subscribe external systems to memory events (stored, forgotten, decayed, consolidated, contradiction, reflected) |
| **Tagging & Collections** | Tag cloud, filter by tag, prefix-based collections (e.g. `project:alpha`) |
| **Plugin System** | 7 lifecycle hooks (onStore, onRecall, onForget, onDecay, onReflect, onStartup, onShutdown) |
| **Importance Decay** | Source-aware default importance, daily decay for unused memories, protection rules for AI clients |
| **Inline Edit & Bulk Ops** | PATCH individual memories, bulk tag/archive via API and dashboard |
| **Observability** | Debug endpoints, scoring breakdowns, Swagger UI at `/docs` |

---

## How it works

Every time an AI connected to Engram receives a query:

1. **Embeds** the query into a 384-dimensional semantic vector *(locally — no API, no cost)*
2. **Searches** its vector index for similar past memories
3. **Expands** via the knowledge graph to retrieve related concepts
4. **Scores** candidates by semantic similarity + recency + importance + access frequency
5. **Queues** possible contradictions and returns existing memory excerpts with instructions for the connected AI to judge them immediately
6. **Injects** the assembled context into the AI's prompt

The AI responds with awareness of everything it has ever learned. After the exchange, the response is stored as a new memory — the brain grows continuously.

---

## Memory model

| Type | What it stores | Example |
|---|---|---|
| **Episodic** | Events, conversations, timestamped interactions | *"User asked about deployment on 2026-03-15"* |
| **Semantic** | Facts, knowledge, concepts + knowledge graph | `concept: TypeScript` → *"typed superset of JavaScript"* |
| **Procedural** | Patterns, skills, trigger→action rules | *"When user asks about DB migrations → use drizzle-kit generate"* |
| **Working** | Dynamically assembled context for a query | *(assembled at query time, not stored)* |

---

## Integrations

```
Claude Code    ──MCP──────────→ ┐
Claude Desktop ──extension────→ │  Engram  →  SQLite
Ollama         ──proxy────────→ │  REST :4901
Any app        ──REST─────────→ │
CLI            ──direct───────→ ┘
```

| Integration | Method | How |
|---|---|---|
| **Claude Code** | MCP (26 native tools) | `store_memory`, `recall_context`, `request_reflection`, … |
| **Claude Desktop** | 1-click Desktop Extension | [Smithery](https://smithery.ai/skills/ayvazyan10/engram) or `.mcpb` from releases |
| **Ollama** | Transparent HTTP proxy | Point client at `:11435` instead of `:11434` |
| **Any app** | Direct REST API | `POST /api/recall` + `POST /api/memory` |
| **Terminal** | CLI | `engram recall "what was the last decision?"` |

---

## Quick start

### One-command install

For Claude Code, choose the [recommended plugin](docs/INTEGRATIONS.md#claude-code-plugin-recommended) OR `engram setup` for MCP and hooks, never both.

```bash
# Memory for your AI client — npx-based MCP config, no clone/build
npx -y @engram-ai-memory/cli setup --npx

# Optional: REST API + Atlas dashboard on :4901 (the wizard clones and builds the server)
npm i -g @engram-ai-memory/cli
engram setup
engram start
```

The first command is all an MCP client needs. With the server running, open http://localhost:4901 for the dashboard, `/docs` for Swagger UI.

### CLI commands

```bash
engram setup                 # Clone, build, install the CLI globally, wire up MCP
engram setup --npx           # Fast setup — npx-based MCP config, no clone/build
engram setup --source cursor # Also picks WHICH client config file to write (see below)
engram init                  # Generate AI memory instructions (CLAUDE.md, .cursorrules, etc.)
engram init --client cursor  # Generate instructions for a specific client
engram update                # Pull, rebuild, re-link the CLI, restart the server
engram update --force        # Update even with local repo changes (stashed, or kept on a backup branch)
engram update --no-restart   # Update without restarting the server
engram start                 # Start the server (detached)
engram start --foreground    # Run it in this terminal instead
engram stop                  # Stop the server — waits for it to actually exit
engram doctor                # Health checks; exits 1 when it finds something
engram status                # Server status + memory count
engram configure show        # Print the current config
engram configure set <k> <v> # Change one setting
engram configure path        # Print the config file path
engram cloud connect <url>   # Configure multi-device sync against Postgres
engram cloud status          # Sync state, last sync, pending pushes
engram cloud sync            # Run one push + pull now
engram cloud encrypt         # Turn on end-to-end encryption (prompts for the passphrase)
engram cloud devices         # This device's sync identity
engram cloud disconnect      # Stop syncing; the local database is untouched
```

`engram setup --source <client>` picks both the identifier stamped on stored
memories **and** the config file that gets written: `claude-code` →
`~/.claude.json`, `cursor` → `~/.cursor/mcp.json`, `windsurf` →
`~/.codeium/windsurf/mcp_config.json`. Any other value — including the default
— registers nothing and prints the JSON block for you to paste yourself. It
never writes `~/.mcp.json`; no MCP client reads that path.

`engram stop`, `engram doctor` and `engram update` report failure through the
exit code, so they can be used in scripts: `stop` waits up to 10 s for the
process to exit and returns 1 if it may still be running (and refuses to signal
a PID that does not own the port); `doctor` returns 1 when any check fails;
`update` returns 1 when the repository moved but the build, the global CLI
refresh or the restart did not complete. `update` keys on a build stamp as well
as git state, so the first run after upgrading always rebuilds rather than
reporting "already up to date" over a stale `dist/`.

### Manual install (alternative)

```bash
git clone https://github.com/ayvazyan10/engram
cd engram
pnpm install
pnpm turbo run build
node apps/server/dist/index.js
```

Or keep it running in the background with PM2:

```bash
pnpm turbo run build
pm2 start ecosystem.config.cjs
pm2 logs engram
```

### Store your first memory

```bash
curl -X POST http://localhost:4901/api/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers TypeScript over JavaScript", "type": "semantic", "concept": "preferences"}'
```

### Ask the brain

```bash
curl -X POST http://localhost:4901/api/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "What language does the user prefer?"}'
```

---

## CLI

Install the CLI globally for terminal access:

```bash
npm i -g @engram-ai-memory/cli
```

```bash
# Store a memory
engram store "User prefers TypeScript" --type semantic --importance 0.8

# Search
engram search "TypeScript" --top 5

# Recall context (pipeable)
engram recall "what languages does the user prefer?" --raw

# Stats
engram stats

# Export/import
engram export > backup.json
engram import < backup.json

# Forget
engram forget a1b2c3d4-...

# Reflection (AI-driven — runs on the AI connected via MCP)
engram reflect-status                   # show whether a reflection cycle is due
engram reflections --type pattern       # list stored pattern insights
```

### Reflection needs no LLM configuration

Engram never calls a model itself. When a reflection cycle is due, the AI connected over MCP does the reasoning via `request_reflection` → `store_reflection`. There are no providers, models, or API keys to configure.

Set `ENGRAM_DB_PATH` to point at your database file.

---

## MCP Setup (Claude Code, Cursor, Windsurf, Cline)

Add Engram as a native tool in any MCP-compatible AI client — no API calls, no wrappers.

Add the config below to the file your client reads:

| Client | Config file |
|---|---|
| Claude Code (user scope) | `~/.claude.json` |
| Claude Code (project scope) | `.mcp.json` in the project root |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

`engram setup --source <client>` writes the right one for you. Any other client
reads its own file — check its documentation and paste the same block there.

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-code"
      }
    }
  }
}
```

> **Note:** Do not put `mcpServers` in `~/.claude/settings.json` — that file is for Claude Code settings only. MCP servers belong in `~/.claude.json` (user scope) or `.mcp.json` (project scope).

If you installed via `engram setup`, you can point to the local build instead:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/home/you/.engram/repo/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-code"
      }
    }
  }
}
```

Restart your AI client. **26 tools** are now available:

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `forget` |
| **Stats & Health** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `get_contradiction_tasks`, `complete_contradiction_check`, `check_contradictions`, `resolve_contradiction` |
| **Reflection** | `request_reflection`, `store_reflection`, `get_reflections` |
| **Distillation** | `get_distill_tasks`, `complete_distill` |
| **Tags** | `list_tags`, `tag_memory` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |

### Auto-store conversations (optional)

Local `engram setup` installs recall (UserPromptSubmit), SessionStart, and SessionEnd hooks automatically. SessionEnd stores under the absolute git project root; recall combines that project's memories with shared memories. Outside git, storage uses the shared pool and recall is unscoped. SessionStart loads context from the local MCP script. `engram update` refreshes previously installed hooks.

Add a Claude Code hook to automatically save conversation summaries to engram when a session ends:

```bash
# Copy the hook script
cp scripts/claude-code-hook.sh ~/.claude/hooks/engram-session-end.sh
chmod +x ~/.claude/hooks/engram-session-end.sh
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/engram-session-end.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

Every session now auto-stores a summary to engram — the brain grows without manual effort.

Stored sessions are tagged `pending-distill`. The AI connected to Engram calls `get_distill_tasks`, extracts durable facts itself (Engram runs no LLM and needs no API key), and calls `complete_distill`, which stores the facts and then archives the raw session. SessionStart reminds the AI when sessions are waiting to be distilled.

---

## Claude Desktop Extension (1-click install)

The fastest way to get Engram into Claude Desktop — no manual JSON editing required.

### Via Smithery

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

Go to [smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram), click **Install**, optionally set your database path and namespace, and Smithery configures Claude Desktop automatically.

### Via .mcpb Desktop Extension

Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest) and open it in Claude Desktop (File → Open Extension). The bundle auto-installs `@engram-ai-memory/mcp` to `~/.engram/mcp/` on first launch — no setup required.

> **How the bootstrap works:** on first run the `.mcpb` bundle installs `@engram-ai-memory/mcp@<version>` via npm into `~/.engram/mcp/`. A marker file prevents re-installation on subsequent launches. All 26 MCP tools are then available in Claude Desktop.

---

## Packages

| Package | Description | npm |
|---|---|---|
| `@engram-ai-memory/core` | The Brain — memory engine, embeddings, graph, retrieval, decay, reflection | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/core?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/core) |
| `@engram-ai-memory/mcp` | MCP Server — 26 tools for Claude Code and MCP-compatible clients | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/mcp?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/mcp) |
| `@engram-ai-memory/cli` | CLI — store, search, recall, reflections, stats, export, import from the terminal | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/cli?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/cli) |
| `@engram-ai-memory/server` | Fastify REST API + Socket.io WebSocket (53 endpoints) | — |
| `@engram-ai-memory/web` | Atlas dashboard — Map, Recall, Review, Timeline, Insights, Settings | — |
| `@engram-ai-memory/vis` | Force-directed layout + animation helpers | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/vis?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/vis) |
| `@engram-ai-memory/adapter-ollama` | Transparent Ollama memory proxy (:11435) | — |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4901` | API server port |
| `HOST` | `127.0.0.1` | Bind address — **loopback only by default** |
| `ENGRAM_SOURCE` | `mcp-client` | Client identifier (e.g. `claude-code`, `cursor`, `windsurf`) |
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path. Blank means the default; `~` and `~/x` are expanded |
| `ENGRAM_NAMESPACE_MODE` | `project` | Namespace behavior: `project`, `none`, `filter`, or `isolated` |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace value used when mode is `filter` or `isolated`; overrides `project` detection |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` | Persistent vector index path |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Override embedding model |
| `ENGRAM_DECAY_INTERVAL` | `3600000` | Auto-decay sweep interval (ms) |
| `ENGRAM_DECAY_THRESHOLD` | `0.05` | Retention score below which memories are archived |
| `ENGRAM_ALLOWED_ORIGINS` | localhost dashboard origins | Comma-separated browser origins allowed to call the API (CORS + WebSocket). Non-browser clients (CLI, MCP, curl) are unaffected. |
| `ENGRAM_API_KEY` | *(none)* | When set, all API routes except `/api/health` require this key via `X-API-Key` or `Authorization: Bearer`. Unset = open (local-first default). **Set-but-empty aborts startup** rather than silently disabling auth. |
| `ENGRAM_ALLOWED_HOSTS` | *(empty)* | Hostnames allowed in the `Host` header on `/api/*` (DNS-rebinding defense). IP literals and `localhost` always pass; anything reached by name — a reverse proxy, a Docker service name — must be listed. `*` disables the check. |
| `ENGRAM_RATE_LIMIT_MAX` | `1000` | Requests per window in the `global` tier. Also `ENGRAM_RATE_LIMIT_HEAVY_MAX` (300), `ENGRAM_RATE_LIMIT_WHOLE_STORE_MAX` (30), `ENGRAM_RATE_LIMIT_WINDOW_MS` (60000), `ENGRAM_RATE_LIMIT_DISABLED`. |
| `ENGRAM_CSP` | *(built-in policy)* | Override the Content-Security-Policy sent on every response, or `off` to send none. |
| `ENGRAM_WEBHOOK_ALLOW_PRIVATE` | `false` | Allow webhook delivery to loopback/private addresses. Denied by default to prevent SSRF; set `true` if your webhook consumers are on localhost or a private network. |
| `ENGRAM_SYNC_URL` | *(none)* | PostgreSQL connection string for multi-device sync. Unset = sync disabled. See [Cloud Sync](docs/CLOUD-SYNC.md). |
| `ENGRAM_SYNC_MODE` | `auto` | Sync behavior: `auto` (background sync on interval + debounce), `manual` (explicit only), `off`. |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval in milliseconds (auto mode only). |
| `ENGRAM_SYNC_ALLOW_UNENCRYPTED` | `false` | Allow non-TLS PostgreSQL connections. For local development only — production should always use `sslmode=require`. |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(none)* | Passphrase for E2E encryption of synced data. Unset = data reaches Postgres as plaintext. See [Cloud Sync](docs/CLOUD-SYNC.md#8-end-to-end-encryption). |
| `OLLAMA_PROXY_PORT` | `11435` | Ollama proxy listen port |
| `ENGRAM_PROXY_HOST` | `127.0.0.1` | Ollama proxy bind address — **loopback only by default**. The proxy has no authentication, so a wider bind hands any peer on the network an endpoint that drives your GPU. |
| `ENGRAM_MAX_BODY_BYTES` | `10485760` | Ceiling on a proxied request body; over it the proxy answers `413`. |
| `ENGRAM_TOOL_RETRY` | `true` | Auto-retry failed tool calls once with an instruction (proxy) |

`project` is the default: inside a git repository the MCP server and hooks scope to the absolute git top-level path and read that project's memories plus global ones; outside a repository they use the shared pool. `filter` scopes to `ENGRAM_NAMESPACE`, and `isolated` together with `ENGRAM_NAMESPACE` is a fixed boundary that rejects overrides and cross-namespace queries. The REST server and dashboard always run as `none` and see every project. Existing memories have a NULL namespace and stay global.

This is a summary. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) has the full list, including everything under [Security](docs/CONFIGURATION.md#security). Note that `engram start` derives the server's environment from `~/.engram/config.json`, so shell variables it manages are overridden — see the [CLI section](docs/CONFIGURATION.md#cli-packagescli).

---

## Ports

| Service | Port | Purpose |
|---|---|---|
| Engram API | **4901** | REST + WebSocket + Swagger UI |
| Dashboard | **4901** | Atlas dashboard (served from API server) |
| Dashboard (Docker) | **4902** | Standalone dashboard container, optional |
| Ollama Proxy | **11435** | Memory injection proxy → Ollama |

`docker compose` publishes all three — plus the sync-testing Postgres on 5432 — on **loopback only**. Exposing the API deliberately means setting `ENGRAM_API_KEY`, adding the public hostname to `ENGRAM_ALLOWED_HOSTS`, and only then changing the published address.

All ports are in the 49xx range to avoid conflicts with common dev services (3000, 5173, 8080, etc.).

---

## Live demo

```bash
# Load demo memories with knowledge graph connections
cd packages/core && npx tsx scripts/demo.ts

# Open the Atlas dashboard
# → http://localhost:4901
```

**Atlas views:** Map · Recall · Review · Timeline · Insights · Settings

Explore memories on a map with named regions, Meaning / Faults / Time lenses and search pins. Its switcher adds four lazily loaded views at `#/?view=sky|landscape|river|pulse`: **Sky**, a WebGL night sky arranged by meaning and age; **Landscape**, retention terrain with a Now / +7 / +30 / +90-day decay preview; **River**, braided history by region with brush-to-zoom and region following; and **Pulse**, a read-only recall explanation showing ranks, graph pulls, token budget and exclusions. Recall draws the numbered route of what your AI would be told alongside the exact context. Review contradictions, near-duplicates, fading-but-important memories and possible secrets, with Redact for detected secrets. Open any memory to inspect or edit it; archive and memory-sheet contradiction actions offer a six-second Undo. Timeline groups memories by day, Insights holds Numbers and Reflections, and Settings shows connection steps and health. Welcome guides the first connection.

Use light or dark mode (or follow the system), open commands with **⌘K / Ctrl+K**, and keep the same project scope as you move between memory views. The layout adapts to phones, with keyboard navigation and an accessible list alongside the map.

---

## Performance

| Metric | Value | Approach |
|---|---|---|
| Recall latency (100 memories) | ~18ms p50 | In-memory cosine scan + importance scoring |
| Store throughput | ~120 mem/s | SQLite WAL + auto-linking |
| Embedding | 8ms/text | Local ONNX/WASM (all-MiniLM-L6-v2) |
| Cold startup (1k memories) | ~1.2s | Full DB scan + index build |
| Cached startup (1k memories) | ~45ms | Persisted index (27x faster) |
| Storage per memory | ~1.3 KB | FP16 compressed (2x reduction) |
| Dashboard JS budgets | ≤ 200 KB initial / ≤ 125 KB lazy Insights / ≤ 220 KB lazy 3D views (gzip) | Charts load with Insights; three.js loads with Sky / Landscape; `check:bundle` enforces limits |

Embeddings run **locally** using ONNX Runtime WASM — no OpenAI API, no cost, no data leaving your machine.

---

## Documentation

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, component overview |
| [docs/API.md](docs/API.md) | Full REST API reference (53 endpoints) |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Claude Code, Ollama, REST, webhooks, plugins |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Monorepo, build system, contributing |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variables, database, tuning |

Interactive Swagger UI: `http://localhost:4901/docs`

Marketing site & interactive docs: [engram.am](https://engram.am)

---

## Contributing

We welcome contributions of all kinds — bug fixes, new integrations, adapters for other AI tools, visualization improvements, and documentation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where help is especially welcome:

- **New adapters** — LM Studio, llama.cpp, Anthropic API, OpenAI API
- **Mobile / browser** — lightweight browser-side memory client
- **Multi-modal embeddings** — images, audio alongside text
- **Multi-device cloud sync** — SQLite stays the local engine; devices replicate through a shared PostgreSQL instance via `ENGRAM_SYNC_URL` (see [Cloud Sync](docs/CLOUD-SYNC.md))
- **ANN vector index** — replace the brute-force cosine scan with HNSW so recall stops scaling linearly with memory count

---

## Usage examples

### Example 1 — Session start: recall relevant context

```
User: "Continue working on the auth refactor"
Claude: [calls recall_context("auth refactor current status")]
→ Returns past decisions, code patterns, and session notes about auth
```

Tool: `recall_context` · Input: `{ "query": "auth refactor current status", "maxTokens": 1500 }` · Output: formatted context block with matched memories and scores.

### Example 2 — Store a decision

```
User: "Always use drizzle-kit migrate, never drizzle-kit push — it broke prod once"
Claude: [calls store_memory with type "procedural", importance 0.95]
→ Next session: search_memory("database migrations") surfaces this rule automatically
```

Tool: `store_memory` → `search_memory` · Demonstrates cross-session persistence.

### Example 3 — Contradiction detection

```
User (day 1): "Production runs on PostgreSQL 15"
User (day 30): "We migrated prod to SQLite WAL last month"
Claude: [store_memory returns possible contradictions with existing memory excerpts]
→ judges each pair immediately using the response
→ calls complete_contradiction_check(verdict: "contradiction", strategy: "keep_newest")
```

Tools: `store_memory`, `get_contradiction_tasks`, `complete_contradiction_check`. Heuristics only nominate candidates. The connected model verifies the conflict and uses `keep_newest` only when the new memory fully replaces the older one.

---

## Privacy policy

Engram is local-first and privacy-preserving by design:

- **Local by default.** All memories are stored in a local SQLite database (`~/.engram/engram.db`). No data leaves your machine unless you explicitly enable cloud sync.
- **Cloud sync is opt-in.** Setting `ENGRAM_SYNC_URL` replicates memories to a PostgreSQL database you own and control — Engram never phones home and never touches any third-party service on its own. See [Cloud Sync](docs/CLOUD-SYNC.md).
- **All embeddings run on-device.** The `all-MiniLM-L6-v2` model runs locally via `@xenova/transformers` — no external embedding API calls.
- **No telemetry.** Engram does not collect usage statistics, crash reports, or any analytics.
- **Webhooks are opt-in.** If you configure webhooks, memory events are sent to your chosen URL — fully under your control.

Full privacy policy: **https://engram.am/privacy**

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built with ♥ for the open AI ecosystem by <a href="https://github.com/ayvazyan10">Razmik Ayvazyan</a></sub>
</div>
