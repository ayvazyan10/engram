import { describe, it, expect } from 'vitest';

import {
  CLI_PACKAGE,
  derivePrefixFromModulePath,
  derivePrefixFromInstalledLink,
  findPackageRoot,
  currentGlobalPrefix,
  globalInstallArgs,
  globalInstallCommand,
  globalInstallAdvice,
  npmErrorLines,
} from '../globalInstall.js';
import type { InstallProbe } from '../globalInstall.js';

/**
 * A fake filesystem for the symlink-aware lookups: `links` maps a path to what
 * it really resolves to, `packages` lists directories holding a package.json.
 */
function probeOf(links: Record<string, string>, packages: readonly string[] = []): InstallProbe {
  return {
    realpath: (p) => links[p] ?? null,
    hasPackageJson: (dir) => packages.includes(dir),
  };
}

// ─── Prefix derivation (pure — no filesystem) ────────────────────────────────

describe('derivePrefixFromModulePath', () => {
  it('derives the prefix from a POSIX global layout (<prefix>/lib/node_modules)', () => {
    expect(derivePrefixFromModulePath('/usr/lib/node_modules/@engram-ai-memory/cli/dist/cli.js')).toBe('/usr');
  });

  it('derives a user-owned prefix, which is the case npm config get prefix gets wrong', () => {
    expect(
      derivePrefixFromModulePath('/home/administrator/.npm-global/lib/node_modules/@engram-ai-memory/cli/dist/cli.js'),
    ).toBe('/home/administrator/.npm-global');
  });

  it('derives the prefix from a Windows layout (<prefix>\\node_modules)', () => {
    expect(
      derivePrefixFromModulePath('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@engram-ai-memory\\cli\\dist\\cli.js'),
    ).toBe('C:\\Users\\me\\AppData\\Roaming\\npm');
  });

  it('derives the prefix when node_modules sits directly under it on POSIX (no lib segment)', () => {
    expect(derivePrefixFromModulePath('/opt/tools/node_modules/@engram-ai-memory/cli/dist/cli.js')).toBe('/opt/tools');
  });

  it('only strips a lib segment that borders node_modules', () => {
    expect(derivePrefixFromModulePath('/opt/lib/lib/node_modules/@engram-ai-memory/cli/dist/cli.js')).toBe('/opt/lib');
  });

  it('handles a deeply nested file inside a scoped package', () => {
    expect(
      derivePrefixFromModulePath(
        '/home/me/.npm-global/lib/node_modules/@engram-ai-memory/cli/dist/lib/internal/globalInstall.js',
      ),
    ).toBe('/home/me/.npm-global');
  });

  it('keeps the outermost boundary when the package has nested dependencies', () => {
    expect(
      derivePrefixFromModulePath(
        '/usr/local/lib/node_modules/@engram-ai-memory/cli/node_modules/@engram-ai-memory/core/dist/index.js',
      ),
    ).toBe('/usr/local');
  });

  it('returns null for a repo checkout — there is no global install to target', () => {
    expect(derivePrefixFromModulePath('/home/me/projects/neuralCore/packages/cli/dist/cli.js')).toBeNull();
  });

  it('returns null for a pnpm-linked checkout (virtual store, not an npm prefix)', () => {
    expect(
      derivePrefixFromModulePath(
        '/home/me/.local/share/pnpm/global/5/.pnpm/@engram-ai-memory+cli@0.6.3/node_modules/@engram-ai-memory/cli/dist/cli.js',
      ),
    ).toBeNull();
  });

  it('returns null for an npx cache path', () => {
    expect(derivePrefixFromModulePath('/home/me/.npm/_npx/4f1c2/node_modules/@engram-ai-memory/cli/dist/cli.js')).toBeNull();
  });

  it('returns null when nothing sensible is left above node_modules', () => {
    expect(derivePrefixFromModulePath('/node_modules/@engram-ai-memory/cli/dist/cli.js')).toBeNull();
    expect(derivePrefixFromModulePath('/lib/node_modules/@engram-ai-memory/cli/dist/cli.js')).toBeNull();
    expect(derivePrefixFromModulePath('')).toBeNull();
  });
});

