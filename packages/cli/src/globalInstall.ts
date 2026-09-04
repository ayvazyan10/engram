/**
 * Global-install helpers behind `engram setup` / `engram update`.
 *
 * Both commands refresh the globally installed CLI with `npm install -g .`, and
 * a bare `npm` resolves whatever `npm config get prefix` reports — which is not
 * necessarily the prefix the running binary lives under. A machine where the
 * user installed under ~/.npm-global but npm's config still points at /usr gets
 * an EACCES on /usr/lib/node_modules, and the printed advice
 * (`npm install -g @engram-ai-memory/cli@latest`) resolves the same wrong
 * prefix and fails identically. So the prefix is derived from where this module
 * actually sits, and the executed command and the printed advice are built from
 * that one value.
 *
 * Kept free of process.exit / console side effects so it stays unit-testable;
 * every path-shaped decision is a pure function taking the path as a parameter.
 */

import fs from 'fs';
import { fileURLToPath } from 'url';

/** The npm package this CLI publishes as — used in the copy-pasteable fix line. */
export const CLI_PACKAGE = '@engram-ai-memory/cli';

/** Most npm output worth showing is the last handful of lines. */
const DEFAULT_ERROR_LINES = 5;

/**
 * Path segments that mean "this tree is not an npm prefix". A pnpm virtual
 * store and an npx cache both contain a node_modules boundary, but installing
 * into either would put the CLI somewhere nothing on PATH ever looks.
 */
const NON_PREFIX_MARKERS: ReadonlySet<string> = new Set(['.pnpm', '_npx', '_cacache']);

/** True for a path written in Windows shape, whichever platform we run on. */
function isWindowsPath(modulePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(modulePath) || modulePath.includes('\\');
}

/**
 * The npm prefix the running CLI was installed under, derived from the path of
 * a module inside it.
 *
 * Handles both global layouts: `<prefix>/lib/node_modules/<pkg>/...` on POSIX
 * and `<prefix>/node_modules/<pkg>/...` on Windows. Returns null when the CLI
 * is not running from a global install at all (a repo checkout, `pnpm link`,
 * an npx cache) — null means "install with no --prefix", exactly as before.
 */
export function derivePrefixFromModulePath(modulePath: string): string | null {
  if (!modulePath) return null;

  const segments = modulePath.split(/[\\/]+/);
  if (segments.some((segment) => NON_PREFIX_MARKERS.has(segment))) return null;

  // The OUTERMOST node_modules is the install boundary. A dependency vendored
  // inside the CLI's own package sits behind a second, deeper one, and taking
  // that would name the package directory as the prefix.
  const boundary = segments.indexOf('node_modules');
  if (boundary < 0) return null;

  const above = segments.slice(0, boundary);
  const prefixSegments = above[above.length - 1] === 'lib' ? above.slice(0, -1) : above;
  // A leading '' is the POSIX root and carries no name of its own, so a prefix
  // of nothing but roots and separators is not a prefix worth passing to npm.
  if (!prefixSegments.some((segment) => segment.length > 0)) return null;

  return prefixSegments.join(isWindowsPath(modulePath) ? '\\' : '/');
}

/** Split a path written in either shape into its segments. */
function splitPath(value: string): string[] {
  return value.split(/[\\/]+/);
}

/** Rejoin segments with the separator the original path was written in. */
function joinPath(segments: readonly string[], windows: boolean): string {
  return segments.join(windows ? '\\' : '/');
}

