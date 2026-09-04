/**
 * The CLI's half of "sync what the user configured".
 *
 * `engram cloud encrypt` tells the user to `export
 * ENGRAM_SYNC_ENCRYPTION_KEY=…`, and the MCP server honours it — but
 * `engram cloud sync` built its SyncEngine with no encryptionKey at all, so a
 * manual sync pushed the whole local database (content, summary, metadata,
 * tags, embeddings) in PLAINTEXT and its last-write-wins upsert overwrote the
 * ciphertext rows an encrypted peer had already pushed. Those peers then
 * logged "Could not decrypt", skipped the rows, and advanced their pull cursor
 * past them anyway.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import { syncEngineOptions, syncEncryptionKey } from '../syncOptions.js';

describe('syncEncryptionKey', () => {
  it('reads ENGRAM_SYNC_ENCRYPTION_KEY — the variable `engram cloud encrypt` tells users to export', () => {
    expect(syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: 'correct horse battery staple' })).toBe(
      'correct horse battery staple',
    );
  });

  it('is undefined when the variable is unset', () => {
    expect(syncEncryptionKey({})).toBeUndefined();
  });

  it('refuses a blank value instead of reading it as "no encryption wanted"', () => {
    // Hosts and shells template an untouched optional field as ''. Reading
    // that as unset made `engram cloud sync` push the whole local database in
    // plaintext while the config that set the variable still said encryption
    // was on — and the last-write-wins upsert then overwrote ciphertext rows
    // encrypted peers had already pushed. Absent means "not wanted"; empty
    // means "wanted, value lost", and only the first is safe to act on. This
    // is the rule ENGRAM_API_KEY adopted on the REST server.
    expect(() => syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: '' })).toThrow(
      /ENGRAM_SYNC_ENCRYPTION_KEY is set but empty/
    );
    expect(() => syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: '   ' })).toThrow(
      /ENGRAM_SYNC_ENCRYPTION_KEY is set but empty/
    );
  });

  it('says what unsetting it would mean, so the operator can act on the message', () => {
    expect(() => syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: '' })).toThrow(
      /Unset it to sync without end-to-end encryption/
    );
  });

  it('keeps a passphrase byte-for-byte — trimming one would derive a different key', () => {
    expect(syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: ' pass phrase ' })).toBe(' pass phrase ');
  });
});

describe('syncEngineOptions', () => {
  const config = { syncUrl: 'postgres://user:pw@host/db?sslmode=require' };

  it('carries the configured passphrase into the SyncEngine config', () => {
    const opts = syncEngineOptions(config, { ENGRAM_SYNC_ENCRYPTION_KEY: 'shared-passphrase' });
    expect(opts.encryptionKey).toBe('shared-passphrase');
  });

  it('never silently drops a configured passphrase — plaintext push is the bug', () => {
    const env = { ENGRAM_SYNC_ENCRYPTION_KEY: 'shared-passphrase' };
    expect(syncEngineOptions(config, env)).toEqual({
      syncUrl: config.syncUrl,
      mode: 'manual',
      encryptionKey: 'shared-passphrase',
    });
  });

  it('refuses to build a config from a blank passphrase', () => {
    expect(() => syncEngineOptions(config, { ENGRAM_SYNC_ENCRYPTION_KEY: '' })).toThrow(
      /ENGRAM_SYNC_ENCRYPTION_KEY is set but empty/
    );
  });

  it('omits encryptionKey entirely when nothing is configured', () => {
    const opts = syncEngineOptions(config, {});
    expect(opts.encryptionKey).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(opts, 'encryptionKey')).toBe(false);
  });

  it('runs one-shot: the CLI drives sync explicitly, it does not schedule one', () => {
    expect(syncEngineOptions(config, {}).mode).toBe('manual');
  });

  it('passes the sync URL through unchanged', () => {
    expect(syncEngineOptions(config, {}).syncUrl).toBe(config.syncUrl);
  });
});

// ─── The call sites, pinned ──────────────────────────────────────────────────

/**
 * cli.ts is a commander entrypoint with side effects on import, so it cannot
 * be exercised in-process. What matters here is structural and checkable from
 * the source: no cloud command may build a SyncEngine by hand again, because
 * hand-built config is exactly how the passphrase went missing.
 */
describe('cli.ts SyncEngine call sites', () => {
  const source = readFileSync(new URL('../cli.ts', import.meta.url), 'utf8');

  it('constructs every SyncEngine through syncEngineOptions', () => {
    const constructions = source.match(/new SyncEngine\(([^)]*)\)/g) ?? [];
    expect(constructions.length).toBeGreaterThan(0);
    for (const construction of constructions) {
      expect(construction, `hand-built SyncEngine config: ${construction}`).toContain('syncEngineOptions(');
    }
  });

  it('never inlines a SyncEngine config that omits the passphrase', () => {
    expect(source).not.toMatch(/new SyncEngine\(\{\s*syncUrl:/);
  });

  /**
   * ENGRAM_DEVICE_NAME was written into the server's environment by both
   * `engram start` and `engram update`, and no process has ever read it: the
   * server identifies itself by the per-install device id core mints in
   * sync/deviceId.ts, and `deviceName` is a CLI-side display label read
   * straight from this config file. A setting that looks configurable and
   * reaches nothing is worse than no setting, so the write was removed rather
   * than wired up.
   */
  it('does not export a device name nothing reads', () => {
    expect(source).not.toContain('ENGRAM_DEVICE_NAME:');
  });

  /**
   * Loading core costs ~110ms of module evaluation, and the CLI's whole point
   * is that data commands speak HTTP to the server instead. syncOptions.ts
   * reads the passphrase through core's env helpers, so it has to arrive
   * through a dynamic import inside the cloud commands, not at the top of the
   * file where `engram store` would pay for it.
   */
  it('never imports syncOptions (and through it, core) at module scope', () => {
    expect(source).not.toMatch(/^import .*from '\.\/syncOptions\.js'/m);
    expect(source).toMatch(/await import\('\.\/syncOptions\.js'\)/);
  });

  it('never imports core at module scope either', () => {
    expect(source).not.toMatch(/^import .*from '@engram-ai-memory\/core'/m);
  });
});
