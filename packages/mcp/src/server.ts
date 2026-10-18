#!/usr/bin/env node
/**
 * Engram MCP Server
 *
 * Exposes Engram brain capabilities as MCP tools for any AI client
 * (Claude Code, Cursor, Windsurf, Cline, and any MCP-compatible client).
 *
 * Run: node dist/server.js
 * Or register it with a client — `~/.claude.json` for Claude Code at user
 * scope, `.mcp.json` in a project root for project scope, `~/.cursor/mcp.json`,
 * `~/.codeium/windsurf/mcp_config.json`. NOT `~/.mcp.json`: nothing reads it.
 * `engram setup --source <client>` writes the right one.
 *   { "mcpServers": { "engram": { "command": "npx", "args": ["-y", "@engram-ai-memory/mcp@latest"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NeuralBrain, SyncEngine, redactSyncUrl } from '@engram-ai-memory/core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerTools } from './tools.js';
import { resolveNamespaceSettings } from './namespaceEnv.js';
import { readSyncSettings, syncEngineConfig } from './syncSettings.js';

// Report the real release version instead of hardcoding it. This package has no
// "type":"module", so tsc emits CommonJS here and __dirname is available;
// ../package.json resolves from both src/ and dist/.
const VERSION: string = (
  JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')) as { version: string }
).version;

const defaultSource = process.env['ENGRAM_SOURCE'] || 'mcp-client';
// Shared with the `engram-store-session` entrypoint (store-session.ts): both
// write into the same database and must agree on which namespace that is.
const { namespaceMode, namespace } = resolveNamespaceSettings(process.env);

/**
 * Where memories go when the host gave us no path.
 *
 * Same trap as ENGRAM_NAMESPACE_MODE above, with a far worse ending: hosts
 * that template an unset optional config field pass an EMPTY STRING rather
 * than omitting the variable, and better-sqlite3 reads '' as an ANONYMOUS
 * TEMPORARY DATABASE that is deleted when the connection closes. The Claude
 * Desktop extension's `db_path` defaults to "" and tells the user to leave it
 * empty, so every install that followed the instructions reported memories as
 * stored and threw all of them away on exit, with no .db file anywhere.
 *
 * The default is the one the manifest advertises (~/.engram/engram.db), not
 * `process.cwd()/engram.db`: under Claude Desktop the cwd belongs to the app,
 * so a database there is one nobody chose and nobody can find.
 *
 * A configured path is used as given, except that a leading `~/` is expanded:
 * a JSON client config has no shell to do it, and a literal `~` directory
 * would be created under whatever cwd the client launched us in.
 */
export function resolveDbPath(raw: string | undefined, home: string = os.homedir()): string {
  if (!raw || raw.trim().length === 0) return path.join(home, '.engram', 'engram.db');
  if (raw === '~') return home;
  if (raw.startsWith('~/')) return path.join(home, raw.slice(2));
  return raw;
}

/**
 * Create the directory the database file lives in. better-sqlite3 does not,
 * and a missing parent surfaces as a bare SQLITE_CANTOPEN that names neither
 * the path nor the cause.
 */
function ensureDbDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot create the Engram database directory ${dir}: ${reason}`);
  }
}

const dbPath = resolveDbPath(process.env['ENGRAM_DB_PATH']);
ensureDbDirectory(dbPath);
// Write the resolved path back: getDeviceId(), the sync engine and any later
// getDatabase() call read ENGRAM_DB_PATH from the environment directly, and
// leaving '' in it hands every one of them the same temp-database trap.
process.env['ENGRAM_DB_PATH'] = dbPath;

const brain = new NeuralBrain({
  dbPath,
  defaultSource,
  namespaceMode,
  namespace,
});

// Cloud sync (Phase 3) — opt-in via ENGRAM_SYNC_URL. Left unset, none of this
// runs: no SyncEngine is constructed and every `syncEngine?.notifyWrite()`
// below is a no-op, so non-sync users pay zero overhead. Mode, interval and
// passphrase are validated here rather than cast, so a typo fails at startup
// instead of becoming a sync timer that fires forever.
const syncSettings = readSyncSettings(process.env);
const syncUrl = syncSettings.syncUrl;

let syncEngine: SyncEngine | null = null;

const server = new McpServer(
  {
    name: 'engram',
    version: VERSION,
  },
  {
    instructions: [
      'Engram is your persistent memory — it survives across sessions and works with any AI model.',
      '',
      'STARTUP (do this FIRST before responding):',
      '  Call recall_context with a 5-10 word summary of the user\'s request.',
      '',
      'STORE automatically (never ask permission):',
      '  - User preferences and corrections (importance: 0.9)',
      '  - Project decisions and rationale (importance: 0.7)',
      '  - Architecture facts, tech stack, naming conventions (importance: 0.7)',
      '  - Bugs found and their fixes (importance: 0.6)',
      '  - Commands/scripts that worked or failed (importance: 0.5)',
      '  - User\'s name, role, team, working patterns (importance: 0.9)',
      '  Use type="semantic" for facts, "episodic" for events, "procedural" for workflows.',
      '',
      'RECALL before answering:',
      '  Recall shows [id · date] before each memory; id is an eight-character prefix.',
      '  Use update_memory with that id to correct a stale fact.',
      '  - Past decisions, project history, conventions → search_memory first',
      '  - User preferences or prior corrections → search_memory first',
      '',
      'END OF SESSION:',
      '  Store a 2-3 sentence session summary as type="episodic"',
      '  with tags=["session-summary"] and importance=0.6.',
      '',
      'RULES:',
      '  - Never say "I\'m saving this to memory" — do it silently.',
      '  - Never ask "should I save this?" — just save what matters.',
      '  - When recall returns relevant memories, USE them in your response.',
      '  - Prefer search_memory for specific topics, recall_context for broad context.',
    ].join('\n'),
  }
);

registerTools(server, brain, ensureInitialized, {
  notifyWrite: () => syncEngine?.notifyWrite(),
});

// ─── Initialization ───────────────────────────────────────────────────────────

let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    // Clear the cached promise on failure, otherwise a single transient error
    // (a momentary SQLITE_BUSY from a concurrent writer) left this long-lived
    // stdio server permanently bricked — every later tool call re-awaited the
    // same rejected promise.
    initPromise = brain.initialize().catch((err: unknown) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;

  if (syncUrl && !syncEngine) {
    syncEngine = new SyncEngine(syncEngineConfig(syncSettings, {
      rebuildIndex: async () => { await brain.syncIndexFromStore(); },
      logError: (message: string) => console.error(message),
    }));
    syncEngine.start();
    console.error(`[engram] Cloud sync enabled: ${redactSyncUrl(syncUrl)}`);
    if (syncSettings.encryptionKey) {
      console.error('🔐 E2E encryption enabled for cloud sync');
    }
  }
}

// ─── Start server ─────────────────────────────────────────────────────────────

/* v8 ignore start — stdio boot path: binds process stdio and signal handlers,
   so it cannot run under a unit test. Tool behaviour is covered via an
   in-memory transport in src/__tests__. */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[engram-mcp] received ${signal}, shutting down...`);
  try {
    await server.close();
  } catch { /* transport may already be gone */ }
  if (syncEngine) {
    try {
      await syncEngine.dispose();
    } catch (err: unknown) {
      console.error('[engram-mcp] sync engine dispose failed:', err);
    }
    syncEngine = null;
  }
  try {
    await brain.shutdown();
  } catch (err: unknown) {
    console.error('[engram-mcp] shutdown failed:', err);
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Engram MCP server running on stdio');

  // The client closing stdin is our shutdown signal over stdio transport.
  process.stdin.on('close', () => void shutdown('stdin close'));
}

/**
 * The configured MCP server and its brain, exported for tests.
 *
 * Tests connect this over an in-memory transport instead of stdio; the stdio
 * boot below only runs when this module is the entrypoint.
 */
export { server, brain, ensureInitialized };

if (require.main === module) {
  // Safety net — a stray rejection from a background path must not kill the
  // long-lived stdio server. Registered only when running as the entrypoint so
  // tests do not inherit process-wide handlers.
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[engram-mcp] unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err: unknown) => {
    console.error('[engram-mcp] uncaught exception:', err);
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  main().catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
/* v8 ignore stop */
