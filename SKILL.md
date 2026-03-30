# Engram AI Memory

Universal AI memory backend — give any AI model persistent, structured memory that survives sessions, systems, and restarts.

## What it does

Engram stores episodic, semantic, and procedural memories in a local SQLite database and retrieves the most relevant ones using semantic vector search + knowledge graph traversal. It exposes **18 MCP tools** covering every aspect of memory management.

All embeddings run 100% locally via ONNX Runtime — no API keys, no data leaves your machine.

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

## Key capabilities

- **`recall_context`** — assembles the most relevant memories for any query and returns them as formatted context ready to inject into AI prompts. This is the primary tool — call it at the start of every session.
- **`store_memory`** — saves episodic events, semantic facts, or procedural patterns with optional tags, importance, and session grouping.
- **`check_contradictions`** — automatically detects conflicting memories using semantic negation and concept conflict signals.
- **`decay_sweep`** — runs Ebbinghaus forgetting curve decay to archive stale memories and consolidate old episodes into semantic facts.

## Configuration

| Option | Description | Default |
|---|---|---|
| `dbPath` | Path to the SQLite database file | `~/.engram/engram.db` |
| `namespace` | Isolate memories per project or context | *(global)* |
| `embeddingModel` | Xenova ONNX embedding model | `Xenova/all-MiniLM-L6-v2` |

## Recommended workflow

```
Session start  →  recall_context("current task description")
During session →  store_memory("decision or finding", type="episodic")
Session end    →  store_memory("session summary", type="episodic", importance=0.8)
```

## Requirements

- Node.js ≥ 22
- npm (for first-run auto-install)
- ~25 MB disk for the embedding model (downloaded once on first use)

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://engram.am/docs)
- [Privacy Policy](https://engram.am/privacy)
- [npm: @engram-ai-memory/mcp](https://npmjs.com/package/@engram-ai-memory/mcp)
