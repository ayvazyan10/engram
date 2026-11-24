/**
 * Claude Code auto-memory wiring for `engram setup`.
 *
 * Pure, side-effect-scoped helpers (extracted here so they are unit-testable,
 * mirroring serverControl.ts). The console orchestration lives in cli.ts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { isDeepStrictEqual } from 'node:util';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
export const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

/** Hooks installed for automatic memory, keyed by Claude Code event. */
export const CLAUDE_HOOKS: ReadonlyArray<{ event: string; file: string; timeout: number }> = [
  { event: 'UserPromptSubmit', file: 'engram-recall.sh', timeout: 8 },
  { event: 'SessionStart', file: 'engram-session-start.sh', timeout: 10 },
  { event: 'SessionEnd', file: 'engram-session-end.sh', timeout: 15 },
];

/** A config file that exists but could not be parsed. Never write over one. */
export class ConfigParseError extends Error {
  constructor(readonly file: string, readonly reason: string) {
    super(
      `${file} exists but is not valid JSON (${reason}). ` +
      'Engram will not overwrite it — inspect or move the file, then re-run.'
    );
    this.name = 'ConfigParseError';
  }
}

/**
 * Read a JSON config file for a read-modify-WRITE cycle.
 *
 * Returns {} only when the file genuinely holds nothing we could destroy:
 * absent, or empty. A file that exists and does not parse throws, because the
 * caller's next move is to write over it.
 *
 * This used to answer {} for a corrupt file too, and the callers merged their
 * one key into that {} and wrote it back. ~/.claude.json is Claude Code's
 * primary state file — oauthAccount, userID, every project's trust state — and
 * Claude Code rewrites it constantly, so a single torn read was enough to log
 * the user out and untrust every project, with no backup written anywhere.
 */
