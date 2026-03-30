#!/usr/bin/env node
/**
 * Engram MCP Desktop Extension — bootstrap launcher
 *
 * Ensures @engram-ai-memory/mcp is installed at the pinned version,
 * then hands off to the real server via stdio.
 */

'use strict';

const { execFileSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE = '@engram-ai-memory/mcp';
const VERSION = process.env['ENGRAM_PACKAGE_VERSION'] || '0.1.3';
const INSTALL_DIR = path.join(os.homedir(), '.engram', 'mcp');
const SERVER_BIN = path.join(INSTALL_DIR, 'node_modules', '.bin', 'engram-mcp');
const MARKER = path.join(INSTALL_DIR, `.installed-${VERSION}`);

function log(msg) {
  process.stderr.write(`[engram] ${msg}\n`);
}

function ensureInstalled() {
  if (existsSync(MARKER)) return;

  log(`Installing ${PACKAGE}@${VERSION} to ${INSTALL_DIR} ...`);

  const { mkdirSync } = require('fs');
  mkdirSync(INSTALL_DIR, { recursive: true });

  try {
    execFileSync(
      'npm',
      ['install', '--prefix', INSTALL_DIR, `${PACKAGE}@${VERSION}`],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : String(err);
    log(`Installation failed: ${msg}`);
    process.exit(1);
  }

  // Write marker so we skip install on subsequent launches
  require('fs').writeFileSync(MARKER, new Date().toISOString());
  log(`Installed ${PACKAGE}@${VERSION}`);
}

function startServer() {
  const child = spawn('node', [
    path.join(INSTALL_DIR, 'node_modules', PACKAGE, 'dist', 'server.js'),
  ], {
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

ensureInstalled();
startServer();
