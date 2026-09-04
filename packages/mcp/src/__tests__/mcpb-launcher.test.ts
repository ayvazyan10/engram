/**
 * The Claude Desktop extension's bootstrap launcher (packages/mcpb/server/index.js).
 *
 * It declares win32 support and could not run there at all:
 * `execFileSync('npm', …)` without a shell cannot resolve `npm.cmd` on Windows
 * (`spawn npm ENOENT`), and Node >= 18.20 / 20.12 refuses to spawn a `.cmd`
 * without a shell at all (CVE-2024-27980 hardening). First launch therefore
 * failed on every Windows machine, and `process.exit(1)` ran on every launch
 * after it. Separately, `spawn('node', …)` searched the GUI PATH Claude Desktop
 * hands its servers, which does not contain nvm or Homebrew-on-Apple-Silicon.
 *
 * Tested from here because packages/mcpb ships no test runner of its own; the
 * launcher is plain CommonJS with no build step, so it is required directly.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

const require_ = createRequire(import.meta.url);
const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const launcher: any = require_('../../../mcpb/server/index.js');

const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const POSIX_NODE = '/usr/local/bin/node';

describe('npmInvocation', () => {
  const args = ['install', '--prefix', '/home/me/.engram/mcp', '@engram-ai-memory/mcp@0.6.0'];

  it('runs npm through the node binary already running us, with no shell at all', () => {
    // The one form that works identically on every platform: a plain argv
    // spawn, so nothing we pass is ever parsed by a shell.
    const invocation = launcher.npmInvocation(args, {
      platform: 'win32',
      execPath: WIN_NODE,
      exists: () => true,
    });
    expect(invocation.shell).toBe(false);
    expect(invocation.file).toBe(WIN_NODE);
    expect(invocation.argv[0]).toMatch(/npm-cli\.js$/);
    expect(invocation.argv.slice(1)).toEqual(args);
  });

  it('does the same on POSIX, so nvm and Homebrew nodes use their own npm', () => {
    const invocation = launcher.npmInvocation(args, {
      platform: 'linux',
      execPath: POSIX_NODE,
      exists: () => true,
    });
    expect(invocation.shell).toBe(false);
    expect(invocation.file).toBe(POSIX_NODE);
    expect(invocation.argv.slice(1)).toEqual(args);
  });

  it('falls back to a bare argv `npm` on POSIX, where execFile resolves it fine', () => {
    const invocation = launcher.npmInvocation(args, {
      platform: 'linux',
      execPath: POSIX_NODE,
      exists: () => false,
    });
    expect(invocation).toEqual({ file: 'npm', argv: args, shell: false });
  });

  it('NEVER falls back to a bare argv `npm` on Windows — that is the ENOENT', () => {
    const invocation = launcher.npmInvocation(args, {
      platform: 'win32',
      execPath: WIN_NODE,
      exists: () => false,
    });
    expect(invocation.file).not.toBe('npm');
    expect(invocation.shell).toBe(true);
  });

  it('quotes every value in the Windows shell fallback instead of interpolating it raw', () => {
    const invocation = launcher.npmInvocation(
      ['install', '--prefix', 'C:\\Users\\John Doe\\.engram\\mcp', '@engram-ai-memory/mcp@0.6.0'],
      { platform: 'win32', execPath: WIN_NODE, exists: () => false },
    );
    expect(invocation.argv).toEqual([]);
    expect(invocation.file).toContain('"C:\\Users\\John Doe\\.engram\\mcp"');
    // A space in the home directory must not split into two arguments.
    expect(invocation.file).not.toMatch(/--prefix C:\\Users\\John Doe/);
  });

  it('refuses a value it cannot safely quote rather than building the command anyway', () => {
    for (const hostile of ['C:\\a"b', 'C:\\%PATH%', 'C:\\a\nb']) {
      expect(() =>
        launcher.npmInvocation(['install', '--prefix', hostile, 'pkg@1.0.0'], {
          platform: 'win32',
          execPath: WIN_NODE,
          exists: () => false,
        }),
      ).toThrow(/quote/i);
    }
  });
});

describe('resolveVersion', () => {
  it('accepts a normal pinned version', () => {
    expect(launcher.resolveVersion('0.6.3')).toBe('0.6.3');
    expect(launcher.resolveVersion('1.0.0-rc.1')).toBe('1.0.0-rc.1');
  });

  it('falls back to the pinned default when unset or blank', () => {
    expect(launcher.resolveVersion(undefined)).toBe(launcher.DEFAULT_VERSION);
    expect(launcher.resolveVersion('')).toBe(launcher.DEFAULT_VERSION);
    expect(launcher.resolveVersion('   ')).toBe(launcher.DEFAULT_VERSION);
  });

  it('rejects anything a shell could read as more than a version', () => {
    for (const hostile of ['0.6.0 && calc', '0.6.0; rm -rf /', '$(id)', '0.6.0|whoami', '../../etc']) {
      expect(() => launcher.resolveVersion(hostile)).toThrow(/version/i);
    }
  });
});

describe('installArgs', () => {
  it('passes the install directory as its own argv entry, never inside a string', () => {
    expect(launcher.installArgs('/home/me/.engram/mcp', '0.6.0')).toEqual([
      'install',
      '--prefix',
      '/home/me/.engram/mcp',
      '@engram-ai-memory/mcp@0.6.0',
    ]);
  });
});

describe('serverInvocation', () => {
  it('starts the server with the node binary running us, not whatever PATH has', () => {
    // Claude Desktop launches MCP servers with the GUI PATH (/usr/bin:/bin:…),
    // where an nvm or Homebrew-on-Apple-Silicon node does not appear at all.
    const invocation = launcher.serverInvocation('/home/me/.engram/mcp');
    expect(invocation.file).toBe(process.execPath);
    expect(invocation.args).toEqual([
      path.join('/home/me/.engram/mcp', 'node_modules', '@engram-ai-memory/mcp', 'dist', 'server.js'),
    ]);
  });
});

describe('importing the launcher', () => {
  it('does not install or start anything on require — only as the entrypoint', () => {
    // If the module ran its side effects on import, this suite would have
    // spawned npm and an MCP server before reaching any assertion.
    expect(typeof launcher.npmInvocation).toBe('function');
    expect(typeof launcher.ensureInstalled).toBe('function');
    expect(typeof launcher.startServer).toBe('function');
  });
});

/**
 * The extension pins the npm version it installs, and the install marker is
 * `.installed-<version>` — so a manifest pinning a version older than the
 * published package means every Desktop user keeps running the old server and
 * never upgrades, silently, until someone edits the manifest. The launcher's
 * DEFAULT_VERSION is the same trap one level down: it applies whenever the
 * manifest stops setting the variable, and it sat at 0.4.1 while the package
 * was at 0.6.3.
 *
 * These are the checks that would have caught it: the three versions have to
 * move together, so a release that forgets one fails here instead of shipping.
 */
describe('pinned package version', () => {
  const readJson = (p: string): any =>
    JSON.parse(readFileSync(path.join(__dirname_, p), 'utf8'));

  const mcpVersion = readJson('../../package.json').version as string;

  it('matches the version the extension manifest installs', () => {
    const manifest = readJson('../../../mcpb/manifest.json');
    expect(manifest.server.mcp_config.env.ENGRAM_PACKAGE_VERSION).toBe(mcpVersion);
  });

  it('matches the launcher fallback used when the manifest sets nothing', () => {
    expect(launcher.DEFAULT_VERSION).toBe(mcpVersion);
  });

  it('pins a concrete version, never a floating tag the install marker cannot track', () => {
    expect(mcpVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(launcher.DEFAULT_VERSION).not.toBe('latest');
  });
});
