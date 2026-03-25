#!/usr/bin/env node

/**
 * @engram-ai-memory/cli — Engram command-line interface.
 *
 * Usage:
 *   engram store "User prefers TypeScript" --type semantic --importance 0.8
 *   engram search "TypeScript" --top 5
 *   engram recall "what languages does the user prefer?"
 *   engram stats
 *   engram forget <id>
 *   engram export > backup.json
 *   engram import < backup.json
 */

import { Command } from 'commander';
import { NeuralBrain, closeDb } from '@engram-ai-memory/core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn } from 'child_process';

const DEFAULT_DB_PATH = process.env['ENGRAM_DB_PATH'] ?? path.join(process.cwd(), 'engram.db');

function createBrain(): NeuralBrain {
  return new NeuralBrain({
    dbPath: DEFAULT_DB_PATH,
    defaultSource: 'cli',
    indexPath: process.env['ENGRAM_INDEX_PATH'] ?? DEFAULT_DB_PATH + '.index',
  });
}

async function withBrain<T>(fn: (brain: NeuralBrain) => Promise<T>): Promise<T> {
  const brain = createBrain();
  await brain.initialize();
  try {
    return await fn(brain);
  } finally {
    brain.shutdown();
  }
}

const program = new Command();

program
  .name('engram')
  .description('Engram CLI — store, search, recall, and manage AI memories')
  .version('0.1.0');

// ─── store ───────────────────────────────────────────────────────────────────

program
  .command('store <content>')
  .description('Store a new memory')
  .option('-t, --type <type>', 'Memory type: episodic, semantic, procedural', 'episodic')
  .option('-i, --importance <n>', 'Importance score 0.0–1.0', parseFloat)
  .option('-s, --source <source>', 'Source identifier', 'cli')
  .option('-c, --concept <concept>', 'Concept label (for semantic memories)')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-n, --namespace <ns>', 'Memory namespace')
  .action(async (content: string, opts) => {
    await withBrain(async (brain) => {
      const { memory, contradictions } = await brain.store({
        content,
        type: opts.type,
        importance: opts.importance,
        source: opts.source,
        concept: opts.concept,
        tags: opts.tags?.split(',').map((t: string) => t.trim()),
        namespace: opts.namespace,
      });

      console.log(`Stored: ${memory.id}`);
      console.log(`  type: ${memory.type}  importance: ${memory.importance}  model: ${memory.embeddingModel}`);

      if (contradictions.hasContradictions) {
        console.log(`\n  Contradictions detected: ${contradictions.contradictions.length}`);
        for (const c of contradictions.contradictions) {
          console.log(`    vs ${c.existingMemoryId.slice(0, 8)}... (confidence: ${c.confidence}, strategy: ${c.suggestedStrategy})`);
        }
      }
    });
  });

