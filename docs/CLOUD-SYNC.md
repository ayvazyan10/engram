# Cloud Sync

Multi-device synchronization for Engram, via a shared PostgreSQL database.

---

## 1. Overview

Engram is **local-first**: SQLite is the only primary backend, and every read and write goes through your local `engram.db` file. Nothing about that changes with this feature.

Cloud sync is an **explicit opt-in** on top of that. When you set `ENGRAM_SYNC_URL`, Engram starts replicating memories, sessions, and memory connections through a shared PostgreSQL instance so multiple devices — your laptop, your desktop, a server — can converge on the same brain over time.

A few things worth being precise about:

- **Any Postgres provider works.** Neon, Supabase, Railway, Render, a self-hosted instance — Engram needs nothing beyond standard Postgres. It doesn't require `pgvector` or any extension.
- **No data leaves your machine unless you configure `ENGRAM_SYNC_URL`.** Leave it unset and Engram behaves exactly as it always has — fully local, zero network calls for storage.
- **Sync is not backup.** It's bidirectional replication: writes from every connected device eventually appear on every other device. There's no separate "backup" copy and no single source of truth other than "whatever the devices converge to." If you want backups, use your Postgres provider's backup/snapshot feature, or `engram export`.

---

## 2. Quick Start

### Step 1 — Create a PostgreSQL database

