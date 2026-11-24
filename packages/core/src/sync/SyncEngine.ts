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

import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';
import { createPgSyncConnection, redactSyncUrl } from '../db/pg/connection.js';
import type { PgSyncConnection } from '../db/pg/connection.js';
import { getEmbeddingModelId } from '../embedding/Embedder.js';
import { DEFAULT_DECAY_CONFLICT_WINDOW_MS } from '../lifecycle/DecayPolicy.js';
import type { DecayPolicyConfig } from '../lifecycle/DecayPolicy.js';
import { getDeviceId } from './deviceId.js';
import {
  computeSyncId, migrateLegacySyncState, pullCursorWithOverlap, readCursor, writeCursor,
} from './cursor.js';
import { shouldApplyPulledRow } from './conflict.js';
import { PgSyncClient } from './PgSyncClient.js';
import { EncryptionManager } from './encryption.js';
import {
  countPendingPush, initializeAccessQueue, selectAccessCountersBatch, selectConnectionsBatch, selectMemoriesBatch, selectSessionsBatch,
} from './syncLocalReads.js';
import type { SyncDb } from './syncLocalReads.js';
import {
  applyMergedAccessCounters, applyPulledConnection, applyPulledMemory, applyPulledSession,
} from './syncApply.js';
import { drainPullBatches, drainPushBatches, maxNullable } from './syncLoops.js';
import {
  decryptPulledConnections, decryptPulledMemories, decryptPulledSessions,
  encryptConnectionsForPush, encryptMemoriesForPush, encryptSessionsForPush,
} from './syncCrypto.js';

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
   * Called after `pull()` applies at least one new/updated memory or connection locally.
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

export class SyncEngine {
  private readonly config: SyncConfig;
  private readonly syncUrl: string;
  private readonly syncId: string;
  private deviceId: string;
  private readonly db: SyncDb;

  private pgConn: PgSyncConnection | null = null;
  private pgClient: PgSyncClient | null = null;
  private connectingPromise: Promise<void> | null = null;
  private checkedEmbeddingModel: string | null = null;
  private encryptionManager: EncryptionManager | null = null;

  private intervalTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  private inFlight: Promise<SyncResult> | null = null;
  private currentPhase: 'push' | 'pull' | null = null;
  private backoffMs = BACKOFF_INITIAL_MS;
  private nextRetryAt = 0;

  private disposed = false;
  private readonly onBeforeExit = (): void => {
    void this.stop();
  };

  constructor(config: SyncConfig) {
    this.config = { ...config, mode: config.mode ?? 'auto' };
    this.syncUrl = config.syncUrl;
    this.syncId = computeSyncId(config.syncUrl);
    this.deviceId = getDeviceId();
    this.db = getDb();
    // Retire ambiguous target keys before any scan reads a checkpoint.
    migrateLegacySyncState(this.db, config.syncUrl);
    process.once('beforeExit', this.onBeforeExit);
  }

  // ─── public API ───────────────────────────────────────────────────────