// ─── The install boundary when the package directory is a SYMLINK ────────────

/**
 * `npm install -g .` — which is what `engram setup` and `engram update` run —
 * does not copy the package: it symlinks
 * `<prefix>/lib/node_modules/@engram-ai-memory/cli` at the repo checkout. Node
 * resolves module paths through symlinks, so `import.meta.url` names the REPO,
 * which has no node_modules segment and yields no prefix at all. The link's own
 * location is the only thing left that names the prefix, and the bin the
 * process was started from sits beside it.
 */
describe('findPackageRoot', () => {
  it('finds the directory holding package.json', () => {
    const root = findPackageRoot('/repo/packages/cli/dist/globalInstall.js', (dir) => dir === '/repo/packages/cli');
    expect(root).toBe('/repo/packages/cli');
  });

  it('finds it from a source tree as well as a build output', () => {
    const root = findPackageRoot('/repo/packages/cli/src/globalInstall.ts', (dir) => dir === '/repo/packages/cli');
    expect(root).toBe('/repo/packages/cli');
  });

  it('takes the NEAREST package.json, not an outer workspace one', () => {
    const has = (dir: string): boolean => dir === '/repo' || dir === '/repo/packages/cli';
    expect(findPackageRoot('/repo/packages/cli/dist/globalInstall.js', has)).toBe('/repo/packages/cli');
  });

  it('walks up a Windows path too', () => {
    const root = findPackageRoot('C:\\repo\\packages\\cli\\dist\\globalInstall.js', (dir) => dir === 'C:\\repo\\packages\\cli');
    expect(root).toBe('C:\\repo\\packages\\cli');
  });

  it('is null when nothing above the file is a package', () => {
    expect(findPackageRoot('/repo/packages/cli/dist/globalInstall.js', () => false)).toBeNull();
  });
});

describe('derivePrefixFromInstalledLink', () => {
  const repoPackage = '/home/me/.engram/repo/packages/cli';
  const installed = `/home/me/.npm-global/lib/node_modules/${CLI_PACKAGE}`;

  it('recovers the prefix from the bin beside a symlinked global install', () => {
    const probe = probeOf({ [repoPackage]: repoPackage, [installed]: repoPackage });
    expect(derivePrefixFromInstalledLink('/home/me/.npm-global/bin/engram', repoPackage, probe)).toBe(
      '/home/me/.npm-global',
    );
  });

  it('recovers a system prefix the same way', () => {
    const sysInstalled = `/usr/local/lib/node_modules/${CLI_PACKAGE}`;
    const probe = probeOf({ [repoPackage]: repoPackage, [sysInstalled]: repoPackage });
    expect(derivePrefixFromInstalledLink('/usr/local/bin/engram', repoPackage, probe)).toBe('/usr/local');
  });

  it('recovers the Windows prefix, where the shim sits directly in the prefix', () => {
    const winPackage = 'C:\\repo\\packages\\cli';
    const winInstalled = `C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\${CLI_PACKAGE.replace('/', '\\')}`;
    const probe = probeOf({ [winPackage]: winPackage, [winInstalled]: winPackage });
    expect(derivePrefixFromInstalledLink('C:\\Users\\me\\AppData\\Roaming\\npm\\engram.cmd', winPackage, probe)).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\npm',
    );
  });

  it('is null when the global install points at a DIFFERENT checkout', () => {
    // Another clone linked into the same prefix must not be mistaken for ours.
    const probe = probeOf({ [repoPackage]: repoPackage, [installed]: '/home/me/other-clone/packages/cli' });
    expect(derivePrefixFromInstalledLink('/home/me/.npm-global/bin/engram', repoPackage, probe)).toBeNull();
  });

  it('is null when nothing is installed under the bin\'s prefix', () => {
    const probe = probeOf({ [repoPackage]: repoPackage });
    expect(derivePrefixFromInstalledLink('/home/me/.npm-global/bin/engram', repoPackage, probe)).toBeNull();
  });

  it('is null when the package root itself cannot be resolved', () => {
    const probe = probeOf({ [installed]: repoPackage });
    expect(derivePrefixFromInstalledLink('/home/me/.npm-global/bin/engram', repoPackage, probe)).toBeNull();
  });

  it('does not mistake a workspace root for an npm prefix', () => {
    // A pnpm workspace links <repo>/node_modules/@engram-ai-memory/cli at
    // packages/cli, which has the Windows install shape. A prefix never holds
    // a package.json; a workspace root always does.
    const workspaceLink = `/repo/node_modules/${CLI_PACKAGE}`;
    const probe = probeOf({ '/repo/packages/cli': '/repo/packages/cli', [workspaceLink]: '/repo/packages/cli' }, ['/repo']);
    expect(derivePrefixFromInstalledLink('/repo/engram.js', '/repo/packages/cli', probe)).toBeNull();
  });

  it('only treats the parent of a directory literally named bin as a POSIX prefix', () => {
    const odd = `/home/me/scripts/lib/node_modules/${CLI_PACKAGE}`;
    const probe = probeOf({ [repoPackage]: repoPackage, [odd]: repoPackage });
    expect(derivePrefixFromInstalledLink('/home/me/scripts/tools/engram', repoPackage, probe)).toBeNull();
  });
});