The easiest option is **[Neon](https://neon.tech)** — free tier, connection string ready in under a minute, no card required for the free plan. **[Supabase](https://supabase.com)** works just as well if you'd rather use that. Railway, Render, or a self-hosted Postgres are all fine too — Engram only needs a standard `postgres://` connection string.

### Step 2 — Set `ENGRAM_SYNC_URL`

```bash
ENGRAM_SYNC_URL=postgres://user:pass@host/db?sslmode=require
```

TLS is required by default — keep `?sslmode=require` on the connection string (see [Security](#7-security)).

### Step 3 — Start Engram

The schema is created and migrated automatically on first connection — there's nothing to run by hand. Start whichever surface you use normally:

**MCP** — add the env block to the config file your client reads (`~/.claude.json` for Claude Code, `~/.cursor/mcp.json` for Cursor, `~/.codeium/windsurf/mcp_config.json` for Windsurf):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@engram-ai-memory/mcp@latest"],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
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

Repeat step 2–3 on every device you want in the mesh, pointing at the **same** Postgres database. They'll start converging on the next sync cycle.

---

## 3. How Sync Works

Once configured, sync runs in the background:

- **Interval:** a full sync cycle runs every 30 seconds by default (`ENGRAM_SYNC_INTERVAL`).
- **Debounce:** after a local write, a sync is also triggered a couple of seconds later (independent of the interval), so changes don't sit around for a full 30s before propagating.
- **Push:** local changes are read from SQLite and sent to Postgres, batched 500 rows at a time.
- **Pull:** remote changes are read from Postgres and applied to local SQLite, also batched 500 rows at a time. Pull uses a **5-minute overlap window** behind the last-seen cursor, so a transaction that started before — but committed after — the previous pull is still picked up rather than silently skipped.

**What's synced:** memories, sessions, and memory connections (the knowledge graph edges between memories). Everything else — the vector index, decay/reflection state, device identity — stays local.

**Device identity:** each installation gets a unique `device_id`, generated once (a UUID) and persisted in a local-only table that never itself syncs. It's used purely to break ties during conflict resolution (see below) — it's not a user-facing identifier you need to manage.

> One caveat worth knowing: if you clone or restore an `engram.db` file onto a second machine (disk image, backup restore, `cp`), that copy inherits the same `device_id` as the original. Two installations sharing one id can occasionally mis-resolve a tie between exactly those two devices. Treat a cloned database as sharing identity with its source until you've verified otherwise.

You can also drive sync manually instead of waiting on the interval — see [Recovery / Troubleshooting](#10-recovery--troubleshooting).

---

## 4. Conflict Resolution

When the same row has changed on two devices, Engram resolves it deterministically — both sides compute the same answer independently, with no coordination required:

- **Last-Write-Wins (LWW) by `updatedAt`.** The row with the newer timestamp wins.
- **Ties are broken by `device_id`.** If two updates land on the exact same `updatedAt`, the row from the device with the lexicographically greater `device_id` wins. Both devices arrive at the same conclusion without talking to each other.
- **`access_count` and `last_accessed_at` are MAX-merged, not LWW'd.** These bump on every recall from *any* device, so treating them as a normal LWW field would let one device's read silently erase another's. Instead, Engram always keeps the higher value — access counts never decrease, and the most recent access timestamp always wins, regardless of which side's row "won" the rest of the conflict.
- **Soft deletes (archival) propagate the same way as edits.** A memory's `archivedAt` (or a connection/session's `deletedAt`) is folded into the LWW comparison as the row's "effective" timestamp. That means an unarchive/undelete on one device beats an archive/delete on another **only if its timestamp is newer** — deletion doesn't automatically win, and neither does un-deletion. Whichever change actually happened later wins.

---

## 5. Embedding Model Compatibility

**All devices sharing a sync database must use the same embedding model.** Vectors from different models live in different, incompatible vector spaces — mixing them silently corrupts semantic search.

Engram enforces this automatically: the first time a device connects to a sync target, it compares its local embedding model against the model already recorded in Postgres. If they differ, sync refuses to proceed and fails with a clear error rather than pushing incompatible vectors.

**To change the embedding model across a synced fleet of devices:**

1. Stop Engram on every device (CLI: `engram stop`; MCP/REST: stop the process).
2. Change `ENGRAM_EMBEDDING_MODEL` to the new model on **every** device — they all need to agree before anyone reconnects.
3. On **one** device, run a re-embed to regenerate every memory's vector under the new model:
   - MCP tool: `re_embed`
   - REST: `POST /api/embeddings/re-embed`
4. Start the remaining devices. On their next sync cycle they'll pull the re-embedded vectors from Postgres rather than trying to push their own stale ones.

See [CONFIGURATION.md](CONFIGURATION.md#embedder) for the full list of supported models.

---

## 6. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_SYNC_URL` | *(none)* | PostgreSQL connection string. Unset = sync disabled entirely. |
| `ENGRAM_SYNC_MODE` | `auto` | `auto` (interval + debounce, background), `manual` (explicit sync calls only), `off` (scheduler never runs) |
| `ENGRAM_SYNC_INTERVAL` | `30000` | Background sync interval in ms (`auto` mode only) |
| `ENGRAM_SYNC_ALLOW_UNENCRYPTED` | `false` | Allow non-TLS Postgres connections. Development only — see [Security](#7-security) |
| `ENGRAM_SYNC_ENCRYPTION_KEY` | *(none)* | Passphrase for end-to-end encryption of synced data. Unset = data reaches Postgres as plaintext (still TLS-in-transit), **and syncing against an already-encrypted database is refused**. Also read by `engram cloud encrypt` when no passphrase is given on the command line. See [End-to-end encryption](#8-end-to-end-encryption) |

The passphrase is passed **byte-for-byte and never trimmed** — trimming would derive a different key and orphan every row already encrypted.

The MCP server validates `ENGRAM_SYNC_MODE` and `ENGRAM_SYNC_INTERVAL` and refuses to start on a bad value. The REST API server does not: an unrecognised mode silently disables the scheduler, and a non-numeric interval produces `NaN`, which degenerates into a sync attempt roughly every millisecond.

---

## 7. Security

- **TLS is required by default.** Connection strings must include `?sslmode=require`, or Engram refuses to connect. Set `ENGRAM_SYNC_ALLOW_UNENCRYPTED=true` to bypass this — only do so for a trusted local Postgres during development, never against a real network connection.
- **Passwords are never exposed.** The password portion of `ENGRAM_SYNC_URL` is redacted before it can reach a log line, a `status` response, or an error message. Every place that would otherwise print the connection string prints a masked version instead.
- **WebSocket auth follows `ENGRAM_API_KEY`.** If you set `ENGRAM_API_KEY` on the REST server, the Socket.io `/neural` namespace requires the same key on connection (passed as `auth.token` in the socket handshake) and checks it with a timing-safe comparison. Exposing a synced Engram server beyond `localhost` without `ENGRAM_API_KEY` set means anyone who can reach it can read and write your memories.
- **Encryption at rest is your Postgres provider's responsibility, unless you enable Engram's own end-to-end encryption.** By default Engram doesn't add at-rest encryption — use a managed provider (Neon, Supabase, etc.) that encrypts data at rest by default, or configure it yourself on a self-hosted instance. For a stronger guarantee where the Postgres operator never sees plaintext at all, see [End-to-end encryption](#8-end-to-end-encryption).

---

## 8. End-to-end encryption

Cloud sync can optionally encrypt memory data client-side before it ever reaches Postgres, so the database — and whoever administers it — never sees plaintext content.

### Setup

```bash
# Initialize encryption (first device) — prompts, with the input hidden
engram cloud encrypt

# Set env var for automatic encryption on every sync
export ENGRAM_SYNC_ENCRYPTION_KEY="my-secret-passphrase"

# Or pass when starting
ENGRAM_SYNC_ENCRYPTION_KEY="my-secret-passphrase" engram start
```

`engram cloud encrypt [passphrase]` connects to the configured `ENGRAM_SYNC_URL`, derives a key from the passphrase, and stores the salt, the KDF cost parameters and a verification sentinel in Postgres — all three in one transaction, first-wins, so two devices bootstrapping at once cannot end up with one device's salt and the other's sentinel. It doesn't itself enable encryption on future syncs — that's what `ENGRAM_SYNC_ENCRYPTION_KEY` does, read on every sync connection.

**Where the passphrase comes from**, in order: the command-line argument, then `ENGRAM_SYNC_ENCRYPTION_KEY`, then an interactive prompt with the input hidden. Passing it on the command line still works but prints a warning — it lands in your shell history and is visible in `ps` — so prefer the bare command or the environment variable. With no TTY and neither source set, the command exits 1 rather than prompting into the void. The only validation is that it is not empty: there is no minimum length or complexity check.

`engram cloud encrypt` writes metadata only. It does **not** re-encrypt rows already pushed in plaintext, and it never touches local SQLite. Running it twice with the same passphrase is a safe no-op; with a different one it reports that the database is already configured and exits 1.

### How it works

- **AES-256-GCM with scrypt key derivation** (`N=2^17`, `r=8`, `p=1`) — a memory-hard KDF that resists brute-forcing on commodity hardware/GPUs. GCM gives both confidentiality and integrity: a tampered ciphertext fails to decrypt rather than silently returning garbage. The cost is **recorded per database** rather than hardcoded, so a database bootstrapped before the cost was raised keeps deriving at its original `N=2^15` — raising it there would invalidate the stored sentinel and lock the owner out of every row already encrypted. Parameters read back from the server are bounded on both sides: the floor is the legacy cost, so a hostile operator cannot publish a cheap `N` and have every client derive a brute-forceable key.
- **Per-field encryption.** On a memory row: `content`, `summary`, `metadata`, `tags`, `embedding`, `concept`, `trigger_pattern` and `action_pattern` — the last three hold the actual content of semantic and procedural memories. On a session row: `context`. On a connection row: `metadata`. Everything else stays plaintext because the server filters, cursors or resolves conflicts on it: `namespace`, `session_id`, `source`, `device_id`, `type`, `relationship` and every timestamp. A Postgres operator can therefore see how many memories exist, when they changed, which device wrote them and how they relate — just not what any of them say.
- **Ciphertext is bound to its row and column.** Every value authenticates the table, row id and column it was produced for (AES-GCM associated data), so a database operator cannot lift one row's `content` into another row, or swap `summary` and `content` inside one row. Either move now fails to decrypt instead of decrypting into the wrong place. The plaintext metadata above is deliberately *not* bound: background maintenance rewrites `updated_at`, `archived_at` and `device_id` without touching content, and binding them would turn routine work into undecryptable rows.
- **Encrypted text format:** `enc:v2:<base64(nonce || ciphertext || authTag)>`. Encrypted embeddings use the same `nonce || ciphertext || authTag` layout but stay raw bytes (no prefix, no base64) since embeddings are already stored as a byte column. `enc:v1:` values — the earlier format, with no binding — are still read; nothing writes them any more.
- **Random 12-byte nonce per field.** Every encryption call generates a fresh nonce, so the same plaintext produces different ciphertext each time — rows can't be correlated by comparing ciphertext bytes.
- **Salt stored in Postgres.** A 32-byte random salt is generated once and stored in the `sync_metadata` table (`key='encryption_salt'`), so every device can derive the same key from the same passphrase without the salt itself needing to be shared out-of-band.
- **Sentinel verification.** A fixed plaintext, encrypted under the derived key, is stored alongside the salt (`key='encryption_sentinel'`). Any device initializing encryption decrypts the sentinel to confirm its passphrase is correct *before* trusting the derived key — this is what turns a typo'd passphrase into an immediate, clear error instead of a pile of undecryptable rows.

### Multi-device setup

1. Run `engram cloud encrypt` on the first device. This generates the salt, the KDF parameters and the sentinel, and stores them in Postgres.
2. On additional devices, set `ENGRAM_SYNC_ENCRYPTION_KEY` to the **same** passphrase — no need to run `engram cloud encrypt` again on each one.
3. Each device reads the salt from `sync_metadata`, derives the same key locally, and verifies it against the sentinel on connect. A wrong passphrase fails fast with a clear error rather than corrupting or silently dropping data.

> **Upgrade every device together.** `enc:v2` rows carry the row-and-column binding described above, and an older client cannot read them. A mesh where one device is still on the previous release will see that device fail to decrypt every row written by the upgraded ones. Old `enc:v1` rows keep decrypting on both, so the migration is one-way and safe in that direction only.

**A device with no passphrase now refuses to sync** against a database that has encryption established, instead of connecting and pushing plaintext over it. Pushing would have sent that device's whole database in the clear, and the last-write-wins upsert would have overwritten ciphertext rows the encrypted peers had already pushed — silently and irreversibly downgrading the store for everyone. The error names `ENGRAM_SYNC_ENCRYPTION_KEY` as the fix.

### Tradeoffs

- **pgvector search disabled.** Encrypted embeddings are random bytes from Postgres's point of view, so semantic search can never run server-side against them. This is by design, not a missing feature — Engram doesn't rely on server-side vector search anyway; semantic search always runs locally against SQLite + the local vector index, plaintext, on every device.
- **No passphrase recovery.** The passphrase is never stored anywhere, only verified via the sentinel. If it's lost, encrypted rows in Postgres are permanently unreadable — there is no reset or recovery path. Local SQLite data is unaffected either way, since sync only ever encrypts the copy that leaves the device.
- **Mixed content is handled gracefully, not rejected.** If some rows were pushed before encryption was enabled, they remain plaintext in Postgres and are pulled as-is — the encrypted-value check looks for the `enc:v1:` / `enc:v2:` prefix and leaves unprefixed values alone. On pull, a row that fails to decrypt (wrong passphrase, corrupted ciphertext, or data encrypted under a different key) is skipped with a warning rather than aborting the whole sync — it stays on the server and simply isn't applied locally until it can be decrypted.
- **Metadata is not authenticated.** Timestamps, `archived_at`, `device_id` and `namespace` stay outside the binding for the reason given above, so a Postgres operator can still reorder or re-attribute rows even though they cannot read or move content. Closing that needs a per-row MAC column, which does not exist yet.

---

## 9. Namespace / Tenant Isolation

If multiple *people* share a single Postgres database (as opposed to one person's multiple devices), isolation between them is controlled by `ENGRAM_NAMESPACE_MODE` — the same setting that governs local namespace behavior, not something sync-specific.

- **`none` (default):** every connected device sees every memory — one shared pool. This is the right default for one person syncing their own devices, and it's what you get if you don't set anything.
- **`filter`:** memories are tagged with a namespace. Queries default to the caller's namespace, but cross-namespace reads/writes remain possible via explicit overrides.
- **`isolated`:** a strict boundary. Each namespace only ever sees its own memories, and cross-namespace overrides are rejected outright.

**Important:** with `ENGRAM_NAMESPACE_MODE=none` (the default) and a Postgres database shared by more than one person, every connected device can read and modify every memory in it — there is no isolation. If you're sharing one sync database across multiple people, use `ENGRAM_NAMESPACE_MODE=isolated` with a distinct `ENGRAM_NAMESPACE` per person/tenant. `none` is meant for "my own devices," not "our team's shared database."

---

## 10. Recovery / Troubleshooting

**Sync seems stuck**
- Confirm `ENGRAM_SYNC_URL` is reachable from this machine (`psql "$ENGRAM_SYNC_URL" -c 'select 1'`, or just check your provider's connection status).
- Check your Postgres provider's logs/dashboard for connection errors or rejected auth.
- CLI: `engram cloud status` shows last sync time, pending push count, pull cursor, and the last error (if any).

**"Embedding model mismatch" error**
- All devices sharing a sync target must use the same embedding model. See [Embedding Model Compatibility](#5-embedding-model-compatibility) for the fix.

**Data isn't appearing on another device**
- Verify both devices point at the *exact* same `ENGRAM_SYNC_URL` (same host, same database — a typo'd database name silently creates a second, disconnected mesh).
- Check sync status on both sides (`engram cloud status`, or `GET /api/sync/status`) to confirm they're both actually syncing and not sitting on `ENGRAM_SYNC_MODE=off`.
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

Each installation now also records a fingerprint of the database file its id was minted for — hostname, resolved path, and the file's device and inode numbers. A fingerprint that no longer matches means this file is not the one the id belongs to, and a fresh id is minted automatically, with every locally-owned row re-stamped onto it in the same transaction so nothing pending is stranded. `mv` within one filesystem preserves all four components, so an ordinary relocation is not mistaken for a copy.

A spurious re-mint costs one new UUID and a log line; a missed collision is silent data divergence, which is why the check errs toward re-minting. `resetDeviceId()` in `@engram-ai-memory/core` triggers the same recovery explicitly.

**Your local data is always safe.** SQLite is the source of truth for that device regardless of what Postgres or the network is doing. If sync breaks, stalls, or the remote database disappears entirely, nothing is lost locally — Engram just stops replicating until sync is working again.

---

## 11. Limitations

- **No server-side search.** Sync replicates rows; it doesn't add `pgvector` or any server-side vector search. Semantic search still runs locally, against your local SQLite + vector index, on every device. With encryption enabled this is unavoidable rather than a gap — see [End-to-end encryption](#8-end-to-end-encryption).
- **Encryption is opt-in.** Without `ENGRAM_SYNC_ENCRYPTION_KEY` set, data is encrypted in transit (TLS) but not at rest — whoever administers your Postgres database can read memory content unless your provider encrypts it for you. Enable [end-to-end encryption](#8-end-to-end-encryption) if you don't trust the Postgres instance with plaintext.
- **The sync interval has a practical floor.** Every cycle costs a round trip and a transaction against Postgres; pushing `ENGRAM_SYNC_INTERVAL` very low mostly adds load without meaningfully improving propagation latency (the write-triggered debounce already covers the common case of "I just changed something, sync it soon").
