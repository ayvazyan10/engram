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
import { pidAlive, isPortOpen, awaitServerHealthy, verifyServer } from './serverControl.js';

// ─── Config & State ──────────────────────────────────────────────────────────

const ENGRAM_HOME = process.env['ENGRAM_HOME'] ?? path.join(os.homedir(), '.engram');
const CONFIG_PATH = path.join(ENGRAM_HOME, 'config.json');
const PID_PATH = path.join(ENGRAM_HOME, 'server.pid');
const LOG_PATH = path.join(ENGRAM_HOME, 'logs', 'server.log');
const REPO = 'https://github.com/ayvazyan10/engram.git';
/** Schema version of the `engram export` payload (independent of the package version). */
const EXPORT_FORMAT_VERSION = '0.1.0';

interface EngramConfig {
  dbPath: string;
  port: number;
  host: string;
  namespace: string | null;
  embeddingModel: string;
  indexPath: string;
  repoPath: string;
}

const DEFAULT_CONFIG: EngramConfig = {
  dbPath: path.join(ENGRAM_HOME, 'engram.db'),
  port: 4901,
  host: '127.0.0.1',
  namespace: null,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  indexPath: path.join(ENGRAM_HOME, 'engram.db.index'),
  repoPath: path.join(ENGRAM_HOME, 'repo'),
};