describe('currentGlobalPrefix', () => {
  const repoPackage = '/home/me/.engram/repo/packages/cli';
  const moduleUrl = `file://${repoPackage}/dist/globalInstall.js`;

  it('recovers the prefix after `npm install -g .`, where the module path names the repo', () => {
    // The regression that shipped: `engram update` is ALWAYS in this state
    // after the first `engram setup`, so the prefix fix never applied to the
    // command it was written for and the EACCES it fixed came straight back.
    const installed = `/home/me/.npm-global/lib/node_modules/${CLI_PACKAGE}`;
    const probe = probeOf(
      { [`${repoPackage}/dist/globalInstall.js`]: `${repoPackage}/dist/globalInstall.js`, [repoPackage]: repoPackage, [installed]: repoPackage },
      [repoPackage],
    );
    expect(currentGlobalPrefix(moduleUrl, '/home/me/.npm-global/bin/engram', probe)).toBe('/home/me/.npm-global');
  });

  it('and then BOTH the executed command and the printed advice carry --prefix', () => {
    const installed = `/home/me/.npm-global/lib/node_modules/${CLI_PACKAGE}`;
    const probe = probeOf(
      { [`${repoPackage}/dist/globalInstall.js`]: `${repoPackage}/dist/globalInstall.js`, [repoPackage]: repoPackage, [installed]: repoPackage },
      [repoPackage],
    );
    const prefix = currentGlobalPrefix(moduleUrl, '/home/me/.npm-global/bin/engram', probe);
    expect(globalInstallCommand(prefix)).toBe('npm install -g --prefix /home/me/.npm-global .');
    expect(globalInstallAdvice(prefix)).toBe(`npm install -g --prefix /home/me/.npm-global ${CLI_PACKAGE}@latest`);
  });

  it('still reads a registry install straight off the module path', () => {
    const registryModule = `/usr/lib/node_modules/${CLI_PACKAGE}/dist/globalInstall.js`;
    const probe = probeOf({ [registryModule]: registryModule });
    expect(currentGlobalPrefix(`file://${registryModule}`, '/usr/bin/engram', probe)).toBe('/usr');
  });

  it('is null for a repo checkout that no global install points at', () => {
    // Not "a checkout is never a global install" — that assumption is what
    // broke `engram update`. It is null because no bin beside a matching
    // installed package could be found.
    const probe = probeOf({ [`${repoPackage}/dist/globalInstall.js`]: `${repoPackage}/dist/globalInstall.js`, [repoPackage]: repoPackage }, [repoPackage]);
    expect(currentGlobalPrefix(moduleUrl, '/usr/bin/node', probe)).toBeNull();
  });

  it('is null when the process has no argv[1] to work from', () => {
    const probe = probeOf({ [repoPackage]: repoPackage }, [repoPackage]);
    expect(currentGlobalPrefix(moduleUrl, undefined, probe)).toBeNull();
  });

  it('runs against the real filesystem without throwing', () => {
    expect(() => currentGlobalPrefix()).not.toThrow();
  });
});

