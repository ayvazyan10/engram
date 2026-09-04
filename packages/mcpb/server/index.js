#!/usr/bin/env node
/**
 * Engram MCP Desktop Extension — bootstrap launcher
 *
 * Ensures @engram-ai-memory/mcp is installed at the pinned version,
 * then hands off to the real server via stdio.
 *
 * Two host realities shape everything below.
 *
 * 1. Windows ships npm as `npm.cmd`. `execFileSync('npm', …)` cannot resolve
 *    it (spawn npm ENOENT), and since Node 18.20 / 20.12 a `.cmd` cannot be
 *    spawned without a shell at all (CVE-2024-27980 hardening). The manifest
 *    declares win32 support, so first launch failed on every Windows machine
 *    and every launch after it exited 1.
 *
 * 2. Claude Desktop launches MCP servers with the GUI PATH (/usr/bin:/bin:…),
 *    which contains neither an nvm node nor a Homebrew-on-Apple-Silicon one.
 *    `spawn('node', …)` therefore found nothing on plenty of Macs.
 *
 * Both are solved the same way: run everything through `process.execPath`, the
 * node binary already executing this file. That also keeps npm off the shell —
 * which matters, because the install directory contains the user's home path
 * and must never be interpolated into a command string.
 */

'use strict';

const { execFileSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE = '@engram-ai-memory/mcp';
/**
 * Used only when the host sets no ENGRAM_PACKAGE_VERSION. It must track the
 * published @engram-ai-memory/mcp version: the install marker is
 * `.installed-<version>`, so a stale value here installs an old server once and
 * never upgrades it. Kept honest by the version test in
 * packages/mcp/src/__tests__/mcpb-launcher.test.ts, which fails when this, the
 * manifest pin and packages/mcp/package.json drift apart.
 */
const DEFAULT_VERSION = '0.6.3';
const INSTALL_DIR = path.join(os.homedir(), '.engram', 'mcp');

/** A version we are willing to put on a command line: no shell metacharacters. */
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

function log(msg) {
  process.stderr.write(`[engram] ${msg}\n`);
}

/**
 * The version to install. ENGRAM_PACKAGE_VERSION comes from the host manifest
 * and can reach a shell on the Windows fallback path below, so anything that
 * is not a bare version token is refused here rather than quoted and hoped for.
 */
function resolveVersion(raw) {
  if (raw === undefined || raw === null || String(raw).trim().length === 0) return DEFAULT_VERSION;
  const value = String(raw).trim();
  if (!SAFE_VERSION.test(value)) {
    throw new Error(`Refusing to install an unrecognised package version: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * npm's own JS entry point, next to the node binary we are running: the
 * standard Windows install puts it at <nodedir>\node_modules\npm\bin\npm-cli.js
 * and POSIX ones at <nodedir>/../lib/node_modules/npm/bin/npm-cli.js.
 *
 * Running that through `process.execPath` is a plain argv spawn on every
 * platform — no shell, no `.cmd` resolution, and the npm that belongs to this
 * node rather than whatever the GUI PATH happens to expose.
 */
function findNpmCli(execPath, exists) {
  const dir = path.dirname(execPath);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => exists(candidate)) || null;
}

/**
 * Quote a value for cmd.exe. Inside double quotes cmd leaves &, |, <, >, ^ and
 * spaces alone, but still expands %VAR% — and a literal quote would end the
 * quoting outright. Nothing here is worth guessing about: refuse instead.
 */
function quoteForCmd(value) {
  if (/["%\r\n]/.test(value)) {
    throw new Error(`Refusing to quote a path containing " % or a newline for the Windows shell: ${value}`);
  }
  return `"${value}"`;
}

/**
 * How to run `npm <args>`.
 *
 * Preferred and used almost everywhere: node + npm-cli.js, argv only. The
 * shell is reached for exactly once — Windows with no npm-cli.js beside node —
 * and there every value is quoted by us, never interpolated raw.
 */
function npmInvocation(args, opts) {
  const options = opts || {};
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const exists = options.exists || existsSync;

  const npmCli = findNpmCli(execPath, exists);
  if (npmCli) return { file: execPath, argv: [npmCli].concat(args), shell: false };
  if (platform !== 'win32') return { file: 'npm', argv: args, shell: false };

  // With shell:true Node joins file and args with spaces and hands the result
  // to cmd.exe unquoted, so the command has to arrive already quoted — as one
  // string, with no argv left for Node to append.
  const command = ['npm'].concat(args.map(quoteForCmd)).join(' ');
  return { file: command, argv: [], shell: true };
}

/** argv for the install. The install directory is its OWN entry, never a string. */
function installArgs(installDir, version) {
  return ['install', '--prefix', installDir, `${PACKAGE}@${version}`];
}

/** How to start the real server: the node running us, not PATH's idea of one. */
function serverInvocation(installDir) {
  return {
    file: process.execPath,
    args: [path.join(installDir, 'node_modules', PACKAGE, 'dist', 'server.js')],
  };
}

function ensureInstalled(version, installDir) {
  const marker = path.join(installDir, `.installed-${version}`);
  if (existsSync(marker)) return;

  log(`Installing ${PACKAGE}@${version} to ${installDir} ...`);

  const { mkdirSync, writeFileSync } = require('fs');
  mkdirSync(installDir, { recursive: true });

  const invocation = npmInvocation(installArgs(installDir, version));
  try {
    execFileSync(invocation.file, invocation.argv, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: invocation.shell,
    });
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : String(err);
    log(`Installation failed: ${msg}`);
    process.exit(1);
  }

  // Write marker so we skip install on subsequent launches
  writeFileSync(marker, new Date().toISOString());
  log(`Installed ${PACKAGE}@${version}`);
}

function startServer(installDir) {
  const invocation = serverInvocation(installDir);
  const child = spawn(invocation.file, invocation.args, {
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    log(`Failed to start server: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });

  process.on('SIGINT',  () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

module.exports = {
  DEFAULT_VERSION,
  PACKAGE,
  INSTALL_DIR,
  resolveVersion,
  findNpmCli,
  quoteForCmd,
  npmInvocation,
  installArgs,
  serverInvocation,
  ensureInstalled,
  startServer,
};

// Only as the entrypoint: requiring this file (the tests in packages/mcp do)
// must not install anything or spawn a server.
if (require.main === module) {
  let version;
  try {
    version = resolveVersion(process.env['ENGRAM_PACKAGE_VERSION']);
  } catch (err) {
    log(err.message);
    process.exit(1);
  }
  ensureInstalled(version, INSTALL_DIR);
  startServer(INSTALL_DIR);
}
