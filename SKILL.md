---
name: engram
description: Persistent AI memory backend with semantic search and knowledge graph. Stores episodic, semantic, and procedural memories in a local SQLite database and retrieves the most relevant ones using vector similarity + graph traversal. Use when you need to remember information across sessions, recall past decisions, store facts about a project, detect contradictions between beliefs, or give any AI model a persistent, growing brain. All embeddings run locally — no API keys required.
license: MIT
compatibility: Requires Node.js >= 22 and npm. Embedding model (~25 MB) downloads automatically on first use. Works on macOS, Linux, and Windows.
metadata:
  author: ayvazyan10
  version: "0.1.3"
  homepage: https://engram.am
  npm: "@engram-ai-memory/mcp"
---

# Engram AI Memory

Universal AI memory backend — give any AI model persistent, structured memory that survives sessions, systems, and restarts.

## Tools (18 total)

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `forget` |
| **Stats** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `check_contradictions`, `resolve_contradiction` |
| **Tags** | `list_tags`, `tag_memory` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |

## Recommended workflow

```
Session start  →  recall_context("current task or question")
During session →  store_memory("decision or finding", type="episodic")
Session end    →  store_memory("session summary", importance=0.8)
```

## Key tools

- **`recall_context`** — primary recall tool. Assembles the most relevant memories for a query and returns formatted context ready to inject into prompts. Call at the start of every session.
- **`store_memory`** — saves episodic events, semantic facts (`type="semantic"`, `concept="..."`) or procedural patterns (`type="procedural"`).
- **`search_memory`** — semantic similarity search with optional type filter and threshold.
- **`check_contradictions`** — detects memories that conflict with a given memory ID.
- **`resolve_contradiction`** — resolves conflicts via strategy: `keep_newest`, `keep_oldest`, `keep_important`, `keep_both`, or `manual`.
- **`decay_sweep`** — runs Ebbinghaus forgetting curve decay; archives stale memories and consolidates old episodes into facts.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path |
| `ENGRAM_NAMESPACE` | *(global)* | Isolate memories per project |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Local ONNX embedding model |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://engram.am/docs)
- [Privacy Policy](https://engram.am/privacy)