function loadConfig(): EngramConfig {
  if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: EngramConfig): void {
  fs.mkdirSync(ENGRAM_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function getApiBase(): string {
  const config = loadConfig();
  return `http://${config.host}:${config.port}`;
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

// ─── Colors ──────────────────────────────────────────────────────────────────

const B = '\x1b[1m';
const D = '\x1b[2m';
const G = '\x1b[32m';
const C = '\x1b[36m';
const R = '\x1b[31m';
const Y = '\x1b[33m';
const X = '\x1b[0m';
const ok = (msg: string) => console.log(`${G}  ✓${X} ${msg}`);
const fail = (msg: string) => console.log(`${R}  ✗${X} ${msg}`);
const step = (msg: string) => console.log(`${C}  →${X} ${msg}`);
const warn = (msg: string) => console.log(`${Y}  !${X} ${msg}`);

// ─── Program ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('engram')
  .description('Engram CLI — Universal AI Brain')
  .version('0.3.0');

// ─── setup ───────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Initialize Engram — clone, build, configure, and set up MCP for any AI client')
  .option('--no-mcp', 'Skip MCP configuration')
  .option('--npx', 'Use npx instead of cloning repo (fastest setup)')
  .option('--source <name>', 'AI client identifier (e.g. claude-code, cursor, windsurf)', 'mcp-client')
  .option('--non-interactive', 'Run without prompts')
  .action(async (opts) => {
    console.log(`\n${B}  ⬡  Engram Setup${X}\n`);

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
        try {
          execSync('git pull --ff-only', { cwd: config.repoPath, stdio: 'pipe',  });
          ok('Repository updated');
        } catch {
          warn('Pull failed — continuing with existing version');
        }
      } else {
        try {
          // spawnSync with an argv array — never build a shell string from
          // config.repoPath. Double quotes do not neutralise $(), backticks or
          // embedded quotes, and repoPath is user-controlled via
          // `configure set repoPath` / ENGRAM_HOME.
          const clone = spawnSync('git', ['clone', '--depth=1', REPO, config.repoPath], {
            stdio: 'pipe',
          });
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
        fail('Install failed. Check the output above for details.');
        process.exit(1);
      }

      step('Building all packages...');
      try {
        execSync('pnpm turbo run build', { cwd: config.repoPath, stdio: 'inherit', env: execEnv });
        ok('Build complete');
      } catch {
        fail('Build failed. Check the output above for details.');
        process.exit(1);
      }

      step('Installing CLI globally...');
      try {
        execSync('npm install -g .', { cwd: path.join(config.repoPath, 'packages', 'cli'), stdio: 'pipe', env: execEnv });
        ok('CLI linked from repo build');
      } catch {
        warn('Could not install CLI globally. Try: npm install -g @engram-ai-memory/cli@latest');
      }
    } else {
      ok('Using npx mode — skipping clone/build');
    }

    if (opts.mcp !== false) {
      step('Configuring MCP integration...');
      const mcpPath = path.join(os.homedir(), '.mcp.json');
      let mcpConfig: Record<string, unknown> = {};
      if (fs.existsSync(mcpPath)) {
        try { mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); } catch {}
      }
      const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;

      const engramEnv: Record<string, string> = {
        ENGRAM_DB_PATH: config.dbPath,
        ENGRAM_SOURCE: opts.source,
      };

      if (opts.npx) {
        mcpServers.engram = {
          command: 'npx',
          args: ['-y', '@engram-ai-memory/mcp@latest'],
          env: engramEnv,
        };
      } else {
        mcpServers.engram = {
          command: 'node',
          args: [path.join(config.repoPath, 'packages', 'mcp', 'dist', 'server.js')],
          env: engramEnv,
        };
      }

      mcpConfig.mcpServers = mcpServers;
      fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
      ok(`MCP configured: ${mcpPath}`);
    }

    console.log(`\n${B}${G}  Engram installed successfully!${X}\n`);
    if (opts.npx) {
      console.log(`  Restart your AI client to activate Engram.`);
      console.log(`  MCP config:           ${D}~/.mcp.json${X}`);
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
      ...(config.namespace ? { ENGRAM_NAMESPACE: config.namespace } : {}),
    };

    if (opts.foreground) {
      step(`Starting Engram (foreground) on :${config.port}...`);
      const child = spawn('node', [serverScript], { env, stdio: 'inherit', cwd: config.repoPath });
      child.on('exit', (code) => process.exit(code ?? 0));
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
    fs.writeFileSync(PID_PATH, String(child.pid));

    const result = await awaitServerHealthy(child, config.host, config.port);

    if (result.healthy) {
      ok(`Engram running (PID ${child.pid})`);
      console.log(`  Dashboard: ${C}http://${config.host}:${config.port}${X}`);
      console.log(`  API:       ${C}http://${config.host}:${config.port}/api${X}`);
      console.log(`  Swagger:   ${C}http://${config.host}:${config.port}/docs${X}`);
      console.log(`  Logs:      ${D}${LOG_PATH}${X}`);
    } else {
      // The process we spawned never served a healthy response — don't leave a
      // misleading pidfile, and don't orphan a half-started process.
      try { fs.unlinkSync(PID_PATH); } catch {}
      if (!result.exited && child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
      fail(result.exited
        ? `Server exited during startup${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ''} — the port may already be in use. Check logs:`
        : `Server did not become healthy on :${config.port}. Check logs:`);
      console.log(`  ${D}cat ${LOG_PATH}${X}`);
      process.exit(1);
    }
  });

// ─── stop ────────────────────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop the running Engram server')
  .action(() => {
    const { running, pid } = isServerRunning();
    if (!running) { warn('Server is not running.'); return; }
    try {
      process.kill(pid!, 'SIGTERM');
      fs.unlinkSync(PID_PATH);
      ok(`Server stopped (PID ${pid})`);
    } catch (err) {
      fail(`Failed to stop: ${err instanceof Error ? err.message : err}`);
    }
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
    const serverScript = path.join(config.repoPath, 'apps', 'server', 'dist', 'index.js');
    if (fs.existsSync(serverScript)) { ok(`Server built: ${config.repoPath}`); }
    else { fail('Server not built — run: engram setup'); issues++; }

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

    const globalMcpPath = path.join(os.homedir(), '.mcp.json');
    const legacyMcpPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(globalMcpPath)) {
      try {
        const mc = JSON.parse(fs.readFileSync(globalMcpPath, 'utf8'));
        if (mc.mcpServers?.engram) { ok('MCP: configured in ~/.mcp.json'); }
        else { warn('MCP: ~/.mcp.json exists but engram not configured — run: engram setup'); }
      } catch { warn('MCP: ~/.mcp.json parse error'); }
    } else { warn('MCP: ~/.mcp.json not found — run: engram setup'); }
    if (fs.existsSync(legacyMcpPath)) {
      try {
        const mc = JSON.parse(fs.readFileSync(legacyMcpPath, 'utf8'));
        if (mc.mcpServers?.engram) { warn('Legacy: engram found in ~/.claude/settings.json — migrate to ~/.mcp.json'); }
      } catch {}
    }

    console.log();
    console.log(issues === 0 ? `${G}  All checks passed.${X}\n` : `${Y}  ${issues} issue(s) found.${X}\n`);
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
  if (!(key in config)) { fail(`Unknown key: ${key}\n  Valid: ${Object.keys(config).join(', ')}`); process.exit(1); }
  const parsed = key === 'port' ? parseInt(value, 10) : value === 'null' ? null : value;
  (config as unknown as Record<string, unknown>)[key] = parsed;
  saveConfig(config);
  ok(`${key} = ${parsed}`);
});
configCmd.command('path').description('Print config file path').action(() => console.log(CONFIG_PATH));
configCmd.action(() => {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
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
  .action(async (opts) => {
    console.log(`\n${B}  ⬡  Engram Update${X}\n`);

    const config = loadConfig();
    const repoPath = config.repoPath;

    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      fail(`Repository not found at ${repoPath}`);
      console.log(`  Run ${C}engram setup${X} first.`);
      process.exit(1);
    }

    step('Checking for updates...');
    try {
      execSync('git fetch --quiet', { cwd: repoPath, stdio: 'pipe' });
    } catch {
      fail('Could not reach remote repository. Check your connection.');
      process.exit(1);
    }

    const local = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    const remote = execSync('git rev-parse @{u}', { cwd: repoPath, encoding: 'utf8' }).trim();

    if (local === remote) {
      ok('Already up to date.');
      console.log();
      return;
    }

    const behind = execSync('git rev-list --count HEAD..@{u}', { cwd: repoPath, encoding: 'utf8' }).trim();
    step(`${behind} new commit(s) available`);

    step('Pulling latest changes...');
    try {
      execSync('git pull --ff-only', { cwd: repoPath, stdio: 'pipe' });
      ok('Repository updated');
    } catch {
      fail('Pull failed — you may have local modifications.');
      console.log(`  Try: ${D}cd ${repoPath} && git stash && engram update${X}`);
      process.exit(1);
    }

    const execEnv = { ...process.env, NODE_NO_WARNINGS: '1' };

    step('Installing dependencies...');
    try {
      execSync('pnpm install --no-frozen-lockfile', { cwd: repoPath, stdio: 'inherit', env: execEnv });
      ok('Dependencies installed');
    } catch {
      fail('Install failed. Check the output above.');
      process.exit(1);
    }

    step('Rebuilding all packages...');
    try {
      execSync('pnpm turbo run build', { cwd: repoPath, stdio: 'inherit', env: execEnv });
      ok('Build complete');
    } catch {
      fail('Build failed. Check the output above.');
      process.exit(1);
    }

    step('Updating CLI...');
    try {
      execSync('npm install -g .', { cwd: path.join(repoPath, 'packages', 'cli'), stdio: 'pipe', env: execEnv });
      ok('CLI updated globally');
    } catch {
      warn('Could not update CLI globally. Try: npm install -g @engram-ai-memory/cli@latest');
    }

    if (opts.restart !== false) {
      const { running, pid } = isServerRunning();
      if (running) {
        step('Restarting server...');
        try {
          process.kill(pid!, 'SIGTERM');
          fs.unlinkSync(PID_PATH);
        } catch {}

        await new Promise((r) => setTimeout(r, 1000));

        const serverScript = path.join(repoPath, 'apps', 'server', 'dist', 'index.js');
        const env = {
          ...process.env,
          PORT: String(config.port),
          HOST: config.host,
          ENGRAM_DB_PATH: config.dbPath,
          ENGRAM_INDEX_PATH: config.indexPath,
          ENGRAM_EMBEDDING_MODEL: config.embeddingModel,
          ...(config.namespace ? { ENGRAM_NAMESPACE: config.namespace } : {}),
        };
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        const logFd = fs.openSync(LOG_PATH, 'a');
        const child = spawn('node', [serverScript], {
          env,
          detached: true,
          stdio: ['ignore', logFd, logFd],
          cwd: repoPath,
        });
        child.unref();
        fs.writeFileSync(PID_PATH, String(child.pid));

        const result = await awaitServerHealthy(child, config.host, config.port, { attempts: 20 });

        if (result.healthy) {
          ok(`Server restarted (PID ${child.pid})`);
        } else {
          try { fs.unlinkSync(PID_PATH); } catch {}
          if (!result.exited && child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
          warn(result.exited
            ? `Server exited during restart${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ''}. Check logs:`
            : 'Server may not have restarted cleanly. Check logs:');
          console.log(`  ${D}cat ${LOG_PATH}${X}`);
        }
      }
    }

    const newRev = execSync('git rev-parse --short HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    console.log(`\n${B}${G}  Engram updated to ${newRev}${X}\n`);
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
  .description('Import memories from JSON (stdin)')
  .option('--dry-run', 'Preview only')
  .action(async (opts) => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const input = Buffer.concat(chunks).toString('utf8').trim();
    if (!input) { console.error('No input. Pipe a JSON file: engram import < backup.json'); process.exit(1); }

    let memories: Array<Record<string, unknown>> = [];
    if (input.startsWith('{') && input.includes('\n{')) {
      for (const line of input.split('\n')) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        if (e.type === 'memory') memories.push(e.data);
      }
    } else {
      memories = JSON.parse(input).memories ?? [];
    }

    console.log(`Found ${memories.length} memories to import`);
    if (opts.dryRun) { console.log('Dry run — no changes.'); return; }

    let imported = 0, skipped = 0;
    for (const m of memories) {
      try {
        await api('POST', '/api/memory', {
          content: m.content, type: m.type ?? 'episodic', source: m.source ?? 'import',
          importance: m.importance, concept: m.concept,
          tags: typeof m.tags === 'string' ? JSON.parse(m.tags as string) : m.tags,
          namespace: m.namespace,
        });
        imported++;
      } catch { skipped++; }
    }
    console.log(`Imported: ${imported}  Skipped: ${skipped}`);
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
