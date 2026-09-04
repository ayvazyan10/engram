/**
 * What `engram setup` needs before it starts.
 *
 * Setup cloned, installed and built without checking that git, pnpm or a
 * supported Node were there at all. A missing pnpm surfaced at the end as
 * better-sqlite3 toolchain advice, and a missing git as
 * "Clone failed: git exited with null" — because spawnSync's ENOENT lands in
 * `clone.error`, which nothing read. The published CLI also declared no
 * `engines`, so npm installed it happily onto Node 18.
 */

import { describe, it, expect } from 'vitest';
import { checkNode, checkCommand, setupRequirements, unmet, MIN_NODE_MAJOR } from '../preflight.js';

/** A probe that answers with a version, like `pnpm --version` does. */
const answers = (version: string) => () => version;
const missing = (name: string) => (): string => {
  const err = new Error(`spawnSync ${name} ENOENT`) as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  throw err;
};

describe('checkNode', () => {
  it('accepts the supported major and anything above it', () => {
    expect(checkNode(`${MIN_NODE_MAJOR}.0.0`).ok).toBe(true);
    expect(checkNode(`${MIN_NODE_MAJOR + 3}.1.2`).ok).toBe(true);
  });

  it('rejects an older Node and says which one is needed', () => {
    const result = checkNode('18.20.4');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('18.20.4');
    expect(result.fix).toContain(String(MIN_NODE_MAJOR));
  });

  it('rejects a version it cannot read rather than assuming it is fine', () => {
    expect(checkNode('').ok).toBe(false);
    expect(checkNode('not-a-version').ok).toBe(false);
  });
});

describe('checkCommand', () => {
  it('reports the version when the command answers', () => {
    const result = checkCommand('pnpm', answers('9.15.4'), 'install pnpm');
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('9.15.4');
  });

  it('reports a missing command with the fix, not with the raw ENOENT', () => {
    const result = checkCommand('git', missing('git'), 'install git from https://git-scm.com');
    expect(result.ok).toBe(false);
    expect(result.name).toBe('git');
    expect(result.fix).toContain('git-scm.com');
  });

  it('treats an empty answer as a missing command', () => {
    expect(checkCommand('pnpm', answers('   '), 'install pnpm').ok).toBe(false);
  });
});

describe('setupRequirements', () => {
  it('checks node, git and pnpm for a full local install', () => {
    const results = setupRequirements({
      nodeVersion: `${MIN_NODE_MAJOR}.1.0`,
      run: (cmd) => (cmd === 'git' ? 'git version 2.43.0' : '9.15.4'),
      needsRepoTools: true,
    });
    expect(results.map((r) => r.name)).toEqual(['Node.js', 'git', 'pnpm']);
    expect(unmet(results)).toEqual([]);
  });

  it('checks only node in npx mode — nothing is cloned or built there', () => {
    const results = setupRequirements({
      nodeVersion: `${MIN_NODE_MAJOR}.1.0`,
      run: missing('git'),
      needsRepoTools: false,
    });
    expect(results.map((r) => r.name)).toEqual(['Node.js']);
    expect(unmet(results)).toEqual([]);
  });

  it('collects every missing requirement instead of stopping at the first', () => {
    const results = setupRequirements({
      nodeVersion: '18.20.4',
      run: missing('anything'),
      needsRepoTools: true,
    });
    expect(unmet(results).map((r) => r.name)).toEqual(['Node.js', 'git', 'pnpm']);
  });
});
