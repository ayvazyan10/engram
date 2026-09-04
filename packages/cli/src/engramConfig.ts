/**
 * The shape of ~/.engram/config.json, and what the CLI is willing to believe
 * about it.
 *
 * The file is hand-editable and was read with a bare `JSON.parse` + spread, so
 * whatever it held became the CLI's idea of the truth: a `port` of
 * `"1; touch /tmp/pwned #"` reached a shell command, a `dbPath` of `42` reached
 * the filesystem, and a `syncMode` of `"hourly"` was exported into the server's
 * environment. Reading is now a validation step that reports what it refused,
 * so a broken field falls back to the default AND says so instead of quietly
 * changing where the CLI points.
 */

import path from 'path';

export const NAMESPACE_MODES = ['none', 'filter', 'isolated'] as const;
export type NamespaceModeName = (typeof NAMESPACE_MODES)[number];

export const SYNC_MODES = ['auto', 'manual', 'off'] as const;
export type SyncModeName = (typeof SYNC_MODES)[number];

export interface EngramConfig {
  dbPath: string;
  port: number;
  host: string;
  namespace: string | null;
  namespaceMode: NamespaceModeName;
  embeddingModel: string;
  indexPath: string;
  repoPath: string;
  syncUrl?: string;
  syncInterval?: number;
  syncMode?: SyncModeName;
  deviceName?: string;
}

/**
 * Every key `engram configure set` accepts.
 *
 * An explicit list, not `key in config`: `in` walks the prototype chain, so
 * `configure set constructor x` passed the check and was written to the file,
 * and it is false for optional keys that are absent, so `configure set
 * syncInterval 60000` was rejected as unknown on a config that never had one.
 */
