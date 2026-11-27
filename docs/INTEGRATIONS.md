# Integrations

Engram exposes multiple integration surfaces:

1. **MCP Server** — for any MCP-compatible AI client (Claude Code, Cursor, Windsurf, Cline — 15 tools by default, 26 with admin tools enabled)
2. **Claude Desktop Extension** — 1-click install via Smithery or `.mcpb` bundle
3. **REST API** — for everything else (Ollama, custom apps, 62 `/api` method/path pairs)
4. **CLI** — terminal workflows and scripting
5. **Webhooks** — push notifications to external systems on memory events
6. **Plugin System** — extend Engram with lifecycle hooks

---

## Claude Desktop Extension (1-click install)

The easiest way to get Engram into Claude Desktop — no manual JSON editing or path configuration.

### Via Smithery

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

Go to [smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram) and click **Install**. Smithery automatically configures Claude Desktop and prompts for optional settings. The Smithery launcher accepts `dbPath`, `namespace`, `namespaceMode` (`none` by default, `filter` or `isolated`), `embeddingModel`, `syncUrl` and `syncMode` (`auto` by default, `manual` or `off`). It runs `npx -y -p @engram-ai-memory/mcp@latest engram-mcp`.

### Via .mcpb Desktop Extension

1. Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest)
2. Open Claude Desktop → File → Open Extension
3. Select the `.mcpb` file

The extension requires Node.js 22+ and npm. It installs `@engram-ai-memory/mcp@0.15.1` under `~/.engram/mcp/`. The launcher skips installation when the version marker, installed package version and server entry point all match.

**User config options (set during installation):**

| Option | Description | Default |
|---|---|---|
| `db_path` | `ENGRAM_DB_PATH`; blank uses `~/.engram/engram.db` | *(empty)* |
| `namespace_mode` | `ENGRAM_NAMESPACE_MODE`: `project`, `none`, `filter`, or `isolated` | `project` |
| `namespace` | `ENGRAM_NAMESPACE`; required in isolated mode, overrides project detection | *(empty)* |
| `admin_tools` | `ENGRAM_ADMIN_TOOLS`; the launcher converts true to `1` to expose 11 extra tools | `false` |
| `sync_url` | `ENGRAM_SYNC_URL`; PostgreSQL connection string | *(empty)* |
| `sync_mode` | `ENGRAM_SYNC_MODE`; `auto`, `manual` or `off` | `auto` |
| `sync_encryption_key` | `ENGRAM_SYNC_ENCRYPTION_KEY`; shared encryption passphrase | *(empty)* |

**How the bootstrap launcher works:**

```
Claude Desktop  →  node <extension directory>/server/index.js
                      │
                      ├─ Install:    npm install --prefix ~/.engram/mcp @engram-ai-memory/mcp@0.15.1
                      └─ All runs:   spawn the same Node executable with
                                     ~/.engram/mcp/node_modules/@engram-ai-memory/mcp/dist/server.js (stdio)
```

---

## MCP Integration (Claude Code, Cursor, Windsurf, Cline)

### Remote MCP over HTTP

The REST server exposes Streamable HTTP MCP at `http(s)://<host>:<port>/mcp`.
It accepts stateless JSON-RPC POST requests and provides the same tool set as stdio MCP, using the REST server’s brain and `ENGRAM_ADMIN_TOOLS` setting.
When `ENGRAM_API_KEY` is configured, send `X-API-Key: <ENGRAM_API_KEY>` or
`Authorization: Bearer <ENGRAM_API_KEY>`. Otherwise, omit the auth headers.

Example client configuration (replace the key placeholder with your configured key):

```json
{
  "mcpServers": {
    "engram": {
      "url": "http://localhost:4901/mcp",
      "headers": { "X-API-Key": "<ENGRAM_API_KEY>" }
    }
  }
}
```

### Claude Code plugin (recommended)

Choose the plugin OR `engram setup` for Claude Code MCP and hooks, never both; setup leaves those integrations to an already enabled Engram plugin.

Run these commands in Claude Code:

```text
/plugin marketplace add ayvazyan10/engram
/plugin install engram@engram
```

The marketplace points to `plugins/engram/`. Its `.claude-plugin/plugin.json` declares version `0.15.1`, `.mcp.json` launches `engram-mcp` via `npx` at `@latest`, and `hooks/hooks.json` registers three command hooks. SessionStart runs `engram-session-start` and returns project context when available.

SessionEnd saves a transcript summary on exit or `/clear` and skips `resume`. After a Write, Edit or MultiEdit to a Claude project memory Markdown file, PostToolUse mirrors its contents into the same local database. SessionEnd launches `engram-store-session` and PostToolUse launches `engram-store-memory-file` in the background. SessionStart runs in the foreground. The plugin MCP entry defaults `ENGRAM_SOURCE` to `claude-code`, `ENGRAM_NAMESPACE_MODE` to `project` and `ENGRAM_ADMIN_TOOLS` to `0`. Edits reuse the file’s Engram record, and the mirror skips `MEMORY.md`. Node.js 22 or newer and npm are required.

