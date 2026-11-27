# Cloud Sync

Multi-device synchronization for Engram, via a shared PostgreSQL database.

---

## 1. Overview

Engram is **local-first**: SQLite is the primary store for memory records, and searches use a local index. Cloud sync runs alongside local reads and writes.

Cloud sync is an **explicit opt-in** on top of that. In the default `auto` mode, when you set `ENGRAM_SYNC_URL`, Engram starts replicating memories, sessions, and memory connections through a shared PostgreSQL instance so multiple devices — your laptop, your desktop, a server — can converge on the same brain over time.

A few things worth being precise about:

- **Any Postgres provider works.** Neon, Supabase, Railway, Render, a self-hosted instance — Engram needs nothing beyond standard Postgres. It doesn't require `pgvector` or any extension.
- **Without a sync URL, storage stays local.** MCP and the REST server create a sync engine only when they receive a URL. The CLI reads its saved `syncUrl` for `engram cloud` commands.
- **Sync is not backup.** It's bidirectional replication: writes from every connected device eventually appear on every other device. There's no separate "backup" copy and no single source of truth other than "whatever the devices converge to." If you want backups, use your Postgres provider's backup/snapshot feature, or use `engram export` for a portable copy of active memories.

---

## 2. Quick Start

### Step 1 — Create a PostgreSQL database

The easiest option is **[Neon](https://neon.tech)** — free tier, connection string ready in under a minute, no card required for the free plan. **[Supabase](https://supabase.com)** works just as well if you'd rather use that. Railway, Render, or a self-hosted Postgres are all fine too — Engram only needs a standard `postgres://` connection string.

### Step 2 — Set `ENGRAM_SYNC_URL`

```bash
export ENGRAM_SYNC_URL="postgres://user:pass@host/db?sslmode=require"
```

Direct connections add `sslmode=require` when the URL omits it. Include it explicitly for `engram cloud connect` (see [Security](#7-security)).

### Step 3 — Start Engram

The first connection applies pending sync migrations automatically. A PostgreSQL advisory lock serializes upgrades, and each migration’s SQL and journal entry commit together. Start whichever surface you use normally:

**MCP** — add the env block to the config file your client reads (`~/.claude.json` for Claude Code, `~/.cursor/mcp.json` for Cursor, `~/.codeium/windsurf/mcp_config.json` for Windsurf):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-code",
        "ENGRAM_SYNC_URL": "postgres://user:pass@host/db?sslmode=require"
      }
    }
  }
}
```

**CLI** — configure it once, sync starts automatically on the next launch:

```bash
engram cloud connect "postgres://user:pass@host/db?sslmode=require"
engram start
```

`engram cloud disconnect` clears the saved sync URL, mode and interval. Restart a running server to pick up the change and unset any separately exported `ENGRAM_SYNC_URL`.

**REST server** — set the same env var before starting `apps/server`:

```bash
ENGRAM_SYNC_URL=postgres://user:pass@host/db?sslmode=require \
  node apps/server/dist/index.js
