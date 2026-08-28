/**
 * SyncEngine — the public API of Engram's multi-device sync (Phase 2). One
 * instance owns one Postgres sync target: it lazily connects, checks
 * embedding-model compatibility, and drives the push/pull protocol from
 * `.claude/PRPs/plans/postgres-cloud-sync.md` (section 4). The actual row
 * queries and conflict application live in `./syncLocalReads.ts`,
 * `./syncApply.ts`, and `./syncLoops.ts` — this file is the orchestrator:
 * connection lifecycle, the concurrency guard, backoff/error bookkeeping,
 * and the background scheduler.
 *
 * SyncEngine never touches `NeuralBrain` directly (that would be a circular
 * dependency — `NeuralBrain` is expected to *own* a `SyncEngine` in a later
 * phase, not the other way around). The one place local state outside the
 * sync tables needs to change — rebuilding the in-memory vector index after
 * new memories land locally — is exposed as the optional
 * `onIndexRebuildNeeded` callback instead.
 *
 * Sync failures are always caught here, recorded to `sync_state.last_error`
 * (password-redacted), and reported via `onSyncError` — they never throw
 * past the background scheduler and never touch `store()` / `recall()`,
 * which live entirely outside this class.
 */

import { getDb } from '../db/index.js';
import type { Memory } from '../db/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';
import { createPgSyncConnection, redactSyncUrl } from '../db/pg/connection.js';
import type { PgSyncConnection } from '../db/pg/connection.js';
import { getEmbeddingModelId } from '../embedding/Embedder.js';
import { getDeviceId } from './deviceId.js';
import { computeSyncId, pullCursorWithOverlap, readCursor, writeCursor } from './cursor.js';
import { shouldApplyPulledRow } from './conflict.js';
import { PgSyncClient } from './PgSyncClient.js';
import { EncryptionManager } from './encryption.js';
import {
  countPendingPush, selectConnectionsBatch, selectMemoriesBatch, selectSessionsBatch,
} from './syncLocalReads.js';
import type { SyncDb } from './syncLocalReads.js';
import { applyPulledConnection, applyPulledMemory, applyPulledSession } from './syncApply.js';
import { drainPullBatches, drainPushBatches, maxNullable } from './syncLoops.js';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_DEBOUNCE_MS = 2_000;
const LOCAL_BATCH_SIZE = 500;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface SyncConfig {
  /** Postgres connection string. */
  syncUrl: string;
  /** Sync interval in ms, used by the background scheduler. Default 30000 (30s). */
  intervalMs?: number;
  /** Sync mode: 'auto' (interval + debounce), 'manual' (only explicit calls), 'off' (scheduler never runs). Default 'auto'. */
  mode?: 'auto' | 'manual' | 'off';
  /** Debounce delay after a write before triggering sync, in ms. Default 2000. */
  debounceMs?: number;
  /** Passphrase for E2E encryption. When set, all data pushed to PG is encrypted. */
  encryptionKey?: string;
  /** Called after every sync cycle (success or failure) with the current status. */
  onSyncStatus?: (status: SyncStatus) => void;
  /** Called when a sync cycle fails. Never thrown past — informational only. */
  onSyncError?: (error: Error) => void;
  /**
   * Called after `pull()` applies at least one new/updated memory locally.
   * The integration point (e.g. `NeuralBrain`) should use this to rebuild
   * its in-memory vector index — `SyncEngine` has no index of its own.
   */
  onIndexRebuildNeeded?: () => void | Promise<void>;
}

export interface SyncStatus {
  state: 'idle' | 'pushing' | 'pulling' | 'error';
  lastSyncAt: string | null;
  pendingPushCount: number;
  lastError: string | null;
  pullCursor: string | null;
  deviceId: string;
  embeddingModel: string | null;
}

export interface SyncResult {
  pushed: { memories: number; connections: number; sessions: number };
  pulled: { memories: number; connections: number; sessions: number };
  conflicts: number;
  durationMs: number;
}

