import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  gitIn,
  parseStatus,
  inspectWorkingTree,
  restoreFiles,
  classifyPullFailure,
  blockedPaths,
  gitErrorSummary,
  upstreamRef,
  fastForward,
  stashAll,
  resetToUpstream,
  syncRepo,
  REGENERATED_FILES,
  type GitRunner,
  type GitResult,
} from '../gitUpdate.js';

// ─── Pure helpers (no git process) ───────────────────────────────────────────

const fakeGit = (responses: Record<string, Partial<GitResult>>): GitRunner => (args) => {
  const key = args.join(' ');
  const hit = responses[key] ?? responses[args[0] ?? ''] ?? {};
  return { status: hit.status ?? 0, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' };
};

describe('parseStatus', () => {
  it('parses NUL-separated entries', () => {
    const out = ' M pnpm-lock.yaml\0?? scratch.txt\0 D packages/cli/README.md\0';
    expect(parseStatus(out)).toEqual([
      { code: ' M', path: 'pnpm-lock.yaml' },
      { code: '??', path: 'scratch.txt' },
      { code: ' D', path: 'packages/cli/README.md' },
    ]);
  });

  it('skips the trailing origin path of a rename entry', () => {
    const out = 'R  new.ts\0old.ts\0 M other.ts\0';
    expect(parseStatus(out)).toEqual([
      { code: 'R ', path: 'new.ts' },
      { code: ' M', path: 'other.ts' },
    ]);
  });

  it('treats spaces in paths as part of the path', () => {
    expect(parseStatus(' M some dir/a b.txt\0')).toEqual([{ code: ' M', path: 'some dir/a b.txt' }]);
  });

  it('returns nothing for a clean tree', () => {
    expect(parseStatus('')).toEqual([]);
  });
});

describe('inspectWorkingTree', () => {
  it('separates tool-regenerated files from real user edits', () => {
    const git = fakeGit({
      'status --porcelain -z --untracked-files=all': {
        stdout: ' M pnpm-lock.yaml\0 M packages/core/src/index.ts\0?? notes.md\0',
      },
    });
    const tree = inspectWorkingTree(git);
    expect(tree.regenerated).toEqual(['pnpm-lock.yaml']);
    expect(tree.modified).toEqual(['packages/core/src/index.ts']);
    expect(tree.untracked).toEqual(['notes.md']);
    expect(tree.clean).toBe(false);
  });

  it('reports a clean tree', () => {
    const git = fakeGit({ 'status --porcelain -z --untracked-files=all': { stdout: '' } });
    expect(inspectWorkingTree(git).clean).toBe(true);
  });

  it('never classifies an untracked lockfile as regenerated', () => {
    const git = fakeGit({
      'status --porcelain -z --untracked-files=all': { stdout: '?? pnpm-lock.yaml\0' },
    });
    const tree = inspectWorkingTree(git);
    expect(tree.regenerated).toEqual([]);
    expect(tree.untracked).toEqual(['pnpm-lock.yaml']);
  });

  it('treats a failed status call as a clean tree', () => {
    const git = fakeGit({ status: { status: 128, stderr: 'not a git repository' } });
    expect(inspectWorkingTree(git).clean).toBe(true);
  });
});

describe('classifyPullFailure', () => {
  it('detects modified tracked files', () => {
    const stderr = 'error: Your local changes to the following files would be overwritten by merge:\n\tpnpm-lock.yaml\n';
    expect(classifyPullFailure(stderr)).toBe('local-changes');
  });

  it('detects untracked collisions', () => {
    const stderr = 'error: The following untracked working tree files would be overwritten by merge:\n\tnewfile.txt\n';
    expect(classifyPullFailure(stderr)).toBe('untracked-collision');
  });

  it('detects diverged branches', () => {
    expect(classifyPullFailure('fatal: Not possible to fast-forward, aborting.')).toBe('diverged');
  });

  it('falls back to unknown', () => {
    expect(classifyPullFailure('fatal: the remote end hung up unexpectedly')).toBe('unknown');
  });
});

describe('blockedPaths', () => {
  it('extracts the tab-indented file list git prints', () => {
    const stderr = [
      'error: The following untracked working tree files would be overwritten by merge:',
      '\tnewfile.txt',
      '\tdocs/guide.md',
      'Please move or remove them before you merge.',
      'Aborting',
    ].join('\n');
    expect(blockedPaths(stderr)).toEqual(['newfile.txt', 'docs/guide.md']);
  });

  it('returns an empty list when git named no files', () => {
    expect(blockedPaths('fatal: Not possible to fast-forward, aborting.')).toEqual([]);
  });
});

describe('gitErrorSummary', () => {
  it('drops hint noise and keeps the real message', () => {
    const stderr = [
      'hint: Diverging branches can\'t be fast-forwarded, you need to either:',
      'hint: ',
      'hint: \tgit merge --no-ff',
      'fatal: Not possible to fast-forward, aborting.',
    ].join('\n');
    expect(gitErrorSummary(stderr)).toBe('fatal: Not possible to fast-forward, aborting.');
  });

  it('returns a placeholder for empty stderr', () => {
    expect(gitErrorSummary('   ')).toBe('git exited with an error');
  });
});

// ─── Integration against real repositories ───────────────────────────────────

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

let root: string;
let origin: string;
let clone: string;

/** Bare origin with one commit, plus a shallow clone of it — the `engram setup` shape. */
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-git-'));
  origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  clone = path.join(root, 'clone');

  git(root, 'init', '-q', '--bare', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'test@engram.local');
  git(work, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(work, 'pnpm-lock.yaml'), 'lock v1\n');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  git(work, 'branch', '-M', 'master');
  git(work, 'push', '-q', '-u', origin, 'master');

  git(root, 'clone', '-q', '--depth=1', `file://${origin}`, clone);
  git(clone, 'config', 'user.email', 'test@engram.local');
  git(clone, 'config', 'user.name', 'test');

  // Upstream moves ahead: rewrites the lockfile and adds a new file.
  fs.writeFileSync(path.join(work, 'pnpm-lock.yaml'), 'lock v2\n');
  fs.writeFileSync(path.join(work, 'newfile.txt'), 'upstream\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'upstream change');
  git(work, 'push', '-q', origin, 'master');
  git(clone, 'fetch', '-q');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('fastForward (real git)', () => {
  it('fast-forwards a clean shallow clone', () => {
    const result = fastForward(gitIn(clone));
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(clone, 'pnpm-lock.yaml'), 'utf8')).toBe('lock v2\n');
  });

  it('reports local-changes when a tracked file was rewritten by the package manager', () => {
    fs.writeFileSync(path.join(clone, 'pnpm-lock.yaml'), 'lock rewritten locally\n');
    const result = fastForward(gitIn(clone));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('local-changes');
    expect(result.blocked).toContain('pnpm-lock.yaml');
  });

  it('reports untracked-collision when an untracked file shadows an incoming one', () => {
    fs.writeFileSync(path.join(clone, 'newfile.txt'), 'mine\n');
    const result = fastForward(gitIn(clone));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('untracked-collision');
    expect(result.blocked).toContain('newfile.txt');
  });

  it('reports diverged when the clone has local commits', () => {
    fs.writeFileSync(path.join(clone, 'local.txt'), 'local\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-qm', 'local commit');
    const result = fastForward(gitIn(clone));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('diverged');
  });
});

