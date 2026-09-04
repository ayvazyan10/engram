/**
 * ~/.engram/config.json is hand-editable, and nothing checked what came out of
 * it. Three separate failures came from that:
 *
 *  - `port` was never validated. It reached `lsof` (a shell command string
 *    until the fix in serverControl.ts), the API base URL, and the child
 *    server's PORT, whatever it held.
 *  - `configure set` gated on `key in config`, which is true for every
 *    prototype member — `engram configure set constructor x` passed validation
 *    and was written to disk — and false for optional keys that are not
 *    currently present, so `configure set syncInterval 60000` was rejected as
 *    an unknown key on a fresh config.
 *  - `process.env['ENGRAM_DB_PATH'] = config.dbPath || undefined` stores the
 *    STRING "undefined" when dbPath is empty, so `cloud status` and
 *    `cloud sync` opened a database called ./undefined.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  defaultConfig,
  normalizeConfig,
  isConfigKey,
  parseConfigValue,
  applyDbPathEnv,
  CONFIG_KEYS,
} from '../engramConfig.js';

const defaults = defaultConfig('/home/tester/.engram');

describe('defaultConfig', () => {
  it('roots every path in the given state directory', () => {
    expect(defaults.dbPath).toBe(path.join('/home/tester/.engram', 'engram.db'));
    expect(defaults.indexPath).toBe(path.join('/home/tester/.engram', 'engram.db.index'));
    expect(defaults.repoPath).toBe(path.join('/home/tester/.engram', 'repo'));
    expect(defaults.port).toBe(4901);
    expect(defaults.namespaceMode).toBe('none');
  });
});

describe('normalizeConfig', () => {
  it('keeps a valid stored config', () => {
    const { config, problems } = normalizeConfig({ port: 5000, host: '0.0.0.0', namespace: 'work', namespaceMode: 'isolated' }, defaults);
    expect(config.port).toBe(5000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.namespace).toBe('work');
    expect(config.namespaceMode).toBe('isolated');
    expect(problems).toEqual([]);
  });

  it('rejects a port that could reach a command line and says so', () => {
    const { config, problems } = normalizeConfig({ port: '1; touch /tmp/pwned #' }, defaults);
    expect(config.port).toBe(defaults.port);
    expect(problems.join(' ')).toMatch(/port/);
  });

  it('rejects out-of-range and non-integer ports', () => {
    for (const port of [0, -1, 65536, 1.5, null, {}, 'abc']) {
      const { config, problems } = normalizeConfig({ port }, defaults);
      expect(config.port, JSON.stringify(port)).toBe(defaults.port);
      expect(problems.length, JSON.stringify(port)).toBe(1);
    }
  });

  it('falls back to the legacy derivation for a bogus namespace mode', () => {
    expect(normalizeConfig({ namespaceMode: 'private', namespace: 'work' }, defaults).config.namespaceMode).toBe('filter');
    expect(normalizeConfig({ namespaceMode: '', namespace: null }, defaults).config.namespaceMode).toBe('none');
  });

  it('drops a sync mode and interval it does not understand instead of exporting them', () => {
    const { config, problems } = normalizeConfig({ syncMode: 'hourly', syncInterval: 'soon' }, defaults);
    expect(config.syncMode).toBeUndefined();
    expect(config.syncInterval).toBeUndefined();
    expect(problems.length).toBe(2);
  });

  it('keeps a valid sync mode and interval', () => {
    const { config } = normalizeConfig({ syncMode: 'manual', syncInterval: 60000 }, defaults);
    expect(config.syncMode).toBe('manual');
    expect(config.syncInterval).toBe(60000);
  });

  it('refuses a non-string path rather than handing it to the filesystem', () => {
    const { config, problems } = normalizeConfig({ dbPath: 42, host: 7 }, defaults);
    expect(config.dbPath).toBe(defaults.dbPath);
    expect(config.host).toBe(defaults.host);
    expect(problems.length).toBe(2);
  });

  it('treats a non-object stored config as no config at all', () => {
    expect(normalizeConfig(null, defaults).config).toEqual(defaults);
    expect(normalizeConfig('nope', defaults).config).toEqual(defaults);
    expect(normalizeConfig([1, 2], defaults).config).toEqual(defaults);
  });
});

describe('isConfigKey', () => {
  it('accepts every documented key, present in the object or not', () => {
    for (const key of CONFIG_KEYS) expect(isConfigKey(key), key).toBe(true);
    expect(isConfigKey('syncInterval')).toBe(true);
    expect(isConfigKey('deviceName')).toBe(true);
  });

  it('rejects prototype members that `key in config` accepted', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(isConfigKey(key), key).toBe(false);
    }
  });

  it('rejects anything else', () => {
    expect(isConfigKey('portt')).toBe(false);
    expect(isConfigKey('')).toBe(false);
  });
});

describe('parseConfigValue', () => {
  it('parses a port and refuses everything that is not one', () => {
    expect(parseConfigValue('port', '5000')).toEqual({ ok: true, value: 5000 });
    for (const bad of ['0', '65536', '1.5', 'abc', '']) {
      const result = parseConfigValue('port', bad);
      expect(result.ok, bad).toBe(false);
    }
  });

  it('constrains namespaceMode and syncMode to what the code implements', () => {
    expect(parseConfigValue('namespaceMode', 'isolated')).toEqual({ ok: true, value: 'isolated' });
    expect(parseConfigValue('namespaceMode', 'private').ok).toBe(false);
    expect(parseConfigValue('syncMode', 'manual')).toEqual({ ok: true, value: 'manual' });
    expect(parseConfigValue('syncMode', 'hourly').ok).toBe(false);
  });

  it('parses syncInterval as a positive whole number of milliseconds', () => {
    expect(parseConfigValue('syncInterval', '60000')).toEqual({ ok: true, value: 60000 });
    expect(parseConfigValue('syncInterval', '-1').ok).toBe(false);
    expect(parseConfigValue('syncInterval', 'soon').ok).toBe(false);
  });

  it('maps the literal null to a cleared value', () => {
    expect(parseConfigValue('namespace', 'null')).toEqual({ ok: true, value: null });
  });

  it('passes other strings through', () => {
    expect(parseConfigValue('dbPath', '/data/engram.db')).toEqual({ ok: true, value: '/data/engram.db' });
  });
});

describe('applyDbPathEnv', () => {
  it('exports a configured path', () => {
    const env: Record<string, string | undefined> = {};
    applyDbPathEnv(env, '/data/engram.db');
    expect(env['ENGRAM_DB_PATH']).toBe('/data/engram.db');
  });

  it('never writes the string "undefined" for an empty path', () => {
    const env: Record<string, string | undefined> = { ENGRAM_DB_PATH: '/old/path.db' };
    applyDbPathEnv(env, '');
    expect(env['ENGRAM_DB_PATH']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(env, 'ENGRAM_DB_PATH')).toBe(false);
  });

  it('does the same for undefined and for whitespace', () => {
    const env: Record<string, string | undefined> = { ENGRAM_DB_PATH: '/old/path.db' };
    applyDbPathEnv(env, undefined);
    expect(env['ENGRAM_DB_PATH']).toBeUndefined();
    applyDbPathEnv(env, '   ');
    expect(env['ENGRAM_DB_PATH']).toBeUndefined();
  });
});
