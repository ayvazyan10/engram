# @engram-ai-memory/cli

Terminal tool for [Engram](https://github.com/ayvazyan10/engram) — store, search, recall, and manage AI memories from the command line. Uses the brain engine directly, no server required.

## Install

```bash
npm install -g @engram-ai-memory/cli
```

## Usage

```bash
# Store a memory
engram store "User prefers TypeScript" --type semantic --importance 0.8

# Semantic search
engram search "TypeScript" --top 5

# Recall context (pipeable to LLMs)
engram recall "what languages does the user prefer?" --raw

# Full stats
engram stats

# Export all memories
engram export > backup.json

# Import from backup
engram import < backup.json

# Archive a memory
engram forget a1b2c3d4-...
```

## Commands

| Command | Description |
|---|---|
| `engram store <content>` | Store with `--type`, `--importance`, `--tags`, `--concept`, `--namespace` |
| `engram search <query>` | Vector search with `--top`, `--threshold`, `--type`, `--json` |
| `engram recall <query>` | Context assembly with `--max-tokens`, `--raw`, `--json` |
| `engram stats` | Memory counts, embedding status, index info. `--json` for machine output |
| `engram forget <id>` | Archive (soft-delete) a memory |
| `engram export` | Export as JSON or NDJSON (`--format ndjson`), filter with `--type` |
| `engram import` | Import from stdin. Supports `--dry-run` |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database path |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` | Vector index cache path |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://github.com/ayvazyan10/engram/tree/master/docs)
- [Website](https://engram.am)

## License

MIT
