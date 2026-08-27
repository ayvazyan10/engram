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

**MCP** — add the env block to your `claude_desktop_config.json` (or `.mcp.json`):

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

You can also drive sync manually instead of waiting on the interval — see [Recovery / Troubleshooting](#9-recovery--troubleshooting).

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

---

## 7. Security

- **TLS is required by default.** Connection strings must include `?sslmode=require`, or Engram refuses to connect. Set `ENGRAM_SYNC_ALLOW_UNENCRYPTED=true` to bypass this — only do so for a trusted local Postgres during development, never against a real network connection.
- **Passwords are never exposed.** The password portion of `ENGRAM_SYNC_URL` is redacted before it can reach a log line, a `status` response, or an error message. Every place that would otherwise print the connection string prints a masked version instead.
- **WebSocket auth follows `ENGRAM_API_KEY`.** If you set `ENGRAM_API_KEY` on the REST server, the Socket.io `/neural` namespace requires the same key on connection (passed as `auth.token` in the socket handshake) and checks it with a timing-safe comparison. Exposing a synced Engram server beyond `localhost` without `ENGRAM_API_KEY` set means anyone who can reach it can read and write your memories.
- **Encryption at rest is your Postgres provider's responsibility.** Engram doesn't add its own at-rest encryption — use a managed provider (Neon, Supabase, etc.) that encrypts data at rest by default, or configure it yourself on a self-hosted instance.

---

## 8. Namespace / Tenant Isolation

If multiple *people* share a single Postgres database (as opposed to one person's multiple devices), isolation between them is controlled by `ENGRAM_NAMESPACE_MODE` — the same setting that governs local namespace behavior, not something sync-specific.

- **`none` (default):** every connected device sees every memory — one shared pool. This is the right default for one person syncing their own devices, and it's what you get if you don't set anything.
- **`filter`:** memories are tagged with a namespace. Queries default to the caller's namespace, but cross-namespace reads/writes remain possible via explicit overrides.
- **`isolated`:** a strict boundary. Each namespace only ever sees its own memories, and cross-namespace overrides are rejected outright.

**Important:** with `ENGRAM_NAMESPACE_MODE=none` (the default) and a Postgres database shared by more than one person, every connected device can read and modify every memory in it — there is no isolation. If you're sharing one sync database across multiple people, use `ENGRAM_NAMESPACE_MODE=isolated` with a distinct `ENGRAM_NAMESPACE` per person/tenant. `none` is meant for "my own devices," not "our team's shared database."

---

## 9. Recovery / Troubleshooting

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

**Your local data is always safe.** SQLite is the source of truth for that device regardless of what Postgres or the network is doing. If sync breaks, stalls, or the remote database disappears entirely, nothing is lost locally — Engram just stops replicating until sync is working again.

---

## 10. Limitations

- **No server-side search.** Sync replicates rows; it doesn't add `pgvector` or any server-side vector search. Semantic search still runs locally, against your local SQLite + vector index, on every device.
- **No end-to-end encryption.** Data is encrypted in transit (TLS), but whoever administers your Postgres database can read memory content at rest unless your provider encrypts it for you. Don't sync sensitive data through a Postgres instance you don't trust.
- **The sync interval has a practical floor.** Every cycle costs a round trip and a transaction against Postgres; pushing `ENGRAM_SYNC_INTERVAL` very low mostly adds load without meaningfully improving propagation latency (the write-triggered debounce already covers the common case of "I just changed something, sync it soon").