/** Windows path comparison is case-insensitive; POSIX is not. */
function samePath(a: string, b: string, windows: boolean): boolean {
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The filesystem questions the install-boundary lookup needs to ask. Injected
 * so the layouts below can be tested without building real symlink trees.
 */
export interface InstallProbe {
  /** Fully resolved path, or null when it does not exist or cannot be read. */
  realpath(path: string): string | null;
  /** Whether this directory holds a package.json. */
  hasPackageJson(dir: string): boolean;
}

const NODE_PROBE: InstallProbe = {
  realpath(target) {
    try { return fs.realpathSync(target); } catch { return null; }
  },
  hasPackageJson(dir) {
    try { return fs.statSync(`${dir}/package.json`).isFile(); } catch { return false; }
  },
};

/** The nearest directory at or above `file` that holds a package.json. */
export function findPackageRoot(file: string, hasPackageJson: (dir: string) => boolean): string | null {
  const segments = splitPath(file);
  const windows = isWindowsPath(file);
  for (let end = segments.length - 1; end > 0; end--) {
    const dir = joinPath(segments.slice(0, end), windows);
    if (dir.length === 0) continue; // POSIX root — nothing to test
    if (hasPackageJson(dir)) return dir;
  }
  return null;
}

/**
 * Prefixes the bin we were launched from could belong to, each paired with the
 * layout npm would have installed the package under there.
 *
 * The pairing is deliberate: npm's POSIX global layout is
 * `<prefix>/bin/<name>` + `<prefix>/lib/node_modules/<pkg>`, and its Windows
 * one is `<prefix>\<name>.cmd` + `<prefix>\node_modules\<pkg>`. Cross-matching
 * the two would let an unrelated tree answer for a layout it never had.
 */
function prefixCandidates(binPath: string): ReadonlyArray<{ prefix: string; layout: readonly string[]; prefixMustNotBeAPackage: boolean }> {
  const segments = splitPath(binPath);
  const windows = isWindowsPath(binPath);
  const dirSegments = segments.slice(0, -1);
  const candidates: Array<{ prefix: string; layout: readonly string[]; prefixMustNotBeAPackage: boolean }> = [];

  // POSIX: only a directory literally named `bin` is npm's global bin dir.
  if (dirSegments[dirSegments.length - 1] === 'bin' && dirSegments.length > 1) {
    candidates.push({ prefix: joinPath(dirSegments.slice(0, -1), windows), layout: ['lib', 'node_modules'], prefixMustNotBeAPackage: false });
  }
  // Windows: the shim sits directly in the prefix. A pnpm workspace root has
  // that exact shape (<repo>/node_modules/<pkg> linked at packages/cli), so
  // require the absence of a package.json — a prefix never has one.
  if (dirSegments.length > 0) {
    candidates.push({ prefix: joinPath(dirSegments, windows), layout: ['node_modules'], prefixMustNotBeAPackage: true });
  }

  return candidates.filter((candidate) => splitPath(candidate.prefix).some((segment) => segment.length > 0));
}

/**
 * The prefix a global install of THIS package lives under, found from the bin
 * the process was started from rather than from the module path.
 *
 * `npm install -g .` — what `engram setup` and `engram update` both run — does
 * not copy the package, it symlinks `<prefix>/lib/node_modules/<pkg>` at the
 * checkout. Node resolves module paths through symlinks, so after the first
 * setup `import.meta.url` names the REPO, which has no node_modules segment
 * and therefore no derivable prefix: `engram update` fell back to a bare
 * `npm install -g .` on every machine, which is the EACCES this module exists
 * to avoid. Only the link's own location still names the prefix.
 *
 * Every candidate is confirmed by resolving the installed package and checking
 * it is the very directory we are running from, so a wrapper script or shell
 * alias pointing somewhere unrelated yields null rather than a wrong prefix.
 */
export function derivePrefixFromInstalledLink(binPath: string, packageRoot: string, probe: InstallProbe): string | null {
  const target = probe.realpath(packageRoot);
  if (!target) return null;

  const windows = isWindowsPath(binPath);
  const packageSegments = CLI_PACKAGE.split('/');

  for (const candidate of prefixCandidates(binPath)) {
    if (candidate.prefixMustNotBeAPackage && probe.hasPackageJson(candidate.prefix)) continue;
    const installed = joinPath([...splitPath(candidate.prefix), ...candidate.layout, ...packageSegments], windows);
    const resolved = probe.realpath(installed);
    if (resolved && samePath(resolved, target, windows)) return candidate.prefix;
  }
  return null;
}

/**
 * The npm prefix THIS process was installed under, or null when it is not a
 * global install at all.
 *
 * Two layouts, because npm has two. A registry install puts the package under
 * `<prefix>/lib/node_modules`, so the module path names the prefix outright.
 * A `npm install -g .` symlinks the checkout there instead, and Node resolves
 * that link away before we ever see the path — so the bin beside the link is
 * what has to be asked. `process.argv[1]` is only trusted because the answer
 * is verified back against the directory we are actually running from.
 */
export function currentGlobalPrefix(
  moduleUrl: string = import.meta.url,
  binPath: string | undefined = process.argv[1],
  probe: InstallProbe = NODE_PROBE,
): string | null {
  const filePath = fileURLToPath(moduleUrl);
  // realpath returns null when the file was unlinked mid-run — npm replacing
  // this very package is exactly that case. The unresolved path still names
  // the install in every copied layout, so degrade to it rather than lose the
  // prefix.
  const fromModule = derivePrefixFromModulePath(probe.realpath(filePath) ?? filePath);
  if (fromModule) return fromModule;

  if (!binPath) return null;
  const packageRoot = findPackageRoot(filePath, (dir) => probe.hasPackageJson(dir));
  if (!packageRoot) return null;
  return derivePrefixFromInstalledLink(binPath, packageRoot, probe);
}

/**
 * Quote for a shell only when the value needs it. Prefixes come from our own
 * resolved module path, so this is about spaces in "C:\Program Files\nodejs",
 * not injection — double quotes keep Windows backslashes literal in both cmd
 * and sh, which single quotes would not do portably.
 */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@:+=./\\-]+$/.test(value)) return value;
  return `"${value.replace(/(["`$])/g, '\\$1')}"`;
}

