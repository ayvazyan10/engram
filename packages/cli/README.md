# @engram-ai-memory/cli

Terminal tool for [Engram](https://github.com/ayvazyan10/engram) — install, manage, and interact with AI memories from the command line.

## Install

```bash
npm install -g @engram-ai-memory/cli
```

## Setup (one command)

```bash
# Clone, build, configure, wire up MCP for your AI client
engram setup

# Start the server (API + 3D dashboard on :4901)
engram start

# Check everything is healthy
engram doctor
```

`engram setup --source <client>` picks both the identifier stamped on stored
memories **and** the config file that gets written:

| `--source` | File written |
|---|---|
| `claude-code` | `~/.claude.json` (user scope — loads in every session) |
| `cursor` | `~/.cursor/mcp.json` |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` |

Any other value — including the default — registers nothing for `--source`:
setup prints the JSON block for you to paste into your own client's config and
reports the step as skipped. It never writes `~/.mcp.json`; no MCP client reads
that path.

Separately, if `~/.claude` exists, setup also registers Engram at user scope in
`~/.claude.json` and installs the recall and session-end hooks — so plain
`engram setup` wires up Claude Code on its own. Skip that with
`--no-claude-hooks`.

## Server Management

```bash
engram setup                 # First-time setup wizard
engram setup --npx           # Fast setup — npx-based MCP config, no clone/build
engram init                  # Write memory instructions into CLAUDE.md, .cursorrules, …
engram init --client cursor  # Just one client (claude, cursor, windsurf, cline, all)
engram update                # Pull, rebuild, re-link the CLI, restart the server
engram update --force        # Same, but set local repo changes aside first
engram update --no-restart   # Update without restarting the server
engram start                 # Start server (detached)
engram start --foreground    # Run it in this terminal instead
engram stop                  # Stop the server — waits for it to actually exit
engram status                # Server status + memory count
engram doctor                # Health checks (Node, pnpm, build, DB, MCP, API)
engram configure show        # Print the current config
engram configure set port 5000  # Change one setting
engram configure path        # Print the config file path
```

`stop`, `doctor` and `update` report failure through the exit code, so they can
be used in scripts:

- **`stop`** waits for the process to exit and returns 1 if it may still be
  running. It refuses to signal a PID that does not own the configured port —
  after a reboot a stale pidfile can point at an unrelated process of yours.
- **`doctor`** returns 1 when any check fails.
- **`update`** returns 1 when the repository moved but the build, the global CLI
  refresh or the restart did not complete. It keys on a build stamp as well as
  git state, so the first run after upgrading always rebuilds rather than
  reporting "already up to date" over a stale `dist/`.

`start --foreground` writes a pidfile too, so `status` and `stop` can see a
server running in another terminal.

## Memory Commands

These talk to the running server over HTTP — start it with `engram start` first.

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

`import` creates **new** records — ids and timestamps are not preserved, so
re-running it duplicates. Use `--dry-run` to preview.

## Cloud Sync

Multi-device sync against your own PostgreSQL database. See
[docs/CLOUD-SYNC.md](https://github.com/ayvazyan10/engram/blob/master/docs/CLOUD-SYNC.md).

```bash
engram cloud connect <postgres-url>  # Configure sync
engram cloud status                  # Sync state, last sync, pending pushes
engram cloud sync                    # Run one push + pull now
engram cloud devices                 # This device's sync identity
engram cloud encrypt                 # Turn on end-to-end encryption
engram cloud disconnect              # Stop syncing; the local database is untouched
```

`cloud encrypt` takes the passphrase from the argument, then
`ENGRAM_SYNC_ENCRYPTION_KEY`, then a hidden prompt — in that order. The argument
still works but warns: it puts the key that decrypts every synced memory into
your shell history and into `ps`. With no terminal to prompt on and neither
other source set, it exits 1 rather than guessing.

## Reflection

Engram never calls a model itself — the AI connected over MCP does the
reasoning. These commands show what came of it:

```bash
engram reflect-status                # Is a reflection cycle due?
engram reflections --type pattern    # List stored insights
engram reflections --limit 5 --json  # Raw JSON
```

## Configuration

Config file: `~/.engram/config.json` (mode `0600` — it can hold a Postgres password).

| Key | Default | Description |
|---|---|---|
| `dbPath` | `~/.engram/engram.db` | SQLite database path |
| `port` | `4901` | API server port |
| `host` | `127.0.0.1` | Bind address |
| `namespace` | `null` | Memory namespace |
| `namespaceMode` | `none` | `none`, `filter`, or `isolated` |
| `embeddingModel` | `Xenova/all-MiniLM-L6-v2` | Embedding model |
| `indexPath` | `~/.engram/engram.db.index` | Vector index path |
| `repoPath` | `~/.engram/repo` | Cloned repo path |
| `syncUrl` | *(unset)* | PostgreSQL connection string — set by `cloud connect` |
| `syncMode` | *(unset)* | `auto`, `manual`, or `off` |
| `syncInterval` | *(unset)* | Background sync interval, in milliseconds |
| `deviceName` | *(unset)* | Name for this device in sync status (defaults to the hostname) |

Every key is settable with `engram configure set <key> <value>`. `port`,
`namespaceMode`, `syncMode` and `syncInterval` are checked, and a bad value is
refused rather than written.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_HOME` | `~/.engram` | Root of the CLI's own state directory (config, pidfile, logs, build stamp, repo) |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(unset)* | Cloud-sync passphrase — read by `cloud encrypt`, and passed through to the server `start` launches |

The CLI does not read `ENGRAM_DB_PATH` or `ENGRAM_INDEX_PATH` itself. It reads
`${ENGRAM_HOME}/config.json` and **exports** those variables into the server
process it starts — change them with `engram configure set`.

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Configuration reference](https://github.com/ayvazyan10/engram/blob/master/docs/CONFIGURATION.md)
- [Documentation](https://github.com/ayvazyan10/engram/tree/master/docs)
- [Website](https://engram.am)

## License

MIT
