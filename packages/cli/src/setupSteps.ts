/**
 * The steps `engram setup` and `engram update` run, minus the commander
 * plumbing: prerequisite checks, MCP registration for the client the user
 * named, the Claude Code auto-memory wiring, and the build stamp that lets
 * `update` tell a finished build from an interrupted one.
 *
 * Extracted from cli.ts so each step can be exercised on its own — cli.ts is a
 * commander entrypoint that parses argv on import, so nothing inside it was
 * ever reachable from a test.
 *
 * Paths are parameters, not module constants: the tests point them at a
 * temporary HOME instead of the real one.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildStatus, serializeBuildStamp } from './buildState.js';
import {
  CLAUDE_DIR, CLAUDE_SETTINGS, CLAUDE_JSON, CLAUDE_HOOKS,
  updateJsonConfig, installHookScript, registerHook,
} from './claudeSetup.js';
import { resolveMcpClient, manualSnippet, supportedClientList } from './mcpClients.js';
import { setupRequirements, unmet } from './preflight.js';
import { reportConfigRefusal, reportBackup } from './reporters.js';
import { C, D, R, X, ok, fail, warn, detail } from './ui.js';
import type { EngramConfig } from './engramConfig.js';

/**
 * Short HEAD of the updated checkout, or null when git cannot say. Only the
 * closing banner needs it, and the update has already happened by then — a git
 * hiccup at that point must not turn a successful update into a stack trace.
 */
