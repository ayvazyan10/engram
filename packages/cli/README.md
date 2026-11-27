# @engram-ai-memory/cli

Terminal tool for [Engram](https://github.com/ayvazyan10/engram) — install, manage, and interact with AI memories from the command line.

## Install

```bash
npm install -g @engram-ai-memory/cli
```

## Setup (one command)

```bash
# Clone, build, configure, and register MCP for Cursor
engram setup --source cursor

# Start the server (API + Atlas dashboard on :4901)
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
| `codex` | `~/.codex/config.toml` |
| `opencode` | `~/.config/opencode/opencode.json` |

`claude` and `claudecode` alias `claude-code`, `codeium` aliases `windsurf`, and `codex-cli` and `open-code` are also accepted. An unknown source (including the default `mcp-client`) prints a JSON block to paste and reports the client registration as skipped.

If `~/.claude` exists and the Engram plugin is inactive, local setup also registers Engram at user scope in `~/.claude.json` and installs four hooks. SessionStart selects up to three pinned, handover or high-importance memories from the exact project and reports available updates or stale servers. UserPromptSubmit searches the running REST server. PostToolUse mirrors writes and edits to Claude project memory Markdown files, excluding `MEMORY.md`. Each save updates the same Engram record. SessionEnd captures a summary on `/clear` and skips `resume`. Pass `--no-claude-hooks` to skip the Claude auto-memory integration.

`engram setup` writes a marked block to each supported, configured or detected client's global instruction file. `engram update` refreshes the block. Pass `--no-global-rules` to either command to skip that step. MCP also refreshes its client’s block at startup. Setup with the flag records `ENGRAM_GLOBAL_RULES=0` in its MCP entries, including with `--npx`. See [global instruction paths](https://github.com/ayvazyan10/engram/blob/master/docs/INTEGRATIONS.md#setup). Use `--no-mcp` during setup to skip client registration.

## Server Management

```bash
engram setup                 # Clone, build and configure without prompting
engram setup --npx           # Fast setup — npx-based MCP config, no clone/build
engram init                  # Write memory instructions into CLAUDE.md, .cursorrules, …
engram init --client cursor  # Just one client (claude, cursor, windsurf, cline, codex, opencode, all)
engram update                # Pull, rebuild, re-link the CLI, restart a running server after rebuilding
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
- **`doctor`** returns 1 when the report counts an issue.
- **`update`** returns 1 when the repository moved but the build, the global CLI
  refresh or the restart did not complete. A missing artifact, missing stamp or
  stamp for a different revision also triggers a rebuild.

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
engram forget a1b2c3d4-1111-4000-8000-000000000001  # Use the full ID from search --json

# Export / Import
engram export > backup.json
engram import < backup.json
```

`import` ignores the source IDs and timestamps. Engram can merge a matching
memory with an existing record of the same type in the same namespace. Stdin
JSON/NDJSON imports report merges separately. File imports report the number
processed per run. Use `--dry-run` to preview the memory count.

```bash
engram import --from markdown ./CLAUDE.md
engram import --from markdown ./memory/ --dry-run
engram import --from chatgpt ./memories.json
engram import --from claude ./memories.txt
```

- `markdown`: recursively reads `.md` files in a directory, or a single file.
  Heading sections become memories with the heading as `concept`; text outside
  sections splits at top-level bullets. Claude Code memory files with YAML
  frontmatter keep the entire body as one memory, with `name` as `concept`.
  `MEMORY.md` link-only indexes are skipped. Tags: `import:markdown` and the
  filename (including `.md`).
- `chatgpt`: one fact per nonempty text line (leading bullets removed), or a
  JSON array of strings or objects containing `content`, `memory`, or `text`.
  Tag: `import:chatgpt`.
- `claude`: one fact per nonempty text/markdown line, with leading bullets
  removed. Tag: `import:claude`.

These file formats create semantic memories and send batches of up to 1,000
records. Stdin imports keep per-record requests to preserve metadata and session
IDs. Invalid records or failed requests produce a nonzero exit code and skipped
counts; an input containing no memories also exits nonzero.

## Cloud Sync

Multi-device sync against your own PostgreSQL database. See
[docs/CLOUD-SYNC.md](https://github.com/ayvazyan10/engram/blob/master/docs/CLOUD-SYNC.md).

```bash
engram cloud connect <postgres-url>  # Configure sync
engram cloud status                  # Sync state, last sync, pending pushes
engram cloud sync                    # Run one push + pull now
engram cloud sync --re-embed       # Sync local edits and convert cloud vectors to this device’s model
engram cloud migrate-model <source> <target> # Convert the shared model after all devices sync and stop
engram cloud devices                 # This device's sync identity
engram cloud encrypt                 # Turn on end-to-end encryption
engram cloud disconnect              # Remove sync settings for future launches
```

`cloud encrypt` takes the passphrase from the argument, then
`ENGRAM_SYNC_ENCRYPTION_KEY`, then a hidden prompt — in that order. The argument
still works but warns: it puts the key that decrypts every synced memory into
your shell history and into `ps`. With no terminal to prompt on and neither
other source set, it exits 1 rather than guessing.

## Reflection

The AI connected over MCP does the reasoning for reflection. These commands show what came of it:

```bash
engram reflect-status                # Is a reflection cycle due?
engram reflections --type pattern    # List stored insights
engram reflections --limit 5 --json  # Raw JSON
```

## Configuration

Config file: `~/.engram/config.json` (mode `0600` — it can hold a Postgres password).

| Key | Default | Description |
|---|---|---|
| `dbPath` | `~/.engram/engram.db` | SQLite database path. Relative paths start in the user's home directory. |
| `port` | `4901` | API server port |
| `host` | `127.0.0.1` | Bind address |
| `namespace` | `null` | Memory namespace |
| `namespaceMode` | `project` | `project`, `none`, `filter`, or `isolated`. `start` maps `project` to `none` for the REST server |
| `embeddingModel` | `''` (automatic) | Empty string selects the default `Xenova/paraphrase-multilingual-MiniLM-L12-v2` for new databases |
| `indexPath` | `~/.engram/engram.db.index` | Vector index path |
| `repoPath` | `~/.engram/repo` | Cloned repo path |
| `syncUrl` | *(unset)* | PostgreSQL connection string — set by `cloud connect` |
| `syncMode` | *(unset)* | `auto`, `manual`, or `off` |
| `syncInterval` | *(unset)* | Background sync interval, in milliseconds |
| `deviceName` | *(unset)* | Name for this device in sync status (defaults to the hostname) |

Every key is settable with `engram configure set <key> <value>`. `port`,
`host`, `namespaceMode`, `syncMode` and `syncInterval` are checked, and a bad value is
refused rather than written.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_HOME` | `~/.engram` | Root of the CLI's own state directory (config, pidfile, logs, build stamp, repo) |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(unset)* | Cloud-sync passphrase — read by `cloud encrypt`, and passed through to the server `start` launches |
| `ENGRAM_API_KEY` | *(unset)* | Sent with CLI memory requests and by the installed REST hooks |
| `ENGRAM_GLOBAL_RULES` | enabled | Set to `0` to skip global instruction updates |

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

In the default `project` mode, worktrees share their main repository’s namespace. Outside git, the current directory supplies the namespace, with global scope at home and filesystem roots. The prompt hook also searches shared semantic and procedural memories. SessionStart reads the local database, and `engram update` refreshes previously installed hooks. After an update from an older CLI, SessionStart can restore a missing memory-mirror hook.
