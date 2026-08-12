# @engram-ai-memory/mcp

MCP Server — connects [Engram](https://github.com/ayvazyan10/engram) brain to any AI client (Claude Code, Cursor, Windsurf, Cline, and any MCP-compatible client). 21 tools for memory management, search, recall, decay, contradictions, tags, webhooks, reflection, and more.

## Install

### npm (manual)

```bash
npm install -g @engram-ai-memory/mcp
```

### Smithery (1-click — recommended for Claude Desktop)

[![Install on Smithery](https://smithery.ai/badge/ayvazyan10/engram)](https://smithery.ai/skills/ayvazyan10/engram)

[smithery.ai/skills/ayvazyan10/engram](https://smithery.ai/skills/ayvazyan10/engram) — installs and configures automatically.

### Desktop Extension (.mcpb)

Download `engram-mcp.mcpb` from [GitHub Releases](https://github.com/ayvazyan10/engram/releases/latest) and open in Claude Desktop.

## Setup

Add to `~/.mcp.json` (global) or `.mcp.json` (per-project):

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
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database path |
| `ENGRAM_NAMESPACE_MODE` | `none` | `none`, `filter`, or `isolated` |
| `ENGRAM_NAMESPACE` | — | Namespace used by `filter`/`isolated` modes |
| `ENGRAM_SOURCE` | `mcp-client` | AI client identifier (e.g. `claude-code`, `cursor`, `windsurf`) |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [MCP Tools Reference](https://github.com/ayvazyan10/engram/blob/master/docs/INTEGRATIONS.md)
- [Website](https://engram.am)

## License

MIT