export function shortHead(repoPath: string, opts: { quiet?: boolean } = {}): string | null {
  try {
    // argv form: repoPath is user-controlled through `configure set repoPath`
    // and ENGRAM_HOME, and must never be parsed by a shell.
    const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoPath, encoding: 'utf8' });
    if (rev.error) throw rev.error;
    if (rev.status !== 0) throw new Error(rev.stderr?.trim() || `git exited with ${rev.status}`);
    return rev.stdout.trim() || null;
  } catch (err) {
    // Quiet when the answer is only used to decide whether to rebuild: the
    // caller has a fallback, and a warning there would read as a failure.
    if (!opts.quiet) warn(`Updated, but could not read the new revision: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Preflight ───────────────────────────────────────────────────────────────

/**
 * Check git, pnpm and Node before setup touches anything. Missing tools used to
 * surface halfway through as somebody else's error message.
 *
 * Returns false instead of exiting: the caller owns the exit code, and a
 * function that ends the process cannot be tested.
 */
export function checkPrerequisites(needsRepoTools: boolean): boolean {
  const results = setupRequirements({
    nodeVersion: process.versions.node,
    run: (cmd, args) => {
      const probe = spawnSync(cmd, [...args], { encoding: 'utf8' });
      if (probe.error) throw probe.error;
      if (probe.status !== 0) throw new Error(probe.stderr?.trim() || `${cmd} exited with ${probe.status}`);
      return probe.stdout ?? '';
    },
    needsRepoTools,
  });

  for (const result of results) {
    if (result.ok) ok(`${result.name} ${result.detail}`);
  }

  const missing = unmet(results);
  if (missing.length === 0) return true;

  for (const requirement of missing) {
    fail(`${requirement.name}: ${requirement.detail}`);
    console.log(`  Fix: ${C}${requirement.fix}${X}`);
  }
  console.log(`\n${R}  Setup stopped — nothing has been changed.${X}\n`);
  return false;
}

/**
 * Record that a build COMPLETED for the revision now checked out. `engram
 * update` reads it to tell "nothing to do" apart from "the last attempt died
 * before it built anything".
 */
export function recordBuild(repoPath: string, stampPath: string): void {
  const rev = shortHead(repoPath, { quiet: true });
  if (!rev) {
    warn('Could not read the built revision from git — the next update will rebuild.');
    return;
  }
  try {
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, serializeBuildStamp(rev));
  } catch (err) {
    // Not fatal: the build itself succeeded. But the next update will rebuild
    // because it cannot prove that, so say why.
    warn(`Could not record the build revision: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Is the checkout built, and built from what is checked out right now? */
export function currentBuildStatus(repoPath: string, stampPath: string): ReturnType<typeof buildStatus> {
  return buildStatus({
    repoPath,
    stampPath,
    headRev: shortHead(repoPath, { quiet: true }),
    exists: fs.existsSync,
    readFile: (p: string) => fs.readFileSync(p, 'utf8'),
  });
}

// ─── MCP client registration ─────────────────────────────────────────────────

/**
 * Register the server where the named client actually reads it.
 *
 * This used to write ~/.mcp.json unconditionally and report "MCP configured".
 * Claude Code reads `.mcp.json` from the PROJECT directory and user-scope
 * servers from ~/.claude.json; Cursor and Windsurf have their own files. So the
 * one file setup wrote was the one file nothing loads — see mcpClients.ts.
 */
export function configureMcpClient(
  source: string,
  engramServer: Record<string, unknown>,
  home: string,
  skipped: string[],
): void {
  const target = resolveMcpClient(source, home);

  if (target.kind === 'manual') {
    warn(`No MCP config file is known for --source ${source} — nothing was registered.`);
    console.log(`  ${D}Engram can configure: ${supportedClientList()}${X}`);
    console.log(`  Add this to your client's MCP config yourself:`);
    detail(manualSnippet(engramServer).split('\n'));
    skipped.push(`MCP registration for "${source}" — add the snippet above to your client's config`);
    return;
  }

  try {
    reportBackup(updateJsonConfig(target.path, (current) => ({
      ...current,
      [target.key]: { ...(current[target.key] as Record<string, unknown> | undefined), engram: engramServer },
    })));
    ok(`${target.label} MCP registered: ${target.path}`);
    warn(target.activation);
  } catch (err) {
    reportConfigRefusal(err, `${target.label} MCP registration`, skipped);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- merging free-form user JSON config */

/**
 * Wire Engram into Claude Code as automatic memory: register the MCP server at
 * user scope (loads in every session with no manual approval — a project-scope
 * ~/.mcp.json entry does not) and, for a full local install, install the recall
 * and session-end hooks. Best-effort: a malformed Claude config is reported and
 * left untouched rather than aborting setup — or being overwritten.
 */
export interface ClaudePaths {
  /** ~/.claude — its absence is how we detect Claude Code is not installed. */
  readonly dir: string;
  /** ~/.claude/settings.json — where hooks are registered. */
  readonly settings: string;
  /** ~/.claude.json — where USER-SCOPE MCP servers live. */
  readonly userJson: string;
}

/** The real locations, for cli.ts. Tests pass a temporary home instead. */
export const CLAUDE_PATHS: ClaudePaths = {
  dir: CLAUDE_DIR,
  settings: CLAUDE_SETTINGS,
  userJson: CLAUDE_JSON,
};

export function setupClaudeCode(
  config: EngramConfig,
  engramServer: Record<string, unknown>,
  withHooks: boolean,
  hooksDir: string,
  paths: ClaudePaths,
  skipped: string[],
): void {
  if (!fs.existsSync(paths.dir)) {
    warn('Claude Code not detected (~/.claude absent) — skipping auto-memory');
    return;
  }
  try {
    reportBackup(updateJsonConfig(paths.userJson, (current) => ({
      ...current,
      mcpServers: { ...(current.mcpServers as Record<string, unknown> | undefined), engram: engramServer },
    })));
    ok('MCP registered at user scope (~/.claude.json) — loads in every session');
  } catch (err) {
    reportConfigRefusal(err, 'Claude Code user-scope MCP', skipped);
    return;
  }

  if (!withHooks) {
    warn('npx mode has no local server — skipping recall/session-end hooks');
    warn('Restart Claude Code (or run /mcp) to activate.');
    return;
  }

  try {
    const templateDir = path.join(config.repoPath, 'packages', 'cli', 'templates');
    const apiBase = `http://localhost:${config.port}`;
    // Install the scripts first: the config update must be a pure transform, so
    // a refusal below cannot leave half-written hooks referenced by nothing.
    const installed = CLAUDE_HOOKS.map((h) => ({
      ...h,
      command: installHookScript(templateDir, hooksDir, h.file, apiBase),
    }));
    reportBackup(updateJsonConfig(paths.settings, (current) => {
      const next = structuredClone(current) as Record<string, any>;
      for (const h of installed) registerHook(next, h.event, h.command, h.timeout);
      return next;
    }));
    ok('Recall + session-end hooks installed (~/.engram/hooks/)');
  } catch (err) {
    reportConfigRefusal(err, 'Claude Code recall/session-end hooks', skipped);
  }
  warn('Restart Claude Code (or run /mcp) to activate.');
}

/* eslint-enable @typescript-eslint/no-explicit-any */

