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

Engram gives any AI model **human-like memory** that persists across sessions, systems, and restarts. Connect your AI clients to the same Engram store to share memories across tools.

Most AI tools forget what happened in earlier sessions. Engram stores what your AIs learn and returns relevant memories when a client requests context. The Ollama proxy and Claude Code’s local prompt hook can request it automatically.

```
┌─ You tell Claude Code about your stack  ──→  stored as semantic memory
└─ Next day, different tool, new session  ──→  that tool can recall it from Engram
```

---

## Features

| Feature | Description |
|---|---|
| **3 Memory Types** | Episodic (events), Semantic (facts + knowledge graph), Procedural (trigger→action patterns) |
| **7-Step Recall Pipeline** | Embed → Vector search → Graph expand → Score → Rank → Truncate → Log |
| **Hybrid Search** | Opt in to combine vector similarity with SQLite FTS5 keyword matches in search and recall |
| **Memory Decay & GC** | Ebbinghaus forgetting curve, auto-archive stale memories, episodic→semantic consolidation |
| **Memory Reflection** | AI-driven insight engine — the AI connected over MCP reasons over your memories to surface patterns, knowledge gaps, trends, and contradictions. Engram needs no separate LLM or API key for reflection. |
| **Atlas dashboard** | Map, Recall, Review, Timeline, Insights and Settings; light/dark and ⌘K command palette |
| **Optional Namespaces** | Stdio MCP scopes to the current project by default. Choose unscoped access, filtering or strict isolation |
| **Contradiction Detection** | Heuristics nominate candidates; the connected AI verifies them before using 5 resolution strategies (`keep_newest`, `keep_oldest`, `keep_important`, `keep_both`, `manual`) |
| **Embedding Upgradability** | Swap embedding models, store model ID alongside vectors, batch re-embedding pipeline |
| **Streaming Recall** | SSE delivers selected search matches first, graph neighbors next, then the assembled context |
| **Index Persistence** | Save/load vector index to disk for fast startup (27-37x speedup) |
| **CLI Tool** | `engram store/search/recall/stats/forget/export/import/reflections/cloud` from the terminal |
| **Import/Export** | Export live memories as JSON or NDJSON via the CLI. Import those records or memory files from Markdown, ChatGPT and Claude. Matching records can merge |
| **Webhooks** | Subscribe external systems to memory events (stored, forgotten, decayed, consolidated, contradiction, reflected) |
| **Tagging & Collections** | Tag cloud, filter by tag, prefix-based collections (e.g. `project:alpha`) |
| **Plugin System** | 7 lifecycle hooks (onStore, onRecall, onForget, onDecay, onReflect, onStartup, onShutdown) |
| **Importance Decay** | Source-aware default importance, daily decay for unused memories, protection rules for AI clients |
| **Inline Edit & Bulk Ops** | PATCH individual memories, bulk tag/archive via API and dashboard |
| **Observability** | Health and index status, read-only recall explanations with ranks and token budgets, Swagger UI at `/docs` |

---

## How it works

When a connected AI requests context, Engram:

1. **Embeds** the query locally (384 dimensions with the default model)
2. **Searches** its vector index for similar past memories
3. **Expands** via the knowledge graph to retrieve related concepts
4. **Scores** candidates by semantic similarity + recency + importance + access frequency
5. **Selects** memories for the token budget and formats them by type
6. **Returns** the assembled context to the client and, by default, records the recall

