/**
 * Claude Code auto-memory wiring for `engram setup`.
 *
 * Pure, side-effect-scoped helpers (extracted here so they are unit-testable,
 * mirroring serverControl.ts). The console orchestration lives in cli.ts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
export const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

/** Hooks installed for automatic memory, keyed by Claude Code event. */
export const CLAUDE_HOOKS: ReadonlyArray<{ event: string; file: string; timeout: number }> = [
  { event: 'UserPromptSubmit', file: 'engram-recall.sh', timeout: 8 },
  { event: 'SessionStart', file: 'engram-session-start.sh', timeout: 10 },
  { event: 'SessionEnd', file: 'engram-session-end.sh', timeout: 15 },
];

/* eslint-disable @typescript-eslint/no-explicit-any -- reading/merging free-form user JSON config */

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
export function readJson(file: string): Record<string, any> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // Only "not there" is safe to treat as empty. EACCES, EISDIR and friends
    // are real problems the caller must not paper over with a fresh file.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

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
  return parsed as Record<string, any>;
}

/**
 * Read for INSPECTION only — `engram doctor` reporting what is configured.
 *
 * Never use this before a write: answering {} for an unreadable file is
 * exactly the behaviour that destroyed configs.
 */
export function readJsonOrEmpty(file: string): Record<string, any> {
  try { return readJson(file); } catch { return {}; }
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
 * Write a JSON config the way a file holding somebody's login deserves:
 * a timestamped backup of what was there first, then a temp file + rename so
 * a crash or a full disk mid-write cannot leave a truncated config behind.
 *
 * The temp file is a sibling on purpose — rename is only atomic within one
 * filesystem, and the system temp dir is routinely a different one.
 *
 * Returns the backup path, or null when the file did not exist yet.
 */
export function writeJsonConfig(file: string, data: Record<string, any>, now: Date = new Date()): string | null {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let backup: string | null = null;
  let mode = 0o600; // a fresh config may hold credentials — keep it private
  try {
    mode = fs.statSync(file).mode & 0o777;
    backup = backupPathFor(file, now, fs.existsSync);
    fs.copyFileSync(file, backup);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const temp = `${file}.engram-${process.pid}-${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n');
      // Rename is only as durable as the bytes behind it.
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch { /* never created — nothing to clean */ }
    throw err;
  }

  return backup;
}

/**
 * Read, transform, write — refusing outright when the current contents could
 * not be parsed. `update` receives the parsed config and must return a NEW
 * object rather than mutating the one it was given.
 */
export function updateJsonConfig(
  file: string,
  update: (current: Record<string, any>) => Record<string, any>,
): string | null {
  return writeJsonConfig(file, update(readJson(file)));
}

/** Substitute the API-base placeholder in a hook template. */
export function renderHook(templateBody: string, apiBase: string, repoPath = '', dbPath = ''): string {
  return templateBody.replace(/__API_BASE__|__REPO_PATH__|__DB_PATH__/g, (placeholder) => {
    if (placeholder === '__API_BASE__') return apiBase;
    return quoteHookCommand(placeholder === '__REPO_PATH__' ? repoPath : dbPath);
  });
}

/** Copy a hook template into hooksDir with the API base baked in; returns dest path. */
export function installHookScript(templateDir: string, hooksDir: string, file: string, apiBase: string, repoPath = '', dbPath = ''): string {
  const body = renderHook(fs.readFileSync(path.join(templateDir, file), 'utf8'), apiBase, repoPath, dbPath);
  fs.mkdirSync(hooksDir, { recursive: true });
  const dest = path.join(hooksDir, file);
  fs.writeFileSync(dest, body);
  fs.chmodSync(dest, 0o755);
  return dest;
}

/** Quote a hook script path so a home directory containing spaces still runs. */
export function quoteHookCommand(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `"${command}"`;
  return `'${command.replace(/'/g, `'\\''`)}'`;
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
  const hooks = (settings.hooks ?? {}) as Record<string, Array<{ hooks?: Array<Record<string, unknown>> }>>;
  const entries = hooks[event] ?? [];
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

/** Detect installed hooks, including quoted commands and legacy locations. */
export function hasClaudeHooks(settingsFile: string): boolean {
  const hooks: unknown = readJsonOrEmpty(settingsFile).hooks;
  if (!hooks || typeof hooks !== 'object') return false;
  return Object.values(hooks).some((entries: unknown) => Array.isArray(entries) && entries.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('hooks' in entry) || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some((hook: unknown) => hook && typeof hook === 'object' && 'command' in hook
      && typeof hook.command === 'string'
      && CLAUDE_HOOKS.some((h) => h.file === path.basename(unquoteHookCommand(hook.command as string))));
  }));
}

/* eslint-enable @typescript-eslint/no-explicit-any */