  /** One-shot full sync: push then pull. Only one sync/push/pull runs at a time. */
  async sync({ skipEmbeddingModelCheck = false } = {}): Promise<SyncResult> {
    return this.runGuarded(async () => {
      const pushed = await this.doPush(skipEmbeddingModelCheck);
      const { pulled, conflicts } = await this.doPull(skipEmbeddingModelCheck);
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
    const deviceId = this.currentPhase ? this.deviceId : getDeviceId();
    const cursor = readCursor(this.db, this.syncId);
    const state: SyncStatus['state'] = this.currentPhase
      ? this.currentPhase === 'push' ? 'pushing' : 'pulling'
      : cursor?.lastError
        ? 'error'
        : 'idle';

    return {
      state,
      lastSyncAt: cursor?.lastSyncAt ?? null,
      pendingPushCount: countPendingPush(this.db, cursor?.lastPushAt ?? null, LOCAL_BATCH_SIZE, deviceId),
      lastError: cursor?.lastError ?? null,
      pullCursor: cursor?.pullCursor ?? null,
      deviceId,
      embeddingModel: cursor?.embeddingModel ?? null,
    };
  }

  /** Start the background scheduler (interval + debounce). Idempotent; a no-op unless mode is 'auto'. */
  start(): void {
    if (this.intervalTimer || this.config.mode !== 'auto') return;

    const intervalMs = this.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.intervalTimer = setInterval(() => this.syncAutomatically(), intervalMs);
    this.intervalTimer.unref?.();

    this.syncAutomatically();
  }

  private syncAutomatically(): void {
    if (this.inFlight || Date.now() < this.nextRetryAt) return;
    // runGuarded records the error and reports it through onSyncError.
    this.sync().catch(() => {});
  }

  /** Notify the engine that a local write happened (triggers a debounced sync in 'auto' mode). */
  notifyWrite(): void {
    if (this.config.mode !== 'auto') return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const debounceMs = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.syncAutomatically();
    }, Math.max(debounceMs, this.nextRetryAt - Date.now()));
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
   * Runs `fn` with the "only one sync at a time" guard. A concurrent
   * request gets a busy error. On success, records `lastSyncAt` and resets
   * backoff; on failure, records `lastError` (redacted), grows backoff, and
   * rethrows so callers (including the scheduler, and its no-op catch
   * above) see the failure.
   */
  private async runGuarded(fn: () => Promise<Omit<SyncResult, 'durationMs'>>): Promise<SyncResult> {
    if (this.inFlight) {
      throw Object.assign(new Error('A sync operation is already in progress.'), { statusCode: 409 });
    }

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
      this.deviceId = getDeviceId();
      const partial = await fn();
      const result: SyncResult = { ...partial, durationMs: Date.now() - start };
      this.backoffMs = BACKOFF_INITIAL_MS;
      this.nextRetryAt = 0;
      writeCursor(this.db, this.syncId, {
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      });
      this.currentPhase = null;
      this.config.onSyncStatus?.(this.status());
      return result;
    } catch (err) {
      this.currentPhase = null;
      this.handleSyncError(err);
      this.config.onSyncStatus?.(this.status());
      throw err;
    }
  }

  private handleSyncError(error: unknown): void {
    const message = this.redactMessage(error instanceof Error ? error.message : String(error));
    writeCursor(this.db, this.syncId, { lastError: message });
    this.nextRetryAt = Date.now() + this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.config.onSyncError?.(error instanceof Error ? error : new Error(message));
  }

  /** Strips a raw, unredacted sync URL out of an error message, if one leaked into it. */
  private redactMessage(message: string): string {
    if (!message.includes(this.syncUrl)) return message;
    return message.split(this.syncUrl).join(redactSyncUrl(this.syncUrl));
  }

  // ─── connection + embedding-model compatibility (2.4) ────────────────────

  private async ensureConnected(skipEmbeddingModelCheck: boolean): Promise<PgSyncClient> {
    if (this.disposed) {
      throw new Error('SyncEngine has been disposed; create a new instance to sync again.');
    }
    if (this.pgClient) {
      await this.checkEmbeddingModelCompatibility(skipEmbeddingModelCheck);
      return this.pgClient;
    }
    if (!this.connectingPromise) {
      this.connectingPromise = this.connect(skipEmbeddingModelCheck);
    }
    await this.connectingPromise;
    if (!this.pgClient) {
      throw new Error(`Failed to establish sync connection to ${redactSyncUrl(this.syncUrl)}`);
    }
    return this.pgClient;
  }

  private async connect(skipEmbeddingModelCheck: boolean): Promise<void> {
    try {
      this.pgConn = await createPgSyncConnection(this.syncUrl);
      this.pgClient = new PgSyncClient({
        db: this.pgConn.db,
        pool: this.pgConn.pool,
        batchSize: LOCAL_BATCH_SIZE,
        requireUnencrypted: !this.config.encryptionKey,
      });
      await this.checkEmbeddingModelCompatibility(skipEmbeddingModelCheck);
      await this.initializeEncryption();
      initializeAccessQueue(this.db, this.syncId);
    } catch (err) {
      this.connectingPromise = null;
      const conn = this.pgConn;
      this.pgConn = null;
      this.pgClient = null;
      this.encryptionManager = null;
      this.checkedEmbeddingModel = null;
      if (conn) await conn.close().catch(() => {});
      throw err;
    }
  }