export const CONFIG_KEYS = [
  'dbPath', 'port', 'host', 'namespace', 'namespaceMode', 'embeddingModel',
  'indexPath', 'repoPath', 'syncUrl', 'syncInterval', 'syncMode', 'deviceName',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

/** The config a fresh install gets, rooted in the given state directory. */
export function defaultConfig(engramHome: string): EngramConfig {
  return {
    dbPath: path.join(engramHome, 'engram.db'),
    port: 4901,
    host: '127.0.0.1',
    namespace: null,
    namespaceMode: 'none',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    indexPath: path.join(engramHome, 'engram.db.index'),
    repoPath: path.join(engramHome, 'repo'),
  };
}

/** A TCP port and nothing else — the check `lsof`, `fetch` and PORT all rely on. */
export function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export interface NormalizedConfig {
  readonly config: EngramConfig;
  /** Human-readable notes about fields that were refused, for the caller to print. */
  readonly problems: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate one optional string field, collecting a problem when it is not one. */
function takeString(
  stored: Record<string, unknown>,
  key: keyof EngramConfig & string,
  fallback: string,
  problems: string[],
): string {
  const value = stored[key];
  if (value === undefined) return fallback;
  if (typeof value === 'string' && value.length > 0) return value;
  problems.push(`config: ${key} is not a non-empty string — using ${fallback}`);
  return fallback;
}

/**
 * Turn whatever is in the file into a config the rest of the CLI can trust,
 * plus the list of fields that had to be refused.
 */
export function normalizeConfig(stored: unknown, defaults: EngramConfig): NormalizedConfig {
  const problems: string[] = [];
  if (!isPlainObject(stored)) return { config: defaults, problems };

  const port = stored['port'] === undefined ? defaults.port
    : isValidPort(stored['port']) ? stored['port']
      : (problems.push(`config: port ${JSON.stringify(stored['port'])} is not a number between 1 and 65535 — using ${defaults.port}`), defaults.port);

  const namespace = typeof stored['namespace'] === 'string' && stored['namespace'].length > 0
    ? stored['namespace']
    : null;

  // A hand-edited config can carry an empty or bogus mode; fall back to the
  // legacy derivation rather than exporting garbage into the child process
  // env, where it would abort the MCP server on startup.
  const namespaceMode = NAMESPACE_MODES.includes(stored['namespaceMode'] as NamespaceModeName)
    ? (stored['namespaceMode'] as NamespaceModeName)
    : namespace ? 'filter' : 'none';

  const config: EngramConfig = {
    dbPath: takeString(stored, 'dbPath', defaults.dbPath, problems),
    port,
    host: takeString(stored, 'host', defaults.host, problems),
    namespace,
    namespaceMode,
    embeddingModel: takeString(stored, 'embeddingModel', defaults.embeddingModel, problems),
    indexPath: takeString(stored, 'indexPath', defaults.indexPath, problems),
    repoPath: takeString(stored, 'repoPath', defaults.repoPath, problems),
  };

  if (typeof stored['syncUrl'] === 'string' && stored['syncUrl'].length > 0) config.syncUrl = stored['syncUrl'];
  if (typeof stored['deviceName'] === 'string' && stored['deviceName'].length > 0) config.deviceName = stored['deviceName'];

  if (stored['syncMode'] !== undefined) {
    if (SYNC_MODES.includes(stored['syncMode'] as SyncModeName)) config.syncMode = stored['syncMode'] as SyncModeName;
    else problems.push(`config: syncMode ${JSON.stringify(stored['syncMode'])} is not one of ${SYNC_MODES.join(', ')} — ignoring it`);
  }

  if (stored['syncInterval'] !== undefined) {
    const interval = stored['syncInterval'];
    if (typeof interval === 'number' && Number.isInteger(interval) && interval > 0) config.syncInterval = interval;
    else problems.push(`config: syncInterval ${JSON.stringify(interval)} is not a positive whole number of milliseconds — ignoring it`);
  }

  return { config, problems };
}

export type ParsedValue =
  | { ok: true; value: string | number | null }
  | { ok: false; error: string };

/** Validate one `engram configure set <key> <value>` pair. */
export function parseConfigValue(key: ConfigKey, value: string): ParsedValue {
  if (key === 'port') {
    // An unparseable port used to become NaN, which JSON.stringify writes as
    // null — loadConfig then spread null over the default, so every later
    // command talked to http://127.0.0.1:null.
    const port = Number(value);
    return isValidPort(port)
      ? { ok: true, value: port }
      : { ok: false, error: `Invalid port: ${value} (expected an integer between 1 and 65535)` };
  }

  if (key === 'namespaceMode') {
    return NAMESPACE_MODES.includes(value as NamespaceModeName)
      ? { ok: true, value }
      : { ok: false, error: `Invalid namespaceMode: ${value} (expected ${NAMESPACE_MODES.join(', ')})` };
  }

  if (key === 'syncMode') {
    return SYNC_MODES.includes(value as SyncModeName)
      ? { ok: true, value }
      : { ok: false, error: `Invalid syncMode: ${value} (expected ${SYNC_MODES.join(', ')})` };
  }

  if (key === 'syncInterval') {
    const interval = Number(value);
    return Number.isInteger(interval) && interval > 0
      ? { ok: true, value: interval }
      : { ok: false, error: `Invalid syncInterval: ${value} (expected a positive whole number of milliseconds)` };
  }

  return { ok: true, value: value === 'null' ? null : value };
}

/**
 * Export ENGRAM_DB_PATH for a child process or an in-process SyncEngine.
 *
 * `env['ENGRAM_DB_PATH'] = dbPath || undefined` does not clear the variable —
 * Node coerces the assignment to the STRING "undefined", and better-sqlite3
 * then opens a database file literally called `undefined` in the working
 * directory. Deleting the key is the only way to say "not configured".
 */
export function applyDbPathEnv(env: Record<string, string | undefined>, dbPath: string | undefined): void {
  if (dbPath && dbPath.trim().length > 0) env['ENGRAM_DB_PATH'] = dbPath;
  else delete env['ENGRAM_DB_PATH'];
}