/** argv for the install npm actually runs, with the prefix when we have one. */
export function globalInstallArgs(prefix: string | null): readonly string[] {
  return prefix ? ['install', '-g', '--prefix', prefix, '.'] : ['install', '-g', '.'];
}

/** The same install as a shell string, for execSync. */
export function globalInstallCommand(prefix: string | null): string {
  return `npm ${globalInstallArgs(prefix).map(shellQuote).join(' ')}`;
}

/**
 * The copy-pasteable line shown when the install fails. Built from the same
 * prefix as the executed command so the two can never disagree — the old advice
 * dropped the prefix and sent users straight back into the failure.
 */
export function globalInstallAdvice(prefix: string | null): string {
  const target = `${CLI_PACKAGE}@latest`;
  return prefix ? `npm install -g --prefix ${shellQuote(prefix)} ${target}` : `npm install -g ${target}`;
}

/** Buffer | string | anything else → text, without throwing on the else. */
function streamText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

/**
 * npm's own words, recovered from a failed execSync. Under `stdio: 'pipe'` npm
 * writes its diagnosis (the EACCES, the offending directory) onto the error as
 * Buffers, where a bare `catch {}` used to drop it — leaving the user with a
 * one-line warning and no way to tell a permissions problem from a network one.
 *
 * Bounded, and to the LAST lines: npm's tail carries the diagnosis, and an
 * unbounded dump would bury the fix line printed underneath it.
 */
export function npmErrorLines(err: unknown, max: number = DEFAULT_ERROR_LINES): readonly string[] {
  if (typeof err !== 'object' || err === null) return [];
  const fields = err as { stderr?: unknown; stdout?: unknown; message?: unknown };

  const captured = streamText(fields.stderr).trim() || streamText(fields.stdout).trim();
  // Nothing captured means npm never ran (ENOENT, a missing shell): the error's
  // own message is then the only account of what happened.
  const text = captured || (typeof fields.message === 'string' ? fields.message : '');

  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-max);
}