describe('restoreFiles (real git)', () => {
  it('discards a locally rewritten lockfile so the update can proceed', () => {
    fs.writeFileSync(path.join(clone, 'pnpm-lock.yaml'), 'lock rewritten locally\n');
    const runner = gitIn(clone);

    expect(inspectWorkingTree(runner).regenerated).toEqual(['pnpm-lock.yaml']);
    expect(restoreFiles(runner, ['pnpm-lock.yaml'])).toBe(true);
    expect(inspectWorkingTree(runner).clean).toBe(true);
    expect(fastForward(runner).ok).toBe(true);
  });

  it('also discards a staged rewrite', () => {
    fs.writeFileSync(path.join(clone, 'pnpm-lock.yaml'), 'staged rewrite\n');
    git(clone, 'add', 'pnpm-lock.yaml');
    const runner = gitIn(clone);
    expect(restoreFiles(runner, ['pnpm-lock.yaml'])).toBe(true);
    expect(inspectWorkingTree(runner).clean).toBe(true);
  });

  it('is a no-op for an empty file list', () => {
    expect(restoreFiles(gitIn(clone), [])).toBe(true);
  });
});

describe('stashAll (real git)', () => {
  it('stashes untracked files too — plain `git stash` does not', () => {
    fs.writeFileSync(path.join(clone, 'newfile.txt'), 'mine\n');
    const runner = gitIn(clone);

    expect(fastForward(runner).ok).toBe(false);
    expect(stashAll(runner, 'engram update').ok).toBe(true);
    expect(fastForward(runner).ok).toBe(true);
    expect(fs.readFileSync(path.join(clone, 'newfile.txt'), 'utf8')).toBe('upstream\n');
    expect(git(clone, 'stash', 'list')).toContain('engram update');
  });

  it('preserves user edits to tracked files in the stash', () => {
    fs.writeFileSync(path.join(clone, 'a.txt'), 'user edit\n');
    const runner = gitIn(clone);
    expect(stashAll(runner, 'engram update').ok).toBe(true);
    expect(fs.readFileSync(path.join(clone, 'a.txt'), 'utf8')).toBe('a\n');
    expect(git(clone, 'stash', 'list')).toContain('engram update');
  });
});

describe('resetToUpstream (real git)', () => {
  it('moves a diverged clone onto upstream and keeps the commits on a backup branch', () => {
    fs.writeFileSync(path.join(clone, 'local.txt'), 'local\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-qm', 'local commit');
    const runner = gitIn(clone);
    const localHead = git(clone, 'rev-parse', 'HEAD').trim();

    const result = resetToUpstream(runner, 'engram-backup-test');
    expect(result.ok).toBe(true);
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(git(clone, 'rev-parse', '@{u}').trim());
    expect(git(clone, 'rev-parse', 'engram-backup-test').trim()).toBe(localHead);
    expect(fs.readFileSync(path.join(clone, 'pnpm-lock.yaml'), 'utf8')).toBe('lock v2\n');
  });
});

