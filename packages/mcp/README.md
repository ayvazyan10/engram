# @engram-ai-memory/mcp

MCP Server — connects [Engram](https://github.com/ayvazyan10/engram) brain to any AI client (Claude Code, Cursor, Windsurf, Cline, and any MCP-compatible client). 21 tools for memory management, search, recall, decay, contradictions, tags, webhooks, reflection, and more.

## Install

### npm (manual)

```bash
npm install -g @engram-ai-memory/mcp
```

Installs two binaries: `engram-mcp` (the stdio server) and
`engram-store-session` (writes a session summary, used by the Claude Code
session-end hook).

### Smithery (1-click — recommended for Claude Desktop)

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

[smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram) — installs and configures automatically.

### Desktop Extension (.mcpb)

Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest) and open in Claude Desktop.

## Setup

Add the block below to the config file your client reads — `~/.mcp.json` is not
one of them:

| Client | Config file |
|---|---|
| Claude Code (user scope) | `~/.claude.json` |
| Claude Code (project scope) | `.mcp.json` in the project directory |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

`engram setup --source <claude-code\|cursor\|windsurf>` writes the right one for you.

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@engram-ai-memory/mcp@latest"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-code"
      }
    }
  }
}
```

Set `ENGRAM_SOURCE` to your AI client: `claude-code`, `cursor`, `windsurf`, `cline`.

Restart your AI client. 21 tools appear automatically.

## Tools

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `forget` |
| **Stats** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `check_contradictions`, `resolve_contradiction` |
| **Tags** | `list_tags`, `tag_memory` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |
| **Reflection** | `request_reflection`, `store_reflection`, `get_reflections` |

## Recommended Workflow

```
Session start  → recall_context(task description)
During work    → store_memory(decisions, findings)
End of session → store_memory(session summary)
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path. A blank value counts as unset — **not** as the current directory, where a desktop host would put a database nobody can find |
| `ENGRAM_NAMESPACE_MODE` | `none` (`filter` when `ENGRAM_NAMESPACE` is set) | `none`, `filter`, or `isolated` |
| `ENGRAM_NAMESPACE` | — | Namespace used by `filter`/`isolated` modes |
| `ENGRAM_SOURCE` | `mcp-client` | AI client identifier (e.g. `claude-code`, `cursor`, `windsurf`) |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model (must match the API server when sharing a database) |
| `ENGRAM_SYNC_URL` | — | PostgreSQL connection string for multi-device sync. Unset = no sync engine is constructed |
| `ENGRAM_SYNC_MODE` | `auto` | `auto`, `manual`, or `off` |
| `ENGRAM_SYNC_INTERVAL` | — | Background sync interval, in milliseconds |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | — | Passphrase for end-to-end encryption of synced rows |

The four sync variables are validated at startup: a bad mode or interval stops
the server with a message naming the variable, rather than becoming a timer that
never stops. See [Cloud Sync](https://github.com/ayvazyan10/engram/blob/master/docs/CLOUD-SYNC.md).

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [MCP Tools Reference](https://github.com/ayvazyan10/engram/blob/master/docs/INTEGRATIONS.md)
- [Website](https://engram.am)

## License

MIT
