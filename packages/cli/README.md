# @engram-ai-memory/cli

Terminal tool for [Engram](https://github.com/ayvazyan10/engram) — install, manage, and interact with AI memories from the command line.

## Install

```bash
npm install -g @engram-ai-memory/cli
```

## Setup (one command)

```bash
# Clone, build, configure, set up Claude Code MCP
engram setup

# Start the server (API + 3D dashboard on :4901)
engram start

# Check everything is healthy
engram doctor
```

## Server Management

```bash
engram setup               # First-time setup wizard
engram start               # Start server (background)
engram start --foreground  # Start in foreground
engram stop                # Stop the server
engram status              # Server status + memory count
engram doctor              # Health checks (Node, pnpm, DB, MCP, API)
engram configure           # View config
engram configure set port 5000  # Change a setting
```

## Memory Commands

```bash
# Store
engram store "User prefers TypeScript" --type semantic --importance 0.8

# Search
engram search "TypeScript" --top 5

# Recall (pipeable)
engram recall "what languages does the user prefer?" --raw

# Stats
engram stats

# Forget
engram forget a1b2c3d4-...

# Export / Import
engram export > backup.json
engram import < backup.json
```

## Configuration

Config file: `~/.engram/config.json`

| Key | Default | Description |
|---|---|---|
| `dbPath` | `~/.engram/engram.db` | SQLite database path |
| `port` | `4901` | API server port |
| `host` | `127.0.0.1` | Bind address |
| `namespace` | `null` | Memory namespace |
| `embeddingModel` | `Xenova/all-MiniLM-L6-v2` | Embedding model |
| `indexPath` | `~/.engram/engram.db.index` | Vector index path |
| `repoPath` | `~/.engram/repo` | Cloned repo path |

## Environment Variables

| Variable | Description |
|---|---|
| `ENGRAM_DB_PATH` | Override database path |
| `ENGRAM_INDEX_PATH` | Override index path |
| `ENGRAM_HOME` | Override state directory (default: `~/.engram`) |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://github.com/ayvazyan10/engram/tree/master/docs)
- [Website](https://engram.am)

## License

MIT
