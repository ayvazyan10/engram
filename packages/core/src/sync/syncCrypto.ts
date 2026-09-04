/**
 * Row-batch encryption for the sync push/pull paths — the glue between
 * `EncryptionManager`'s single-row API and the batches `SyncEngine` moves.
 *
 * Every function here is a no-op pass-through when `manager` is null or not
 * initialized, so push/pull stay byte-for-byte what they were before
 * encryption existed for users who never set a passphrase.
 *
 * WHAT IS ENCRYPTED (all user content):
 *   memories            content, summary, metadata, tags, embedding,
 *                       concept, trigger_pattern, action_pattern
 *   sessions            context
 *   memory_connections  metadata
 *
 * WHAT IS NOT, deliberately:
 *   namespace, session_id, source, device_id, type, relationship, and every
 *   timestamp. Postgres filters, cursors and resolves conflicts on those
 *   columns; encrypting them breaks sync itself. So the server sees no
 *   memory *content*, but it does see the shape of the graph — how many
 *   rows exist, when they changed, which device wrote them, which namespace
 *   and session they belong to, and how memories relate to each other.
 *
 * WHAT THE SERVER CAN STILL DO. Encrypted values are bound to their table,
 * row id and column (`FieldBinding` in `./crypto.ts`), so a hostile or
 * compromised operator can no longer move ciphertext between rows or between
 * columns — either now fails to decrypt and is quarantined below. The
 * plaintext columns above are NOT authenticated, though, and cannot be:
 * `backfillNullDeviceIds` rewrites `device_id`, and the LWW upsert's
 * `GREATEST` merge rewrites the access counters, both without touching
 * content. So an operator can still push `updated_at` into the future to win
 * last-write-wins everywhere, clear `archived_at` to resurrect a deleted
 * memory, or move a row between namespaces. Closing that needs a MAC over
 * the row's metadata carried in its own column, which is a schema change
 * this layer cannot make on its own.
 */

import type { Memory, MemoryConnection, Session } from '../db/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';
import type { EncryptionManager } from './encryption.js';
import type { PullPage } from './syncLoops.js';

/** The manager, or null when encryption is off / not yet derived. */
function activeManager(manager: EncryptionManager | null): EncryptionManager | null {
  return manager?.initialized ? manager : null;
}

// ─── push ───────────────────────────────────────────────────────────────────

export function encryptMemoriesForPush(manager: EncryptionManager | null, rows: Memory[]): Memory[] {
  const active = activeManager(manager);
  if (!active) return rows;

  return rows.map((row) => {
    const enc = active.encryptRow(row);
    return {
      ...row,
      content: enc.content,
      summary: enc.summary,
      // `metadata`/`tags` are NOT NULL columns; the shared Encryptable*
      // shapes allow null only because decrypt reuses them — encrypting a
      // non-null string never actually yields null.
      metadata: enc.metadata ?? row.metadata,
      tags: enc.tags ?? row.tags,
      embedding: enc.embedding,
      concept: enc.concept,
      triggerPattern: enc.triggerPattern,
      actionPattern: enc.actionPattern,
    };
  });
}

export function encryptConnectionsForPush(
  manager: EncryptionManager | null,
  rows: MemoryConnection[]
): MemoryConnection[] {
  const active = activeManager(manager);
  if (!active) return rows;

  return rows.map((row) => ({
    ...row,
    metadata: active.encryptConnection(row).metadata ?? row.metadata,
  }));
}

export function encryptSessionsForPush(manager: EncryptionManager | null, rows: Session[]): Session[] {
  const active = activeManager(manager);
  if (!active) return rows;

  return rows.map((row) => ({ ...row, context: active.encryptSession(row).context }));
}

// ─── pull ───────────────────────────────────────────────────────────────────

export function decryptPulledMemories(
  manager: EncryptionManager | null,
  page: PullPage<PgMemory>
): PullPage<PgMemory> {
  const active = activeManager(manager);
  if (!active) return page;

  return decryptPage(page, 'memory', (row) => {
    const result = active.tryDecryptRow(row);
    if (result === null) return null;
    return {
      ...row,
      content: result.content,
      summary: result.summary,
      metadata: result.metadata ?? row.metadata,
      tags: result.tags ?? row.tags,
      embedding: result.embedding,
      concept: result.concept,
      triggerPattern: result.triggerPattern,
      actionPattern: result.actionPattern,
    };
  });
}

export function decryptPulledConnections(
  manager: EncryptionManager | null,
  page: PullPage<PgMemoryConnection>
): PullPage<PgMemoryConnection> {
  const active = activeManager(manager);
  if (!active) return page;

  return decryptPage(page, 'connection', (row) => {
    const result = active.tryDecryptConnection(row);
    if (result === null) return null;
    return { ...row, metadata: result.metadata ?? row.metadata };
  });
}

export function decryptPulledSessions(
  manager: EncryptionManager | null,
  page: PullPage<PgSession>
): PullPage<PgSession> {
  const active = activeManager(manager);
  if (!active) return page;

  return decryptPage(page, 'session', (row) => {
    const result = active.tryDecryptSession(row);
    if (result === null) return null;
    return { ...row, context: result.context };
  });
}

/**
 * Decrypts one pulled page, dropping rows that fail.
 *
 * A row whose fields carry no encryption envelope is legacy plaintext and
 * decrypts to itself, so the only rows that land here are genuinely
 * undecryptable ones — ciphertext under some other key, tampered bytes, or a
 * value the server moved in from another row or column (see `FieldBinding`).
 * Those are dropped, but the page is also marked `blocked`, which pins the
 * pull cursor where it is (see `SyncEngine.doPull`).
 *
 * Pinning rather than skipping is the deliberate trade: a skipped row falls
 * out of the 5-minute overlap window within one cycle and is then lost to
 * this device permanently and silently. A pinned cursor re-pulls the same
 * page — noisy, and no further pages arrive until the row is dealt with, but
 * nothing disappears without anyone noticing.
 */
function decryptPage<TRow extends { id: string }>(
  page: PullPage<TRow>,
  label: string,
  decrypt: (row: TRow) => TRow | null
): PullPage<TRow> {
  const rows: TRow[] = [];
  let blocked = false;

  for (const row of page.rows) {
    const decrypted = decrypt(row);
    if (decrypted === null) {
      blocked = true;
      console.warn(
        `[engram] Could not decrypt ${label} ${row.id} — it is encrypted under a different key. ` +
          'Holding the pull cursor before it rather than skipping past it; check ' +
          'ENGRAM_SYNC_ENCRYPTION_KEY, or remove the row, to let sync move on.'
      );
      continue;
    }
    rows.push(decrypted);
  }

  if (!blocked) return { ...page, rows };
  return { ...page, rows, maxServerUpdatedAt: null, lastId: null, hasMore: false, blocked: true };
}
