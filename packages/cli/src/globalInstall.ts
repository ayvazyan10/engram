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

/**
 * The prefix for THIS process, resolved through symlinks: the global bin is a
 * symlink into `<prefix>/lib/node_modules`, and only the link target names the
 * prefix. Uses this module's own URL rather than process.argv[1], which a
 * wrapper script or a shell alias can point anywhere.
 */
export function currentGlobalPrefix(moduleUrl: string = import.meta.url): string | null {
  const filePath = fileURLToPath(moduleUrl);
  try {
    return derivePrefixFromModulePath(fs.realpathSync(filePath));
  } catch (err) {
    // realpathSync throws when the file was unlinked mid-run — npm replacing
    // this very package is exactly that case. The unresolved path still names
    // the install in every layout above, so degrade to it rather than lose the
    // prefix; the error itself carries nothing a caller could act on.
    void err;
    return derivePrefixFromModulePath(filePath);
  }
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