  /**
   * Derives the E2E encryption key once per connection lifetime (scrypt key
   * derivation is expensive, so this must not run on every sync cycle — see
   * `./encryption.ts`).
   *
   * With no passphrase configured this is a no-op *only* against a database
   * that was never encrypted, which keeps push/pull byte-for-byte unchanged
   * from before encryption existed. Against an encrypted one it refuses to
   * connect: pushing would send this device's whole database in plaintext,
   * and the last-write-wins upsert would overwrite ciphertext rows that
   * encrypted peers had already pushed — silently and irreversibly
   * downgrading the store for everyone.
   */
  private async initializeEncryption(): Promise<void> {
    if (!this.pgClient) return;

    if (!this.config.encryptionKey) {
      await this.pgClient.assertUnencrypted();
      return;
    }

    const manager = new EncryptionManager(this.pgClient);
    await manager.initialize(this.config.encryptionKey);
    this.encryptionManager = manager;
  }

  /**
   * Guards against mixing incompatible embedding vector spaces across
   * devices on connection and whenever this process switches models.
   */
  private async checkEmbeddingModelCompatibility(skipEmbeddingModelCheck: boolean): Promise<void> {
    if (skipEmbeddingModelCheck) {
      // The next normal cycle must read the claim after remote conversion.
      this.checkedEmbeddingModel = null;
      return;
    }
    const localModel = getEmbeddingModelId();
    if (localModel === this.checkedEmbeddingModel || !this.pgClient) return;
    await this.pgClient.assertEmbeddingModel(localModel);

    writeCursor(this.db, this.syncId, { embeddingModel: localModel });
    this.checkedEmbeddingModel = localModel;
  }

  // ─── push ─────────────────────────────────────────────────────────────

  private assertDeviceIdCurrent(): void {
    if (this.deviceId !== getDeviceId()) throw new Error('Device ID changed during sync. Retry with the new identity.');
  }

  private checkpointScan(checkpoint: { lastPushAt: string } | { pullCursor: string }): void {
    this.db.transaction((tx) => {
      this.assertDeviceIdCurrent();
      writeCursor(tx, this.syncId, checkpoint);
    }, { behavior: 'immediate' });
  }