With the default `ENGRAM_SOURCE=claude-code` and global rules enabled, the plugin’s `@latest` MCP entry refreshes `~/.claude/CLAUDE.md` on launch. Hook changes arrive with the versioned plugin. Claude Code defaults to manual updates for third-party marketplaces. Run `claude plugin update engram@engram` and start a new session, or enable marketplace auto-update. [Claude Code plugin updates](https://code.claude.com/docs/en/plugins/host-marketplace#keep-users-up-to-date)

The MCP server exposes Engram as native tools inside any MCP-compatible AI client. No API calls needed — your AI uses `store_memory`, `recall_context`, etc. directly as tool calls.

### Setup

**Option A — npx (fastest, recommended)**

If you are not using the Claude Code plugin, add to the config file your client reads:

| Client | Config file |
|---|---|
| Claude Code (user scope) | `~/.claude.json` |
| Claude Code (manual project scope) | `.mcp.json` in the project directory |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Codex CLI | `~/.codex/config.toml` |
| OpenCode | `~/.config/opencode/opencode.json` |

`engram setup --source <client>` writes the user config for these five clients. An unknown source (including the default `mcp-client`) gets a manual snippet. `--no-mcp` skips registration. With Claude Code detected, setup also configures its user entry and local hooks unless `--no-claude-hooks` is set or the plugin is enabled. `--npx` skips the local build and hooks. Generated npx entries use `npx -y @engram-ai-memory/mcp@latest`; local entries use `node` and the absolute built `server.js` path. Setup creates `config.json` if missing in `ENGRAM_HOME` (default `~/.engram`). Changed client config files get timestamped backups. Claude user-config writes respect `~/.claude.json.lock` and refuse concurrent edits.

Both entry styles set `ENGRAM_DB_PATH`, `ENGRAM_SOURCE`, `ENGRAM_NAMESPACE_MODE` (fresh config: `project`) and `ENGRAM_NAMESPACE` when configured. Relative `dbPath` values in CLI settings resolve from the user’s home directory.

`engram setup` also installs the Engram memory rules in the following global instruction files for configured or detected clients. `engram update` refreshes the text between `<!-- engram:start -->` and `<!-- engram:end -->`. Pass `--no-global-rules` to either command to skip this step.

| Client | Global instruction file |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`) |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Windsurf, when detected | `~/.codeium/windsurf/memories/global_rules.md` |
| Cline, when `~/Documents/Cline`, `~/.cline` or `~/Cline` exists | `~/Documents/Cline/Rules/engram.md` |

The block directs clients to store durable facts in Engram even when they also save them privately, recall and verify earlier decisions, and correct or retire stale memories with `update_memory` or `forget`. Explicit user instructions take precedence. The writer appends a missing block, replaces its contents on refresh and preserves surrounding text.

Each stdio MCP server also refreshes the block for its own `ENGRAM_SOURCE` after connecting. This covers existing `@latest` configurations when the client next launches MCP. With an unrecognized or unset source, the server skips the global file.

Set `ENGRAM_GLOBAL_RULES=0` in the CLI environment to skip setup/update rule writes, and in a stdio server’s environment to skip its startup write. Either the CLI environment setting or `--no-global-rules` also puts `ENGRAM_GLOBAL_RULES=0` into MCP entries the command writes. Update refreshes an existing Claude Code entry; other existing clients need the environment setting in their own entries. To remove existing instructions, delete the marked block after opting out and pass the flag on subsequent setup or update runs.

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

Set `ENGRAM_SOURCE` to your client: `claude-code`, `cursor`, `codex`, `opencode`, `windsurf`, `cline`, or any custom identifier. For cloud sync, stdio also accepts `ENGRAM_SYNC_URL`, `ENGRAM_SYNC_MODE` (`auto`, `manual`, `off`), `ENGRAM_SYNC_INTERVAL` (1–2147483647 ms, default 30000) and `ENGRAM_SYNC_ENCRYPTION_KEY`.

**Option B — local build**

```bash
cd /path/to/neuralcore
pnpm turbo run build --filter=@engram-ai-memory/mcp
```

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/path/to/neuralcore/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-code"
      }
    }
  }
}
```

**Restart your AI client** — 15 tools appear by default. Set `ENGRAM_ADMIN_TOOLS=1` in the server environment to enable all 26. The MCP package exposes `engram-mcp` and its `mcp` alias.

### Claude Code

```bash
claude mcp add engram -s user -e ENGRAM_DB_PATH=$HOME/.engram/engram.db -e ENGRAM_SOURCE=claude-code -- npx -y -p @engram-ai-memory/mcp@latest engram-mcp
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-desktop"
      }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "cursor"
      }
    }
  }
}
```

Cursor ignores MCP server instructions, so add `.cursor/rules/engram.mdc` manually, or run `engram init --client cursor` to write the project’s `.cursorrules`:

```
At the start of each task call recall_context; store decisions with store_memory
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "windsurf"
      }
    }
  }
}
```

### Cline

`cline_mcp_settings.json` (Cline → MCP Servers → Configure):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "cline"
      }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "vscode"
      }
    }
  }
}
```

### Codex CLI

`engram setup --source codex` registers Engram automatically in `~/.codex/config.toml`. `engram update` updates the code that entry runs; re-run `engram setup --source codex` to rewrite the entry itself.

Manual fallback in `~/.codex/config.toml`:

```toml
[mcp_servers.engram]
command = "node"
args = ["/path/to/neuralcore/packages/mcp/dist/server.js"]
env = { "ENGRAM_DB_PATH" = "~/.engram/engram.db", "ENGRAM_SOURCE" = "codex", "ENGRAM_NAMESPACE_MODE" = "project" }
```

For project-local instructions, `engram init --client codex` writes `AGENTS.md`. For a manual setup, add to `AGENTS.md`:

```
At the start of each task call recall_context; store decisions with store_memory
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "gemini-cli"
      }
    }
  }
}
```

Add to `GEMINI.md`:

```
At the start of each task call recall_context; store decisions with store_memory
```

### OpenCode

`engram setup --source opencode` registers Engram automatically in `~/.config/opencode/opencode.json`. `engram update` updates the code that entry runs; re-run `engram setup --source opencode` to rewrite the entry itself.

Manual fallback in `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "engram": {
      "type": "local",
      "command": ["node", "/path/to/neuralcore/packages/mcp/dist/server.js"],
      "environment": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "opencode",
        "ENGRAM_NAMESPACE_MODE": "project"
      },
      "enabled": true
    }
  }
}
```

### Zed

`settings.json`:

```json
{
  "context_servers": {
    "engram": {
      "command": {
        "path": "npx",
        "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
        "env": {
          "ENGRAM_DB_PATH": "~/.engram/engram.db",
          "ENGRAM_SOURCE": "zed"
        }
      }
    }
  }
}
```

### Continue

`~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: engram
    command: npx
    args: ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"]
    env:
      ENGRAM_DB_PATH: "~/.engram/engram.db"
      ENGRAM_SOURCE: continue