// ─── Command / advice (one source, so they cannot disagree) ──────────────────

describe('globalInstallArgs / globalInstallCommand / globalInstallAdvice', () => {
  const prefix = derivePrefixFromModulePath('/home/me/.npm-global/lib/node_modules/@engram-ai-memory/cli/dist/cli.js');

  it('passes the derived prefix to npm', () => {
    expect(globalInstallArgs(prefix)).toEqual(['install', '-g', '--prefix', '/home/me/.npm-global', '.']);
    expect(globalInstallCommand(prefix)).toBe('npm install -g --prefix /home/me/.npm-global .');
  });

  it('prints advice that targets the same prefix the command used', () => {
    expect(globalInstallAdvice(prefix)).toBe(`npm install -g --prefix /home/me/.npm-global ${CLI_PACKAGE}@latest`);
    expect(globalInstallCommand(prefix).includes('--prefix /home/me/.npm-global')).toBe(true);
    expect(globalInstallAdvice(prefix).includes('--prefix /home/me/.npm-global')).toBe(true);
  });

  it('drops --prefix from BOTH when no prefix could be derived', () => {
    expect(globalInstallArgs(null)).toEqual(['install', '-g', '.']);
    expect(globalInstallCommand(null)).toBe('npm install -g .');
    expect(globalInstallAdvice(null)).toBe(`npm install -g ${CLI_PACKAGE}@latest`);
  });

  it('quotes a prefix containing spaces in both the command and the advice', () => {
    const spaced = derivePrefixFromModulePath('C:\\Program Files\\nodejs\\node_modules\\@engram-ai-memory\\cli\\dist\\cli.js');
    expect(spaced).toBe('C:\\Program Files\\nodejs');
    expect(globalInstallCommand(spaced)).toBe('npm install -g --prefix "C:\\Program Files\\nodejs" .');
    expect(globalInstallAdvice(spaced)).toBe(`npm install -g --prefix "C:\\Program Files\\nodejs" ${CLI_PACKAGE}@latest`);
    // argv form never quotes — the shell is not involved there.
    expect(globalInstallArgs(spaced)).toContain('C:\\Program Files\\nodejs');
  });
});

// ─── npm's own words, recovered from the thrown error ────────────────────────

describe('npmErrorLines', () => {
  const execError = (fields: Record<string, unknown>): unknown => Object.assign(new Error('Command failed: npm install -g .'), fields);

  it('reads stderr Buffers, which is how execSync surfaces npm output under stdio:pipe', () => {
    const err = execError({ stderr: Buffer.from('npm error code EACCES\nnpm error syscall mkdir\n') });
    expect(npmErrorLines(err)).toEqual(['npm error code EACCES', 'npm error syscall mkdir']);
  });

  it('falls back to stdout when stderr is empty', () => {
    const err = execError({ stderr: Buffer.from('  \n'), stdout: Buffer.from('npm error EEXIST\n') });
    expect(npmErrorLines(err)).toEqual(['npm error EEXIST']);
  });

  it('keeps at most 5 lines, and keeps the LAST ones where npm puts the diagnosis', () => {
    const err = execError({ stderr: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].join('\n') });
    expect(npmErrorLines(err)).toEqual(['l3', 'l4', 'l5', 'l6', 'l7']);
    expect(npmErrorLines(err, 2)).toEqual(['l6', 'l7']);
  });

  it('drops blank lines and trailing whitespace', () => {
    const err = execError({ stderr: 'npm error EACCES   \n\n\n   \nnpm error not ok\n' });
    expect(npmErrorLines(err)).toEqual(['npm error EACCES', 'npm error not ok']);
  });

  it('falls back to the error message when npm printed nothing at all', () => {
    expect(npmErrorLines(new Error('spawn npm ENOENT'))).toEqual(['spawn npm ENOENT']);
  });

  it('never throws on a non-error value', () => {
    expect(npmErrorLines(undefined)).toEqual([]);
    expect(npmErrorLines('boom')).toEqual([]);
    expect(npmErrorLines({})).toEqual([]);
  });
});
