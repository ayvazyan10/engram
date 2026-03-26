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
import { execSync, spawn } from 'child_process';

// ─── Config & State ──────────────────────────────────────────────────────────

const ENGRAM_HOME = process.env['ENGRAM_HOME'] ?? path.join(os.homedir(), '.engram');
const CONFIG_PATH = path.join(ENGRAM_HOME, 'config.json');
const PID_PATH = path.join(ENGRAM_HOME, 'server.pid');
const LOG_PATH = path.join(ENGRAM_HOME, 'logs', 'server.log');
const REPO = 'https://github.com/ayvazyan10/engram.git';

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
  try {
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    fs.unlinkSync(PID_PATH);
    return { running: false };
  }
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
  .version('0.1.4');

// ─── setup ───────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Initialize Engram — clone, build, configure, and set up MCP for Claude Code')
  .option('--no-mcp', 'Skip Claude Code MCP configuration')
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
        execSync(`git clone --depth=1 ${REPO} "${config.repoPath}"`, { stdio: 'pipe',  });
        ok('Repository cloned');
      } catch (err) {
        fail(`Clone failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    }

    const execOpts = { cwd: config.repoPath, stdio: 'pipe' as const, env: { ...process.env, NODE_NO_WARNINGS: '1' } };

    step('Installing dependencies...');
    try {
      execSync('pnpm install --no-frozen-lockfile', execOpts);
      ok('Dependencies installed');
    } catch (err) {
      fail(`Install failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    step('Building all packages...');
    try {
      execSync('pnpm turbo run build', execOpts);
      ok('Build complete');
    } catch (err) {
      fail(`Build failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    if (opts.mcp !== false) {
      step('Configuring Claude Code MCP integration...');
      const mcpConfigPaths = [
        path.join(os.homedir(), '.claude', 'settings.json'),
        path.join(os.homedir(), '.claude.json'),
      ];
      let mcpPath = mcpConfigPaths.find((p) => fs.existsSync(p));
      if (!mcpPath) {
        fs.mkdirSync(path.join(os.homedir(), '.claude'), { recursive: true });
        mcpPath = mcpConfigPaths[0]!;
      }
      let mcpConfig: Record<string, unknown> = {};
      if (fs.existsSync(mcpPath)) {
        try { mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); } catch {}
      }
      const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
      mcpServers.engram = {
        command: 'node',
        args: [path.join(config.repoPath, 'packages', 'mcp', 'dist', 'server.js')],
        env: { ENGRAM_DB_PATH: config.dbPath },
      };
      mcpConfig.mcpServers = mcpServers;
      fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
      ok(`MCP configured: ${mcpPath}`);
    }

    console.log(`\n${B}${G}  Engram installed successfully!${X}\n`);
    console.log(`  Start the server:     ${D}engram start${X}`);
    console.log(`  Check health:         ${D}engram doctor${X}`);
    console.log(`  Store a memory:       ${D}engram store "hello world"${X}`);
    console.log(`  Open dashboard:       ${C}http://localhost:${config.port}${X}`);
    console.log(`  Swagger docs:         ${C}http://localhost:${config.port}/docs${X}`);
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

    const url = `http://${config.host}:${config.port}/api/health`;
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(url);
        if (res.ok) { healthy = true; break; }
      } catch {}
    }

    if (healthy) {
      ok(`Engram running (PID ${child.pid})`);
      console.log(`  Dashboard: ${C}http://${config.host}:${config.port}${X}`);
      console.log(`  API:       ${C}http://${config.host}:${config.port}/api${X}`);
      console.log(`  Swagger:   ${C}http://${config.host}:${config.port}/docs${X}`);
      console.log(`  Logs:      ${D}${LOG_PATH}${X}`);
    } else {
      fail('Server did not start. Check logs:');
      console.log(`  ${D}cat ${LOG_PATH}${X}`);
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

    const mcpPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const mc = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        if (mc.mcpServers?.engram) { ok('Claude Code MCP: configured'); }
        else { warn('Claude Code MCP: not configured — run: engram setup'); }
      } catch { warn('Claude Code settings: parse error'); }
    } else { warn('Claude Code: settings.json not found'); }

    console.log();
    console.log(issues === 0 ? `${G}  All checks passed.${X}\n` : `${Y}  ${issues} issue(s) found.${X}\n`);
  });

// ─── status ──────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show Engram server status and memory summary')
  .action(async () => {
    const config = loadConfig();
    const { running, pid } = isServerRunning();
    console.log(`\n${B}  Engram Status${X}\n`);

    if (!running) {
      console.log(`  Server:  ${R}stopped${X}`);
      console.log(`  Start:   ${D}engram start${X}\n`);
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
configCmd.command('show').description('Show current config').action(() => console.log(JSON.stringify(loadConfig(), null, 2)));
configCmd.command('set <key> <value>').description('Set a config value').action((key: string, value: string) => {
  const config = loadConfig();
  if (!(key in config)) { fail(`Unknown key: ${key}\n  Valid: ${Object.keys(config).join(', ')}`); process.exit(1); }
  (config as unknown as Record<string, unknown>)[key] = key === 'port' ? parseInt(value, 10) : value === 'null' ? null : value;
  saveConfig(config);
  ok(`${key} = ${(config as unknown as Record<string, unknown>)[key]}`);
});
configCmd.command('path').description('Print config file path').action(() => console.log(CONFIG_PATH));
configCmd.action(() => console.log(JSON.stringify(loadConfig(), null, 2)));

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
    const result = await api<{ count: number; memories: unknown[] }>('GET', '/api/memory?limit=100000');
    if (opts.format === 'ndjson') {
      for (const m of result.memories) console.log(JSON.stringify({ type: 'memory', data: m }));
    } else {
      console.log(JSON.stringify({ version: '0.1.0', exportedAt: new Date().toISOString(), count: result.count, memories: result.memories }, null, 2));
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

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parseAsync().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