const EMPTY_COUNTS = (): { memories: number; connections: number; sessions: number } => ({
  memories: 0, connections: 0, sessions: 0,
});

const EMPTY_RESULT: SyncResult = {
  pushed: EMPTY_COUNTS(),
  pulled: EMPTY_COUNTS(),
  conflicts: 0,
  durationMs: 0,
};

export class SyncEngine {
  private readonly config: SyncConfig;
  private readonly syncUrl: string;
  private readonly syncId: string;
  private readonly deviceId: string;
  private readonly db: SyncDb;

  private pgConn: PgSyncConnection | null = null;
  private pgClient: PgSyncClient | null = null;
  private connectingPromise: Promise<void> | null = null;
  private embeddingModelChecked = false;
  private encryptionManager: EncryptionManager | null = null;

  private intervalTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  private inFlight: Promise<SyncResult> | null = null;
  private lastResult: SyncResult = EMPTY_RESULT;
  private currentPhase: 'push' | 'pull' | null = null;
  private backoffMs = BACKOFF_INITIAL_MS;

  private disposed = false;
  private readonly onBeforeExit = (): void => {
    void this.stop();
  };

  constructor(config: SyncConfig) {
    this.config = config;
    this.syncUrl = config.syncUrl;
    this.syncId = computeSyncId(config.syncUrl);
    this.deviceId = getDeviceId();
    this.db = getDb();
    process.once('beforeExit', this.onBeforeExit);
  }

  // ─── public API ───────────────────────────────────────────────────────

  /** One-shot full sync: push then pull. Only one sync/push/pull runs at a time. */
  async sync(): Promise<SyncResult> {
    return this.runGuarded(async () => {
      const pushed = await this.doPush();
      const { pulled, conflicts } = await this.doPull();
      return { pushed, pulled, conflicts };
    });
  }

  /** Push-only: send local changes to Postgres. */
  async push(): Promise<SyncResult> {
    return this.runGuarded(async () => {
      const pushed = await this.doPush();
      return { pushed, pulled: EMPTY_COUNTS(), conflicts: 0 };
    });
  }

  /** Pull-only: fetch remote changes to local. */
  async pull(): Promise<SyncResult> {
    return this.runGuarded(async () => {
      const { pulled, conflicts } = await this.doPull();
      return { pushed: EMPTY_COUNTS(), pulled, conflicts };
    });
  }

  /** Current sync status. */
  status(): SyncStatus {
    const cursor = readCursor(this.db, this.syncId);
    const state: SyncStatus['state'] = this.currentPhase
      ? this.currentPhase === 'push' ? 'pushing' : 'pulling'
      : cursor?.lastError
        ? 'error'
        : 'idle';

    return {
      state,
      lastSyncAt: cursor?.lastSyncAt ?? null,
      pendingPushCount: countPendingPush(this.db, cursor?.lastPushAt ?? null, LOCAL_BATCH_SIZE),
      lastError: cursor?.lastError ?? null,
      pullCursor: cursor?.pullCursor ?? null,
      deviceId: this.deviceId,
      embeddingModel: cursor?.embeddingModel ?? null,
    };
  }

  /** Start the background scheduler (interval + debounce). Idempotent; a no-op unless mode is 'auto'. */
  start(): void {
    if (this.intervalTimer || this.config.mode !== 'auto') return;

    const intervalMs = this.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.intervalTimer = setInterval(() => {
      // sync() already records failures to cursor.lastError and reports
      // them via onSyncError (see runGuarded) — this catch exists only to
      // stop a rejected promise from becoming an unhandled rejection.
      this.sync().catch(() => {});
    }, intervalMs);
    this.intervalTimer.unref?.();

    this.sync().catch(() => {});
  }

