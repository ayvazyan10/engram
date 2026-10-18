#!/usr/bin/env node
/**
 * Standalone memory store — creates a NeuralBrain directly, stores one memory, and exits.
 * Used by session-end hooks when the REST server is not running.
 *
 * Usage:
 *   echo "session summary text" | node store-session.js
 *   node store-session.js "session summary text"
 */

import { NeuralBrain, resolveDbPath } from '@engram-ai-memory/core';
import fs from 'fs';
import path from 'path';
import { resolveNamespaceSettings, type NamespaceEnv } from './namespaceEnv.js';

export { resolveDbPath };

/** Shortest summary worth a row — anything below this is a hook misfire. */
const MIN_CONTENT_LENGTH = 10;

/** Pending live sessions visible under core's namespace rules. */
export async function getPendingDistillSessions(brain: NeuralBrain) {
  // getByTag filters before slicing. Apply the access check before our limit
  // too: filter mode without a namespace must only expose global memories.
  const sessions = await brain.getByTag('pending-distill', Number.MAX_SAFE_INTEGER);
  return sessions.filter((session) => brain.canAccessNamespace(session.namespace));
}

/**
 * The summary to store: the command line if there is one, otherwise stdin.
 * Split out from main() so the argv/stdin choice is testable without a process.
 */
export async function readContent(argv: readonly string[], stdin: AsyncIterable<Buffer>): Promise<string> {
  if (argv[2]) return argv.slice(2).join(' ');

  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

/**
 * Store one session summary in the brain the environment describes.
 *
 * Namespace configuration is read here for the same reason the MCP server
 * reads it: writing with `namespace: null` under
 * ENGRAM_NAMESPACE_MODE=isolated hides the summary from the brain that is
 * supposed to own it and exposes it to every other namespace. This used to
 * pass only dbPath and defaultSource, so the hook-written summaries were the
 * one kind of memory that ignored the user's isolation setting entirely.
 */
export async function storeSession(content: string, env: NamespaceEnv): Promise<void> {
  const source = env['ENGRAM_SOURCE'] || 'mcp-client';
  const { namespaceMode, namespace } = resolveNamespaceSettings(env);

  const dbPath = resolveDbPath(env['ENGRAM_DB_PATH']);
  // better-sqlite3 will not create the directory, and a missing parent fails
  // as a bare SQLITE_CANTOPEN — which main()'s catch would swallow into a
  // silent exit 0, the very failure mode this file is fixing.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const brain = new NeuralBrain({
    dbPath,
    defaultSource: source,
    namespaceMode,
    ...(namespace ? { namespace } : {}),
  });
  await brain.initialize();
  try {
    await brain.store({
      content,
      type: 'episodic',
      source,
      tags: ['session-summary', 'auto-stored', 'pending-distill'],
      importance: 0.6,
      ...(namespace ? { namespace } : {}),
    });
  } finally {
    brain.shutdown();
  }
}

/* v8 ignore start — process glue: reads real stdin and exits the process. The
   behaviour it strings together is covered through readContent/storeSession. */
async function main(): Promise<void> {
  const content = await readContent(process.argv, process.stdin);
  if (!content || content.length < MIN_CONTENT_LENGTH) {
    process.exit(0);
  }
  await storeSession(content, process.env);
}

// Only when run as the entrypoint (the `engram-store-session` bin, or the
// session-end hook): importing this module must not read stdin or exit.
if (require.main === module) {
  main().catch((err: unknown) => {
    // Exit 0 on purpose: this runs from a session-end hook and must never fail
    // the session. But say so on stderr first — a silent exit 0 is how a
    // hook that stored nothing for weeks looked exactly like one that worked.
    console.error(`[engram-store-session] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  });
}
/* v8 ignore stop */
