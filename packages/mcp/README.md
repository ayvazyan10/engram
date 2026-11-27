# @engram-ai-memory/mcp

MCP Server — connects [Engram](https://github.com/ayvazyan10/engram) brain to any AI client (Claude Code, Cursor, Windsurf, Cline, and any MCP-compatible client). 15 tools are visible by default; 11 admin tools are shown with `ENGRAM_ADMIN_TOOLS=1`. Tools cover memory management, search, recall, decay, contradictions, tags, webhooks, reflection, distillation, and more.

## Install

### npm (manual)

```bash
npm install -g @engram-ai-memory/mcp
```

The stdio server is `engram-mcp` (also available as `mcp`). The Claude Code plugin uses `engram-session-start` for recall, `engram-store-session` for summaries, and `engram-store-memory-file` to mirror a project memory file from its path. All three use the local database directly.

### Smithery (1-click — recommended for Claude Desktop)

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

[smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram) — installs and configures automatically.

### Desktop Extension (.mcpb)

Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest) and open in Claude Desktop.

## Setup

For stdio, add the block below to the config file your client reads. For Streamable HTTP, connect to the running Engram API server at `http://localhost:4901/mcp`.

| Client | Config file |
|---|---|
| Claude Code (user scope) | `~/.claude.json` |
| Claude Code (project scope) | `.mcp.json` in the project directory |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

`engram setup --source cursor` (or `--source claude-code` or `--source windsurf`) writes the user-level entry. `--source codex` writes `~/.codex/config.toml` and `--source opencode` writes `~/.config/opencode/opencode.json` in their native formats.

After connecting, the stdio server refreshes the global memory rules for the client named by `ENGRAM_SOURCE`. Set `ENGRAM_GLOBAL_RULES=0` in the server environment to opt out. CLI setup also installs a marked block in supported clients' global instruction files. `engram update` refreshes it. Both commands accept `--no-global-rules`. Local CLI setup for Claude Code includes a PostToolUse hook that mirrors project memory Markdown files (excluding `MEMORY.md`) and a SessionEnd hook that captures `/clear` and skips `resume`. The plugin also mirrors memory files and captures session ends. See [CLI integration details](https://github.com/ayvazyan10/engram/blob/master/docs/INTEGRATIONS.md#setup).

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

Set `ENGRAM_SOURCE` to identify your AI client, for example `claude-code`, `codex`, `opencode`, `cursor`, `windsurf` or `cline`.

Restart your AI client. 15 tools appear by default; 11 admin tools are shown with `ENGRAM_ADMIN_TOOLS=1`.

## Tools

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `update_memory`, `forget` |
| **Stats** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `get_contradiction_tasks`, `complete_contradiction_check`, `check_contradictions`, `resolve_contradiction` |
| **Tags** | `list_tags`, `tag_memory` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |
| **Reflection** | `request_reflection`, `store_reflection`, `get_reflections` |
| **Distillation** | `get_distill_tasks`, `complete_distill` |

## Recommended Workflow

```
When earlier decisions matter → recall_context({ query: taskDescription })
When a durable fact emerges   → store_memory({ content: fact, type: "semantic" })
When a stored fact changes    → update_memory({ id: memoryId, content: correctedFact })
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path. A blank value counts as unset — **not** as the current directory, where a desktop host would put a database nobody can find |
| `ENGRAM_NAMESPACE_MODE` | `project` | Scope to the main git root or current directory. Outside git, home and filesystem roots use global scope, as does a deleted working directory. Also accepts `none`, `filter`, `isolated` |
| `ENGRAM_NAMESPACE` | — | Overrides project detection, selects a namespace in `filter`, and is required in `isolated` |
| `ENGRAM_SOURCE` | reported MCP client name, then `mcp-client` | Default source for tool calls |
| `ENGRAM_EMBEDDING_MODEL` | automatic | New stores use `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. An existing store keeps its model unless overridden. Run `re_embed` to convert stored vectors |
| `ENGRAM_HYBRID_SEARCH` | off | Set to `1` or `true` to include BM25 keyword matches in search and recall |
| `ENGRAM_ADMIN_TOOLS` | off | Set to `1` to expose admin tools |
| `ENGRAM_GLOBAL_RULES` | enabled | Set to `0` to skip global instruction updates |
| `ENGRAM_SYNC_URL` | — | PostgreSQL connection string for multi-device sync. Unset = no sync engine is constructed |
| `ENGRAM_SYNC_MODE` | `auto` | `auto`, `manual`, or `off` |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval, in milliseconds |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | — | Passphrase for end-to-end encryption of synced rows |

Sync mode, interval and passphrase are checked at startup. An invalid mode or interval, or a nonempty passphrase containing only whitespace, stops the server. See [Cloud Sync](https://github.com/ayvazyan10/engram/blob/master/docs/CLOUD-SYNC.md).

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [MCP Tools Reference](https://github.com/ayvazyan10/engram/blob/master/docs/INTEGRATIONS.md)
- [Website](https://engram.am)

## License

MIT