export function readJson(file: string, raw = readConfigText(file)): Record<string, unknown> {
  if (raw === null) return {};

  // A leading UTF-8 BOM is not JSON but carries none of the user's data, and
  // an editor that added one should not cost anybody their config.
  const text = raw.replace(/^\uFEFF/, '');
  if (text.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigParseError(file, err instanceof Error ? err.message : String(err));
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigParseError(file, 'top-level value is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function readConfigText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Validate nested config objects before merging, preserving unrelated keys. */
export function configObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Read for INSPECTION only — `engram doctor` reporting what is configured.
 *
 * Never use this before a write: answering {} for an unreadable file is
 * exactly the behaviour that destroyed configs.
 */
export function readJsonOrEmpty(file: string): Record<string, unknown> {
  try { return readJson(file); } catch (err) {
    console.error(`Could not inspect ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * Where the pre-write copy of `file` goes: same directory (so it survives on
 * the same filesystem and the same permissions), timestamped so repeated runs
 * never overwrite an earlier rescue copy.
 */
export function backupPathFor(file: string, now: Date, taken: (candidate: string) => boolean): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  let candidate = `${file}.${stamp}.bak`;
  for (let n = 2; taken(candidate); n++) candidate = `${file}.${stamp}-${n}.bak`;
  return candidate;
}

/**
 * Write config text the way a file holding somebody's login deserves:
 * a timestamped backup of what was there first, then a temp file + rename so
 * a crash or a full disk mid-write cannot leave a truncated config behind.
 *
 * The temp file is a sibling on purpose — rename is only atomic within one
 * filesystem, and the system temp dir is routinely a different one.
 *
 * Returns the backup path, or null when the file is new or unchanged.
 */
export function writeConfigFile(file: string, contents: string, now: Date = new Date(), original = readConfigText(file)): string | null {
  if (contents === original) return null;
  // Claude Code coordinates user-config writers with a sibling .lock directory.
  const lock = path.basename(file) === '.claude.json' ? `${file}.lock` : null;
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) file = fs.realpathSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (lock) {
    try { fs.mkdirSync(lock); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      throw new Error(`Claude config is locked at ${lock}. Re-run setup when the writer finishes.`);
    }
  }
  try {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    const backup = stat ? backupPathFor(file, now, fs.existsSync) : null;
    if (backup) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    atomicWriteConfig(file, contents, stat ? stat.mode & 0o777 : 0o600, original);
    return backup;
  } finally {
    if (lock) fs.rmdirSync(lock);
  }
}

export function atomicWriteConfig(file: string, contents: string, mode: number, original?: string | null): void {
  const temp = `${file}.engram-${process.pid}-${Date.now()}.tmp`;
  const fd = fs.openSync(temp, 'wx', mode);
  try {
    try {
      fs.writeFileSync(fd, contents);
      // Rename is only as durable as the bytes behind it.
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(temp, mode);
    if (original !== undefined && readConfigText(file) !== original) {
      throw new Error(`${file} changed during setup. Re-run setup to merge the latest edits.`);
    }
    fs.renameSync(temp, file);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') console.error(cleanupError);
    }
    throw err;
  }
}

export function writeJsonConfig(file: string, data: Record<string, unknown>, now: Date = new Date()): string | null {
  return updateJsonConfig(file, () => data, now);
}

/**
 * Read, transform, write — refusing outright when the current contents could
 * not be parsed. `update` receives the parsed config and must return a NEW
 * object rather than mutating the one it was given.
 */
export function updateJsonConfig(
  file: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>,
  now: Date = new Date(),
): string | null {
  const original = readConfigText(file);
  const current = readJson(file, original);
  const next = update(current);
  if (original !== null && isDeepStrictEqual(current, next)) return null;
  return writeConfigFile(file, JSON.stringify(next, null, 2) + '\n', now, original);
}

function escapeBashSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function bashLiteral(value: string): string {
  return `'${escapeBashSingleQuotes(value)}'`;
}

/** Render hook paths, API base and the same environment as its MCP entry. */
export function renderHook(
  templateBody: string, apiBase: string, repoPath = '', dbPath = '',
  mcpEnv: Readonly<Record<string, string>> = { ENGRAM_DB_PATH: dbPath, ENGRAM_SOURCE: 'claude-code' },
): string {
  return templateBody.replace(/__API_BASE__|__REPO_PATH__|__DB_PATH__|__MCP_ENV__|__NAMESPACE_MODE__|__NAMESPACE__/g, (placeholder) => {
    // The templates enclose the default URL in single quotes.
    if (placeholder === '__API_BASE__') return escapeBashSingleQuotes(apiBase);
    if (placeholder === '__NAMESPACE_MODE__') return bashLiteral(mcpEnv['ENGRAM_NAMESPACE_MODE'] || 'project');
    if (placeholder === '__NAMESPACE__') return bashLiteral(mcpEnv['ENGRAM_NAMESPACE'] || '');
    if (placeholder === '__MCP_ENV__') {
      return Object.entries(mcpEnv).map(([key, value]) => bashLiteral(`${key}=${value}`)).join(' ');
    }
    return bashLiteral(placeholder === '__REPO_PATH__' ? repoPath : dbPath);
  });
}

/** Copy a hook template into hooksDir with the API base baked in; returns dest path. */
export function installHookScript(
  templateDir: string, hooksDir: string, file: string, apiBase: string, repoPath = '', dbPath = '',
  mcpEnv?: Readonly<Record<string, string>>,
): string {
  const body = renderHook(fs.readFileSync(path.join(templateDir, file), 'utf8'), apiBase, repoPath, dbPath, mcpEnv);
  fs.mkdirSync(hooksDir, { recursive: true });
  const dest = path.join(hooksDir, file);
  fs.writeFileSync(dest, body);
  fs.chmodSync(dest, 0o755);
  return dest;
}

/** Quote a hook script path so a home directory containing spaces still runs. */
export function quoteHookCommand(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `"${command}"`;
  return bashLiteral(command);
}

/** Undo quoteHookCommand for basename comparison, including older quoted entries. */
function unquoteHookCommand(command: string): string {
  if (command.length >= 2 && command.startsWith("'") && command.endsWith("'")) {
    return command.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (command.length >= 2 && command.startsWith('"') && command.endsWith('"')) {
    return command.slice(1, -1);
  }
  return command;
}

/**
 * Register a hook command for an event in a settings object, without duplicating
 * it. Dedupe is by script basename, not exact path, so a re-run or a moved
 * script never registers the same hook twice (which would fire it twice).
 */
export function registerHook(
  settings: Record<string, unknown>, event: string, command: string, timeout: number,
): Record<string, unknown> {
  const hooks = configObject(settings.hooks, 'hooks');
  const rawEntries = hooks[event] ?? [];
  if (!Array.isArray(rawEntries)) throw new Error(`hooks.${event} must be an array`);
  const entries = rawEntries.map((entry: unknown) => {
    const group = configObject(entry, `hooks.${event} entry`);
    const handlers = group.hooks ?? [];
    if (!Array.isArray(handlers)) throw new Error(`hooks.${event} entry.hooks must be an array`);
    return { ...group, hooks: handlers.map((hook: unknown) => configObject(hook, `hooks.${event} handler`)) };
  });
  const matches = (hook: Record<string, unknown>): boolean =>
    typeof hook.command === 'string' && path.basename(unquoteHookCommand(hook.command)) === path.basename(command);
  const replacement = { type: 'command', command: quoteHookCommand(command), timeout };
  const already = entries.some((entry) => (entry.hooks ?? []).some(matches));
  const next = already
    ? entries.map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).map((hook) =>
      matches(hook) ? { ...hook, ...replacement } : hook) }))
    : [...entries, { matcher: '', hooks: [replacement] }];
  return { ...settings, hooks: { ...hooks, [event]: next } };
}

/** Validate an event's handlers and resolve the paths we quote at install. */
export function claudeHookCommands(settings: Record<string, unknown>, event: string): string[] {
  const entries = configObject(settings.hooks, 'hooks')[event] ?? [];
  if (!Array.isArray(entries)) throw new Error(`hooks.${event} must be an array`);
  return entries.flatMap((entry: unknown) => {
    const handlers = configObject(entry, `hooks.${event} entry`).hooks ?? [];
    if (!Array.isArray(handlers)) throw new Error(`hooks.${event} entry.hooks must be an array`);
    return handlers.flatMap((handler: unknown) => {
      const { command } = configObject(handler, `hooks.${event} handler`);
      if (command === undefined) return [];
      if (typeof command !== 'string') throw new Error(`hooks.${event} command must be a string`);
      return [unquoteHookCommand(command)];
    });
  });
}

/** Detect installed hooks, including quoted commands and legacy locations. */
export function hasClaudeHooks(settingsFile: string): boolean {
  const settings = readJson(settingsFile);
  return CLAUDE_HOOKS.some((h) => claudeHookCommands(settings, h.event).some((command) => path.basename(command) === h.file));
}
