#!/usr/bin/env node

/**
 * @engram-ai-memory/cli — Engram command-line interface.
 *
 * Zero native dependencies — uses REST API for data commands.
 *
 * Management: engram setup | start | stop | doctor | status | configure
 * Data:       engram store | search | recall | stats | forget | export | import
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn, spawnSync } from 'child_process';
import { pidAlive, isPortOpen, awaitServerHealthy, verifyServer, portListenerPid } from './serverControl.js';
import { CLAUDE_DIR, CLAUDE_SETTINGS, CLAUDE_HOOKS, readJsonOrEmpty } from './claudeSetup.js';
import { syncRepo, nonInteractiveEnv } from './gitUpdate.js';
import { currentGlobalPrefix, globalInstallCommand } from './globalInstall.js';
import {
  defaultConfig, normalizeConfig, isConfigKey, parseConfigValue, applyDbPathEnv, CONFIG_KEYS,
} from './engramConfig.js';
import { stopProcess, describeStopOutcome } from './stopServer.js';
import {
  resolveMcpClient, supportedClientList, KNOWN_CLIENT_IDS, LEGACY_GLOBAL_MCP_FILE,
} from './mcpClients.js';
import {
  shortHead, checkPrerequisites, recordBuild, currentBuildStatus, configureMcpClient, setupClaudeCode,
  CLAUDE_PATHS,
} from './setupSteps.js';
import {
  choosePassphraseSource, passphraseWarning, readHiddenLine, encryptionInstructions, PASSPHRASE_ENV,
} from './passphrase.js';
import { B, D, G, C, R, Y, X, ok, fail, step, warn, detail } from './ui.js';
import {
  reportSyncFailure, reportGlobalInstallFailure, reportInstallFailure,
} from './reporters.js';
import type { EngramConfig } from './engramConfig.js';

// ─── Config & State ──────────────────────────────────────────────────────────

// `||`, not `??`: blank means unset here too. `'' ?? default` keeps the empty
// string, and every path below would then resolve relative to the process's
// cwd — `config.json`, `server.pid` — instead of to ~/.engram. This is the
// rule core's readEnvString states (packages/core/src/lifecycle/envConfig.ts),
// applied inline because this line runs on every `engram` invocation and a
// static core import costs ~110ms of startup for commands that only ever speak
// HTTP to the server.
const ENGRAM_HOME = process.env['ENGRAM_HOME'] || path.join(os.homedir(), '.engram');
const CONFIG_PATH = path.join(ENGRAM_HOME, 'config.json');
const PID_PATH = path.join(ENGRAM_HOME, 'server.pid');
const LOG_PATH = path.join(ENGRAM_HOME, 'logs', 'server.log');
/** Records the revision a build last COMPLETED for — see buildState.ts. */
const BUILD_STAMP_PATH = path.join(ENGRAM_HOME, 'build.json');
const REPO = 'https://github.com/ayvazyan10/engram.git';
/** Schema version of the `engram export` payload (independent of the package version). */
const EXPORT_FORMAT_VERSION = '0.1.0';

const DEFAULT_CONFIG: EngramConfig = defaultConfig(ENGRAM_HOME);

/** Config problems are worth saying once per run, not once per loadConfig(). */
let configProblemsReported = false;

/**
 * Read ~/.engram/config.json, validating every field.
 *
 * Anything the file cannot justify falls back to the default AND is reported —
 * on stderr, so `engram export` and `--json` output stay machine-readable.
 */
function loadConfig(): EngramConfig {
  if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;

  let stored: unknown;
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (!configProblemsReported) {
      configProblemsReported = true;
      console.error(`  ! ${CONFIG_PATH} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — using defaults`);
    }
    return DEFAULT_CONFIG;
  }

  const { config, problems } = normalizeConfig(stored, DEFAULT_CONFIG);
  if (problems.length > 0 && !configProblemsReported) {
    configProblemsReported = true;
    for (const problem of problems) console.error(`  ! ${problem}`);
  }
  return config;
}

function saveConfig(config: EngramConfig): void {
  fs.mkdirSync(ENGRAM_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  // Cloud sync stores a Postgres connection string (with password) in this
  // file — it must never be world- or group-readable.
  fs.chmodSync(CONFIG_PATH, 0o600);
}

function getApiBase(): string {
  const config = loadConfig();
  return `http://${config.host}:${config.port}`;
}

/** Delete the pidfile only when it still contains the given pid. */
function releasePidFileIfOwnedBy(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    const current = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
    if (current === pid) fs.unlinkSync(PID_PATH);
  } catch { /* no pidfile, or already replaced */ }
}

function isServerRunning(): { running: boolean; pid?: number } {
  if (!fs.existsSync(PID_PATH)) return { running: false };
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
  if (pidAlive(pid)) return { running: true, pid };
  try { fs.unlinkSync(PID_PATH); } catch {}
  return { running: false };
}

// ─── REST API client ─────────────────────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Claude Code auto-memory ───────────────────────────────────────────────────

const HOOKS_DIR = path.join(ENGRAM_HOME, 'hooks');

// ─── Program ─────────────────────────────────────────────────────────────────

/** Read from package.json so `engram --version` can't drift from the release. */
function packageVersion(): string {
  try {
    const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(pkg).version as string) || 'unknown';
  } catch {
    return 'unknown';
  }
}

const program = new Command();

program
  .name('engram')
  .description('Engram CLI — Universal AI Brain')
  .version(packageVersion());