When the client stores a memory, Engram checks for possible contradictions. `store_memory` returns candidate excerpts for the connected AI to judge.

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
CLI            ──REST─────────→ ┘
```

| Integration | Method | How |
|---|---|---|
| **Claude Code** | MCP (15 tools visible by default; 11 admin tools shown with `ENGRAM_ADMIN_TOOLS=1`) | `store_memory`, `recall_context`, `request_reflection`, … |
| **MCP over HTTP** | Streamable HTTP on the running API server | Connect to `http://localhost:4901/mcp` |
| **Claude Desktop** | 1-click Desktop Extension | [Smithery](https://smithery.ai/skills/ayvazyan10/engram) or `.mcpb` from releases |
| **Ollama / OpenAI-compatible APIs** | Memory proxy | Point the client at `:11435` and set `ENGRAM_UPSTREAM` for a different upstream |
| **Any app** | Direct REST API | `POST /api/recall` + `POST /api/memory` |
| **Terminal** | CLI | `engram recall "what was the last decision?"` |

---

## Quick start

### One-command install

For Claude Code, choose the [recommended plugin](docs/INTEGRATIONS.md#claude-code-plugin-recommended) OR `engram setup` for MCP and hooks, never both.

```bash
# Memory for your AI client — npx-based MCP config, no clone/build
npx -y @engram-ai-memory/cli setup --npx --source cursor

# Optional: REST API + Atlas dashboard on :4901 (requires Git and pnpm; local setup clones and builds the server)
npm i -g @engram-ai-memory/cli
engram setup
engram start
```

The first command configures Cursor. Substitute your client’s `--source` value below, then restart the client. With the server running, open http://localhost:4901 for the dashboard, `/docs` for Swagger UI.

### CLI commands

```bash
engram setup                 # Clone, build, install the CLI globally, configure a known client or print its MCP snippet
engram setup --npx           # Fast setup — npx-based MCP config, no clone/build
engram setup --source cursor # Also picks WHICH client config file to write (see below)
engram init                  # Generate AI memory instructions (CLAUDE.md, .cursorrules, etc.)
engram init --client cursor  # Generate instructions for a specific client
engram update                # Pull, rebuild, re-link the CLI, restart a running server after rebuilding
engram update --force        # Update even with local repo changes (stashed, or kept on a backup branch)
engram update --no-restart   # Update without restarting the server
engram start                 # Start the server (detached)
engram start --foreground    # Run it in this terminal instead
engram stop                  # Stop the server — waits for it to actually exit
engram doctor                # Health checks; exits 1 if the report counts any issues
engram status                # Server status + memory count
engram configure show        # Print the current config
engram configure set <k> <v> # Change one setting
engram configure path        # Print the config file path
engram cloud connect <url>   # Configure multi-device sync against Postgres
engram cloud status          # Sync state, last sync, pending pushes
engram cloud sync            # Run one push + pull now
engram cloud sync --re-embed # Sync this device’s edits and convert cloud vectors to its model
engram cloud migrate-model <source> <target> # Switch the shared model after stopping sync on all devices
engram cloud encrypt         # Turn on end-to-end encryption (reads ENGRAM_SYNC_ENCRYPTION_KEY or prompts when omitted)
engram cloud devices         # This device's sync identity
engram cloud disconnect      # Remove sync settings for future launches
```

`engram setup --source <client>` picks both the identifier stamped on stored
memories **and** the config file that gets written: `claude-code` →
`~/.claude.json`, `cursor` → `~/.cursor/mcp.json`, `windsurf` →
`~/.codeium/windsurf/mcp_config.json`, `codex` → `~/.codex/config.toml`, and
`opencode` → `~/.config/opencode/opencode.json`. Aliases include `claude`, `claudecode`, `codeium`, `codex-cli` and `open-code`. An unrecognized source (including the default `mcp-client`) prints a JSON block to paste. Detected Claude Code has a separate auto-registration step.

`engram setup` adds a marked memory-rules block to the global instructions of configured or detected Claude Code, Codex, OpenCode, Windsurf and Cline clients. `engram update` refreshes the block and preserves the surrounding text. The MCP server also refreshes its own client’s block on startup, including for existing plugin and npx installs. Pass `--no-global-rules` to skip the CLI step. Setup records `ENGRAM_GLOBAL_RULES=0` in the MCP entries it writes.

`engram stop`, `engram doctor` and `engram update` report failure through the
exit code, so they can be used in scripts: `stop` waits up to 10 s for the
process to exit and returns 1 if it may still be running (and refuses to signal
a PID that does not own the port); `doctor` returns 1 when its report counts an issue;
`update` returns 1 when the repository moved but the build, the global CLI
refresh or the restart did not complete. `update` also rebuilds when a required artifact is missing or the build stamp is missing or stale.

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
engram forget a1b2c3d4-1111-4000-8000-000000000001  # Use the full ID from search --json

# Reflection (AI-driven — runs on the AI connected via MCP)
engram reflect-status                   # show whether a reflection cycle is due
engram reflections --type pattern       # list stored pattern insights
```

### Reflection needs no LLM configuration

When a reflection cycle is due, the AI connected over MCP does the reasoning via `request_reflection` → `store_reflection`. There are no providers, models, or API keys to configure.

CLI memory commands use the running REST server. Set its database with `engram configure set dbPath <path>`, then restart it. For a directly launched server, set `ENGRAM_DB_PATH`.

---

## MCP Setup (Claude Code, Cursor, Windsurf, Cline)

Connect an MCP-compatible client over stdio using the configuration below, or use the running API server’s `/mcp` endpoint.

Add the config below to the file your client reads:

| Client | Config file |
|---|---|
| Claude Code (user scope) | `~/.claude.json` |
| Claude Code (project scope) | `.mcp.json` in the project root |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

`engram setup --source <client>` writes the supported user-level config. Codex CLI and OpenCode use their [native config formats](docs/INTEGRATIONS.md#codex-cli). For a manual integration, use the format and location expected by your client.

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

If you installed with a local clone and build, you can point to the local build instead:

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

Restart your AI client. **15 tools** are visible by default; **11 admin tools** are shown with `ENGRAM_ADMIN_TOOLS=1`:

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `update_memory`, `forget` |
| **Stats & Health** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `get_contradiction_tasks`, `complete_contradiction_check`, `check_contradictions`, `resolve_contradiction` |
| **Reflection** | `request_reflection`, `store_reflection`, `get_reflections` |
| **Distillation** | `get_distill_tasks`, `complete_distill` |
| **Tags** | `list_tags`, `tag_memory` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |

### Auto-store conversations (optional)

With Claude Code detected and its Engram plugin inactive, local `engram setup` installs four hooks. SessionStart shows up to three distinct pinned, handover or high-importance (≥0.8) memories from the exact project, plus available update or stale-server notices. The other three hooks require `jq`, `curl` and the running REST server. UserPromptSubmit injects up to three filtered search results with a minimum similarity of 0.5 by default (adjust with `ENGRAM_RECALL_MIN_SIM`). PostToolUse mirrors Claude Code's project memory Markdown files after Write, Edit or MultiEdit, excluding the `MEMORY.md` index. Editing a file updates its existing Engram memory. SessionEnd saves a summary at importance 0.3, including on `/clear`, and skips `resume`. The plugin provides SessionStart, PostToolUse and SessionEnd.

The hooks honour the configured namespace mode. In `project` mode, worktrees share the main repository's absolute root. Outside Git, the namespace is the current working directory, with global storage at filesystem roots and the user's home. In project mode, prompt recall also searches shared semantic and procedural memories. `engram update` refreshes the existing Claude MCP entry and installed hooks.

For a manual installation of the standalone session-summary hook:

```bash
# Copy the hook script
mkdir -p ~/.claude/hooks
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

The standalone hook uses `jq` to read the last 1,500 characters of assistant text and calls `engram-store-session` when the summary has at least 20 characters.

Stored sessions are tagged `pending-distill`. The AI connected to Engram calls `get_distill_tasks`, extracts durable facts itself (Engram runs no LLM and needs no API key), and calls `complete_distill`, which stores the facts and then archives the raw session.

---

## Claude Desktop Extension (1-click install)

The fastest way to get Engram into Claude Desktop — no manual JSON editing required.

### Via Smithery

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

Go to [smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram), click **Install**, optionally set your database path and namespace, and Smithery configures Claude Desktop automatically. Smithery defaults to `none` for namespace mode. Choose `filter` with a namespace to scope the connection.

### Via .mcpb Desktop Extension

Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest) and open it in Claude Desktop (File → Open Extension). The bundle auto-installs `@engram-ai-memory/mcp` to `~/.engram/mcp/` on first launch using Node.js 22+ and npm.

> **How the bootstrap works:** on first run the `.mcpb` bundle installs `@engram-ai-memory/mcp@<version>` via npm into `~/.engram/mcp/`. Subsequent launches skip installation when the version, marker and server entrypoint are all present. 15 MCP tools are visible by default; enable **Admin tools** in the extension settings to show the 11 admin tools.

---

## Packages

| Package | Description | npm |
|---|---|---|
| `@engram-ai-memory/core` | The Brain — memory engine, embeddings, graph, retrieval, decay, reflection | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/core?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/core) |
| `@engram-ai-memory/mcp` | MCP Server for Claude Code and MCP-compatible clients — 15 tools visible by default; 11 admin tools shown with `ENGRAM_ADMIN_TOOLS=1` | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/mcp?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/mcp) |
| `@engram-ai-memory/cli` | CLI — store, search, recall, reflections, stats, export, import from the terminal | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/cli?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/cli) |
| `@engram-ai-memory/server` | Fastify REST API + Socket.io WebSocket (62 REST method/path pairs under `/api`) | — |
| `@engram-ai-memory/web` | Atlas dashboard — Map, Recall, Review, Timeline, Insights, Settings | — |
| `@engram-ai-memory/vis` | Force-directed layout + animation helpers | [![npm](https://img.shields.io/npm/v/@engram-ai-memory/vis?color=6366f1)](https://npmjs.com/package/@engram-ai-memory/vis) |
| `@engram-ai-memory/adapter-ollama` | Transparent Ollama memory proxy (:11435) | — |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4901` | API server port |
| `HOST` | `127.0.0.1` | Bind address — **loopback only by default** |
| `ENGRAM_SOURCE` | MCP client name, falling back to `mcp-client` | Source for MCP tool writes when omitted by the caller |
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path. Blank means the default; `~` and `~/x` are expanded |
| `ENGRAM_NAMESPACE_MODE` | `project` (stdio MCP and CLI setup) | Direct REST startup accepts `none` (default), `filter` (default with `ENGRAM_NAMESPACE`), or `isolated` |
| `ENGRAM_NAMESPACE` | *(none)* | Namespace value used when mode is `filter` or `isolated`; overrides `project` detection |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` when a DB path is configured | Vector index path. Isolated mode appends a namespace hash |
| `ENGRAM_EMBEDDING_MODEL` | *(automatic)* | New databases use `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384-dim, ~118 MB quantized, multilingual); existing databases keep their stored model unless overridden. Run `re_embed` to convert existing vectors. |
| `ENGRAM_HYBRID_SEARCH` | off | Set to `1` or `true` to combine vector and BM25 keyword rankings |
| `ENGRAM_DEDUP_THRESHOLD` | `0.97` | Minimum cosine similarity for merging compatible memories of the same type and namespace |
| `ENGRAM_ADMIN_TOOLS` | off | Set to `1` to show the 11 admin MCP tools |
| `ENGRAM_GLOBAL_RULES` | enabled | Set to `0` to skip writes to supported clients’ global instruction files |
| `ENGRAM_DECAY_INTERVAL` | `3600000` | Auto-decay sweep interval (ms) |
| `ENGRAM_DECAY_THRESHOLD` | `0.05` | Retention score below which memories are archived |
| `ENGRAM_ALLOWED_ORIGINS` | localhost dashboard origins | Comma-separated browser origins allowed to call the API (CORS + WebSocket). Non-browser clients (CLI, MCP, curl) are unaffected. |
| `ENGRAM_API_KEY` | *(none)* | When set, `/mcp`, `/docs/json`, `/docs/yaml` and `/api/*` except `/api/health` require this key via `X-API-Key` or `Authorization: Bearer`. Unset = open (local-first default). **Set-but-empty aborts startup** rather than silently disabling auth. |
| `ENGRAM_ALLOWED_HOSTS` | *(empty)* | Hostnames allowed in the `Host` header on `/api/*`, `/mcp` and Socket.IO handshakes (DNS-rebinding defense). IP literals and `localhost` (including `*.localhost`) always pass; anything reached by name — a reverse proxy, a Docker service name — must be listed. `*` disables the check. |
| `ENGRAM_RATE_LIMIT_MAX` | `1000` | Requests per window in the `global` tier. Also `ENGRAM_RATE_LIMIT_HEAVY_MAX` (300), `ENGRAM_RATE_LIMIT_WHOLE_STORE_MAX` (30), `ENGRAM_RATE_LIMIT_WINDOW_MS` (60000), `ENGRAM_RATE_LIMIT_DISABLED`. |
| `ENGRAM_CSP` | *(built-in policy)* | Override the Content-Security-Policy sent on every response, or `off` to send none. |
| `ENGRAM_WEBHOOK_ALLOW_PRIVATE` | `false` | Allow webhook delivery to loopback/private addresses. Denied by default to prevent SSRF; set `true` if your webhook consumers are on localhost or a private network. |
| `ENGRAM_SYNC_URL` | *(none)* | PostgreSQL connection string for multi-device sync. Unset = sync disabled. See [Cloud Sync](docs/CLOUD-SYNC.md). |
| `ENGRAM_SYNC_MODE` | `auto` | Sync behavior: `auto` (background sync on interval + debounce), `manual` (explicit only), `off`. |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval in milliseconds (auto mode only). |
| `ENGRAM_SYNC_ALLOW_UNENCRYPTED` | `false` | Allow non-TLS PostgreSQL connections. For local development only — production should always use `sslmode=require`. |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(none)* | Passphrase for E2E encryption of synced data. Required for an encrypted target. An unencrypted target stores plaintext fields. See [Cloud Sync](docs/CLOUD-SYNC.md#8-end-to-end-encryption). |
| `OLLAMA_PROXY_PORT` | `11435` | Ollama proxy listen port |
| `ENGRAM_UPSTREAM` | `http://localhost:11434` | Proxy upstream URL. Overrides the legacy `OLLAMA_TARGET` |
| `ENGRAM_API` | `http://localhost:4901` (proxy) | Engram API used by the proxy for recall and storage |
| `ENGRAM_PROXY_HOST` | `127.0.0.1` | Ollama proxy bind address — **loopback only by default**. The proxy has no authentication, so a wider bind hands any peer on the network an endpoint that drives your GPU. |
| `ENGRAM_MAX_BODY_BYTES` | `10485760` | Ceiling on a proxied request body; over it the proxy answers `413`. |
| `ENGRAM_TOOL_RETRY` | `true` | Retry once when a model answers a tool-enabled user message in prose without calling a tool (proxy) |

In `project` mode, inside a git repository stdio MCP scopes to the main repository's absolute top-level path, shared by its worktrees, and reads that project's memories plus global ones; outside a repository it uses `filter` scoped to the resolved current working directory, except at a filesystem root (`/` or a Windows drive root) or exactly the user's home directory, where the default is global memories only. Stdio MCP also falls back to global scope if its working directory has been deleted. `filter` scopes to `ENGRAM_NAMESPACE`, and `isolated` together with `ENGRAM_NAMESPACE` is a fixed boundary that rejects overrides and cross-namespace queries. `engram start` maps its `project` setting to `none` for the REST server and dashboard, so they see every project. Memories with a NULL namespace are global.

This is a summary. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) has the full list, including everything under [Security](docs/CONFIGURATION.md#security). Note that `engram start` derives the server's environment from `~/.engram/config.json`, so shell variables it manages are overridden — see the [CLI section](docs/CONFIGURATION.md#cli-packagescli).

---

## Ports

| Service | Port | Purpose |
|---|---|---|
| Engram API | **4901** | REST + WebSocket + Swagger UI |
| Dashboard | **4901** | Atlas dashboard (served from API server) |
| Dashboard (Docker) | **4902** | Standalone dashboard container, optional |
| Ollama Proxy | **11435** | Memory injection proxy → Ollama |

`docker compose` publishes the API (4901), dashboard (4902) and sync-testing Postgres (5432) on **loopback only**. Run the Ollama proxy separately. Exposing the API deliberately means setting `ENGRAM_API_KEY`, adding the public hostname to `ENGRAM_ALLOWED_HOSTS`, and only then changing the published address.

---

## Live demo

```bash
# Load demo memories with knowledge graph connections
(cd packages/core && npx tsx scripts/demo.ts)

# From the repo root, serve the seeded database with the built API and dashboard
ENGRAM_DB_PATH="$PWD/packages/core/engram.db" node apps/server/dist/index.js

# Open the Atlas dashboard
# → http://localhost:4901
```

**Atlas views:** Map · Recall · Review · Timeline · Insights · Settings

Explore memories on a map with named regions, Meaning / Faults / Time lenses and search pins. Its switcher adds four lazily loaded views at URLs such as `#/?view=sky`: **Sky**, a WebGL night sky arranged by meaning and age; **Landscape**, retention terrain with a Now / +7 / +30 / +90-day decay preview; **River**, braided history by region with brush-to-zoom and region following; and **Pulse**, a read-only recall explanation showing ranks, graph pulls, token budget and exclusions. Recall draws the numbered route of what your AI would be told alongside the exact context. Review contradictions, near-duplicates, fading-but-important memories and possible secrets, with Redact for detected secrets. Open any memory to inspect or edit it; archive and memory-sheet contradiction actions offer a six-second Undo. Timeline groups memories by day, Insights holds Numbers and Reflections, and Settings shows connection steps and health. Welcome guides the first connection.

Use light or dark mode (or follow the system), open commands with **⌘K / Ctrl+K**, and keep the same project scope as you move between memory views. The layout adapts to phones, with keyboard navigation and an accessible list alongside the map.

---

## Performance

| Metric | Value | Approach |
|---|---|---|
| Recall latency (100 memories) | ~18ms p50 | In-memory cosine scan + importance scoring |
| Store throughput | ~120 mem/s | SQLite WAL + auto-linking |
| Embedding | 8ms/text | Local ONNX (measured with all-MiniLM-L6-v2) |
| Cold startup (1k memories) | ~1.2s | Full DB scan + index build |
| Cached startup (1k memories) | ~45ms | Persisted index (27x faster) |
| Storage per memory | ~1.3 KB | FP16 halves the embedding bytes compared with FP32 |
| Dashboard JS budgets | ≤ 200 KB initial / ≤ 125 KB lazy Insights / ≤ 220 KB lazy 3D views (gzip) | Charts load with Insights; three.js loads with Sky / Landscape; `check:bundle` enforces limits |

Embeddings run **locally** using ONNX Runtime. The model weights download on first use, and embedding inference stays on your machine.

---

## Documentation

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, component overview |
| [docs/API.md](docs/API.md) | REST API reference |
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

- **New adapters** — additional protocols beyond Ollama and OpenAI-compatible chat completions
- **Mobile / browser** — lightweight browser-side memory client
- **Multi-modal embeddings** — images, audio alongside text
- **Multi-device cloud sync** — SQLite stays the local engine; devices replicate through a shared PostgreSQL instance via `ENGRAM_SYNC_URL` (see [Cloud Sync](docs/CLOUD-SYNC.md))
- **ANN vector index** — replace the brute-force cosine scan with HNSW so recall stops scaling linearly with memory count

---

## Usage examples

### Example 1 — Session start: recall relevant context

```
User: "Continue working on the auth refactor"
Claude: [calls recall_context({ "query": "auth refactor current status", "maxTokens": 1500 })]
→ Returns past decisions, code patterns, and session notes about auth
```

Tool: `recall_context` · Input: `{ "query": "auth refactor current status", "maxTokens": 1500 }` · Output: formatted context text with memory ID prefixes and dates.

### Example 2 — Store a decision

```
User: "Always use drizzle-kit migrate, never drizzle-kit push — it broke prod once"
Claude: [calls store_memory with the instruction as content, type "procedural", importance 0.95]
→ Next session: search_memory({ "query": "database migrations" }) can surface this rule
```

Tool: `store_memory` → `search_memory` · Demonstrates cross-session persistence.

### Example 3 — Contradiction detection

```
User (day 1): "Production runs on PostgreSQL 15"
User (day 30): "Production runs on PostgreSQL 16"
Claude: [if store_memory returns a possible conflict, read the existing memory excerpt]
→ judge whether the new fact supersedes the old one
→ call complete_contradiction_check with sourceId (new), targetId (existing), verdict "contradiction" and strategy "keep_newest"
```

Tools: `store_memory`, `get_contradiction_tasks`, `complete_contradiction_check`. Heuristics only nominate candidates. The connected model verifies the conflict and uses `keep_newest` only when the new memory fully replaces the older one.

---

## Privacy policy

Engram is local-first and privacy-preserving by design:

- **Local by default.** Engram stores memories in SQLite (`~/.engram/engram.db`). Recalled content is returned to the connected AI client or, with the proxy, sent to the configured upstream.
- **Cloud sync is opt-in.** Setting `ENGRAM_SYNC_URL` enables replication to your PostgreSQL database. The stdio MCP server and SessionStart hook also check the package version on GitHub’s master branch using a local cache. See [Cloud Sync](docs/CLOUD-SYNC.md).
- **All embeddings run on-device.** The configured embedding model runs locally via `@xenova/transformers` — no external embedding API calls.
- **No usage telemetry.** Recall history and the dashboard’s analytics are stored locally.
- **Webhooks are opt-in.** If you configure webhooks, memory events are sent to your chosen URL — fully under your control.

Full privacy policy: **https://engram.am/privacy**

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built with ♥ for the open AI ecosystem by <a href="https://github.com/ayvazyan10">Razmik Ayvazyan</a></sub>
</div>
