/**
 * Barrel export for Engram's multi-device sync module (Phase 2). See
 * `.claude/PRPs/plans/postgres-cloud-sync.md` for the design this
 * implements.
 */

export { SyncEngine } from './SyncEngine.js';
export type { SyncConfig, SyncStatus, SyncResult } from './SyncEngine.js';

export { getDeviceId } from './deviceId.js';

export { PgSyncClient } from './PgSyncClient.js';
export type { PushBatch, PullBatch, PgSyncClientOptions } from './PgSyncClient.js';

// Re-exported for testing/extension — conflict resolution and cursor
// bookkeeping are pure/standalone enough to be useful outside SyncEngine.
export type { MergeResult } from './conflict.js';
export { compareLWW, shouldApplyPulledRow } from './conflict.js';
export type { CursorState } from './cursor.js';
export { computeSyncId } from './cursor.js';