  private async doPush(skipEmbeddingModelCheck = false): Promise<SyncResult['pushed']> {
    this.currentPhase = 'push';
    const scanStartedAt = new Date().toISOString();
    const client = await this.ensureConnected(skipEmbeddingModelCheck);
    // Attribute legacy rows on the device that owns them, without changing
    // their edit timestamps. The server cannot determine a NULL row's owner.
    this.db.transaction((tx) => {
      this.assertDeviceIdCurrent();
      for (const table of [schema.memories, schema.memoryConnections, schema.sessions]) {
        tx.update(table).set({ deviceId: this.deviceId }).where(isNull(table.deviceId)).run();
      }
    }, { behavior: 'immediate' });

    const storedPolicy = this.db.select().from(schema.localMeta)
      .where(eq(schema.localMeta.key, 'decay_policy')).get();
    const policy = storedPolicy ? JSON.parse(storedPolicy.value) as Partial<DecayPolicyConfig> : {};
    const overlapMs = policy.decayConflictWindowMs ?? DEFAULT_DECAY_CONFLICT_WINDOW_MS;
    const cursor = readCursor(this.db, this.syncId);
    const startCursor = cursor?.lastPushAt ?? null;
    const decayKey = eq(schema.localMeta.key, `sync_decay:${this.syncId}`);
    const decay = this.db.select({ value: schema.localMeta.value,
      stamp: sql<string>`json_extract(${schema.localMeta.value}, '$[0]')`,
    }).from(schema.localMeta).where(decayKey).get();
    const memoryOverlapMs = Math.max(overlapMs, decay && startCursor ? Date.parse(startCursor) - Date.parse(decay.stamp) : 0);

    const memories = await drainPushBatches(
      (c) => selectMemoriesBatch(this.db, c, LOCAL_BATCH_SIZE, this.deviceId, memoryOverlapMs),
      // `pushMemoriesMerging` rather than `pushMemories`: the MAX merge on
      // access bookkeeping happens server-side, and a device that wins
      // last-write-wins never pulls its own row back, so this is the only
      // point at which it can learn the merged counters.
      async (rows) => {
        const result = await client.pushMemoriesMerging(
          encryptMemoriesForPush(this.encryptionManager, rows), skipEmbeddingModelCheck
        );
        for (const counters of result.merged) applyMergedAccessCounters(this.db, counters);
        return result.applied;
      },
      (row) => row.updatedAt,
      (row) => row.id,
      startCursor,
      LOCAL_BATCH_SIZE
    );
    // Older clients checkpointed skipped pair collisions. Revisit those edges
    // once per target, even when both ordinary cursors have moved past them.
    const pairsKey = `sync_connection_pairs:${this.syncId}`;
    const pairScan = this.db.select({ value: schema.localMeta.value }).from(schema.localMeta)
      .where(eq(schema.localMeta.key, pairsKey)).get();
    let appliedEdge = false;
    const connections = await drainPushBatches(
      (c) => selectConnectionsBatch(this.db, c, LOCAL_BATCH_SIZE, this.deviceId, overlapMs),
      (rows) => client.pushConnections(encryptConnectionsForPush(this.encryptionManager, rows), async (row) => {
        const stored = await client.getConnectionByPair(row);
        const metadata = this.encryptionManager?.decryptConnection(stored).metadata ?? stored.metadata;
        const { applied, pendingPush } = applyPulledConnection(this.db, { ...stored, metadata }, this.syncId);
        appliedEdge ||= applied;
        return pendingPush ? client.pushConnections(encryptConnectionsForPush(this.encryptionManager, [pendingPush])) : 0;
      }),
      (row) => row.updatedAt,
      (row) => row.id,
      pairScan?.value === 'done' ? startCursor : null,
      LOCAL_BATCH_SIZE
    );
    if (pairScan?.value !== 'done') {
      // A concurrent pull can rekey another edge while this scan is in flight.
      // Acknowledge only the scan we started, so that edge stays eligible.
      this.db.insert(schema.localMeta).values({ key: pairsKey, value: 'done' }).onConflictDoUpdate({
        target: schema.localMeta.key, set: { value: 'done' },
        setWhere: eq(schema.localMeta.value, pairScan?.value ?? 'done'),
      }).run();
    }
    if (appliedEdge) await this.config.onIndexRebuildNeeded?.();
    const sessions = await drainPushBatches(
      (c) => selectSessionsBatch(this.db, c, LOCAL_BATCH_SIZE, this.deviceId, overlapMs),
      (rows) => client.pushSessions(encryptSessionsForPush(this.encryptionManager, rows)),
      (row) => row.updatedAt,
      (row) => row.id,
      startCursor,
      LOCAL_BATCH_SIZE
    );

    const accesses = await this.pushAccessCounters(client);

    // A scan covers edits through its start; later commits remain eligible
    // next cycle. Idle scans advance too, so old overlap rows age out.
    this.checkpointScan({ lastPushAt: scanStartedAt });
    if (decay) this.db.delete(schema.localMeta).where(and(decayKey, eq(schema.localMeta.value, decay.value))).run();

    return { memories: memories.count + accesses, connections: connections.count, sessions: sessions.count };
  }