describe('syncRepo (real git)', () => {
  it('fast-forwards a clean checkout', () => {
    expect(syncRepo(clone)).toEqual({ status: 'updated' });
    expect(fs.readFileSync(path.join(clone, 'newfile.txt'), 'utf8')).toBe('upstream\n');
  });

  it('reports up-to-date when there is nothing to pull', () => {
    syncRepo(clone);
    expect(syncRepo(clone)).toEqual({ status: 'up-to-date' });
  });

  it('recovers on its own from lockfile churn left by pnpm install', () => {
    fs.writeFileSync(path.join(clone, 'pnpm-lock.yaml'), 'rewritten by pnpm\n');
    expect(syncRepo(clone).status).toBe('updated');
    expect(fs.readFileSync(path.join(clone, 'pnpm-lock.yaml'), 'utf8')).toBe('lock v2\n');
  });

  it('blocks — naming the files — when untracked files clash, without --force', () => {
    fs.writeFileSync(path.join(clone, 'newfile.txt'), 'mine\n');
    const result = syncRepo(clone);
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.failure).toBe('untracked-collision');
    expect(result.blocked).toEqual(['newfile.txt']);
    expect(fs.readFileSync(path.join(clone, 'newfile.txt'), 'utf8')).toBe('mine\n');
  });

  it('stashes clashing untracked files with --force', () => {
    fs.writeFileSync(path.join(clone, 'newfile.txt'), 'mine\n');
    expect(syncRepo(clone, { force: true }).status).toBe('updated');
    expect(fs.readFileSync(path.join(clone, 'newfile.txt'), 'utf8')).toBe('upstream\n');
    expect(git(clone, 'stash', 'list')).toContain('engram update');
  });

  it('keeps user edits recoverable from the stash with --force', () => {
    fs.writeFileSync(path.join(clone, 'a.txt'), 'user edit\n');
    fs.writeFileSync(path.join(clone, 'newfile.txt'), 'mine\n');
    expect(syncRepo(clone, { force: true }).status).toBe('updated');
    // `stash pop` itself can conflict here (upstream added its own newfile.txt),
    // but nothing is lost — both versions are readable from the stash commit.
    expect(git(clone, 'show', 'stash@{0}:a.txt')).toBe('user edit\n');
    expect(git(clone, 'show', 'stash@{0}^3:newfile.txt')).toBe('mine\n');
  });

  it('keeps diverged commits on a backup branch with --force', () => {
    fs.writeFileSync(path.join(clone, 'local.txt'), 'local\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-qm', 'local commit');
    const localHead = git(clone, 'rev-parse', 'HEAD').trim();

    expect(syncRepo(clone, { force: true }).status).toBe('updated');
    const backup = git(clone, 'branch', '--list', 'engram-backup-*').trim().replace(/^\*?\s*/, '');
    expect(backup).not.toBe('');
    expect(git(clone, 'rev-parse', backup).trim()).toBe(localHead);
  });

  it('stashes untracked work before the hard reset a diverged --force needs', () => {
    fs.writeFileSync(path.join(clone, 'local.txt'), 'local\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-qm', 'local commit');
    fs.writeFileSync(path.join(clone, 'scratch.txt'), 'unsaved work\n');

    expect(syncRepo(clone, { force: true }).status).toBe('updated');
    // reset --hard would have wiped it; the stash is what makes it recoverable.
    git(clone, 'stash', 'pop');
    expect(fs.readFileSync(path.join(clone, 'scratch.txt'), 'utf8')).toBe('unsaved work\n');
  });

  it('reports a missing upstream instead of throwing', () => {
    git(clone, 'checkout', '-q', '-b', 'orphaned');
    const result = syncRepo(clone);
    expect(result.status).toBe('no-upstream');
  });

  it('reports an unreachable remote', () => {
    git(clone, 'remote', 'set-url', 'origin', `file://${root}/does-not-exist.git`);
    const result = syncRepo(clone);
    expect(result.status).toBe('fetch-failed');
    if (result.status !== 'fetch-failed') return;
    expect(result.detail).not.toBe('');
  });

  it('logs each step through the injected logger', () => {
    const steps: string[] = [];
    syncRepo(clone, { log: { step: (m) => steps.push(m), warn: () => {} } });
    expect(steps[0]).toBe('Checking for updates...');
    expect(steps).toContain('Pulling latest changes...');
  });
});

describe('upstreamRef (real git)', () => {
  it('resolves the tracking branch', () => {
    expect(upstreamRef(gitIn(clone))).toBe('origin/master');
  });

  it('returns null when HEAD has no upstream', () => {
    git(clone, 'checkout', '-q', '-b', 'orphaned');
    expect(upstreamRef(gitIn(clone))).toBeNull();
  });
});

describe('REGENERATED_FILES', () => {
  it('covers the lockfiles our own install step rewrites', () => {
    expect(REGENERATED_FILES).toContain('pnpm-lock.yaml');
    expect(REGENERATED_FILES).toContain('package-lock.json');
  });
});