// ─── search ──────────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('Semantic vector search across memories')
  .option('-k, --top <n>', 'Number of results', parseInt, 10)
  .option('--threshold <n>', 'Minimum similarity 0.0–1.0', parseFloat, 0.3)
  .option('-t, --type <type>', 'Filter by memory type')
  .option('--json', 'Output as JSON')
  .action(async (query: string, opts) => {
    await withBrain(async (brain) => {
      const types = opts.type ? [opts.type] : undefined;
      const results = await brain.search(query, {
        topK: opts.top,
        threshold: opts.threshold,
        types,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log('No results found.');
        return;
      }

      console.log(`Found ${results.length} result(s):\n`);
      for (const m of results) {
        const preview = m.content.slice(0, 120).replace(/\n/g, ' ');
        console.log(`  ${m.id.slice(0, 8)}  [${m.type}]  imp=${m.importance.toFixed(2)}  ${m.source ?? ''}`);
        console.log(`    ${preview}${m.content.length > 120 ? '...' : ''}`);
        console.log();
      }
    });
  });

// ─── recall ──────────────────────────────────────────────────────────────────

program
  .command('recall <query>')
  .description('Assemble working memory context for a query')
  .option('-m, --max-tokens <n>', 'Maximum context tokens', parseInt, 2000)
  .option('-t, --type <type>', 'Filter by memory type')
  .option('--json', 'Output as JSON')
  .option('--raw', 'Output raw context string only (for piping)')
  .action(async (query: string, opts) => {
    await withBrain(async (brain) => {
      const types = opts.type ? [opts.type] : undefined;
      const result = await brain.recall(query, {
        maxTokens: opts.maxTokens,
        types,
        source: 'cli',
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (opts.raw) {
        console.log(result.context);
        return;
      }

      console.log(`Recalled ${result.memories.length} memories (${result.latencyMs}ms)\n`);
      for (const m of result.memories) {
        console.log(`  ${m.id.slice(0, 8)}  [${m.type}]  score=${m.score.toFixed(3)}  sim=${m.similarity.toFixed(3)}`);
      }
      console.log(`\n--- Context (${result.context.length} chars) ---\n`);
      console.log(result.context);
    });
  });

// ─── stats ───────────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show memory store statistics')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withBrain(async (brain) => {
      const stats = await brain.stats();
      const embStatus = await brain.embeddingStatus();
      const idxStatus = brain.getIndexStatus();

      if (opts.json) {
        console.log(JSON.stringify({ ...stats, embedding: embStatus, index: idxStatus }, null, 2));
        return;
      }

      console.log('Engram Brain Statistics');
      console.log('='.repeat(40));
      console.log(`  Total memories:  ${stats.total}`);
      console.log(`  Episodic:        ${stats.byType.episodic}`);
      console.log(`  Semantic:        ${stats.byType.semantic}`);
      console.log(`  Procedural:      ${stats.byType.procedural}`);
      console.log(`  Graph nodes:     ${stats.graphNodes}`);
      console.log(`  Graph edges:     ${stats.graphEdges}`);
      console.log(`  Index entries:   ${stats.indexSize}`);
      if (stats.namespace) console.log(`  Namespace:       ${stats.namespace}`);

      console.log();
      console.log('Sources:');
      for (const [src, count] of Object.entries(stats.bySource)) {
        console.log(`  ${src}: ${count}`);
      }

      console.log();
      console.log('Embedding:');
      console.log(`  Model:    ${embStatus.currentModel}`);
      console.log(`  Dim:      ${embStatus.currentDimension}`);
      console.log(`  Current:  ${embStatus.currentModelCount}  Stale: ${embStatus.staleCount}  Legacy: ${embStatus.legacyCount}`);

      console.log();
      console.log('Index:');
      console.log(`  Loaded from: ${idxStatus.loadedFrom}`);
      console.log(`  Init time:   ${idxStatus.initDurationMs}ms`);
      if (idxStatus.indexPath) console.log(`  Path:        ${idxStatus.indexPath}`);
    });
  });

// ─── forget ──────────────────────────────────────────────────────────────────

program
  .command('forget <id>')
  .description('Archive (soft-delete) a memory by ID')
  .action(async (id: string) => {
    await withBrain(async (brain) => {
      await brain.forget(id);
      console.log(`Archived: ${id}`);
    });
  });

// ─── export ──────────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export all memories as JSON (pipe to file: engram export > backup.json)')
  .option('-f, --format <fmt>', 'Output format: json or ndjson', 'json')
  .option('-t, --type <type>', 'Filter by memory type')
  .action(async (opts) => {
    await withBrain(async (brain) => {
      // Use search with very low threshold to get all memories
      // Export searches all types or a specific type
      const types = opts.type ? [opts.type] : undefined;
      const allMemories = await brain.search('', { topK: 100000, threshold: 0, types });

      if (opts.format === 'ndjson') {
        for (const m of allMemories) {
          console.log(JSON.stringify({ type: 'memory', data: stripBlobs(m as unknown as Record<string, unknown>) }));
        }
      } else {
        console.log(JSON.stringify({
          version: '0.1.0',
          exportedAt: new Date().toISOString(),
          count: allMemories.length,
          memories: allMemories.map((m) => stripBlobs(m as unknown as Record<string, unknown>)),
        }, null, 2));
      }
    });
  });

// ─── import ──────────────────────────────────────────────────────────────────

