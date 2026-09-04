/**
 * Cloud-sync configuration, read from the environment and checked.
 *
 * ENGRAM_SYNC_MODE was cast straight to `'auto' | 'manual' | 'off'` and
 * ENGRAM_SYNC_INTERVAL went through `parseInt` with nothing looking at the
 * result. A typo in either reached the sync engine intact: an unknown mode
 * behaves like whichever branch the engine falls through to, and
 * `intervalMs: NaN` schedules a timer that fires immediately and never stops —
 * a loop against the user's own Postgres. Both are refused here, at startup,
 * where the message can still name the variable.
 */

import type { SyncConfig } from '@engram-ai-memory/core';

export const SYNC_MODES = ['auto', 'manual', 'off'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export interface SyncSettings {
  /** undefined when sync is not configured — nothing else is constructed then. */
  readonly syncUrl: string | undefined;
  readonly mode: SyncMode;
  readonly intervalMs: number | undefined;
  readonly encryptionKey: string | undefined;
}

/** Environment as this module reads it — injected so it can be tested. */
export type SyncEnv = Readonly<Record<string, string | undefined>>;

/** Blank means "not configured": hosts template untouched fields as ''. */
function present(raw: string | undefined): string | undefined {
  return raw && raw.trim().length > 0 ? raw : undefined;
}

function resolveMode(raw: string | undefined): SyncMode {
  const value = present(raw);
  if (value === undefined) return 'auto';
  if (!SYNC_MODES.includes(value as SyncMode)) {
    throw new Error(`ENGRAM_SYNC_MODE must be one of: ${SYNC_MODES.join(', ')} (got ${JSON.stringify(value)})`);
  }
  return value as SyncMode;
}

function resolveInterval(raw: string | undefined): number | undefined {
  const value = present(raw);
  if (value === undefined) return undefined;
  // Not parseInt: it reads "10abc" as 10 and "soon" as NaN, and both used to
  // reach setInterval unchallenged.
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `ENGRAM_SYNC_INTERVAL must be a positive whole number of milliseconds (got ${JSON.stringify(value)})`,
    );
  }
  return parsed;
}

export function readSyncSettings(env: SyncEnv): SyncSettings {
  return {
    syncUrl: present(env['ENGRAM_SYNC_URL']),
    mode: resolveMode(env['ENGRAM_SYNC_MODE']),
    intervalMs: resolveInterval(env['ENGRAM_SYNC_INTERVAL']),
    // Passed through byte-for-byte: trimming it would derive a different key
    // and make every previously-encrypted row unreadable.
    encryptionKey: present(env['ENGRAM_SYNC_ENCRYPTION_KEY']),
  };
}

/** What the sync engine calls back into. Injected so both hooks are testable. */
export interface SyncHooks {
  rebuildIndex(): Promise<void>;
  logError(message: string): void;
}

/**
 * Build the SyncEngine configuration, including the two callbacks the engine
 * uses to reach back into the brain and the log.
 */
export function syncEngineConfig(settings: SyncSettings, hooks: SyncHooks): SyncConfig {
  return {
    syncUrl: settings.syncUrl ?? '',
    mode: settings.mode,
    ...(settings.intervalMs !== undefined ? { intervalMs: settings.intervalMs } : {}),
    ...(settings.encryptionKey !== undefined ? { encryptionKey: settings.encryptionKey } : {}),
    onIndexRebuildNeeded: async () => {
      await hooks.rebuildIndex();
    },
    onSyncError: (err: Error) => {
      hooks.logError(`[engram] Sync error: ${err.message}`);
    },
  };
}
