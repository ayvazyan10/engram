# @engram-ai-memory/mcp

MCP Server — connects [Engram](https://github.com/ayvazyan10/engram) brain to Claude Code and any MCP-compatible client. 18 tools for memory management, search, recall, decay, contradictions, tags, webhooks, and more.

## Install

```bash
npm install -g @engram-ai-memory/mcp
```

## Claude Code Setup

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/path/to/node_modules/@engram-ai-memory/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/path/to/engram.db"
      }
    }
  }
}
```

Restart Claude Code. 18 tools appear automatically.

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
| `ENGRAM_NAMESPACE` | — | Memory namespace |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [MCP Tools Reference](https://github.com/ayvazyan10/engram/blob/master/docs/INTEGRATIONS.md)
- [Website](https://engram.am)

## License

MIT