  /** Notify the engine that a local write happened (triggers a debounced sync in 'auto' mode). */
  notifyWrite(): void {
    if (this.config.mode !== 'auto') return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const debounceMs = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.sync().catch(() => {});
    }, debounceMs);
    this.debounceTimer.unref?.();
  }

  /** Stop the background scheduler. Waits for an in-flight sync to finish. */
  async stop(): Promise<void> {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => {});
    }
  }

  /** Close the Postgres connection and clean up. */
  async dispose(): Promise<void> {
    await this.stop();
    process.removeListener('beforeExit', this.onBeforeExit);
    this.disposed = true;

    if (this.pgConn) {
      const conn = this.pgConn;
      this.pgConn = null;
      this.pgClient = null;
      await conn.close().catch(() => {});
    }
  }

  // ─── concurrency guard + error/backoff bookkeeping ───────────────────────

  /**
   * Runs `fn` with the "only one sync at a time" guard: if a sync is
   * already in flight, immediately returns the last completed result rather
   * than queuing behind it. On success, records `lastSyncAt` and resets
   * backoff; on failure, records `lastError` (redacted), grows backoff, and
   * rethrows so callers (including the scheduler, and its no-op catch
   * above) see the failure.
   */
  private async runGuarded(fn: () => Promise<Omit<SyncResult, 'durationMs'>>): Promise<SyncResult> {
    if (this.inFlight) return this.lastResult;

    const run = this.executeGuarded(fn);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  private async executeGuarded(fn: () => Promise<Omit<SyncResult, 'durationMs'>>): Promise<SyncResult> {
    const start = Date.now();
    try {
      const partial = await fn();
      const result: SyncResult = { ...partial, durationMs: Date.now() - start };
      this.lastResult = result;
      this.backoffMs = BACKOFF_INITIAL_MS;
      writeCursor(this.db, this.syncId, {
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      });
      this.config.onSyncStatus?.(this.status());
      return result;
    } catch (err) {
      this.handleSyncError(err);
      this.config.onSyncStatus?.(this.status());
      throw err;
    } finally {
      this.currentPhase = null;
    }
  }

  private handleSyncError(error: unknown): void {
    const message = this.redactMessage(error instanceof Error ? error.message : String(error));
    writeCursor(this.db, this.syncId, { lastError: message });
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.config.onSyncError?.(error instanceof Error ? error : new Error(message));
  }

  /** Strips a raw, unredacted sync URL out of an error message, if one leaked into it. */
  private redactMessage(message: string): string {
    if (!message.includes(this.syncUrl)) return message;
    return message.split(this.syncUrl).join(redactSyncUrl(this.syncUrl));
  }

  // ─── connection + embedding-model compatibility (2.4) ────────────────────

  private async ensureConnected(): Promise<PgSyncClient> {
    if (this.disposed) {
      throw new Error('SyncEngine has been disposed; create a new instance to sync again.');
    }
    if (this.pgClient) return this.pgClient;
    if (!this.connectingPromise) {
      this.connectingPromise = this.connect();
    }
    await this.connectingPromise;
    if (!this.pgClient) {
      throw new Error(`Failed to establish sync connection to ${redactSyncUrl(this.syncUrl)}`);
    }
    return this.pgClient;
  }

  private async connect(): Promise<void> {
    try {
      this.pgConn = await createPgSyncConnection(this.syncUrl);
      this.pgClient = new PgSyncClient({
        db: this.pgConn.db,
        pool: this.pgConn.pool,
        batchSize: LOCAL_BATCH_SIZE,
      });
      await this.checkEmbeddingModelCompatibility();
      await this.initializeEncryption();
    } catch (err) {
      this.connectingPromise = null;
      const conn = this.pgConn;
      this.pgConn = null;
      this.pgClient = null;
      this.encryptionManager = null;
      if (conn) await conn.close().catch(() => {});
      throw err;
    }
  }

  /**
   * Derives the E2E encryption key once per connection lifetime (scrypt key
   * derivation is expensive, so this must not run on every sync cycle — see
   * `./encryption.ts`). A no-op when `config.encryptionKey` isn't set, which
   * keeps push/pull byte-for-byte unchanged from before encryption existed.
   */
  private async initializeEncryption(): Promise<void> {
    if (!this.config.encryptionKey || !this.pgClient) return;
    const manager = new EncryptionManager(this.pgClient);
    await manager.initialize(this.config.encryptionKey);
    this.encryptionManager = manager;
  }

  /**
   * Guards against mixing incompatible embedding vector spaces across
   * devices (plan section 4). Runs once per connection lifetime. `null` on
   * the remote side means "unknown, assume compatible" — most rows never
   * get `embedding_model` stamped outside `NeuralBrain.store()` (plan 2.4).
   */
  private async checkEmbeddingModelCompatibility(): Promise<void> {
    if (this.embeddingModelChecked || !this.pgClient) return;

    const localModel = getEmbeddingModelId();
    const remoteModel = await this.pgClient.getRemoteEmbeddingModel();

    if (remoteModel !== null && remoteModel !== localModel) {
      throw new Error(
        `Embedding model mismatch: local uses "${localModel}" but the sync database uses "${remoteModel}". ` +
          'Mixing models would corrupt vector search. Run "engram cloud sync --re-embed" to re-generate embeddings.'
      );
    }

    writeCursor(this.db, this.syncId, { embeddingModel: localModel });
    this.embeddingModelChecked = true;
  }

  // ─── push ─────────────────────────────────────────────────────────────

  private async doPush(): Promise<SyncResult['pushed']> {
    this.currentPhase = 'push';
    const client = await this.ensureConnected();
    const cursor = readCursor(this.db, this.syncId);
    const startCursor = cursor?.lastPushAt ?? null;

    const memories = await drainPushBatches(
      (c) => selectMemoriesBatch(this.db, c, LOCAL_BATCH_SIZE),
      (rows) => client.pushMemories(this.encryptMemoriesForPush(rows)),
      (row) => row.updatedAt,
      startCursor,
      LOCAL_BATCH_SIZE
    );
    const connections = await drainPushBatches(
      (c) => selectConnectionsBatch(this.db, c, LOCAL_BATCH_SIZE),
      (rows) => client.pushConnections(rows),
      (row) => row.updatedAt,
      startCursor,
      LOCAL_BATCH_SIZE
    );
    const sessions = await drainPushBatches(
      (c) => selectSessionsBatch(this.db, c, LOCAL_BATCH_SIZE),
      (rows) => client.pushSessions(rows),
      (row) => row.updatedAt,
      startCursor,
      LOCAL_BATCH_SIZE
    );

    const overallMax = maxNullable(
      maxNullable(memories.maxUpdatedAt, connections.maxUpdatedAt),
      sessions.maxUpdatedAt
    );
    if (overallMax !== null && overallMax !== startCursor) {
      writeCursor(this.db, this.syncId, { lastPushAt: overallMax });
    }

    return { memories: memories.count, connections: connections.count, sessions: sessions.count };
  }

  /**
   * Encrypts a batch of local memory rows before they're sent to Postgres.
   * Returns new row objects — `rows` (and the SQLite rows within it) are
   * never mutated. A no-op (returns `rows` unchanged) when encryption isn't
   * configured, so push behaves exactly as before when `encryptionKey` is
   * unset. Only `memories` carries the encryptable fields (content/summary/
   * metadata/tags/embedding) — `memory_connections` and `sessions` are
   * pushed as-is.
   */
  private encryptMemoriesForPush(rows: Memory[]): Memory[] {
    const manager = this.encryptionManager;
    if (!manager?.initialized) return rows;

    return rows.map((row) => {
      const encrypted = manager.encryptRow({
        content: row.content,
        summary: row.summary,
        metadata: row.metadata,
        tags: row.tags,
        embedding: row.embedding,
      });
      return {
        ...row,
        content: encrypted.content,
        summary: encrypted.summary,
        // `metadata`/`tags` are NOT NULL columns; encryptRow's signature
        // allows null only for shared-shape reasons (decryptRow reuses it
        // too) — encrypting a non-null string never actually yields null.
        metadata: encrypted.metadata ?? row.metadata,
        tags: encrypted.tags ?? row.tags,
        embedding: encrypted.embedding,
      };
    });
  }

  // ─── pull ─────────────────────────────────────────────────────────────

  private async doPull(): Promise<{ pulled: SyncResult['pulled']; conflicts: number }> {
    this.currentPhase = 'pull';
    const client = await this.ensureConnected();
    const cursor = readCursor(this.db, this.syncId);
    const baseCursor = pullCursorWithOverlap(cursor?.pullCursor ?? null);
    const shouldApply = (deviceId: string | null): boolean => shouldApplyPulledRow(deviceId, this.deviceId);

    const memories = await drainPullBatches<PgMemory>(
      (ts, id) => client.pullMemories(ts, id, this.deviceId).then((b) => ({
        rows: this.decryptPulledMemories(b.memories),
        maxServerUpdatedAt: b.maxServerUpdatedAt,
        lastId: b.lastId,
        hasMore: b.hasMore,
      })),
      (row) => shouldApply(row.deviceId),
      (row) => applyPulledMemory(this.db, row),
      baseCursor
    );
    const connections = await drainPullBatches<PgMemoryConnection>(
      (ts, id) => client.pullConnections(ts, id, this.deviceId).then((b) => ({
        rows: b.connections,
        maxServerUpdatedAt: b.maxServerUpdatedAt,
        lastId: b.lastId,
        hasMore: b.hasMore,
      })),
      (row) => shouldApply(row.deviceId),
      (row) => applyPulledConnection(this.db, row),
      baseCursor
    );
    const sessions = await drainPullBatches<PgSession>(
      (ts, id) => client.pullSessions(ts, id, this.deviceId).then((b) => ({
        rows: b.sessions,
        maxServerUpdatedAt: b.maxServerUpdatedAt,
        lastId: b.lastId,
        hasMore: b.hasMore,
      })),
      (row) => shouldApply(row.deviceId),
      (row) => applyPulledSession(this.db, row),
      baseCursor
    );

    const overallMax = maxNullable(
      maxNullable(memories.maxServerUpdatedAt, connections.maxServerUpdatedAt),
      sessions.maxServerUpdatedAt
    );
    if (overallMax !== null) {
      writeCursor(this.db, this.syncId, { pullCursor: overallMax });
    }

    if (memories.applied > 0 && this.config.onIndexRebuildNeeded) {
      await this.config.onIndexRebuildNeeded();
    }

    return {
      pulled: { memories: memories.applied, connections: connections.applied, sessions: sessions.applied },
      conflicts: memories.conflicts + connections.conflicts + sessions.conflicts,
    };
  }

  /**
   * Decrypts a batch of remote memory rows right after they're pulled from
   * Postgres, before conflict resolution / apply ever sees them. A no-op
   * (returns `rows` unchanged) when encryption isn't configured. Rows that
   * fail to decrypt (wrong passphrase, corrupted ciphertext, or — in a
   * mixed-key rollout — data encrypted under a different key) are dropped
   * with a warning rather than aborting the sync; they stay on the server
   * and are simply not applied locally.
   */
  private decryptPulledMemories(rows: PgMemory[]): PgMemory[] {
    const manager = this.encryptionManager;
    if (!manager?.initialized) return rows;

    const decrypted: PgMemory[] = [];
    for (const row of rows) {
      const result = manager.tryDecryptRow({
        content: row.content,
        summary: row.summary,
        metadata: row.metadata,
        tags: row.tags,
        embedding: row.embedding,
      });
      if (!result) {
        console.warn(`[engram] Could not decrypt memory ${row.id} — skipping`);
        continue;
      }
      decrypted.push({
        ...row,
        content: result.content,
        summary: result.summary,
        // See encryptMemoriesForPush for why the `?? row.x` fallback is safe.
        metadata: result.metadata ?? row.metadata,
        tags: result.tags ?? row.tags,
        embedding: result.embedding,
      });
    }
    return decrypted;
  }
}
