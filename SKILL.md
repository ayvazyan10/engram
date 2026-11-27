---
name: engram
description: "Shared long-term memory across AI tools. Stores durable facts in local SQLite and recalls relevant context with semantic search and a knowledge graph. Explicit user instructions (CLAUDE.md, AGENTS.md, rules) win on conflict. Embeddings run locally; no API keys required."
license: MIT
compatibility: "Requires Node.js 22+ and npm. Works on macOS, Linux, and Windows."
metadata:
  author: ayvazyan10
  version: "0.15.1"
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

Recall when prior decisions or project history would help. Recalled memories can be stale; verify before relying on them. Store durable decisions and their reasons, conventions, fixes, and user preferences, following the user's wishes about what to store. Routine chatter does not need storing. If you also save a durable fact in a client’s own memory, store it in Engram so other clients can recall it.

In the default `project` mode, omitting `namespace` stores in the current project when one is available. On an unscoped client, set `namespace` for a project fact. Use `global: true` only for facts about the user that hold in every project. Isolated mode rejects global writes. Correct stale facts with `update_memory` using `id` and a replacement field, or retire them with `forget({ ids: [...] })`. Both tools accept full IDs or unique prefixes of at least eight characters.

## Key tools

- **`recall_context`** — assembles relevant memories for a broad query and returns only formatted context text.
- **`store_memory`** — saves episodic events, semantic facts (`type="semantic"`, `concept="..."`) or procedural patterns (`type="procedural"`).
- **`search_memory`** — finds specific facts by similarity, with hybrid keyword search when `ENGRAM_HYBRID_SEARCH=1`. Both search and recall accept `since`, `until`, `tags` and `crossNamespace`. Search content is limited to 500 characters per result.
- **`get_contradiction_tasks`** — returns possible conflicts with each memory's content limited to 500 characters.
- **`complete_contradiction_check`** — records a judgment and an optional resolution strategy. `keep_newest` archives the older memory and applies when the newer fact fully replaces it.
- **`get_distill_tasks` / `complete_distill`** — retrieves pending sessions and stores extracted facts before archiving each raw session.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path |
| `ENGRAM_NAMESPACE_MODE` | `project` | Uses the main git root across worktrees, or the current directory outside git. Home and filesystem roots outside git and an unavailable working directory use global scope. Also supports `none`, `filter` and `isolated` |
| `ENGRAM_NAMESPACE` | *(unset)* | Overrides project discovery, selects a scope in `filter` mode and is required in `isolated` mode |
| `ENGRAM_ADMIN_TOOLS` | *(unset)* | Admin tools are hidden unless the value is exactly `1` |
| `ENGRAM_EMBEDDING_MODEL` | automatic | New stores use `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. Existing stores use their stored model unless explicitly overridden |
| `ENGRAM_GLOBAL_RULES` | enabled | Set to `0` to skip refreshing supported clients’ global memory instructions |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://engram.am/docs)
- [Privacy Policy](https://engram.am/privacy)