  private async pushAccessCounters(client: PgSyncClient): Promise<number> {
    let afterKey = '';
    let applied = 0;
    for (;;) {
      const rows = selectAccessCountersBatch(this.db, this.syncId, afterKey, LOCAL_BATCH_SIZE);
      if (rows.length === 0) break;
      applied += await client.pushAccessCounters(rows);
      // A recall committed while the batch was in flight keeps its newer
      // snapshot in the queue. A failed push leaves the entire page pending.
      this.db.transaction((tx) => {
        for (const row of rows) {
          tx.delete(schema.localMeta).where(and(eq(schema.localMeta.key, row.key),
            eq(schema.localMeta.value, row.value))).run();
        }
      });
      if (rows.length < LOCAL_BATCH_SIZE) break;
      afterKey = rows[rows.length - 1]!.key;
    }
    return applied;
  }

  // ─── pull ─────────────────────────────────────────────────────────────

  private async doPull(skipEmbeddingModelCheck = false): Promise<{ pulled: SyncResult['pulled']; conflicts: number }> {
    this.currentPhase = 'pull';
    const client = await this.ensureConnected(skipEmbeddingModelCheck);
    const cursor = readCursor(this.db, this.syncId);
    const baseCursor = pullCursorWithOverlap(cursor?.pullCursor ?? null);
    const scanStartedAt = await client.getPullStartTime();
    const shouldApply = (deviceId: string | null): boolean => shouldApplyPulledRow(deviceId, this.deviceId);
    const manager = this.encryptionManager;

    const memories = await drainPullBatches<PgMemory>(
      (ts, id) => client.pullMemories(ts, id, this.deviceId).then((b) =>
        decryptPulledMemories(manager, { ...b, rows: b.memories })),
      (row) => shouldApply(row.deviceId),
      (row) => applyPulledMemory(this.db, row),
      baseCursor
    );
    const accesses = await drainPullBatches(
      (ts, id) => client.pullOwnedAccessCounters(ts, id, this.deviceId),
      () => true,
      (row) => {
        applyMergedAccessCounters(this.db, row);
        return { applied: false, conflict: false };
      },
      baseCursor
    );
    const connections = await drainPullBatches<PgMemoryConnection>(
      (ts, id) => client.pullConnections(ts, id, this.deviceId).then((b) =>
        decryptPulledConnections(manager, { ...b, rows: b.connections })),
      (row) => shouldApply(row.deviceId),
      (row) => applyPulledConnection(this.db, row, this.syncId),
      baseCursor
    );
    const sessions = await drainPullBatches<PgSession>(
      (ts, id) => client.pullSessions(ts, id, this.deviceId).then((b) =>
        decryptPulledSessions(manager, { ...b, rows: b.sessions })),
      (row) => shouldApply(row.deviceId),
      (row) => applyPulledSession(this.db, row),
      baseCursor
    );

    const overallMax = maxNullable(
      maxNullable(memories.maxServerUpdatedAt, connections.maxServerUpdatedAt),
      maxNullable(sessions.maxServerUpdatedAt, accesses.maxServerUpdatedAt)
    );
    // One cursor covers all three tables, so a table that stopped on an
    // undecryptable row can still be jumped over by another table's
    // progress. When anything is blocked, hold the cursor entirely — the
    // page is re-pulled next cycle (loudly), rather than the blocked row
    // and everything near it ageing out of the 5-minute overlap unnoticed.
    const blocked = memories.blocked || connections.blocked || sessions.blocked;
    if (overallMax !== null && !blocked) {
      const pullCursor = overallMax > scanStartedAt ? scanStartedAt : overallMax;
      this.checkpointScan({ pullCursor });
    }

    if ((memories.applied > 0 || connections.applied > 0) && this.config.onIndexRebuildNeeded) {
      await this.config.onIndexRebuildNeeded();
    }
    if (blocked) {
      throw new Error('Pull blocked by decryption failure. Check ENGRAM_SYNC_ENCRYPTION_KEY and the row identified in the warning.');
    }

    return {
      pulled: { memories: memories.applied, connections: connections.applied, sessions: sessions.applied },
      conflicts: memories.conflicts + connections.conflicts + sessions.conflicts,
    };
  }
}