```

**Smithery / MCPB (Claude Desktop Extension)** — set the config fields during install instead of editing JSON by hand:

| Field | Smithery key | MCPB key |
|---|---|---|
| Sync URL | `syncUrl` | `sync_url` |
| Sync mode | `syncMode` | `sync_mode` |
| Encryption passphrase | — | `sync_encryption_key` |

Repeat step 2–3 on every device you want in the mesh, pointing at the **same** Postgres database. They'll start converging on the next sync cycle.

---

## 3. How Sync Works

In `auto` mode, the REST server starts the scheduler at startup. The stdio MCP server starts it when its brain first initializes.

- **Interval:** a full sync cycle runs every 30 seconds by default (`ENGRAM_SYNC_INTERVAL`).
- **Debounce:** after a local write, a sync is also triggered a couple of seconds later (independent of the interval), so changes don't sit around for a full 30s before propagating.
- **Retries:** the interval and debounced writes share an exponential backoff after failures (1 second up to 60 seconds). An explicit sync can retry immediately. Overlapping calls on the same engine share the active cycle.
- **Push:** local changes are read from SQLite and sent to Postgres, batched 500 rows at a time.
- **Pull:** remote changes are read from Postgres and applied to local SQLite, also batched 500 rows at a time. Pull uses a **5-minute overlap window** behind the last-seen cursor, to catch late commits whose timestamps still fall in that window.

**What's synced:** memories, sessions, and memory connections (the knowledge graph edges between memories). What stays on the device is the vector index file, the recall audit log, webhook subscriptions, the device identity and the sync cursors.

Decay is not separate state left behind. It lives in fields on the memory row itself — `archived_at`, `access_count` and `last_accessed_at` — and those columns sync with the row, so a memory archived by a decay sweep on one device is archived on all of them. Reflections are memories too, and travel the same way.

**Device identity:** each installation gets a unique `device_id`, generated once (a UUID) and persisted in a local-only table that never itself syncs. Sync uses it to select local writes, skip echoes on pull and break ties between concurrent edits.

> Engram checks whether a copy inherited that identity. Each installation also records a fingerprint of the database file its id was minted for (hostname, resolved path, device and inode numbers), so cloning or restoring a fingerprinted `engram.db` onto a second machine — disk image, backup restore, plain `cp` — is detected on first use and a fresh id is minted automatically, with every locally-owned row re-stamped onto it in the same transaction. Left unhandled, a shared id stalls sync in **both** directions while reporting no error; see [Recovery / Troubleshooting](#10-recovery--troubleshooting) for the mechanism and why it errs toward re-minting.

You can also drive sync manually instead of waiting on the interval — see [Recovery / Troubleshooting](#10-recovery--troubleshooting).

---

## 4. Conflict Resolution

When the same row has changed on two devices, Engram resolves it deterministically — both sides compute the same answer independently, with no coordination required:

- **Last-Write-Wins (LWW) by `updatedAt`.** The row with the newer effective timestamp wins.
- **Ties are broken by `device_id`.** If two updates have the same effective timestamp, the row from the device with the lexicographically greater `device_id` wins. Both devices arrive at the same conclusion without talking to each other.
- **`access_count` and `last_accessed_at` are MAX-merged, not LWW'd.** Recalls that record access can update these on any device, so treating them as a normal LWW field would let one device's read silently erase another's. Instead, Engram always keeps the higher value — access counts never decrease, and the most recent access timestamp always wins, regardless of which side's row "won" the rest of the conflict.
- **Soft deletes (archival) propagate the same way as edits.** A memory's `archivedAt` (or a connection’s or session’s `deletedAt`) is folded into the LWW comparison as the row's "effective" timestamp. That means an unarchive/undelete on one device beats an archive/delete on another **only if its timestamp is newer** — deletion doesn't automatically win, and neither does un-deletion. Whichever change actually happened later wins.

---

## 5. Embedding Model Compatibility

**All devices sharing a sync database must use the same embedding model.** Vectors from different models live in different, incompatible vector spaces — mixing them silently corrupts semantic search.

On connection and after a local model change, normal sync checks the active model against the shared model recorded in Postgres. The first device claims an empty target. A different model, or multiple model labels in a legacy target, stops normal sync.

The MCP admin tool `re_embed` (`ENGRAM_ADMIN_TOOLS=1`) and REST `POST /api/embeddings/re-embed` update one device's SQLite vectors. Normal sync refuses a model mismatch, so a local re-embed alone cannot migrate a populated Postgres database.

If this device has switched models and holds the latest edits, run `engram cloud sync --re-embed` on it. For encrypted sync, supply the usual `ENGRAM_SYNC_ENCRYPTION_KEY`.
It re-embeds stale local vectors and pushes pending work, including archives and decay, before converting the remaining remote vectors.
A final sync verifies the new model and pulls the converted rows. Configure the other devices to use that model before they resume sync.

**To migrate a fleet in place**

1. Pause writes and finish a sync on every device using the current model. Stop every Engram server and MCP process before starting the migration.
2. On one device with the CLI configured for this sync database, run `engram cloud migrate-model <source> <target>` with the full old and new model IDs. For an encrypted database, supply its usual `ENGRAM_SYNC_ENCRYPTION_KEY`.
3. Wait for the command to report the number of migrated memories. It checks that every remote vector needing conversion has the source model, including archived memories, and generates replacements on the device. Postgres commits them together after the full count matches. An unexpected model, missing model label, or failed conversion rolls back the vector updates.
4. Configure the target model on every device before restarting. Set `ENGRAM_EMBEDDING_MODEL` for MCP, REST, and one-shot CLI syncs. For servers launched with `engram start`, run `engram configure set embeddingModel <target>`. Resume writes after the devices have pulled the migrated memories.

See [CONFIGURATION.md](CONFIGURATION.md#embedder) for known model IDs and how Engram determines vector dimensions.

---

## 6. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_SYNC_URL` | *(none)* | PostgreSQL connection string for the server or MCP. The CLI uses `syncUrl` saved by `engram cloud connect`. |
| `ENGRAM_SYNC_MODE` | `auto` | `auto` schedules syncs. `manual` and `off` both leave the scheduler stopped. An explicit trigger can still sync a configured target. |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval in ms (`auto` mode only) |
| `ENGRAM_SYNC_ALLOW_UNENCRYPTED` | `false` | Allow non-TLS Postgres connections. Development only — see [Security](#7-security) |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(none)* | Passphrase for end-to-end encryption of synced data. Unset = a fresh target receives plaintext fields (TLS in transit by default), **and syncing against an already-encrypted database is refused**. Also read by `engram cloud encrypt` when no passphrase is given on the command line. See [End-to-end encryption](#8-end-to-end-encryption) |

The passphrase is passed **byte-for-byte and never trimmed**. The REST server and one-shot CLI sync reject an empty or whitespace-only value. Stdio MCP treats an empty string as unset and rejects whitespace-only values.

Both servers reject unknown sync modes and require a whole-number interval from 1 through 2147483647 milliseconds.

---

## 7. Security

- **TLS is required by default.** Direct connections add `sslmode=require` if absent. `engram cloud connect` requires it explicitly by default. Duplicate `sslmode` parameters are rejected. For a trusted development database, set `ENGRAM_SYNC_ALLOW_UNENCRYPTED=true`. The CLI sets this override when the URL explicitly specifies `sslmode=disable`.
- **URL redaction.** Configuration and sync status output mask the URL password and omit the query string and fragment, which can also contain credentials.
- **WebSocket auth follows `ENGRAM_API_KEY`.** If you set `ENGRAM_API_KEY` on the REST server, the Socket.io `/neural` namespace requires the same key on connection (passed as `auth.token` in the socket handshake) and checks it with a timing-safe comparison. Exposing a synced Engram server beyond `localhost` without `ENGRAM_API_KEY` set means anyone who can reach it can read and write your memories.
- **Encryption at rest is your Postgres provider's responsibility, unless you enable Engram's own end-to-end encryption.** By default Engram doesn't add at-rest encryption — use a managed provider (Neon, Supabase, etc.) that encrypts data at rest by default, or configure it yourself on a self-hosted instance. For a stronger guarantee that keeps newly synced content fields private from the Postgres operator, see [End-to-end encryption](#8-end-to-end-encryption).

---

## 8. End-to-end encryption

Cloud sync can optionally encrypt memory data client-side before it ever reaches Postgres, so the database — and whoever administers it — receives ciphertext for the content fields on encrypted writes.

### Setup

```bash
# Initialize encryption (first device) — prompts, with the input hidden
engram cloud encrypt

# Set env var for automatic encryption on every sync
export ENGRAM_SYNC_ENCRYPTION_KEY="my-secret-passphrase"

# Or pass when starting
ENGRAM_SYNC_ENCRYPTION_KEY="my-secret-passphrase" engram start
```

`engram cloud encrypt [passphrase]` connects to the `syncUrl` in the CLI configuration, derives a key from the passphrase, and stores the salt, the KDF cost parameters and a verification sentinel in Postgres — all three in one transaction, first-wins, so two devices bootstrapping at once cannot end up with one device's salt and the other's sentinel. It doesn't itself enable encryption on future syncs — that's what `ENGRAM_SYNC_ENCRYPTION_KEY` does, read on every sync connection.

**Where the passphrase comes from**, in order: the command-line argument, then `ENGRAM_SYNC_ENCRYPTION_KEY`, then an interactive prompt with the input hidden. Passing it on the command line still works but prints a warning — it lands in your shell history and is visible in `ps` — so prefer the bare command or the environment variable. With no TTY and neither source set, the command exits 1 rather than prompting into the void. The only validation is that it contains at least one non-whitespace character.

`engram cloud encrypt` writes metadata only. It does **not** re-encrypt rows already pushed in plaintext, and it never touches local SQLite. Running it twice with the same passphrase is a safe no-op; with a different one it reports that the database is already configured and exits 1.

### How it works

- **AES-256-GCM with scrypt key derivation** (`N=2^17`, `r=8`, `p=1`) — a memory-hard KDF that resists brute-forcing on commodity hardware/GPUs. GCM gives both confidentiality and integrity: a tampered ciphertext fails to decrypt rather than silently returning garbage. The cost is **recorded per database** rather than hardcoded, so a database bootstrapped before the cost was raised keeps deriving at its original `N=2^15` — raising it there would invalidate the stored sentinel and lock the owner out of every row already encrypted. Engram accepts only these two profiles from Postgres, both with `r=8` and `p=1`.
- **Per-field encryption.** On a memory row: `content`, `summary`, `metadata`, `tags`, `embedding`, `concept`, `trigger_pattern` and `action_pattern` — the last three hold the actual content of semantic and procedural memories. On a session row: `context`. On a connection row: `metadata`. Everything else stays plaintext because the server filters, cursors or resolves conflicts on it: `namespace`, `session_id`, `source`, `device_id`, `type`, `relationship` and every timestamp. A Postgres operator can therefore see how many memories exist, when they changed, which device wrote them and how they relate — just not what any of them say.
- **Ciphertext is bound to its row and column.** Every value authenticates the table, row id and column it was produced for (AES-GCM associated data), so a database operator cannot lift one row's `content` into another row, or swap `summary` and `content` inside one row. Either move now fails to decrypt instead of decrypting into the wrong place. The plaintext metadata above is deliberately *not* bound: background maintenance rewrites `updated_at`, `archived_at` and `device_id` without touching content, and binding them would turn routine work into undecryptable rows.
- **Encrypted text format:** `enc:v2:<base64(nonce || ciphertext || authTag)>`. Encrypted embeddings use the same `nonce || ciphertext || authTag` layout but stay raw bytes (no prefix, no base64) since embeddings are already stored as a byte column. `enc:v1:` values — the earlier format, with no binding — are still read; nothing writes them any more.
- **Random 12-byte nonce per field.** Every encryption call generates a fresh nonce, so the same plaintext produces different ciphertext each time — rows can't be correlated by comparing ciphertext bytes.
- **Salt stored in Postgres.** A 32-byte random salt is generated once and stored in the `sync_metadata` table (`key='encryption_salt'`), so every device can derive the same key from the same passphrase without the salt itself needing to be shared out-of-band.
- **Sentinel verification.** A fixed plaintext, encrypted under the derived key, is stored alongside the salt (`key='encryption_sentinel'`). Any device initializing encryption decrypts the sentinel to confirm its passphrase is correct *before* trusting the derived key — this is what turns a typo'd passphrase into an immediate, clear error instead of a pile of undecryptable rows.

### Multi-device setup

1. Run `engram cloud encrypt` on the first device. This generates the salt, the KDF parameters and the sentinel, and stores them in Postgres.
2. On every device, including the first, set `ENGRAM_SYNC_ENCRYPTION_KEY` to the **same** passphrase — no need to run `engram cloud encrypt` again on each one.
3. Each device reads the salt from `sync_metadata`, derives the same key locally, and verifies it against the sentinel on connect. A wrong passphrase fails fast with a clear error rather than corrupting or silently dropping data.

> **Upgrade v1-only clients before writing v2 ciphertext.** `enc:v2` rows carry the row-and-column binding described above, and a client that only supports `enc:v1` cannot read them. A mesh where one device is still on a v1-only release will see that device fail to decrypt newly encrypted rows written by the upgraded ones. Old `enc:v1` rows keep decrypting on both, so the migration is one-way and safe in that direction only.

**A device with no passphrase now refuses to sync** against a database that has encryption established, instead of connecting and pushing plaintext over it. Pushing would have sent that device's whole database in the clear, and the last-write-wins upsert would have overwritten ciphertext rows the encrypted peers had already pushed — silently and irreversibly downgrading the store for everyone. The error names `ENGRAM_SYNC_ENCRYPTION_KEY` as the fix. An already-connected plaintext client repeats this check before each push batch.

### Tradeoffs

- **Search runs locally.** PostgreSQL stores embeddings as bytes. Engram searches its local vector index with either sync encryption setting.
- **No passphrase recovery.** The passphrase is never stored anywhere, only verified via the sentinel. If it's lost, encrypted rows in Postgres are permanently unreadable — there is no reset or recovery path. Local SQLite data is unaffected either way, since sync only ever encrypts the copy that leaves the device.
- **Mixed content is handled gracefully, not rejected.** If some rows were pushed before encryption was enabled, they remain plaintext in Postgres and are pulled as-is — the encrypted-value check looks for the `enc:v1:` / `enc:v2:` prefix and leaves unprefixed values alone. If a row cannot be decrypted, valid rows can still be applied, but the cycle fails and keeps the previous checkpoint for all three tables. The next pull retries from there.
- **Metadata is not authenticated.** Timestamps, `archived_at`, `device_id` and `namespace` stay outside the binding for the reason given above, so a Postgres operator can still reorder or re-attribute rows even though they cannot read or move content. Closing that needs a per-row MAC column, which does not exist yet.

---

## 9. Namespace / Tenant Isolation

`ENGRAM_NAMESPACE_MODE` scopes the local brain. Sync replicates rows across namespaces to the shared database and to peers.

- **`none`:** local reads see every namespace. A directly launched REST server defaults to `none` without a namespace and to `filter` with one.
- **`project`:** the default for stdio MCP and CLI setup. MCP resolves the project to a local `filter` scope. `engram start` maps this mode to `none` for the dashboard.
- **`filter`:** normal searches include the configured project and global memories. Callers can request cross-namespace search and specify a namespace on new memories.
- **`isolated`:** the local brain requires a fixed namespace and rejects conflicting overrides and cross-namespace searches.

**Separate tenants need separate databases and credentials.** Even an isolated client replicates other namespaces into its local SQLite file. Anyone with access to that file or the shared Postgres credentials can bypass local scoping.

---

## 10. Recovery / Troubleshooting

**Sync seems stuck**
- Confirm `ENGRAM_SYNC_URL` is reachable from this machine (`psql "$ENGRAM_SYNC_URL" -c 'select 1'`, or just check your provider's connection status).
- Check your Postgres provider's logs/dashboard for connection errors or rejected auth.
- CLI: `engram cloud status` shows last sync time, pending push count (up to 500 per synced table), pull cursor, and the last error (if any). `engram cloud devices` prints this device’s full ID and display name.

**"Embedding model mismatch" error**
- All devices sharing a sync target must use the same embedding model. See [Embedding Model Compatibility](#5-embedding-model-compatibility) for the fix.

**A push reports a NUL character in a local row**

The error identifies the SQLite table, row ID and column. For a live memory, use `brain.updateMemory(id, { content: replacement })` to supply the intended text. The same method accepts `concept` and `summary` and refreshes the embedding when its input changes.

For a field without an editor, inspect the full bytes in SQLite and replace the field explicitly. This example repairs a session source. Bind `:id` to the reported ID and `:replacement` to the complete corrected value.

```sql
SELECT hex(source) FROM sessions WHERE id = :id;
UPDATE sessions
SET source = :replacement,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    device_id = (SELECT value FROM local_meta WHERE key = 'device_id')
WHERE id = :id AND instr(source, char(0)) > 0;
```

Run `engram cloud sync` after the local edit to retry the pending page.

**Data isn't appearing on another device**
- Verify that both URLs connect to the intended PostgreSQL database. Engram creates tables inside an existing database. A different existing database forms a separate sync target.
- Check the last sync time and errors on both sides (`engram cloud status` or `GET /api/sync/status`). For background sync, also check that each process was started in `auto` mode.
- Give it one full interval (default 30s) — or force it immediately, see below.

**Force a sync cycle manually:**
```bash
# CLI
engram cloud sync

# REST
curl -X POST http://localhost:4901/api/sync/trigger
curl http://localhost:4901/api/sync/status
```

**Two devices sharing one device id (a copied `engram.db`)**

Copying a database to another machine — a backup restore, a disk clone, a plain `cp` — used to duplicate the device id onto both installations. The pull filter is "not written by me", so with a shared id every row from the twin looks like an echo of this device's own push and is skipped, **in both directions**: the two installations sit there exchanging nothing while `engram cloud status` reports no error, because nothing failed.

Each installation now also records a fingerprint of the database file its id was minted for — hostname, resolved path, and the file's device and inode numbers. Older databases without a recorded fingerprint adopt the current fingerprint and keep their ID. A fingerprint that no longer matches means this file is not the one the id belongs to, and a fresh id is minted automatically, with every locally-owned row re-stamped onto it in the same transaction so nothing pending is stranded. Because the resolved path is part of the fingerprint, `mv` to a new path re-mints the id too — even within one filesystem, where device and inode are preserved.

A spurious re-mint costs one new UUID and a log line; a missed collision is silent data divergence, which is why the check errs toward re-minting. `resetDeviceId()` in `@engram-ai-memory/core` triggers the same recovery explicitly.

**You can keep working offline.** A connection failure leaves local SQLite available. Once sync resumes, remote edits and archives are applied using the conflict rules above.

---

## 11. Limitations

- **No server-side search.** Sync replicates rows; it doesn't add `pgvector` or any server-side vector search. Semantic search still runs locally, against your local SQLite + vector index, on every device. With encryption enabled this is unavoidable rather than a gap — see [End-to-end encryption](#8-end-to-end-encryption).
- **Encryption is opt-in.** With default TLS and no passphrase, content is readable by the Postgres operator, including on an encrypted disk. Enable [end-to-end encryption](#8-end-to-end-encryption) to protect newly synced content fields.
- **The sync interval has a practical floor.** Every cycle costs a round trip and a transaction against Postgres; pushing `ENGRAM_SYNC_INTERVAL` very low mostly adds load without meaningfully improving propagation latency (the write-triggered debounce already covers the common case of "I just changed something, sync it soon").