program
  .command('import')
  .description('Import memories from JSON (pipe from file: engram import < backup.json)')
  .option('--dry-run', 'Preview what would be imported without writing')
  .action(async (opts) => {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input = Buffer.concat(chunks).toString('utf8').trim();

    if (!input) {
      console.error('No input. Pipe a JSON file: engram import < backup.json');
      process.exit(1);
    }

    await withBrain(async (brain) => {
      let memories: Array<Record<string, unknown>> = [];

      // Detect NDJSON vs JSON
      if (input.startsWith('{') && input.includes('\n{')) {
        // NDJSON
        for (const line of input.split('\n')) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line);
          if (entry.type === 'memory') memories.push(entry.data);
        }
      } else {
        const data = JSON.parse(input);
        memories = data.memories ?? [];
      }

      console.log(`Found ${memories.length} memories to import`);

      if (opts.dryRun) {
        console.log('Dry run — no changes made.');
        return;
      }

      let imported = 0;
      let skipped = 0;

      for (const m of memories) {
        try {
          await brain.store({
            content: m.content as string,
            type: (m.type as 'episodic' | 'semantic' | 'procedural') ?? 'episodic',
            source: (m.source as string) ?? 'import',
            importance: m.importance as number | undefined,
            concept: m.concept as string | undefined,
            tags: typeof m.tags === 'string' ? JSON.parse(m.tags as string) : m.tags as string[] | undefined,
            namespace: m.namespace as string | undefined,
          });
          imported++;
        } catch {
          skipped++;
        }
      }

      console.log(`Imported: ${imported}  Skipped: ${skipped}`);
    });
  });

// ─── State directory & config ─────────────────────────────────────────────────

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

function isServerRunning(): { running: boolean; pid?: number } {
  if (!fs.existsSync(PID_PATH)) return { running: false };
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
  try {
    process.kill(pid, 0); // test if process exists
    return { running: true, pid };
  } catch {
    fs.unlinkSync(PID_PATH); // stale pid file
    return { running: false };
  }
}

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

