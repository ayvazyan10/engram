/**
 * Environment parsing for the MCP server.
 *
 * Every one of these variables arrives from a host that templates optional
 * config fields as EMPTY STRINGS, so "unset" and "" have to mean the same
 * thing — and anything that is neither has to be refused rather than cast.
 * ENGRAM_SYNC_MODE was cast straight to a union and ENGRAM_SYNC_INTERVAL ran
 * through `parseInt` with no check, so "hourly" became a mode nothing
 * understands and "soon" became `intervalMs: NaN` — a timer that fires
 * immediately, forever, against the user's sync server.
 */

import { describe, it, expect } from 'vitest';
import { resolveNamespaceSettings } from '../namespaceEnv.js';
import { readSyncSettings, syncEngineConfig } from '../syncSettings.js';

describe('resolveNamespaceSettings', () => {
  it('defaults to none when nothing is configured', () => {
    expect(resolveNamespaceSettings({})).toEqual({ namespaceMode: 'none', namespace: undefined });
  });

  it('derives filter mode from a bare namespace', () => {
    expect(resolveNamespaceSettings({ ENGRAM_NAMESPACE: 'work' }))
      .toEqual({ namespaceMode: 'filter', namespace: 'work' });
  });

  it('honours an explicit mode', () => {
    expect(resolveNamespaceSettings({ ENGRAM_NAMESPACE_MODE: 'isolated', ENGRAM_NAMESPACE: 'work' }))
      .toEqual({ namespaceMode: 'isolated', namespace: 'work' });
  });

  it('treats the empty strings a host templates as unset', () => {
    expect(resolveNamespaceSettings({ ENGRAM_NAMESPACE_MODE: '', ENGRAM_NAMESPACE: '' }))
      .toEqual({ namespaceMode: 'none', namespace: undefined });
  });

  it('refuses a mode it does not recognise rather than downgrading to none', () => {
    expect(() => resolveNamespaceSettings({ ENGRAM_NAMESPACE_MODE: 'private' }))
      .toThrow(/ENGRAM_NAMESPACE_MODE must be one of/);
  });
});

describe('readSyncSettings', () => {
  it('reports sync off when no URL is configured', () => {
    expect(readSyncSettings({}).syncUrl).toBeUndefined();
  });

  it('defaults to auto mode with no interval override', () => {
    const settings = readSyncSettings({ ENGRAM_SYNC_URL: 'postgres://host/db' });
    expect(settings).toEqual({
      syncUrl: 'postgres://host/db',
      mode: 'auto',
      intervalMs: undefined,
      encryptionKey: undefined,
    });
  });

  it('accepts each documented mode', () => {
    for (const mode of ['auto', 'manual', 'off'] as const) {
      expect(readSyncSettings({ ENGRAM_SYNC_MODE: mode }).mode).toBe(mode);
    }
  });

  it('treats a blank mode as unset instead of failing on an untouched field', () => {
    expect(readSyncSettings({ ENGRAM_SYNC_MODE: '' }).mode).toBe('auto');
  });

  it('refuses a mode nothing implements', () => {
    expect(() => readSyncSettings({ ENGRAM_SYNC_MODE: 'hourly' }))
      .toThrow(/ENGRAM_SYNC_MODE must be one of: auto, manual, off/);
  });

  it('parses a positive interval', () => {
    expect(readSyncSettings({ ENGRAM_SYNC_INTERVAL: '60000' }).intervalMs).toBe(60000);
  });

  it('treats a blank interval as unset', () => {
    expect(readSyncSettings({ ENGRAM_SYNC_INTERVAL: '  ' }).intervalMs).toBeUndefined();
  });

  it('refuses an interval that is not a positive whole number of milliseconds', () => {
    for (const bad of ['soon', '0', '-5', '1.5', '10abc', 'NaN']) {
      expect(() => readSyncSettings({ ENGRAM_SYNC_INTERVAL: bad }), bad)
        .toThrow(/ENGRAM_SYNC_INTERVAL/);
    }
  });

  it('passes the encryption passphrase through byte-for-byte, blank meaning unset', () => {
    expect(readSyncSettings({ ENGRAM_SYNC_ENCRYPTION_KEY: '  spaced  key  ' }).encryptionKey).toBe('  spaced  key  ');
    expect(readSyncSettings({ ENGRAM_SYNC_ENCRYPTION_KEY: '' }).encryptionKey).toBeUndefined();
  });
});

describe('syncEngineConfig', () => {
  const settings = { syncUrl: 'postgres://host/db', mode: 'auto' as const, intervalMs: 5000, encryptionKey: 'pass' };

  it('carries the settings into the engine config', () => {
    const config = syncEngineConfig(settings, { rebuildIndex: async () => {}, logError: () => {} });
    expect(config.syncUrl).toBe('postgres://host/db');
    expect(config.mode).toBe('auto');
    expect(config.intervalMs).toBe(5000);
    expect(config.encryptionKey).toBe('pass');
  });

  it('rebuilds the index when the engine asks for it', async () => {
    let rebuilt = 0;
    const config = syncEngineConfig(settings, { rebuildIndex: async () => { rebuilt++; }, logError: () => {} });
    await config.onIndexRebuildNeeded?.();
    expect(rebuilt).toBe(1);
  });

  it('reports a sync error instead of letting it disappear', () => {
    const logged: string[] = [];
    const config = syncEngineConfig(settings, { rebuildIndex: async () => {}, logError: (m) => logged.push(m) });
    config.onSyncError?.(new Error('connection reset'));
    expect(logged).toEqual(['[engram] Sync error: connection reset']);
  });

  it('omits an unset interval and passphrase rather than passing undefined through', () => {
    const config = syncEngineConfig(
      { syncUrl: 'postgres://host/db', mode: 'manual', intervalMs: undefined, encryptionKey: undefined },
      { rebuildIndex: async () => {}, logError: () => {} },
    );
    expect('intervalMs' in config).toBe(false);
    expect('encryptionKey' in config).toBe(false);
  });
});
