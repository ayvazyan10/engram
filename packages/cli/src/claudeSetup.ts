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
  { event: 'SessionEnd', file: 'engram-session-end.sh', timeout: 15 },
];

/* eslint-disable @typescript-eslint/no-explicit-any -- reading/merging free-form user JSON config */

/** Read a JSON config file, returning {} for missing or corrupt files. */
export function readJson(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>; } catch { return {}; }
}

/** Substitute the API-base placeholder in a hook template. */
export function renderHook(templateBody: string, apiBase: string): string {
  return templateBody.replace(/__API_BASE__/g, apiBase);
}

/** Copy a hook template into hooksDir with the API base baked in; returns dest path. */
export function installHookScript(templateDir: string, hooksDir: string, file: string, apiBase: string): string {
  const body = renderHook(fs.readFileSync(path.join(templateDir, file), 'utf8'), apiBase);
  fs.mkdirSync(hooksDir, { recursive: true });
  const dest = path.join(hooksDir, file);
  fs.writeFileSync(dest, body);
  fs.chmodSync(dest, 0o755);
  return dest;
}

/**
 * Register a hook command for an event in a settings object, without duplicating
 * it. Dedupe is by script basename, not exact path, so a re-run or a moved
 * script never registers the same hook twice (which would fire it twice).
 */
export function registerHook(settings: Record<string, any>, event: string, command: string, timeout: number): void {
  const hooks = settings.hooks || (settings.hooks = {});
  const entries: any[] = hooks[event] || (hooks[event] = []);
  const base = path.basename(command);
  const already = entries.some((e) =>
    (e.hooks || []).some((h: any) => typeof h.command === 'string' && path.basename(h.command) === base));
  if (!already) entries.push({ matcher: '', hooks: [{ type: 'command', command, timeout }] });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
