/**
 * How the MCP package reads namespace configuration out of the environment.
 *
 * Both entrypoints need this and only one of them had it: `store-session`
 * (the `engram-store-session` bin behind scripts/claude-code-hook.sh) read the
 * database path and nothing else, so every session summary was written with
 * `namespace: null`. Under ENGRAM_NAMESPACE_MODE=isolated that summary is
 * invisible to the brain that wrote it and visible to every other namespace —
 * the exact inversion of what isolation promises. Sharing one resolver is what
 * keeps the two entrypoints from drifting apart again.
 */

import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { NamespaceMode } from '@engram-ai-memory/core';

export const NAMESPACE_MODES: readonly (NamespaceMode | 'project')[] = ['none', 'filter', 'isolated', 'project'];

export interface NamespaceSettings {
  readonly namespaceMode: NamespaceMode;
  /** undefined rather than '' — an empty namespace is "not configured". */
  readonly namespace: string | undefined;
}

/** Environment as this module reads it — injected so it can be tested. */
export type NamespaceEnv = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the namespace mode and value.
 *
 * `||`, not `??`: hosts that template an unset optional config field — the
 * Claude Desktop extension among them — pass an EMPTY STRING rather than
 * omitting the variable, and `??` lets that empty string through to the
 * validation below, where it aborts the server on a field nobody touched.
 *
 * An unrecognised mode throws instead of falling back: silently downgrading
 * `isolated` to `none` would publish memories the user asked to keep separate.
 */
export function resolveNamespaceSettings(env: NamespaceEnv, cwdArg?: string): NamespaceSettings {
  const namespace = env['ENGRAM_NAMESPACE'] || undefined;
  const raw = env['ENGRAM_NAMESPACE_MODE'] || 'project';

  if (!NAMESPACE_MODES.includes(raw as NamespaceMode | 'project')) {
    throw new Error('ENGRAM_NAMESPACE_MODE must be one of: none, filter, isolated, project');
  }

  if (raw === 'project') {
    if (namespace) return { namespaceMode: 'filter', namespace };
    let cwd: string;
    try {
      cwd = cwdArg ?? process.cwd();
    } catch {
      // The working directory was deleted (uv_cwd ENOENT): fall back to the global namespace.
      return { namespaceMode: 'filter', namespace: undefined };
    }
    const git = (...args: string[]) => execFileSync('git', args, {
      encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    try {
      const commonDir = git('-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
      if (path.isAbsolute(commonDir)) {
        // Query the common repository itself. Its linked checkouts are worktrees even when it is bare.
        if (git('--git-dir', commonDir, 'rev-parse', '--is-bare-repository') === 'true') {
          return { namespaceMode: 'filter', namespace: commonDir };
        }
        if (path.basename(commonDir) === '.git') {
          return { namespaceMode: 'filter', namespace: path.dirname(commonDir) };
        }
      }
    } catch {
      // Older git versions may not support --path-format; try the top level.
    }
    try {
      const root = git('-C', cwd, 'rev-parse', '--show-toplevel');
      if (root) return { namespaceMode: 'filter', namespace: root };
    } catch {
      // Outside a repository (or without git), use the directory unless it is a host launch default.
    }
    const resolvedCwd = path.resolve(cwd);
    return {
      namespaceMode: 'filter',
      namespace: resolvedCwd === path.parse(resolvedCwd).root || resolvedCwd === os.homedir() ? undefined : resolvedCwd,
    };
  }

  return { namespaceMode: raw as NamespaceMode, namespace };
}
