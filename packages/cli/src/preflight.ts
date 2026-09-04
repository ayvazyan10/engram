/**
 * The tools `engram setup` needs, checked before it starts changing anything.
 *
 * Setup went straight to `git clone`, `pnpm install` and `pnpm turbo run
 * build`. When one of them was not installed the failure arrived late and
 * wearing the wrong clothes: a missing pnpm ended in better-sqlite3 toolchain
 * advice, and a missing git in "Clone failed: git exited with null" — spawnSync
 * reports ENOENT in `clone.error`, and nothing read it. Checking first means
 * the message names the missing tool while the machine is still untouched.
 */

/** The oldest Node the workspace builds and runs on (matches the root engines). */
export const MIN_NODE_MAJOR = 22;

export interface Requirement {
  readonly name: string;
  readonly ok: boolean;
  /** What we found — a version, or why we found nothing. */
  readonly detail: string;
  readonly fix: string;
}

export function checkNode(version: string): Requirement {
  const major = parseInt(version.split('.')[0] ?? '', 10);
  if (!Number.isInteger(major)) {
    return {
      name: 'Node.js',
      ok: false,
      detail: `could not read the Node version (${JSON.stringify(version)})`,
      fix: `install Node.js ${MIN_NODE_MAJOR} or newer`,
    };
  }
  return major >= MIN_NODE_MAJOR
    ? { name: 'Node.js', ok: true, detail: version, fix: '' }
    : {
      name: 'Node.js',
      ok: false,
      detail: `${version} — Engram needs ${MIN_NODE_MAJOR} or newer`,
      fix: `install Node.js ${MIN_NODE_MAJOR}+ (nvm install ${MIN_NODE_MAJOR}), then re-run engram setup`,
    };
}

/**
 * Probe a command by asking it for its version. The probe throws when the
 * command is not there — that is the ENOENT that used to surface much later.
 */
export function checkCommand(name: string, probe: () => string, fix: string): Requirement {
  try {
    const output = probe().trim();
    if (output.length === 0) return { name, ok: false, detail: 'command produced no output', fix };
    return { name, ok: true, detail: output.split('\n')[0] ?? output, fix: '' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail: `not found (${reason})`, fix };
  }
}

export interface PreflightDeps {
  readonly nodeVersion: string;
  /** Run `<cmd> --version` and return its stdout; throws when the command is missing. */
  readonly run: (cmd: string, args: readonly string[]) => string;
  /** False in npx mode, which clones and builds nothing. */
  readonly needsRepoTools: boolean;
}

export function setupRequirements(deps: PreflightDeps): readonly Requirement[] {
  const results: Requirement[] = [checkNode(deps.nodeVersion)];
  if (!deps.needsRepoTools) return results;

  results.push(checkCommand('git', () => deps.run('git', ['--version']), 'install git from https://git-scm.com'));
  results.push(checkCommand('pnpm', () => deps.run('pnpm', ['--version']), 'install pnpm: npm install -g pnpm'));
  return results;
}

export function unmet(results: readonly Requirement[]): readonly Requirement[] {
  return results.filter((r) => !r.ok);
}
