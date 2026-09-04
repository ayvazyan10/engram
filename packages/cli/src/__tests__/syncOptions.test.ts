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

  it('treats a blank value as unset rather than as an empty passphrase', () => {
    // Same class of bug as the empty ENGRAM_DB_PATH: hosts template an unset
    // optional field as ''. An empty passphrase must never look configured.
    expect(syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: '' })).toBeUndefined();
    expect(syncEncryptionKey({ ENGRAM_SYNC_ENCRYPTION_KEY: '   ' })).toBeUndefined();
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
});
