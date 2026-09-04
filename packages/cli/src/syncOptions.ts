/**
 * SyncEngine configuration for the CLI's one-shot cloud commands.
 *
 * Extracted from cli.ts so there is exactly one place that decides what a
 * CLI-driven sync is configured with, and so it can be tested — cli.ts itself
 * is a commander entrypoint with side effects on import.
 *
 * The reason this exists: `engram cloud sync` and `engram cloud status` each
 * built `new SyncEngine({ syncUrl, mode: 'manual' })` inline with NO
 * encryptionKey, while `engram cloud encrypt` was telling the user to export
 * ENGRAM_SYNC_ENCRYPTION_KEY and the MCP server was honouring it. A manual
 * sync therefore pushed the entire local database in plaintext, and the
 * last-write-wins upsert overwrote the ciphertext rows encrypted peers had
 * already pushed — after which those peers could only log "Could not decrypt",
 * skip the rows, and advance their pull cursor past them.
 */

import { requireConfiguredEnv } from '@engram-ai-memory/core';
import type { SyncConfig } from '@engram-ai-memory/core';

/** The subset of the CLI config a sync needs. */
export interface SyncCommandConfig {
  syncUrl: string;
}

/** Environment as this module reads it — injected so it can be tested. */
export type SyncEnv = Readonly<Record<string, string | undefined>>;

/**
 * The passphrase for E2E encryption of synced rows, read from the variable
 * `engram cloud encrypt` prints and the MCP server reads
 * (packages/mcp/src/server.ts).
 *
 * Set-but-empty is REFUSED rather than read as "no encryption configured".
 * Blank is what a host or shell exporting an untouched optional field hands
 * over, and treating it as unset means `engram cloud sync` pushes the whole
 * local database in plaintext while the config that set the variable still
 * says encryption is on. That is the same reading ENGRAM_API_KEY rejected on
 * the REST server: absent means "not wanted", empty means "wanted, value
 * lost", and only the first is safe to act on. A non-blank value is passed
 * through byte-for-byte — trimming it would derive a different key and make
 * every previously-encrypted row unreadable.
 */
export function syncEncryptionKey(env: SyncEnv = process.env): string | undefined {
  return requireConfiguredEnv(
    env,
    'ENGRAM_SYNC_ENCRYPTION_KEY',
    'Unset it to sync without end-to-end encryption, or export the passphrase ' +
      '`engram cloud encrypt` printed — an empty value used to sync in plaintext ' +
      'silently.'
  );
}

/**
 * Config for a CLI-driven SyncEngine: one-shot ('manual' — the command calls
 * sync() itself) and encrypted whenever the user configured a passphrase.
 */
export function syncEngineOptions(config: SyncCommandConfig, env: SyncEnv = process.env): SyncConfig {
  const encryptionKey = syncEncryptionKey(env);
  return {
    syncUrl: config.syncUrl,
    mode: 'manual',
    ...(encryptionKey ? { encryptionKey } : {}),
  };
}