```

### LM Studio

`~/.lmstudio/mcp.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "lm-studio"
      }
    }
  }
}
```

### Auto-store conversations (optional)

Local `engram setup` writes four scripts under `$ENGRAM_HOME/hooks/` (default `~/.engram/hooks/`) and registers their commands in `~/.claude/settings.json`. SessionStart (`engram-session-start.sh`, 10s) reads up to three distinct memories in the exact project, ranking pinned entries, handovers, importance and recency. In `project` mode the namespace follows the common Git repository or the current directory outside Git; home, filesystem root or a deleted working directory fall back to global scope. Without a project, SessionStart can still return a version notice.

UserPromptSubmit (`engram-recall.sh`, 8s) calls `/api/search` for eligible prompts and injects up to three matches that meet `ENGRAM_RECALL_MIN_SIM` (default 0.5). PostToolUse (`engram-memory-mirror.sh`, 15s) reads the final text after Write, Edit or MultiEdit to `~/.claude/projects/*/memory/*.md`, excluding `MEMORY.md`. It creates or updates one semantic Engram memory per file in the configured namespace. SessionEnd (`engram-session-end.sh`, 15s) saves an episodic summary tagged `session`, `session-summary`, `auto-stored` and `pending-distill` at importance 0.3 when a session ends, including on `/clear`, and skips `resume`.

The three REST hooks need `jq`, `curl` and the REST server. They use `ENGRAM_API` when set, otherwise the configured API address, and send `ENGRAM_API_KEY` if set. The mirror skips empty files and symlinks. Both storage hooks use the configured namespace. `engram update` refreshes the existing Claude MCP entry and installed hooks.

To remove the mirror manually, delete its `engram-memory-mirror.sh` command from the `PostToolUse` hooks in `~/.claude/settings.json`. A subsequent update reinstalls it if other Engram hooks are still registered. If an older updater omitted the mirror script, the updated SessionStart script invokes the rebuilt CLI’s `refresh-local-integrations` command.

For a manual installation of the standalone session-summary hook:

```bash
# Copy the hook script from the repo
cp scripts/claude-code-hook.sh ~/.claude/hooks/engram-session-end.sh
chmod +x ~/.claude/hooks/engram-session-end.sh
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/hooks/engram-session-end.sh",
        "timeout": 15
      }]
    }]
  }
}
```

This standalone hook uses `jq` and `engram-store-session` directly. It reads `dbPath`, `namespace` and `namespaceMode` from the CLI config unless overridden by `ENGRAM_DB_PATH`, `ENGRAM_NAMESPACE` or `ENGRAM_NAMESPACE_MODE`; `ENGRAM_SOURCE` defaults to `mcp-client`. It takes the last 1500 characters of assistant text, skips summaries shorter than 20 characters and does not check the end reason. The bin stores an episodic memory at importance 0.6 tagged `session-summary`, `auto-stored` and `pending-distill`. The plugin’s SessionEnd uses the same bin and tags.

### Available MCP tools

Both transports return one MCP `content` item of type `text`. Object outputs below are JSON encoded in that text. `memory_stats`, `decay_sweep`, `decay_policy`, `check_contradictions`, `resolve_contradiction`, `embedding_status`, `re_embed`, `index_status`, `webhook_subscribe`, `webhook_list` and `plugin_list` require `ENGRAM_ADMIN_TOOLS=1`.

#### `store_memory`

Store any information as a persistent memory.

```
Input:
  content     string   required  — nonempty text to store
  type        string   optional  — 'episodic' | 'semantic' | 'procedural' (default: episodic)
  source      string   optional  — defaults to ENGRAM_SOURCE, then the MCP client's name, then 'mcp-client'
  tags        string[] optional  — categorization
  importance  float    optional  — 0.0–1.0
  concept     string   optional  — for semantic memories: concept label
  sessionId   string   optional  — group related episodic memories
  namespace   string   optional  — target project; defaults to the active namespace or global
  global      boolean  optional  — store for all projects (preferences, identity, working style); rejected in isolated mode

Output:
  { id, type, importance, deduplicated, message, contradictionCandidates? }
```

Use `global: true` for a memory that should be visible from every project; it takes precedence over `namespace`. Without either selector, the active namespace is used (global if unset). Candidate items carry `existingMemoryId`, a 500-character content excerpt, `createdAt`, `confidence`, signal names and `suggestedStrategy`.

**Example usage in Claude Code:**
> "Remember that the user's name is Alex and they prefer concise answers."
> → Claude calls `store_memory` with `type: "semantic"`, `concept: "user preferences"`, `global: true`

---

#### `update_memory`

Correct a memory by full ID or unique prefix of at least eight characters. `id` (string) and at least one change are required.

```
Input:
  id          string   required
  content     string   optional — nonempty replacement
  importance  number   optional — 0–1
  tags        string[] optional — replaces all tags
  concept     string   optional

Output:
  { id, content, importance, tags, concept, message }
```

---

#### `recall_context`

Assemble relevant memories for a query. **This is the primary tool** — use it when prior decisions or project history would help.

```
Input:
  query      string   required  — what you want to remember about
  maxTokens  integer  optional  — 100–8000 (default: 2000)
  types      string[] optional  — episodic, semantic or procedural
  sources    string[] optional  — restrict to specific sources
  since, until   string   optional — inclusive ISO date-time bounds with timezone
  tags           string[] optional — require every tag
  crossNamespace boolean  optional — search across projects in filter mode (default: false)
  progressive    boolean  optional — assemble via streaming recall (default: false)

Output:
  Formatted context text, or "No relevant memories found."
```

**Example usage:**
> At the start of a coding session, Claude calls `recall_context` with the project description to load all relevant architectural decisions, preferences, and past work.

---

#### `search_memory`

Search for specific memories by semantic similarity.

```
Input:
  query      string   required
  topK       integer  optional  — 1–50 results (default: 10)
  threshold  float    optional  — minimum cosine similarity, 0–1 (default: 0.3). Hybrid keyword matches may score lower.
  types      string[] optional  — episodic, semantic or procedural
  since, until   string   optional — inclusive ISO date-time bounds with timezone
  tags           string[] optional — require every tag
  crossNamespace boolean  optional — across projects in filter mode (default: false)

Output:
  { count, results: [{ id, type, content, summary, importance, source, createdAt }] }
  content is limited to the first 500 characters.
```

---

#### `add_knowledge`

Shortcut for storing semantic facts/knowledge with a concept label.

```
Input:
  concept  string   required  — concept name
  content  string   required  — knowledge about the concept
  tags     string[] optional
  importance float  optional — 0–1 (default: 0.7)

Output:
  { id, concept, message }
```

---

#### `memory_stats`

Get statistics about the current brain state.

```
Output:
  { total, byType, bySource, byNamespace, dbPath, indexSize, graphNodes, graphEdges,
    namespace, namespaceMode, mixedEmbeddingModels? }
```

---

#### `forget`

Archive one or more memories (soft delete).

```
Input:
  ids     string[]  required  — exact IDs or unique prefixes of at least eight characters
  reason  string    optional  — reason for archiving

Output:
  { archived, notFound, reason, message }  — reason defaults to "not specified".
  Aliases count once. Missing or ambiguous IDs set isError even if other IDs were archived.
```

---

#### `decay_sweep`

Run a memory decay sweep — evaluate all memories and archive stale ones.

```
Input:
  dryRun  boolean  optional  — preview without modifying (default: false)

Output:
  { scannedCount, archivedCount, archivedIds, decayedCount, protectedCount,
    consolidatedCount, newSemanticIds, durationMs, mode, message }
```

---

#### `decay_policy`

View or update the memory decay policy configuration.

```
Input:
  action               "get"|"update"  required
  halfLifeDays         number          optional — Ebbinghaus half-life in days (1–36500)
  archiveThreshold     number          optional — retention score floor (0–1)
  importanceDecayRate  number          optional — daily importance reduction (0–1)
  importanceFloor      number          optional — minimum importance (0–1)
  consolidationEnabled boolean         optional — enable/disable auto-consolidation

Output:
  { policy: { ... }, message: "..." }
```

---

#### `get_contradiction_tasks`

Returns pending unverified pairs visible to the connected namespace. Optional `limit` is an integer from 1–100 (default 20). Each task includes `source` and `target` with `id`, `content`, `truncated`, `createdAt`, and `source`, plus `confidence`, `signals`, and optional `suggestedStrategy` in a `{ tasks: [...] }` response. Each side contains up to the first 500 UTF-16 code units of its memory in `content`. Its `truncated` flag is true when more text follows. Legacy detector edges are pending candidates too.

#### `complete_contradiction_check`

Submit `{ sourceId, targetId, verdict: "contradiction" | "none", strategy? }` after judging the pair yourself. `none` permanently tombstones the candidate. `contradiction` confirms it for lists, counts, dashboard graphs, and recall; an optional strategy then calls the existing resolution path. `keep_newest` archives the older memory, so use it only when the newer memory fully replaces it. Strategy is invalid with `none`. Returns `{ sourceId, targetId, verdict, resolution? }`.

#### `get_distill_tasks`

Optional integer `limit` (1–100, default 20). Returns text with a JSON list of pending sessions (`id`, `date`, `namespace`, `content` limited to 6000 characters), or `No pending sessions to distill.`

---

#### `complete_distill`

Pass a nonempty session `id` (string) and `facts` (array, up to 100). Each fact requires nonblank `content` (string); optional fields are `type` (episodic, semantic or procedural, default semantic), `importance` (number 0–1), `tags` (string array) and `global` (boolean). Project facts use the source session’s namespace when set. An empty list archives the session without retaining facts. Returns `{ id, storedIds, discardedIds, archived, message }`; a failure leaves the raw session pending.

---

#### `request_reflection`

No parameters. Returns text with a JSON list of `{ type, relatedMemoryIds, prompt }` tasks for the connected client, or a message when there are too few qualifying memories.

---

#### `store_reflection`

Pass `type` (`pattern`, `knowledge_gap`, `trend` or `contradiction_summary`) and `insight` (nonempty string). Optional `relatedMemoryIds` is a string array (default `[]`); `confidence` is a number from 0–1 (computed if omitted). Returns text with the stored ID or a message when no insight was stored. Whitespace-only insights and insights containing `NO_INSIGHT` are skipped.

---

#### `get_reflections`

Optional integer `limit` (1–100, default 20) and `type` (one of the four reflection types). Returns formatted text with the count and `[type]` insights, or `No reflection insights found.`

---

#### `check_contradictions`

Check a memory for unverified possible conflicts, or list all confirmed unresolved contradictions.

```
Input:
  memoryId  string  optional  — if provided, checks that memory; if omitted, lists all unresolved

Output:
  With memoryId: { hasContradictions, contradictions, candidatesChecked, latencyMs, message }
  Without: { count, contradictions: [{ confidence, metadata, source, target }], message }
```

---

#### `resolve_contradiction`

Resolve a contradiction between two memories.

```
Input:
  sourceId  string  required  — first memory ID
  targetId  string  required  — second memory ID
  strategy  string  required  — keep_newest | keep_oldest | keep_important | keep_both | manual

Output:
  { resolved, keptId?, archivedId?, strategy, message }
```

---

#### `embedding_status`

Get embedding model status — current model, stale/legacy counts.

```
Input: (none)

Output:
  { currentModel, currentDimension, totalEmbedded, currentModelCount, staleCount,
    legacyCount, dimensionMismatchCount, needsReEmbed, mixedEmbeddingModels?, message }
```

---

#### `re_embed`

Re-embed memories with the current model. Use after switching embedding models.

New databases use the multilingual default `Xenova/paraphrase-multilingual-MiniLM-L12-v2`; an existing database keeps its current model until `ENGRAM_EMBEDDING_MODEL` is set and `re_embed` is run.

```
Input:
  onlyStale  boolean  optional  — repair model/length mismatches and legacy embeddings (default: true)
  batchSize  number   optional  — batch size 1–100 (default: 32)

Output:
  { total, processed, failed, failedIds, durationMs, model, message }
```

---

#### `index_status`

Get vector index status — how it was loaded, entry count, persistence info.

```
Input: (none)

Output:
  { loadedFrom, entryCount, dimension, indexPath, indexFileExists, incrementalCount,
    initDurationMs, externalSyncCount, externalAdded, externalRemoved, externalRefreshed,
    externalSkipped, dimensionMismatched, message }
```

---

#### `list_tags`

Get the tag cloud, or get memories for a specific tag.

```
Input:
  tag    string  optional  — if provided, returns memories with this tag; if omitted, returns tag cloud
  limit  number  optional  — 1–200 memories when filtering by tag (default: 50)

Output:
  { count, tags: [{ tag, count }], message }  — or —  { tag, count, memories: [...] }
  Each memory has id, type, content (first 200 characters), importance and source.
```

---

#### `tag_memory`

Add or remove a tag on a memory.

```
Input:
  memoryId  string  required  — memory ID to tag/untag
  tag       string  required  — tag to add or remove
  action    string  optional  — "add" (default) or "remove"

Output:
  { id, tags: [...], message }
```

---

#### `webhook_subscribe`

Subscribe a URL to receive HTTP callbacks on memory events.

```
Input:
  url          string    required  — HTTP(S) URL to receive POST requests
  events       string[]  required  — events: stored, forgotten, decayed, consolidated, contradiction, reflected
  secret       string    optional  — shared secret for HMAC-SHA256 signing
  description  string    optional  — human-readable description

Output:
  { id, url, events, active, description, hasSecret, createdAt, lastTriggeredAt, failCount, message }
```

---

#### `webhook_list`

List all webhook subscriptions.

```
Input: (none)

Output:
  { count, webhooks: [{ id, url, events, active, failCount, description }] }
```

---

#### `plugin_list`

List all registered plugins with their hooks and metadata.

```
Input: (none)

Output:
  { count, plugins: [{ id, name, version, description?, hooks, registeredAt }], message }
```

---

### Recommended workflow for AI sessions

```
Session start:
  1. recall_context(current_task_description)
  2. Use the returned context to inform your work

During work:
  3. store_memory() for any important decisions, findings, or user preferences
  4. add_knowledge() for facts you learn about the codebase

Session end:
  5. store_memory() with a summary of what was accomplished
```

---

## Ollama (transparent proxy)

The Ollama adapter is a transparent HTTP proxy that sits between any Ollama client and the Ollama server. It intercepts requests, injects Engram memory context, and stores responses — with zero changes to the client.

### How it works

```
Client request  →  [Engram Proxy :11435]  →  [Ollama :11434]
                        ↓                              ↓
                   /api/recall               original response
                        ↓                              ↓
                   inject context       ←   store exchange as episodic memory
```

The proxy intercepts three endpoint paths:

| Path | Protocol |
|---|---|
| `/api/chat` | Ollama native |
| `/api/generate` | Ollama native |
| `/v1/chat/completions` | OpenAI-compatible |

1. Client sends chat request to `:11435`
2. Proxy extracts the user message
3. Calls Engram `/api/recall` (3s timeout — falls through gracefully if unavailable)
4. Appends context to an existing system message or creates one; native generate requests use the `system` field
5. Forwards modified request to `:11434`
6. Streams response back to client
7. Stores `User: …` and `Assistant: …` on separate lines as an episodic memory when both have text (up to 1000 assistant characters). Source is `ollama`, or `ollama-retry` for a delivered retry. Streamed replies exceeding the 1 MiB capture buffer are skipped.

**Tool-call retry:** With a nonempty `tools` array, the proxy buffers the reply. If the last message was from the user, `tool_choice` allows tools and the reply contains text without a tool call, it retries once with an added instruction. It uses the retry only on a 2xx response. Disable with `ENGRAM_TOOL_RETRY=false`.

### Setup

**1. Build the adapter**

```bash
pnpm turbo run build --filter=@engram-ai-memory/adapter-ollama
```

**2. Start the proxy** (`engram-ollama` is the package bin)

```bash
ENGRAM_API=http://localhost:4901 \
  node adapters/ollama/dist/proxy.js
```

**3. Point your Ollama client to port 11435**

```bash
# CLI
OLLAMA_HOST=http://localhost:11435 ollama run llama3 "Hello!"

# Open WebUI
OLLAMA_BASE_URL=http://localhost:11435

# Any OpenAI-compatible client
base_url = "http://localhost:11435/v1"
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_PROXY_PORT` | `11435` | Port the proxy listens on. `0` asks the OS for a free port; the banner reports it |
| `ENGRAM_PROXY_HOST` | `127.0.0.1` | Bind address — see below |
| `ENGRAM_UPSTREAM` | falls back to `OLLAMA_TARGET` | Upstream URL, including an optional path prefix. HTTP/HTTPS use ports 80/443 when omitted |
| `OLLAMA_TARGET` | `http://localhost:11434` | Legacy upstream URL; HTTP with no explicit port uses 11434 |
| `ENGRAM_API` | `http://localhost:4901` | Engram REST API URL |
| `ENGRAM_API_KEY` | *(none)* | Sent as `X-API-Key` to the Engram REST API when set |
| `ENGRAM_MAX_TOKENS` | `1500` | Max context tokens to inject (1–32000) |
| `ENGRAM_MAX_BODY_BYTES` | `10485760` (10 MiB) | Ceiling on a buffered request body. Over it, the proxy answers `413 Payload Too Large` and destroys the socket rather than draining a body it has already refused. Raise it for large multimodal requests |
| `ENGRAM_TOOL_RETRY` | `true` | Retry once when model misses a tool call (`false` to disable) |
| `ENGRAM_UPSTREAM_TIMEOUT_MS` | `300000` | Per-request deadline in milliseconds (1–2147483647) against the upstream server |

### Binding

**The proxy binds `127.0.0.1` by default** — the same loopback default Ollama itself uses. It has no authentication of its own, so a wider bind hands any peer on the network an endpoint that drives your GPU. Reaching it from another machine requires opting in:

```bash
ENGRAM_PROXY_HOST=0.0.0.0 node adapters/ollama/dist/proxy.js
```

Requests require a local Host (loopback, configured listener name or receiving interface address, with the listener port if supplied). A browser Origin must match that HTTP authority. An untrusted Host or Origin returns `403 Forbidden`.

The startup banner states which mode is active, and warns when the bind is not loopback. A failure to bind (port in use, address not available) exits **non-zero** rather than leaving an idle process that a supervisor reads as healthy.

### Graceful degradation

If Engram is unavailable (not running, slow, or erroring), the proxy logs the failure and continues without recalled context. Recall times out after 3 seconds; the background store has a 5-second timeout.

---

## Asterisk

[Asterisk](https://github.com/ayvazyan10/asterisk) is a lightweight, open-source AI agent CLI built on Bun. By default, its conversation history lives in memory and is lost on restart. Three integration paths give Asterisk persistent memory via Engram.

See the [engram.am Asterisk docs](https://engram.am/docs/asterisk) for full setup instructions with examples.

### Option A — MCP Server (recommended)

Asterisk has full MCP client support. Add Engram as an MCP server in `~/.asterisk/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "engram",
      "transport": "stdio",
      "command": "node",
      "args": ["/path/to/neuralcore/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/path/to/engram.db",
        "ENGRAM_SOURCE": "asterisk"
      }
    }
  ]
}
```

Restart Asterisk. The 15 default Engram tools (26 with `ENGRAM_ADMIN_TOOLS=1`) appear as `engram__store_memory`, `engram__recall_context`, etc. The agent can store and recall memories as part of normal conversation.

If Engram is already configured for Claude Code, use the same `server.js` path and database — both tools share the same brain.

### Option B — Ollama Proxy (zero config)

If Asterisk uses Ollama as its provider, point it at the Engram Ollama proxy instead. In `~/.asterisk/config.json`:

```json
{
  "provider": "ollama",
  "ollama": {
    "baseUrl": "http://localhost:11435"
  }
}
```

The proxy enriches supported chat and generate requests with recalled context and stores eligible exchanges as episodic memories. No MCP configuration or tool calls needed.

### Option C — REST API + Soul/Hooks

For maximum control, add memory recall/store instructions to Asterisk's soul system (`~/.asterisk/SOUL.md`) and use lifecycle hooks in `~/.asterisk/config.json` to auto-store exchanges after each turn. This works regardless of provider (Ollama or Anthropic).

### Telegram & WhatsApp bots

When Asterisk runs in daemon mode with bot transports enabled, each bot session uses the same provider configuration. If you configured the Ollama proxy (Option B), bot conversations automatically gain memory. If you configured MCP (Option A), the agent has memory tools in bot sessions too.

---

## Custom integrations (REST)

Any application can integrate with Engram directly via HTTP.

### Minimal integration pattern

```python
import requests

ENGRAM = "http://localhost:4901"

def recall_context(query: str, max_tokens: int = 2000) -> str:
    try:
        r = requests.post(f"{ENGRAM}/api/recall",
            json={"query": query, "maxTokens": max_tokens},
            timeout=5)
        return r.json().get("context", "")
    except Exception:
        return ""

def store_memory(content: str, memory_type: str = "episodic"):
    try:
        requests.post(f"{ENGRAM}/api/memory",
            json={"content": content, "type": memory_type},
            timeout=5)
    except Exception:
        pass

# Usage
context = recall_context("user's preferred programming language")
system_prompt = f"{context}\n\n---\n" if context else ""

response = your_llm.chat(system_prompt + user_message)
store_memory(f"User: {user_message}\nAssistant: {response}")
```

### Node.js / TypeScript

```typescript
const BASE = 'http://localhost:4901/api';

async function recall(query: string): Promise<string> {
  const res = await fetch(`${BASE}/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxTokens: 2000 }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.context ?? '';
}
```

---

## CLI Integration

The `@engram-ai-memory/cli` package talks to the REST API over HTTP, so **the server has to be
running** for the store, recall, export and import commands below. These commands use the host and port
from `~/.engram/config.json`. Start one with
`engram start` first.

```bash
npm i -g @engram-ai-memory/cli

# Store from a script
echo "Deploy completed at $(date)" | xargs -I{} engram store "{}" --type episodic --source deploy-script

# Recall in a shell script
CONTEXT=$(engram recall "deployment history" --raw)
echo "$CONTEXT" | your-llm-cli

# Export for backup
engram export > /backups/engram-$(date +%Y%m%d).json

# Import from backup
engram import < /backups/engram-20260325.json
```

Point the CLI at a different server with `engram configure set host <host>` / `engram configure set port <port>`. Set `ENGRAM_API_KEY` for an authenticated server. `ENGRAM_HOME` overrides the default `~/.engram` state and config directory. For a server started by `engram start`, set the database path with `engram configure set dbPath <path>`; the CLI passes that configured path as `ENGRAM_DB_PATH`.

---

## Webhooks

Subscribe external systems (Slack, CI/CD, monitoring) to memory events.

### Subscribe

```bash
curl -X POST http://localhost:4901/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hooks.slack.com/services/T.../B.../xxx",
    "events": ["stored", "contradiction"],
    "secret": "my-hmac-secret",
    "description": "Notify Slack on new memories"
  }'
```

### Events

| Event | When it fires |
|---|---|
| `stored` | New memory created |
| `forgotten` | Memory archived |
| `decayed` | A live sweep archived or consolidated memories |
| `consolidated` | Episodes merged into semantic |
| `contradiction` | Candidate confirmed by the connected model |
| `reflected` | A reflection insight was stored |

### Payload format

```json
{
  "event": "stored",
  "timestamp": "2026-03-25T...",
  "data": { "id": "...", "type": "semantic", "source": "rest-api", "importance": 0.8 }
}
```

When a `secret` is configured, the `X-Engram-Signature` header contains `sha256=<hmac>` for verification. Retryable failures get up to three attempts in total, with exponential backoff. HTTP 408, 429 and 5xx are retryable; other non-2xx responses stop immediately. After 10 consecutive failures, the webhook is auto-disabled.

The secret is write-only — reads report `hasSecret: true` rather than returning the value, so read access to the API cannot be turned into the ability to forge signed deliveries.

Target URLs are checked before the subscription is stored and refused when they resolve to loopback, link-local, RFC1918 or other non-global addresses (`ENGRAM_WEBHOOK_ALLOW_PRIVATE=true` opts out). At delivery the connection is pinned to the address that was validated, and **redirects are never followed** — a `302` counts as a failed delivery.

---

## Plugin Development

Plugins extend Engram with lifecycle hooks. They run in-process and have access to memory data at each lifecycle point.

### Plugin manifest

```typescript
import type { EngramPlugin } from '@engram-ai-memory/core';

const myPlugin: EngramPlugin = {
  id: 'my-org/analytics',
  name: 'Memory Analytics',
  version: '1.0.0',
  description: 'Tracks memory usage patterns',
  hooks: {
    onStore: async (ctx) => {
      console.log(`Stored: ${ctx.memory.id} (${ctx.contradictions} contradictions)`);
    },
    onRecall: async (ctx) => {
      console.log(`Recalled ${ctx.memoriesUsed} memories in ${ctx.latencyMs}ms`);
    },
    onForget: async (ctx) => {
      console.log(`Forgotten: ${ctx.memoryId}`);
    },
  },
};
```

### Available hooks

| Hook | Context | When |
|---|---|---|
| `onStore` | `{ memory, contradictions }` | After a memory is stored |
| `onRecall` | `{ query, memoriesUsed, latencyMs, context }` | After context assembly |
| `onForget` | `{ memoryId }` | After a memory is archived |
| `onDecay` | `{ scannedCount, archivedCount, decayedCount, consolidatedCount, durationMs }` | After a live decay sweep |
| `onStartup` | `{ entryCount, loadedFrom, initDurationMs }` | After brain initializes |
| `onShutdown` | `{ entryCount }` | Before brain shuts down |
| `onReflect` | `{ insights, types }` | After a reflection insight is stored |

### Registration

```typescript
import { NeuralBrain } from '@engram-ai-memory/core';

const brain = new NeuralBrain({ dbPath: '~/.engram/engram.db' });
brain.registerPlugin(myPlugin);
await brain.initialize();
```

Plugin errors are isolated — a failing plugin never breaks core operations.