// ─── setup ───────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Initialize Engram — clone, build, configure, and set up MCP for Claude Code')
  .option('--no-mcp', 'Skip Claude Code MCP configuration')
  .option('--non-interactive', 'Run without prompts')
  .action(async (opts) => {
    console.log(`\n${B}  ⬡  Engram Setup${X}\n`);

    // 1. Create state directory
    step('Creating ~/.engram/ directory...');
    fs.mkdirSync(path.join(ENGRAM_HOME, 'logs'), { recursive: true });
    ok(`State directory: ${ENGRAM_HOME}`);

    // 2. Write default config
    const config = loadConfig();
    if (!fs.existsSync(CONFIG_PATH)) {
      saveConfig(config);
      ok('Config created: ~/.engram/config.json');
    } else {
      ok('Config exists: ~/.engram/config.json');
    }

    // 3. Clone or update repo
    step(`Cloning Engram into ${config.repoPath}...`);
    if (fs.existsSync(path.join(config.repoPath, '.git'))) {
      step('Repository exists — pulling latest...');
      try {
        execSync('git pull --ff-only', { cwd: config.repoPath, stdio: 'pipe' });
        ok('Repository updated');
      } catch {
        warn('Pull failed — continuing with existing version');
      }
    } else {
      try {
        execSync(`git clone --depth=1 ${REPO} "${config.repoPath}"`, { stdio: 'pipe' });
        ok('Repository cloned');
      } catch (err) {
        fail(`Clone failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    }

    // 4. Install dependencies
    step('Installing dependencies...');
    try {
      execSync('pnpm install --frozen-lockfile', { cwd: config.repoPath, stdio: 'pipe' });
      ok('Dependencies installed');
    } catch {
      step('Retrying without --frozen-lockfile...');
      execSync('pnpm install', { cwd: config.repoPath, stdio: 'pipe' });
      ok('Dependencies installed');
    }

    // 5. Build
    step('Building all packages...');
    execSync('pnpm turbo run build', { cwd: config.repoPath, stdio: 'pipe' });
    ok('Build complete');

    // 6. MCP setup
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

    // 7. Done
    console.log(`\n${B}${G}  Engram installed successfully!${X}\n`);
    console.log(`  Start the server:     ${D}engram start${X}`);
    console.log(`  Check health:         ${D}engram doctor${X}`);
    console.log(`  Store a memory:       ${D}engram store "hello world"${X}`);
    console.log(`  Open dashboard:       ${D}http://localhost:${config.port}${X}`);
    console.log(`  Swagger docs:         ${D}http://localhost:${config.port}/docs${X}`);
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
      const child = spawn('node', [serverScript], { env, stdio: 'inherit' });
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
    });
    child.unref();

    fs.writeFileSync(PID_PATH, String(child.pid));

    // Wait for health check
    const url = `http://${config.host}:${config.port}/api/health`;
    let healthy = false;
    for (let i = 0; i < 20; i++) {
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
    if (!running) {
      warn('Server is not running.');
      return;
    }
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

    // Node.js
    const nodeVer = process.versions.node;
    const nodeMajor = parseInt(nodeVer.split('.')[0]!, 10);
    if (nodeMajor >= 22) {
      ok(`Node.js ${nodeVer}`);
    } else {
      fail(`Node.js ${nodeVer} — requires 22+`);
      issues++;
    }

    // pnpm
    try {
      const pnpmVer = execSync('pnpm --version', { encoding: 'utf8' }).trim();
      ok(`pnpm ${pnpmVer}`);
    } catch {
      fail('pnpm not found');
      issues++;
    }

    // Config
    if (fs.existsSync(CONFIG_PATH)) {
      ok(`Config: ${CONFIG_PATH}`);
    } else {
      fail('Config not found — run: engram setup');
      issues++;
    }

    // Repo
    const config = loadConfig();
    const serverScript = path.join(config.repoPath, 'apps', 'server', 'dist', 'index.js');
    if (fs.existsSync(serverScript)) {
      ok(`Server built: ${config.repoPath}`);
    } else {
      fail('Server not built — run: engram setup');
      issues++;
    }

    // Database
    if (fs.existsSync(config.dbPath)) {
      const size = fs.statSync(config.dbPath).size;
      ok(`Database: ${config.dbPath} (${(size / 1024).toFixed(0)} KB)`);
    } else {
      warn(`Database not created yet (will auto-create on first start)`);
    }

    // Server running?
    const { running, pid } = isServerRunning();
    if (running) {
      ok(`Server running (PID ${pid})`);
      try {
        const res = await fetch(`http://${config.host}:${config.port}/api/health`);
        const data = await res.json() as { status: string; uptime: number };
        ok(`API healthy: ${data.status} (uptime: ${Math.round(data.uptime)}s)`);
      } catch {
        fail(`Server running but API not responding on :${config.port}`);
        issues++;
      }
    } else {
      warn('Server not running — start with: engram start');
    }

    // MCP
    const mcpPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        if (mcpConfig.mcpServers?.engram) {
          ok('Claude Code MCP: configured');
        } else {
          warn('Claude Code MCP: not configured — run: engram setup');
        }
      } catch {
        warn('Claude Code settings: parse error');
      }
    } else {
      warn('Claude Code: settings.json not found');
    }

    console.log();
    if (issues === 0) {
      console.log(`${G}  All checks passed.${X}\n`);
    } else {
      console.log(`${Y}  ${issues} issue(s) found.${X}\n`);
    }
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
      console.log(`  Start:   ${D}engram start${X}`);
      console.log();
      return;
    }

    console.log(`  Server:  ${G}running${X} (PID ${pid})`);
    console.log(`  URL:     http://${config.host}:${config.port}`);

    try {
      const healthRes = await fetch(`http://${config.host}:${config.port}/api/health`);
      const health = await healthRes.json() as { uptime: number };
      console.log(`  Uptime:  ${Math.round(health.uptime)}s`);

      const statsRes = await fetch(`http://${config.host}:${config.port}/api/stats`);
      const stats = await statsRes.json() as { total: number; byType: Record<string, number> };
      console.log(`  Memories: ${stats.total} (E:${stats.byType.episodic ?? 0} S:${stats.byType.semantic ?? 0} P:${stats.byType.procedural ?? 0})`);
    } catch {
      warn('Could not reach API');
    }

    if (fs.existsSync(config.dbPath)) {
      const size = fs.statSync(config.dbPath).size;
      console.log(`  DB:      ${config.dbPath} (${(size / 1024).toFixed(0)} KB)`);
    }

    console.log();
  });

// ─── configure ───────────────────────────────────────────────────────────────

const configCmd = program
  .command('configure')
  .description('View or update Engram configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (port, host, dbPath, namespace, embeddingModel)')
  .action((key: string, value: string) => {
    const config = loadConfig();
    if (!(key in config)) {
      fail(`Unknown key: ${key}`);
      console.log(`  Valid keys: ${Object.keys(config).join(', ')}`);
      process.exit(1);
    }
    const parsed = key === 'port' ? parseInt(value, 10)
      : value === 'null' ? null
      : value;
    (config as unknown as Record<string, unknown>)[key] = parsed;
    saveConfig(config);
    ok(`${key} = ${parsed}`);
  });

configCmd
  .command('path')
  .description('Print the config file path')
  .action(() => {
    console.log(CONFIG_PATH);
  });

// Default: show config if no subcommand
configCmd.action(() => {
  const config = loadConfig();
  console.log(JSON.stringify(config, null, 2));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip binary blob fields for JSON export. */
function stripBlobs(m: Record<string, unknown>): Record<string, unknown> {
  const { embedding, ...rest } = m;
  return rest;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parseAsync().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
