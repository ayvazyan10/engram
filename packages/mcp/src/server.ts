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
import { NeuralBrain, SyncEngine, redactSyncUrl, resolveDbPath } from '@engram-ai-memory/core';
import fs from 'fs';
import path from 'path';
import { cachedUpdateNotice } from './versionNotice.js';
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

export { resolveDbPath };

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

let server: McpServer;

function createServer(notice: string): McpServer {
  const server = new McpServer(
    {
      name: 'engram',
      version: VERSION,
    },
    {
      instructions: [
        'Engram is the shared long-term memory for every AI tool this user works with — the same memories in Claude Code, Codex, Cursor and others. Store durable facts here so every tool can use them. When a recalled memory conflicts with the user\'s explicit instructions (CLAUDE.md, AGENTS.md, rules), the instructions win.',
        '- Recall when prior decisions or project history would help: recall_context for broad context, search_memory for a specific fact. Recalled memories can be stale — verify before relying on them.',
        '- Store durable facts worth keeping beyond this session: decisions and their reasons, conventions, fixes, user preferences. Not routine chatter. Follow the user\'s wishes about what to store.',
        '- Follow the namespace guidance in store_memory for project-specific memories. Use global: true only for facts about the user that hold in every project.',
        '- Correct a stale fact with update_memory (by id); retire one with forget.',
        notice,
      ].filter(Boolean).join('\n'),
    }
  );

  registerTools(server, brain, ensureInitialized, {
    notifyWrite: () => syncEngine?.notifyWrite(),
  });
  return server;
}

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
  const notice = await cachedUpdateNotice();
  server = createServer(notice);
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
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

  main().catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
} else {
  server = createServer('');
}
/* v8 ignore stop */
