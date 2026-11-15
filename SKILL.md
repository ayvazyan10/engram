---
name: engram
description: "Shared long-term memory across AI tools. Stores durable facts in local SQLite and recalls relevant context with semantic search and a knowledge graph. Explicit user instructions (CLAUDE.md, AGENTS.md, rules) win on conflict. Embeddings run locally; no API keys required."
license: MIT
compatibility: "Requires Node.js 22+ and npm. Works on macOS, Linux, and Windows."
metadata:
  author: ayvazyan10
  version: "0.12.2"
  homepage: https://engram.am
---

# Engram AI Memory

Engram is the shared long-term memory for every AI tool this user works with — the same memories in Claude Code, Codex, Cursor and others. Store durable facts here so every tool can use them. When a recalled memory conflicts with the user's explicit instructions (CLAUDE.md, AGENTS.md, rules), the instructions win.

## Tools (15 visible by default, 26 with admin tools enabled)

| Category | Tools |
|---|---|
| **Memory** | `store_memory`, `search_memory`, `recall_context`, `add_knowledge`, `update_memory`, `forget` |
| **Contradictions** | `get_contradiction_tasks`, `complete_contradiction_check` |
| **Tags** | `list_tags`, `tag_memory` |
| **Reflection** | `request_reflection`, `store_reflection`, `get_reflections` |
| **Sessions** | `get_distill_tasks`, `complete_distill` |

The following 11 admin tools are hidden unless `ENGRAM_ADMIN_TOOLS=1`:

| Category | Admin tools |
|---|---|
| **Stats** | `memory_stats`, `index_status`, `embedding_status` |
| **Lifecycle** | `decay_sweep`, `decay_policy`, `re_embed` |
| **Contradictions** | `check_contradictions`, `resolve_contradiction` |
| **Webhooks** | `webhook_subscribe`, `webhook_list` |
| **Plugins** | `plugin_list` |

## Usage

Recall when prior decisions or project history would help. Recalled memories can be stale; verify before relying on them. Store durable decisions and their reasons, conventions, fixes, and user preferences, following the user's wishes about what to store. Routine chatter does not need storing.

Memories are scoped to the current project by default. Use `global: true` only for facts about the user that hold in every project. Correct stale facts with `update_memory` by ID, or retire them with `forget`.

## Key tools

- **`recall_context`** — assembles relevant memories for a broad query and returns only formatted context text.
- **`store_memory`** — saves episodic events, semantic facts (`type="semantic"`, `concept="..."`) or procedural patterns (`type="procedural"`).
- **`search_memory`** — finds specific facts with semantic similarity search; memory content is limited to 500 characters per result.
- **`get_contradiction_tasks`** — returns possible conflicts with each memory's content limited to 500 characters.
- **`complete_contradiction_check`** — records a judgment and an optional resolution strategy. `keep_newest` archives the older memory and applies when the newer fact fully replaces it.
- **`get_distill_tasks` / `complete_distill`** — retrieves pending sessions and stores extracted facts before archiving each raw session.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path |
| `ENGRAM_NAMESPACE_MODE` | `project` | Uses the git root, or the current directory outside git, as the project scope; also supports `none`, `filter`, and `isolated` |
| `ENGRAM_NAMESPACE` | *(project scope)* | Leave unset; the server scopes to the current project. Isolated mode requires an explicit namespace. |
| `ENGRAM_ADMIN_TOOLS` | *(unset)* | Admin tools are hidden unless the value is exactly `1` |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Local ONNX embedding model (multilingual; an existing database keeps its model until re-embedded)  |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://engram.am/docs)
- [Privacy Policy](https://engram.am/privacy)
