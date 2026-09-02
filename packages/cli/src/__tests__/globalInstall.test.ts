import { describe, it, expect } from 'vitest';

import {
  CLI_PACKAGE,
  derivePrefixFromModulePath,
  currentGlobalPrefix,
  globalInstallArgs,
  globalInstallCommand,
  globalInstallAdvice,
  npmErrorLines,
} from '../globalInstall.js';

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

describe('currentGlobalPrefix', () => {
  it('is null while the tests run from the repo checkout', () => {
    // The suite imports src/globalInstall.ts straight out of the working tree,
    // which is exactly the "not a global install" case — null means the call
    // sites run `npm install -g .` with no --prefix, as they always did.
    expect(currentGlobalPrefix()).toBeNull();
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
