/**
 * Git helpers behind `engram setup` / `engram update`.
 *
 * The repo at ~/.engram/repo is a working copy the CLI itself writes into:
 * `pnpm install` rewrites pnpm-lock.yaml, and new upstream files can collide
 * with files a user left lying around. Both make `git pull --ff-only` abort, so
 * the update needs to tell those cases apart, name the offending files, and
 * offer a way out that actually works (plain `git stash` does not cover
 * untracked collisions).
 *
 * Kept free of process.exit / console side effects so it stays unit-testable;
 * every call goes through an injectable runner.
 */

import { spawnSync } from 'child_process';

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: readonly string[]) => GitResult;

/** Runner bound to a repository directory. Never builds a shell string. */
export function gitIn(cwd: string): GitRunner {
  return (args) => {
    const r = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
    return {
      status: r.status ?? 1,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? (r.error ? r.error.message : ''),
    };
  };
}

/**
 * Tracked files our own install step rewrites. Local modifications to these are
 * build residue, not user work, so the updater may discard them silently.
 */
export const REGENERATED_FILES: readonly string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
];

export interface StatusEntry {
  /** Two-character porcelain code, e.g. ' M', '??', 'R '. */
  code: string;
  path: string;
}

/**
 * Parse `git status --porcelain -z`. NUL-separated records avoid the quoting
 * git applies to unusual paths in the newline format; a rename record is
 * followed by a bare origin-path record, which is dropped.
 */
export function parseStatus(out: string): StatusEntry[] {
  const records = out.split('\0').filter((r) => r.length > 0);
  const entries: StatusEntry[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.length < 4) continue;
    const code = record.slice(0, 2);
    entries.push({ code, path: record.slice(3) });
    // 'R'/'C' in either column: the next record is the source path.
    if (code.includes('R') || code.includes('C')) i++;
  }

  return entries;
}

export interface WorkingTree {
  clean: boolean;
  /** Modified tracked files the CLI itself regenerates — safe to discard. */
  regenerated: string[];
  /** Modified tracked files that represent real user changes. */
  modified: string[];
  untracked: string[];
}

/** Snapshot the working tree. An unreadable repo reads as clean — the pull that
 * follows will surface the real error rather than a misleading dirty-tree one. */
export function inspectWorkingTree(git: GitRunner): WorkingTree {
  const res = git(['status', '--porcelain', '-z', '--untracked-files=all']);
  if (res.status !== 0) return { clean: true, regenerated: [], modified: [], untracked: [] };

  const regenerated: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const entry of parseStatus(res.stdout)) {
    if (entry.code === '??') untracked.push(entry.path);
    else if (REGENERATED_FILES.includes(entry.path)) regenerated.push(entry.path);
    else modified.push(entry.path);
  }

  return {
    clean: regenerated.length === 0 && modified.length === 0 && untracked.length === 0,
    regenerated,
    modified,
    untracked,
  };
}

/** Restore the given tracked paths from HEAD, clearing staged and unstaged changes. */
export function restoreFiles(git: GitRunner, files: readonly string[]): boolean {
  if (files.length === 0) return true;
  return git(['checkout', 'HEAD', '--', ...files]).status === 0;
}

export type PullFailure = 'local-changes' | 'untracked-collision' | 'diverged' | 'unknown';

/** Map git's abort message onto the case the caller can act on. */
export function classifyPullFailure(stderr: string): PullFailure {
  if (/untracked working tree files would be overwritten/i.test(stderr)) return 'untracked-collision';
  if (/local changes to the following files would be overwritten/i.test(stderr)) return 'local-changes';
  if (/not possible to fast-forward|diverging branches|non-fast-forward/i.test(stderr)) return 'diverged';
  return 'unknown';
}

/** The tab-indented paths git lists when it refuses to overwrite them. */
export function blockedPaths(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('\t'))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length > 0 && !line.startsWith('git '));
}

/** git's stderr with the multi-line `hint:` advice stripped. */
export function gitErrorSummary(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('hint:'));
  return lines.length > 0 ? lines.join('\n') : 'git exited with an error';
}

/** Upstream tracking branch of the current HEAD, or null when there is none. */
export function upstreamRef(git: GitRunner): string | null {
  const res = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (res.status !== 0) return null;
  const ref = res.stdout.trim();
  return ref.length > 0 ? ref : null;
}

export type FastForwardResult =
  | { ok: true }
  | { ok: false; failure: PullFailure; blocked: string[]; stderr: string };

/**
 * Fast-forward the checkout onto the already-fetched upstream. Uses `merge
 * --ff-only` rather than `pull` so it never re-hits the network and can't turn
 * into a merge commit.
 */
export function fastForward(git: GitRunner): FastForwardResult {
  const res = git(['merge', '--ff-only', '@{u}']);
  if (res.status === 0) return { ok: true };
  const stderr = res.stderr || res.stdout;
  return {
    ok: false,
    failure: classifyPullFailure(stderr),
    blocked: blockedPaths(stderr),
    stderr: gitErrorSummary(stderr),
  };
}

