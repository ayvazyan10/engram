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
export function resolveNamespaceSettings(env: NamespaceEnv, cwd = process.cwd()): NamespaceSettings {
  const namespace = env['ENGRAM_NAMESPACE'] || undefined;
  const raw = env['ENGRAM_NAMESPACE_MODE'] || 'project';

  if (!NAMESPACE_MODES.includes(raw as NamespaceMode | 'project')) {
    throw new Error('ENGRAM_NAMESPACE_MODE must be one of: none, filter, isolated, project');
  }

  if (raw === 'project') {
    if (namespace) return { namespaceMode: 'filter', namespace };
    try {
      const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (root) return { namespaceMode: 'filter', namespace: root };
    } catch {
      // Outside a repository (or without git), use the shared memory pool.
    }
    return { namespaceMode: 'none', namespace: undefined };
  }

  return { namespaceMode: raw as NamespaceMode, namespace };
}