// ─── setup ───────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Initialize Engram — clone, build, configure, and set up MCP for any AI client')
  .option('--no-mcp', 'Skip MCP configuration')
  .option('--no-claude-hooks', 'Skip Claude Code auto-memory (user-scope MCP + recall/session-end hooks)')
  .option('--npx', 'Use npx instead of cloning repo (fastest setup)')
  .option('--source <name>', 'AI client identifier (e.g. claude-code, cursor, windsurf)', 'mcp-client')
  // Kept because commander rejects unknown options: dropping it would break
  // any script already passing it. Setup asks nothing — git runs with
  // GIT_TERMINAL_PROMPT=0 and stdin closed, and no other step prompts — so the
  // flag has nothing to switch off. The help text says that instead of
  // promising behaviour the code does not have.
  .option('--non-interactive', 'Accepted for script compatibility — setup never prompts')
  .action(async (opts) => {
    console.log(`\n${B}  ⬡  Engram Setup${X}\n`);

    // Before anything is written: a missing git or pnpm used to surface much
    // later wearing somebody else's error message.
    step('Checking prerequisites...');
    if (!checkPrerequisites(!opts.npx)) process.exit(1);

    step('Creating ~/.engram/ directory...');
    fs.mkdirSync(path.join(ENGRAM_HOME, 'logs'), { recursive: true });
    ok(`State directory: ${ENGRAM_HOME}`);

    const config = loadConfig();
    if (!fs.existsSync(CONFIG_PATH)) {
      saveConfig(config);
      ok('Config created: ~/.engram/config.json');
    } else {
      ok('Config exists: ~/.engram/config.json');
    }

    if (!opts.npx) {
      step(`Cloning Engram into ${config.repoPath}...`);
      if (fs.existsSync(path.join(config.repoPath, '.git'))) {
        step('Repository exists — pulling latest...');
        const sync = syncRepo(config.repoPath, { log: { step, warn } });
        if (sync.status === 'updated') ok('Repository updated');
        else if (sync.status === 'up-to-date') ok('Repository already up to date');
        else {
          reportSyncFailure(sync, config.repoPath);
          warn('Continuing setup with the existing version');
        }
      } else {
        try {
          // spawnSync with an argv array — never build a shell string from
          // config.repoPath. Double quotes do not neutralise $(), backticks or
          // embedded quotes, and repoPath is user-controlled via
          // `configure set repoPath` / ENGRAM_HOME.
          //
          // Prompts off and stdin closed for the same reason `gitIn` does it:
          // the repository is public, so a credential helper offering a stale
          // entry is the only way credentials enter the picture — and git asks
          // for the password on the tty, which would hang setup unseen.
          const clone = spawnSync('git', ['clone', '--depth=1', REPO, config.repoPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: nonInteractiveEnv(process.env),
          });
          // spawnSync reports "git is not installed" in `error`, not in
          // `status` — reading only status turned an ENOENT into the
          // uninterpretable "git exited with null".
          if (clone.error) throw clone.error;
          if (clone.status !== 0) {
            throw new Error(clone.stderr?.toString().trim() || `git exited with ${clone.status}`);
          }
          ok('Repository cloned');
        } catch (err) {
          fail(`Clone failed: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      }

      const execEnv = { ...process.env, NODE_NO_WARNINGS: '1' };

      step('Installing dependencies...');
      try {
        execSync('pnpm install --no-frozen-lockfile', { cwd: config.repoPath, stdio: 'inherit', env: execEnv });
        ok('Dependencies installed');
      } catch {
        reportInstallFailure();
        process.exit(1);
      }

      step('Building all packages...');
      try {
        execSync('pnpm turbo run build', { cwd: config.repoPath, stdio: 'inherit', env: execEnv });
        // Only now: the stamp certifies a build that ran to completion.
        recordBuild(config.repoPath, BUILD_STAMP_PATH);
        ok('Build complete');
      } catch {
        fail('Build failed. Check the output above for details.');
        process.exit(1);
      }

      step('Installing CLI globally...');
      const prefix = currentGlobalPrefix();
      try {
        execSync(globalInstallCommand(prefix), { cwd: path.join(config.repoPath, 'packages', 'cli'), stdio: 'pipe', env: execEnv });
        ok('CLI linked from repo build');
      } catch (err) {
        // Setup carries on and still exits 0: the MCP wiring and Claude hooks
        // below are what make the install usable, and they work with whatever
        // `engram` binary the user already has on PATH.
        reportGlobalInstallFailure(err, prefix, 'install');
      }
    } else {
      ok('Using npx mode — skipping clone/build');
    }

    const engramEnv: Record<string, string> = {
      ENGRAM_DB_PATH: config.dbPath,
      ENGRAM_SOURCE: opts.source,
      ENGRAM_NAMESPACE_MODE: config.namespaceMode,
    };
    if (config.namespace) engramEnv['ENGRAM_NAMESPACE'] = config.namespace;
    const engramServer: Record<string, unknown> = opts.npx
      ? { command: 'npx', args: ['-y', '@engram-ai-memory/mcp@latest'], env: engramEnv }
      : { command: 'node', args: [path.join(config.repoPath, 'packages', 'mcp', 'dist', 'server.js')], env: engramEnv };

    // Every user config file setup declined to touch lands here. Setup still
    // exits 0 — the rest of the install is usable — but the banner has to say
    // so rather than reporting a success that did not happen.
    const skipped: string[] = [];

    if (opts.mcp !== false) {
      step('Configuring MCP integration...');
      configureMcpClient(opts.source, engramServer, os.homedir(), skipped);
    }

    // Claude Code gets the full auto-memory wiring: user-scope MCP so it loads
    // without manual approval, plus recall/session-end hooks for a local install.
    if (opts.claudeHooks !== false) {
      step('Setting up Claude Code auto-memory...');
      setupClaudeCode(config, engramServer, !opts.npx, HOOKS_DIR, CLAUDE_PATHS, skipped);
    }

    if (skipped.length > 0) {
      console.log(`\n${B}${Y}  Engram installed, with ${skipped.length} step(s) skipped:${X}\n`);
      for (const item of skipped) console.log(`  ${Y}!${X} ${item}`);
      console.log();
    } else {
      console.log(`\n${B}${G}  Engram installed successfully!${X}\n`);
    }
    if (opts.npx) {
      console.log(`  Restart your AI client to activate Engram.`);
      console.log(`  MCP clients Engram configures: ${D}${supportedClientList()}${X}`);
    } else {
      console.log(`  Start the server:     ${D}engram start${X}`);
      console.log(`  Check health:         ${D}engram doctor${X}`);
      console.log(`  Store a memory:       ${D}engram store "hello world"${X}`);
      console.log(`  Open dashboard:       ${C}http://localhost:${config.port}${X}`);
      console.log(`  Swagger docs:         ${C}http://localhost:${config.port}/docs${X}`);
    }
    console.log();
  });

// ─── start ───────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the Engram API server (+ 3D dashboard)')
  .option('-f, --foreground', 'Run in foreground (not detached)')
  .action(async (opts) => {
    const config = loadConfig();
    const serverScript = path.join(config.repoPath, 'apps', 'server', 'dist', 'index.js');

    if (!fs.existsSync(serverScript)) {
      fail(`Server not found at ${serverScript}`);
      console.log(`  Run ${C}engram setup${X} first.`);
      process.exit(1);
    }

    const { running, pid } = isServerRunning();
    if (running) {
      warn(`Server already running (PID ${pid})`);
      console.log(`  Dashboard: http://${config.host}:${config.port}`);
      return;
    }

    // Guard against a foreign process already holding the port. Otherwise the
    // health check below could pass against someone else's server while our
    // child dies on a bind conflict — printing a false success.
    if (await isPortOpen(config.host, config.port)) {
      fail(`Port :${config.port} is already in use by a process not managed by Engram.`);
      console.log(`  Stop that process, or pick another port: ${C}engram configure set port <n>${X}`);
      process.exit(1);
    }

    const env = {
      ...process.env,
      PORT: String(config.port),
      HOST: config.host,
      ENGRAM_DB_PATH: config.dbPath,
      ENGRAM_INDEX_PATH: config.indexPath,
      ENGRAM_EMBEDDING_MODEL: config.embeddingModel,
      ENGRAM_NAMESPACE_MODE: config.namespaceMode,
      ...(config.namespace ? { ENGRAM_NAMESPACE: config.namespace } : {}),
      ...(config.syncUrl ? { ENGRAM_SYNC_URL: config.syncUrl } : {}),
      ...(config.syncInterval ? { ENGRAM_SYNC_INTERVAL: String(config.syncInterval) } : {}),
      ...(config.syncMode ? { ENGRAM_SYNC_MODE: config.syncMode } : {}),
      ...(config.syncUrl?.includes('sslmode=disable') ? { ENGRAM_SYNC_ALLOW_UNENCRYPTED: 'true' } : {}),
      ...(process.env['ENGRAM_SYNC_ENCRYPTION_KEY'] ? { ENGRAM_SYNC_ENCRYPTION_KEY: process.env['ENGRAM_SYNC_ENCRYPTION_KEY'] } : {}),
    };

    if (opts.foreground) {
      step(`Starting Engram (foreground) on :${config.port}...`);
      const child = spawn('node', [serverScript], { env, stdio: 'inherit', cwd: config.repoPath });
      // A foreground server used to write no pidfile at all, so `engram status`
      // reported "stopped" and `engram stop` had nothing to stop while the
      // server was running in the next terminal. Same exclusive-create guard as
      // the detached path, and the file goes away with the process.
      if (child.pid !== undefined) {
        try {
          fs.writeFileSync(PID_PATH, String(child.pid), { flag: 'wx' });
        } catch {
          fail('Another Engram server is already starting or running (pidfile exists).');
          try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
          process.exit(1);
        }
      }
      const release = (): void => releasePidFileIfOwnedBy(child.pid);
      child.on('exit', (code) => { release(); process.exit(code ?? 0); });
      // Ctrl-C reaches the child too; clean up rather than leaving a pidfile
      // pointing at a PID the system is free to hand to somebody else.
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, () => { release(); process.exit(0); });
      }
      return;
    }

    step(`Starting Engram on :${config.port}...`);
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const logFd = fs.openSync(LOG_PATH, 'a');
    const child = spawn('node', [serverScript], {
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: config.repoPath,
    });
    child.unref();
    // Exclusive create: two concurrent `engram start` invocations both passed
    // the non-atomic pre-checks, and the loser's cleanup then unlinked the
    // winner's pidfile, orphaning a healthy server.
    try {
      fs.writeFileSync(PID_PATH, String(child.pid), { flag: 'wx' });
    } catch {
      fail('Another `engram start` is already in progress (pidfile exists).');
      if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
      process.exit(1);
    }

    const result = await awaitServerHealthy(child, config.host, config.port);

    if (result.healthy) {
      ok(`Engram running (PID ${child.pid})`);
      console.log(`  Dashboard: ${C}http://${config.host}:${config.port}${X}`);
      console.log(`  API:       ${C}http://${config.host}:${config.port}/api${X}`);
      console.log(`  Swagger:   ${C}http://${config.host}:${config.port}/docs${X}`);
      console.log(`  Logs:      ${D}${LOG_PATH}${X}`);
    } else {
      // Remove the pidfile only if it still points at OUR child, so we cannot
      // delete a pidfile another start already replaced.
      releasePidFileIfOwnedBy(child.pid);
      if (!result.exited && child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
      fail(result.exited
        ? `Server exited during startup${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ''} — the port may already be in use. Check logs:`
        : `Server did not become healthy on :${config.port}. Check logs:`);
      console.log(`  ${D}cat ${LOG_PATH}${X}`);
      process.exit(1);
    }
  });

// ─── stop ────────────────────────────────────────────────────────────────────

/**
 * Signal the server and wait for it to actually go, verifying first that the
 * pidfile still points at OUR process. Shared by `stop` and `update --restart`.
 */
async function stopRunningServer(pid: number, host: string, port: number): Promise<boolean> {
  const outcome = await stopProcess(pid, port, {
    alive: pidAlive,
    portOwner: portListenerPid,
    portOpen: () => isPortOpen(host, port),
    kill: (target, signal) => process.kill(target, signal),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

  if (outcome.status === 'stopped') releasePidFileIfOwnedBy(pid);

  const described = describeStopOutcome(outcome);
  (described.ok ? ok : fail)(described.message);
  for (const line of described.detail) console.log(`  ${D}${line}${X}`);
  return described.ok;
}

program
  .command('stop')
  .description('Stop the running Engram server')
  .action(async () => {
    const config = loadConfig();
    const { running, pid } = isServerRunning();
    if (!running) { warn('Server is not running.'); return; }

    // Exit code follows reality: the old command printed "Server stopped" and
    // exited 0 the instant it had sent a signal, whether or not anything died.
    if (!await stopRunningServer(pid!, config.host, config.port)) process.exit(1);
  });

// ─── doctor ──────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Health checks for Engram installation')
  .action(async () => {
    console.log(`\n${B}  Engram Doctor${X}\n`);
    let issues = 0;

    const nodeVer = process.versions.node;
    if (parseInt(nodeVer.split('.')[0]!, 10) >= 22) { ok(`Node.js ${nodeVer}`); }
    else { fail(`Node.js ${nodeVer} — requires 22+`); issues++; }

    try { ok(`pnpm ${execSync('pnpm --version', { encoding: 'utf8' }).trim()}`); }
    catch { fail('pnpm not found'); issues++; }

    if (fs.existsSync(CONFIG_PATH)) { ok(`Config: ${CONFIG_PATH}`); }
    else { fail('Config not found — run: engram setup'); issues++; }

    const config = loadConfig();
    const build = currentBuildStatus(config.repoPath, BUILD_STAMP_PATH);
    if (build.current) { ok(`Build current: ${config.repoPath}`); }
    else {
      // A repository that is up to date but not built is exactly what used to
      // read as "Already up to date." from `engram update`.
      fail('The checkout is not built, or was built from a different revision:');
      detail(build.reasons);
      console.log(`  Fix: ${C}engram update${X} ${D}(or ${C}engram setup${X}${D} if the repository is missing)${X}`);
      issues++;
    }

    if (fs.existsSync(config.dbPath)) {
      ok(`Database: ${config.dbPath} (${(fs.statSync(config.dbPath).size / 1024).toFixed(0)} KB)`);
    } else { warn('Database not created yet (auto-creates on first start)'); }

    const { running, pid } = isServerRunning();
    if (running) {
      ok(`Server running (PID ${pid})`);
      try {
        const res = await fetch(`http://${config.host}:${config.port}/api/health`);
        const data = await res.json() as { status: string; uptime: number };
        ok(`API healthy: ${data.status} (uptime: ${Math.round(data.uptime)}s)`);
      } catch { fail(`Server running but API not responding on :${config.port}`); issues++; }
    } else { warn('Server not running — start with: engram start'); }

    // Report the client config files that are actually loaded. ~/.mcp.json was
    // reported as "MCP: configured" for a year and is read by nothing — Claude
    // Code loads `.mcp.json` per PROJECT and user-scope servers from
    // ~/.claude.json, and other clients have their own files.
    let anyClientConfigured = false;
    for (const id of KNOWN_CLIENT_IDS) {
      const target = resolveMcpClient(id, os.homedir());
      if (target.kind !== 'file' || !fs.existsSync(target.path)) continue;
      if (readJsonOrEmpty(target.path).mcpServers?.engram) {
        ok(`MCP: registered for ${target.label} (${target.path})`);
        anyClientConfigured = true;
      }
    }
    if (!anyClientConfigured) {
      warn(`MCP: not registered for any client Engram knows (${supportedClientList()}) — run: engram setup --source <client>`);
      issues++;
    }

    const legacyGlobalMcp = path.join(os.homedir(), LEGACY_GLOBAL_MCP_FILE);
    if (fs.existsSync(legacyGlobalMcp) && readJsonOrEmpty(legacyGlobalMcp).mcpServers?.engram) {
      warn(`Legacy: ${legacyGlobalMcp} holds an engram entry, but no MCP client reads that file — it can be removed`);
    }
    const legacyClaudeSettings = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(legacyClaudeSettings) && readJsonOrEmpty(legacyClaudeSettings).mcpServers?.engram) {
      warn('Legacy: engram found in ~/.claude/settings.json — Claude Code reads MCP servers from ~/.claude.json');
    }

    // Claude Code auto-memory: the two hooks (its user-scope MCP entry is
    // covered by the client loop above, which reads the same ~/.claude.json).
    if (fs.existsSync(CLAUDE_DIR)) {
      const settings = readJsonOrEmpty(CLAUDE_SETTINGS);
      for (const h of CLAUDE_HOOKS) {
        // Find the registered command for this event (by script basename, so a
        // custom install location still counts), then confirm the file exists.
        let registeredPath: string | undefined;
        for (const e of (settings.hooks?.[h.event] || [])) {
          for (const x of (e.hooks || [])) {
            if (typeof x.command === 'string' && path.basename(x.command) === h.file) registeredPath = x.command;
          }
        }
        if (registeredPath && fs.existsSync(registeredPath)) ok(`Claude Code hook: ${h.event} (${h.file})`);
        else { warn(`Claude Code hook missing: ${h.event} (${h.file}) — run: engram setup`); issues++; }
      }
    }

    console.log();
    console.log(issues === 0 ? `${G}  All checks passed.${X}\n` : `${Y}  ${issues} issue(s) found.${X}\n`);
    // The exit code has to agree with the report: doctor exited 0 no matter
    // what it found, so no script could ever act on it.
    if (issues > 0) process.exitCode = 1;
  });

// ─── status ──────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show Engram server status and memory summary')
  .action(async () => {
    const config = loadConfig();
    console.log(`\n${B}  Engram Status${X}\n`);

    const { running, pid } = isServerRunning();
    if (!running) {
      console.log(`  Server:  ${R}stopped${X}`);
      console.log(`  Start:   ${D}engram start${X}\n`);
      return;
    }

    // The PID is alive — confirm it actually owns the port before claiming
    // "running" (a stale pidfile can point at a reused, unrelated PID).
    const liveness = verifyServer(pid!, config.port);
    if (liveness.state === 'port_mismatch') {
      console.log(`  Server:  ${Y}unknown${X} (PID ${pid} alive, but :${config.port} is owned by PID ${liveness.ownerPid})`);
      console.log(`  ${D}Stale pidfile? Try: engram stop && engram start${X}\n`);
      return;
    }

    console.log(`  Server:  ${G}running${X} (PID ${pid})`);
    console.log(`  URL:     http://${config.host}:${config.port}`);

    try {
      const health = await api<{ uptime: number }>('GET', '/api/health');
      console.log(`  Uptime:  ${Math.round(health.uptime)}s`);
      const stats = await api<{ total: number; byType: Record<string, number> }>('GET', '/api/stats');
      console.log(`  Memories: ${stats.total} (E:${stats.byType.episodic ?? 0} S:${stats.byType.semantic ?? 0} P:${stats.byType.procedural ?? 0})`);
    } catch { warn('Could not reach API'); }

    if (fs.existsSync(config.dbPath)) {
      console.log(`  DB:      ${config.dbPath} (${(fs.statSync(config.dbPath).size / 1024).toFixed(0)} KB)`);
    }
    console.log();
  });

// ─── configure ───────────────────────────────────────────────────────────────

const configCmd = program.command('configure').description('View or update Engram configuration');
configCmd.command('show').description('Show current config').action(() => {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
});
configCmd.command('set <key> <value>').description('Set a config value').action((key: string, value: string) => {
  const config = loadConfig();
  // An explicit key list, not `key in config`: `in` walks the prototype chain,
  // so `engram configure set constructor x` used to pass and get written to the
  // file — and it answered false for optional keys the config did not yet have,
  // so `configure set syncInterval 60000` was rejected as unknown.
  if (!isConfigKey(key)) {
    fail(`Unknown key: ${key}\n  Valid: ${CONFIG_KEYS.join(', ')}`);
    process.exit(1);
  }

  const parsed = parseConfigValue(key, value);
  if (!parsed.ok) { fail(parsed.error); process.exit(1); }

  saveConfig({ ...config, [key]: parsed.value });
  ok(`${key} = ${parsed.value}`);
});
configCmd.command('path').description('Print config file path').action(() => console.log(CONFIG_PATH));
configCmd.action(() => {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
});

// ─── cloud ───────────────────────────────────────────────────────────────────

const cloudCmd = program.command('cloud').description('Multi-device cloud sync via PostgreSQL');

cloudCmd
  .command('connect <url>')
  .description('Connect to a PostgreSQL database for multi-device sync')
  .action(async (url: string) => {
    const { validateSyncUrl, redactSyncUrl } = await import('@engram-ai-memory/core');
    try {
      // Allow unencrypted for local dev if user explicitly passes sslmode=disable
      if (url.includes('sslmode=disable')) {
        process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
      }
      validateSyncUrl(url);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
    const config = loadConfig();
    config.syncUrl = url;
    saveConfig(config);
    console.log(`✅ Cloud sync configured: ${redactSyncUrl(url)}`);
    console.log('   Sync will start automatically on next engram launch.');
  });

cloudCmd
  .command('disconnect')
  .description('Disconnect from cloud sync (local data is preserved)')
  .action(() => {
    const config = loadConfig();
    delete config.syncUrl;
    delete config.syncInterval;
    delete config.syncMode;
    saveConfig(config);
    console.log('✅ Cloud sync disconnected. Local database is unchanged.');
  });

cloudCmd
  .command('status')
  .description('Show cloud sync status')
  .action(async () => {
    const config = loadConfig();
    if (!config.syncUrl) {
      console.log('Cloud sync is not configured. Run: engram cloud connect <postgres-url>');
      return;
    }
    const { redactSyncUrl, SyncEngine } = await import('@engram-ai-memory/core');
    // Loaded here rather than at the top of the file: syncOptions reads the
    // encryption passphrase through core's env helpers, and a static import
    // would pull the whole core barrel — ~110ms — into `engram store` and
    // every other command that never touches sync.
    const { syncEngineOptions } = await import('./syncOptions.js');

    // Never `= config.dbPath || undefined`: assigning undefined to process.env
    // stores the STRING "undefined", and better-sqlite3 then opens ./undefined.
    applyDbPathEnv(process.env, config.dbPath);
    if (config.syncUrl.includes('sslmode=disable')) {
      process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
    }

    const engine = new SyncEngine(syncEngineOptions({ syncUrl: config.syncUrl }));
    const status = engine.status();
    await engine.dispose();

    // `deviceName` is a CLI-side display label and nothing more: it is read
    // from this config file here and in `cloud devices`, and no other process
    // consumes it. `engram start`/`engram update` used to export it as
    // ENGRAM_DEVICE_NAME into the server's environment, where nothing ever
    // read it — the server's identity is the per-install device id minted in
    // core (sync/deviceId.ts), which is what `status.deviceId` below shows.
    // The export was removed rather than wired up, because a name the server
    // does not use is a setting that only looks like it does something.
    const deviceName = config.deviceName || os.hostname();
    console.log(`Device:       ${deviceName} (${status.deviceId.slice(0, 8)}…)`);
    console.log(`Sync URL:     ${redactSyncUrl(config.syncUrl)}`);
    console.log(`State:        ${status.state}`);
    console.log(`Last sync:    ${status.lastSyncAt ?? 'never'}`);
    console.log(`Pending push: ${status.pendingPushCount}`);
    console.log(`Pull cursor:  ${status.pullCursor ?? 'none'}`);
    console.log(`Model:        ${status.embeddingModel ?? 'unknown'}`);
    if (status.lastError) {
      console.log(`Last error:   ${status.lastError}`);
    }
  });

cloudCmd
  .command('sync')
  .description('Run a one-shot sync cycle (push + pull)')
  .action(async () => {
    const config = loadConfig();
    if (!config.syncUrl) {
      console.error('Cloud sync is not configured. Run: engram cloud connect <postgres-url>');
      process.exit(1);
    }

    // Never `= config.dbPath || undefined`: assigning undefined to process.env
    // stores the STRING "undefined", and better-sqlite3 then opens ./undefined.
    applyDbPathEnv(process.env, config.dbPath);
    if (config.syncUrl.includes('sslmode=disable')) {
      process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
    }

    const { SyncEngine } = await import('@engram-ai-memory/core');
    // See `cloud status` above for why this is not a top-level import.
    const { syncEngineOptions } = await import('./syncOptions.js');
    const engine = new SyncEngine(syncEngineOptions({ syncUrl: config.syncUrl }));
    try {
      console.log('Syncing…');
      const result = await engine.sync();
      console.log(`✅ Sync complete in ${result.durationMs}ms`);
      console.log(`   Pushed: ${result.pushed.memories} memories, ${result.pushed.connections} connections, ${result.pushed.sessions} sessions`);
      console.log(`   Pulled: ${result.pulled.memories} memories, ${result.pulled.connections} connections, ${result.pulled.sessions} sessions`);
      if (result.conflicts > 0) {
        console.log(`   Conflicts resolved: ${result.conflicts}`);
      }
    } catch (err) {
      console.error(`❌ Sync failed: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      await engine.dispose();
    }
  });

cloudCmd
  .command('devices')
  .description('Show known devices (from local sync state)')
  .action(async () => {
    const config = loadConfig();
    if (!config.syncUrl) {
      console.log('Cloud sync is not configured. Run: engram cloud connect <postgres-url>');
      return;
    }

    const { getDeviceId } = await import('@engram-ai-memory/core');
    // Never `= config.dbPath || undefined`: assigning undefined to process.env
    // stores the STRING "undefined", and better-sqlite3 then opens ./undefined.
    applyDbPathEnv(process.env, config.dbPath);

    const deviceId = getDeviceId();
    const deviceName = config.deviceName || os.hostname();
    console.log(`This device: ${deviceName} (${deviceId})`);
    console.log('\nNote: Full device listing requires querying the shared database.');
    console.log('Use "engram cloud status" to see sync state for this device.');
  });

cloudCmd
  // The passphrase is now optional: passing it on argv puts the key that
  // decrypts every synced memory into the shell history and into `ps`.
  .command('encrypt [passphrase]')
  .description('Initialize end-to-end encryption for cloud sync (prompts if no passphrase is given)')
  .action(async (passphraseArg: string | undefined) => {
    const config = loadConfig();
    if (!config.syncUrl) {
      console.error('Cloud sync is not configured. Run: engram cloud connect <postgres-url>');
      process.exit(1);
    }

    if (config.syncUrl.includes('sslmode=disable')) {
      process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
    }

    const source = choosePassphraseSource(passphraseArg, process.env, Boolean(process.stdin.isTTY));
    if (source.kind === 'unavailable') {
      console.error('No passphrase given, and there is no terminal to ask on.');
      console.error(`Pass it in the environment instead: ${PASSPHRASE_ENV}='…' engram cloud encrypt`);
      process.exit(1);
    }
    for (const line of passphraseWarning(source)) warn(line);

    const passphrase = source.kind === 'prompt'
      ? await readHiddenLine('Passphrase: ', process.stdin, process.stdout)
      : source.value;
    if (passphrase.length === 0) {
      console.error('An empty passphrase would encrypt nothing. Aborted.');
      process.exit(1);
    }

    const { createPgSyncConnection, PgSyncClient, EncryptionManager, EncryptionError } =
      await import('@engram-ai-memory/core');

    let conn: Awaited<ReturnType<typeof createPgSyncConnection>> | null = null;
    try {
      conn = await createPgSyncConnection(config.syncUrl);
      const pgClient = new PgSyncClient({ db: conn.db, pool: conn.pool });
      const manager = new EncryptionManager(pgClient);
      await manager.initialize(passphrase);

      console.log('🔐 Encryption initialized successfully.');
      console.log('');
      // The passphrase itself is never echoed — printing it put it in the
      // terminal scrollback of a command that already had it in shell history.
      for (const line of encryptionInstructions()) console.log(line);
    } catch (err) {
      if (err instanceof EncryptionError && err.code === 'WRONG_PASSPHRASE') {
        console.error('❌ This database already has encryption configured with a different passphrase.');
        console.error('   Use the same passphrase that was used to initialize encryption on the first device.');
      } else {
        console.error(`❌ Failed to initialize encryption: ${(err as Error).message}`);
      }
      process.exit(1);
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  });

// ─── init ───────────────────────────────────────────────────────────────────

const MEMORY_INSTRUCTIONS = `# Memory (Engram)

This project uses Engram for persistent AI memory across sessions.

## Behavior

1. **Start of every conversation**: call \`recall_context\` with what the user is asking about.
2. **Store automatically**: architecture decisions, coding conventions, bug fixes, build commands, user preferences. Never ask — just store.
3. **Before answering history questions**: call \`search_memory\` to check for stored context.
4. **End of session**: store a brief summary with tags=["session-summary"].
5. **Never announce** memory operations — use them silently.
`;

const AI_CLIENT_FILES: Record<string, string> = {
  claude: 'CLAUDE.md',
  cursor: '.cursorrules',
  windsurf: '.windsurfrules',
  cline: '.clinerules',
};

program
  .command('init')
  .description('Add Engram memory instructions to the current project for your AI client')
  .option('--client <name>', 'AI client: claude, cursor, windsurf, cline, all (default: all)', 'all')
  .action((opts) => {
    const cwd = process.cwd();
    const clients = opts.client === 'all' ? Object.keys(AI_CLIENT_FILES) : [opts.client];

    for (const client of clients) {
      const filename = AI_CLIENT_FILES[client];
      if (!filename) { warn(`Unknown client: ${client}. Valid: ${Object.keys(AI_CLIENT_FILES).join(', ')}, all`); continue; }
      const filepath = path.join(cwd, filename);

      if (fs.existsSync(filepath)) {
        const existing = fs.readFileSync(filepath, 'utf8');
        if (existing.includes('Engram')) {
          ok(`${filename}: already has Engram instructions`);
          continue;
        }
        fs.appendFileSync(filepath, '\n' + MEMORY_INSTRUCTIONS);
        ok(`${filename}: appended Engram memory instructions`);
      } else {
        fs.writeFileSync(filepath, MEMORY_INSTRUCTIONS);
        ok(`${filename}: created with Engram memory instructions`);
      }
    }
    console.log();
  });

// ─── update ─────────────────────────────────────────────────────────────────

program
  .command('update')
  .description('Update Engram to the latest version — pull, rebuild, and restart')
  .option('--no-restart', 'Skip server restart after update')
  .option('-f, --force', 'Set local changes aside (stash / backup branch) and update anyway')
  .action(async (opts) => {
    console.log(`\n${B}  ⬡  Engram Update${X}\n`);

    const config = loadConfig();
    const repoPath = config.repoPath;

    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      fail(`Repository not found at ${repoPath}`);
      console.log(`  Run ${C}engram setup${X} first.`);
      process.exit(1);
    }

    const sync = syncRepo(repoPath, { force: opts.force === true, log: { step, warn } });
    let repositoryMoved = true;

    if (sync.status === 'up-to-date') {
      // Git having nothing to fetch is not the same as the machine being up to
      // date. An update that fast-forwarded and then died in `pnpm install`
      // leaves exactly this state, and the old early return answered
      // "✓ Already up to date." with apps/server/dist missing or built from the
      // previous commit — `engram start` then ran the old server or failed with
      // "Server not found", and nothing said a rebuild was what was missing.
      const build = currentBuildStatus(repoPath, BUILD_STAMP_PATH);
      if (build.current) {
        ok('Already up to date.');
        console.log();
        return;
      }
      repositoryMoved = false;
      warn('The repository is up to date, but the build is not:');
      detail(build.reasons);
      step('Rebuilding...');
    } else if (sync.status !== 'updated') {
      reportSyncFailure(sync, repoPath);
      console.log();
      process.exit(1);
    } else {
      ok('Repository updated');
    }

    const execEnv = { ...process.env, NODE_NO_WARNINGS: '1' };

    step('Installing dependencies...');
    try {
      execSync('pnpm install --no-frozen-lockfile', { cwd: repoPath, stdio: 'inherit', env: execEnv });
      ok('Dependencies installed');
    } catch {
      reportInstallFailure();
      process.exit(1);
    }

    step('Rebuilding all packages...');
    try {
      execSync('pnpm turbo run build', { cwd: repoPath, stdio: 'inherit', env: execEnv });
      // Written only here, after a build that ran to completion: the stamp is
      // what lets the next run tell a finished update from an interrupted one.
      recordBuild(repoPath, BUILD_STAMP_PATH);
      ok('Build complete');
    } catch {
      fail('Build failed. Check the output above.');
      console.log(`  ${D}The checkout has moved but is not built — re-run ${C}engram update${X}${D} once the cause is fixed,${X}`);
      console.log(`  ${D}or start over with ${C}engram setup${X}${D}.${X}`);
      process.exit(1);
    }

    // Everything that leaves the machine half-updated lands here. The repo has
    // already moved by this point, so these are not fatal — but an unattended
    // run must be able to tell them from a clean update, which costs the green
    // banner and the zero exit code at the end.
    const degraded: string[] = [];

    step('Updating CLI...');
    const prefix = currentGlobalPrefix();
    try {
      execSync(globalInstallCommand(prefix), { cwd: path.join(repoPath, 'packages', 'cli'), stdio: 'pipe', env: execEnv });
      ok('CLI updated globally');
    } catch (err) {
      reportGlobalInstallFailure(err, prefix, 'update');
      degraded.push('the global engram command was not updated — it still runs the previous version');
    }

    if (opts.restart !== false) {
      const { running, pid } = isServerRunning();
      if (running) {
        step('Restarting server...');
        // Same verified, waited stop the `stop` command uses: the old code sent
        // SIGTERM, unlinked the pidfile and slept a fixed second, so a server
        // still holding the port met its own replacement on the way out — and a
        // stale pidfile got an unrelated process signalled.
        const stopped = await stopRunningServer(pid!, config.host, config.port);
        if (!stopped) {
          // Starting a second server against the same database and port while
          // the first is still alive is worse than not restarting at all.
          degraded.push('the old server did not stop — the new one was not started');
        }

        const serverScript = path.join(repoPath, 'apps', 'server', 'dist', 'index.js');
        const env = {
          ...process.env,
          PORT: String(config.port),
          HOST: config.host,
          ENGRAM_DB_PATH: config.dbPath,
          ENGRAM_INDEX_PATH: config.indexPath,
          ENGRAM_EMBEDDING_MODEL: config.embeddingModel,
          ENGRAM_NAMESPACE_MODE: config.namespaceMode,
          ...(config.namespace ? { ENGRAM_NAMESPACE: config.namespace } : {}),
          ...(config.syncUrl ? { ENGRAM_SYNC_URL: config.syncUrl } : {}),
          ...(config.syncInterval ? { ENGRAM_SYNC_INTERVAL: String(config.syncInterval) } : {}),
          ...(config.syncMode ? { ENGRAM_SYNC_MODE: config.syncMode } : {}),
          ...(config.syncUrl?.includes('sslmode=disable') ? { ENGRAM_SYNC_ALLOW_UNENCRYPTED: 'true' } : {}),
          ...(process.env['ENGRAM_SYNC_ENCRYPTION_KEY'] ? { ENGRAM_SYNC_ENCRYPTION_KEY: process.env['ENGRAM_SYNC_ENCRYPTION_KEY'] } : {}),
        };
        if (stopped) {
          fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
          const logFd = fs.openSync(LOG_PATH, 'a');
          const child = spawn('node', [serverScript], {
            env,
            detached: true,
            stdio: ['ignore', logFd, logFd],
            cwd: repoPath,
          });
          child.unref();
          // Exclusive create, like `engram start`: a concurrent start would
          // otherwise have its pidfile silently overwritten here.
          try {
            fs.writeFileSync(PID_PATH, String(child.pid), { flag: 'wx' });
          } catch {
            warn('Another `engram start` claimed the pidfile — leaving the restarted server unmanaged.');
            if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ } }
            degraded.push('the server was not restarted — another start was already in progress');
          }

          const result = await awaitServerHealthy(child, config.host, config.port, { attempts: 20 });

          if (result.healthy) {
            ok(`Server restarted (PID ${child.pid})`);
          } else {
            releasePidFileIfOwnedBy(child.pid);
            if (!result.exited && child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
            warn(result.exited
              ? `Server exited during restart${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ''}. Check logs:`
              : 'Server may not have restarted cleanly. Check logs:');
            console.log(`  ${D}cat ${LOG_PATH}${X}`);
            degraded.push('the server did not come back up — Engram is not answering');
          }
        }
      } else {
        // Not degraded — a stopped server is a choice, not a failure. It used
        // to produce no output at all, which read as "restarted fine".
        ok('Server was not running — nothing to restart');
        console.log(`  Start it with: ${C}engram start${X}`);
      }
    }

    const newRev = shortHead(repoPath);

    if (degraded.length > 0) {
      console.log(`\n${B}${Y}  Engram only partially updated${X}`);
      console.log(`  The repository moved to ${newRev ?? 'the latest commit'}, but:`);
      for (const problem of degraded) console.log(`    ${Y}!${X} ${problem}`);
      console.log();
      process.exit(1);
    }

    console.log(repositoryMoved
      ? `\n${B}${G}  Engram updated${newRev ? ` to ${newRev}` : ''}${X}\n`
      // Nothing was pulled — this run existed to finish a build that had not
      // completed, and saying "updated" would misdescribe it.
      : `\n${B}${G}  Engram rebuilt${newRev ? ` at ${newRev}` : ''}${X}\n`);
  });

// ─── store ───────────────────────────────────────────────────────────────────

program
  .command('store <content>')
  .description('Store a new memory')
  .option('-t, --type <type>', 'Memory type: episodic, semantic, procedural', 'episodic')
  .option('-i, --importance <n>', 'Importance score 0.0–1.0', parseFloat)
  .option('-s, --source <source>', 'Source identifier', 'cli')
  .option('-c, --concept <concept>', 'Concept label')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-n, --namespace <ns>', 'Memory namespace')
  .action(async (content: string, opts) => {
    const result = await api<{ memory: { id: string; type: string; importance: number; embeddingModel: string }; contradictions: { hasContradictions: boolean; contradictions: Array<{ existingMemoryId: string; confidence: number; suggestedStrategy: string }> } }>('POST', '/api/memory', {
      content, type: opts.type, importance: opts.importance, source: opts.source,
      concept: opts.concept, tags: opts.tags?.split(',').map((t: string) => t.trim()), namespace: opts.namespace,
    });
    console.log(`Stored: ${result.memory.id}`);
    console.log(`  type: ${result.memory.type}  importance: ${result.memory.importance}  model: ${result.memory.embeddingModel}`);
    if (result.contradictions.hasContradictions) {
      console.log(`\n  Contradictions: ${result.contradictions.contradictions.length}`);
      for (const c of result.contradictions.contradictions) {
        console.log(`    vs ${c.existingMemoryId.slice(0, 8)}... (confidence: ${c.confidence}, strategy: ${c.suggestedStrategy})`);
      }
    }
  });

// ─── search ──────────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('Semantic vector search')
  .option('-k, --top <n>', 'Number of results', parseInt, 10)
  .option('--threshold <n>', 'Minimum similarity', parseFloat, 0.3)
  .option('-t, --type <type>', 'Filter by type')
  .option('--json', 'Output as JSON')
  .action(async (query: string, opts) => {
    const result = await api<{ count: number; results: Array<{ id: string; type: string; content: string; importance: number; source: string | null }> }>('POST', '/api/search', {
      query, topK: opts.top, threshold: opts.threshold, types: opts.type ? [opts.type] : undefined,
    });
    if (opts.json) { console.log(JSON.stringify(result.results, null, 2)); return; }
    if (result.count === 0) { console.log('No results.'); return; }
    console.log(`Found ${result.count} result(s):\n`);
    for (const m of result.results) {
      console.log(`  ${m.id.slice(0, 8)}  [${m.type}]  imp=${m.importance?.toFixed?.(2) ?? '?'}  ${m.source ?? ''}`);
      console.log(`    ${m.content.slice(0, 120).replace(/\n/g, ' ')}${m.content.length > 120 ? '...' : ''}\n`);
    }
  });

// ─── recall ──────────────────────────────────────────────────────────────────

program
  .command('recall <query>')
  .description('Assemble working memory context')
  .option('-m, --max-tokens <n>', 'Max tokens', parseInt, 2000)
  .option('--json', 'Output as JSON')
  .option('--raw', 'Output raw context only')
  .action(async (query: string, opts) => {
    const result = await api<{ context: string; memories: Array<{ id: string; type: string; score: number; similarity: number }>; latencyMs: number }>('POST', '/api/recall', {
      query, maxTokens: opts.maxTokens,
    });
    if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
    if (opts.raw) { console.log(result.context); return; }
    console.log(`Recalled ${result.memories.length} memories (${result.latencyMs}ms)\n`);
    for (const m of result.memories) {
      console.log(`  ${m.id.slice(0, 8)}  [${m.type}]  score=${m.score.toFixed(3)}  sim=${m.similarity.toFixed(3)}`);
    }
    console.log(`\n--- Context (${result.context.length} chars) ---\n`);
    console.log(result.context);
  });

// ─── stats ───────────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show memory store statistics')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const stats = await api<{ total: number; byType: Record<string, number>; bySource: Record<string, number>; graphNodes: number; graphEdges: number; indexSize: number; namespace: string | null }>('GET', '/api/stats');
    if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }
    console.log('Engram Brain Statistics');
    console.log('='.repeat(40));
    console.log(`  Total:     ${stats.total}`);
    console.log(`  Episodic:  ${stats.byType.episodic ?? 0}`);
    console.log(`  Semantic:  ${stats.byType.semantic ?? 0}`);
    console.log(`  Procedural:${stats.byType.procedural ?? 0}`);
    console.log(`  Nodes:     ${stats.graphNodes}  Edges: ${stats.graphEdges}`);
    if (stats.namespace) console.log(`  Namespace: ${stats.namespace}`);
    console.log('\nSources:');
    for (const [s, c] of Object.entries(stats.bySource)) console.log(`  ${s}: ${c}`);
  });

// ─── forget ──────────────────────────────────────────────────────────────────

program
  .command('forget <id>')
  .description('Archive a memory')
  .action(async (id: string) => {
    await api('DELETE', `/api/memory/${id}`);
    console.log(`Archived: ${id}`);
  });

// ─── export ──────────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export all memories as JSON')
  .option('-f, --format <fmt>', 'json or ndjson', 'json')
  .action(async (opts) => {
    // The list route caps `limit` at 200 (ajv rejects anything larger with a
    // 400), so page through the whole store instead of asking for it in one go.
    const PAGE_SIZE = 200;
    const memories: unknown[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await api<{ count: number; memories: unknown[] }>(
        'GET',
        `/api/memory?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      memories.push(...page.memories);
      if (page.memories.length < PAGE_SIZE) break;
    }

    if (opts.format === 'ndjson') {
      for (const m of memories) console.log(JSON.stringify({ type: 'memory', data: m }));
    } else {
      console.log(JSON.stringify({ version: EXPORT_FORMAT_VERSION, exportedAt: new Date().toISOString(), count: memories.length, memories }, null, 2));
    }
  });

// ─── import ──────────────────────────────────────────────────────────────────

program
  .command('import')
  .description('Import memories from JSON or NDJSON (stdin). Creates NEW records — ids and timestamps are not preserved, so re-running duplicates.')
  .option('--dry-run', 'Preview only')
  .action(async (opts) => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const input = Buffer.concat(chunks).toString('utf8').trim();
    if (!input) { console.error('No input. Pipe a JSON file: engram import < backup.json'); process.exit(1); }

    // Detect the format by trying to parse the whole document first. The old
    // heuristic (starts with '{' AND contains '\n{') misread a single-line
    // NDJSON file as JSON and imported nothing, and a pretty-printed JSON export
    // as NDJSON.
    let memories: Array<Record<string, unknown>> = [];
    let parseFailures = 0;

    try {
      const doc = JSON.parse(input) as { memories?: Array<Record<string, unknown>> };
      memories = doc.memories ?? [];
    } catch {
      for (const line of input.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as { type?: string; data?: Record<string, unknown> };
          if (entry.type === 'memory' && entry.data) memories.push(entry.data);
        } catch {
          // One malformed line must not abort the whole import.
          parseFailures++;
        }
      }
    }

    if (parseFailures > 0) warn(`${parseFailures} malformed line(s) skipped`);

    console.log(`Found ${memories.length} memories to import`);
    if (memories.length === 0) {
      console.error('Nothing to import — input is neither a JSON export nor NDJSON.');
      process.exit(1);
    }
    if (opts.dryRun) { console.log('Dry run — no changes.'); return; }

    let imported = 0;
    let skipped = 0;
    let firstError: string | undefined;

    for (const m of memories) {
      try {
        await api('POST', '/api/memory', {
          content: m.content, type: m.type ?? 'episodic', source: m.source ?? 'import',
          importance: m.importance, concept: m.concept,
          tags: typeof m.tags === 'string' ? JSON.parse(m.tags as string) : m.tags,
          namespace: m.namespace,
        });
        imported++;
      } catch (err) {
        skipped++;
        const message = err instanceof Error ? err.message : String(err);
        // Capture the reason. Swallowing every error made a stopped server look
        // like 500 bad records ("Imported: 0  Skipped: 500") with no clue why.
        if (!firstError) {
          firstError = message;
          // A connection error on the very first record means the server is not
          // reachable at all — fail fast instead of "skipping" the whole file.
          if (imported === 0 && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
            fail(`Cannot reach the Engram API at ${getApiBase()} — is the server running? (engram start)`);
            process.exit(1);
          }
        }
      }
    }

    console.log(`Imported: ${imported}  Skipped: ${skipped}`);
    if (firstError) {
      fail(`First failure: ${firstError}`);
      process.exit(1);
    }
  });

// ─── Reflection ─────────────────────────────────────────────────────────────

program
  .command('reflections')
  .description('List stored reflection insights')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('-t, --type <type>', 'Filter: pattern, knowledge_gap, trend, contradiction_summary')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', opts.limit);
    if (opts.type) params.set('type', opts.type);
    const res = await api<{ count?: number; reflections?: Array<{ type: string; content: string; importance: number; createdAt: string }> }>('GET', `/api/reflections?${params.toString()}`);
    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(`${res.count ?? 0} reflections\n`);
    for (const r of (res.reflections ?? [])) {
      console.log(`  [${r.type}] ${r.content}`);
      console.log(`    importance: ${r.importance}  created: ${r.createdAt}\n`);
    }
  });

program
  .command('reflect-status')
  .description('Show reflection scheduling state (reflection itself runs on the connected AI)')
  .action(async () => {
    const res = await api<{ enabled: boolean; due: boolean; counter: number; threshold: number }>('GET', '/api/reflection/status');
    console.log(`Enabled:   ${res.enabled ? 'Yes' : 'No'}`);
    console.log(`Due:       ${res.due ? 'Yes — ask the connected AI to run request_reflection' : 'No'}`);
    console.log(`Progress:  ${res.counter}/${res.threshold} stores to next cycle`);
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parseAsync().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