/**
 * Stash everything, untracked files included — the plain `git stash` most
 * advice suggests leaves untracked files in place, which is exactly what blocks
 * an incoming file of the same name.
 */
export function stashAll(git: GitRunner, message: string): { ok: boolean; stderr: string } {
  const res = git(['stash', 'push', '--include-untracked', '--message', message]);
  return { ok: res.status === 0, stderr: gitErrorSummary(res.stderr) };
}

/**
 * Point the checkout at upstream, discarding local commits — but tag them with
 * a branch first so nothing becomes unreachable.
 */
export function resetToUpstream(git: GitRunner, backupBranch: string): { ok: boolean; stderr: string } {
  const branch = git(['branch', '--force', backupBranch]);
  if (branch.status !== 0) return { ok: false, stderr: gitErrorSummary(branch.stderr) };
  const reset = git(['reset', '--hard', '@{u}']);
  return { ok: reset.status === 0, stderr: gitErrorSummary(reset.stderr) };
}

// ─── Repository sync ─────────────────────────────────────────────────────────

export type RepoSyncResult =
  | { status: 'updated' | 'up-to-date' }
  | { status: 'fetch-failed' | 'no-upstream'; detail: string }
  | { status: 'blocked'; failure: PullFailure; blocked: string[]; detail: string };

export interface SyncLogger {
  step: (message: string) => void;
  warn: (message: string) => void;
}

const SILENT: SyncLogger = { step: () => {}, warn: () => {} };

/** Timestamp suffix for stash messages and backup branches. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Bring the Engram checkout up to the latest upstream commit.
 *
 * `pnpm install` rewrites pnpm-lock.yaml on every setup and update, so the
 * checkout is routinely dirty through no fault of the user — those files are
 * restored before the fast-forward instead of aborting it. Anything else that
 * blocks the update is reported by name rather than as a bare "pull failed".
 *
 * With `force`, local work is set aside first — always stashed (untracked files
 * included, since `git reset --hard` would overwrite those without a trace) and,
 * for a diverged checkout, local commits are kept on a backup branch.
 */
export function syncRepo(
  repoPath: string,
  opts: { force?: boolean; log?: SyncLogger } = {},
): RepoSyncResult {
  const git = gitIn(repoPath);
  const log = opts.log ?? SILENT;

  log.step('Checking for updates...');
  const fetched = git(['fetch', '--quiet']);
  if (fetched.status !== 0) {
    return { status: 'fetch-failed', detail: gitErrorSummary(fetched.stderr) };
  }

  if (!upstreamRef(git)) {
    return { status: 'no-upstream', detail: 'HEAD has no tracking branch' };
  }

  const local = git(['rev-parse', 'HEAD']).stdout.trim();
  const remote = git(['rev-parse', '@{u}']).stdout.trim();
  if (local && local === remote) return { status: 'up-to-date' };

  const behind = git(['rev-list', '--count', 'HEAD..@{u}']).stdout.trim();
  if (behind && behind !== '0') log.step(`${behind} new commit(s) available`);

  log.step('Pulling latest changes...');

  // Lockfile churn from our own `pnpm install` — build residue, not user work.
  const tree = inspectWorkingTree(git);
  if (tree.regenerated.length > 0 && restoreFiles(git, tree.regenerated)) {
    log.step(`Reset locally regenerated ${tree.regenerated.join(', ')}`);
  }

  let result = fastForward(git);
  if (result.ok) return { status: 'updated' };
  if (!opts.force) {
    return { status: 'blocked', failure: result.failure, blocked: result.blocked, detail: result.stderr };
  }

  // Stash before anything destructive: --include-untracked is what makes an
  // incoming file with the same name survivable, and it must happen before a
  // hard reset, which overwrites untracked files silently.
  if (!inspectWorkingTree(git).clean) {
    const stashed = stashAll(git, `engram update ${stamp()}`);
    if (!stashed.ok) {
      return { status: 'blocked', failure: result.failure, blocked: result.blocked, detail: stashed.stderr };
    }
    log.warn('Local changes stashed — recover them with: git stash pop (or git stash show -p)');
  }

  if (result.failure === 'diverged') {
    const backupBranch = `engram-backup-${stamp()}`;
    const reset = resetToUpstream(git, backupBranch);
    if (!reset.ok) {
      return { status: 'blocked', failure: 'diverged', blocked: [], detail: reset.stderr };
    }
    log.warn(`Local commits moved to branch ${backupBranch}`);
    return { status: 'updated' };
  }

  result = fastForward(git);
  if (result.ok) return { status: 'updated' };
  return { status: 'blocked', failure: result.failure, blocked: result.blocked, detail: result.stderr };
}
