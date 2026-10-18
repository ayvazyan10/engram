#!/usr/bin/env node
/** Recall project memory for Claude Code without holding up a session. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { NamespaceEnv } from './namespaceEnv.ts';
import type * as NamespaceModule from './namespaceEnv.ts';
import type * as StoreModule from './store-session.ts';

// This package emits CommonJS without rewriting .ts specifiers. Load the
// emitted siblings lazily, keeping core/model loading inside the worker.
const storeModulePath = './store-session.js';
const namespaceModulePath = './namespaceEnv.js';

export function buildRecallQuery(cwd: string, branch = ''): string {
  return [path.basename(path.resolve(cwd)), branch.trim()].filter(Boolean).join(' ');
}

function currentBranch(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function recallContext(cwd: string, env: NamespaceEnv): Promise<string> {
  const { resolveDbPath }: typeof StoreModule = await import(storeModulePath);
  const { resolveNamespaceSettings }: typeof NamespaceModule = await import(namespaceModulePath);
  const { NeuralBrain } = await import('@engram-ai-memory/core');
  const { namespaceMode, namespace } = resolveNamespaceSettings(env);
  const dbPath = resolveDbPath(env['ENGRAM_DB_PATH']);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const source = env['ENGRAM_SOURCE'] || 'mcp-client';
  const brain = new NeuralBrain({
    dbPath, defaultSource: source, namespaceMode, ...(namespace ? { namespace } : {}),
  });
  try {
    await brain.initialize();
    const result = await brain.recall(buildRecallQuery(cwd, currentBranch(cwd)), {
      maxTokens: 1500, source,
    });
    return result.context.slice(0, 6000);
  } finally {
    brain.shutdown();
  }
}

/** Returns the hook exit code; errors never publish partial context. */
export async function runSessionStart(
  input: string,
  env: NamespaceEnv = process.env,
  write: (output: string) => void = (output) => { process.stdout.write(output); },
): Promise<0> {
  try {
    const payload: unknown = JSON.parse(input);
    const cwd = payload && typeof payload === 'object' && 'cwd' in payload
      && typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const context = await recallContext(cwd, env);
    if (context) {
      write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
      }) + '\n');
    }
  } catch {
    // Recall is optional: invalid input, DB/model failures and shutdown errors
    // all leave the session usable, with no hook output.
  }
  return 0;
}

/* v8 ignore start -- process boundary; the handler above is unit-tested. */
async function workerMain(): Promise<void> {
  const { readContent }: typeof StoreModule = await import(storeModulePath);
  const input = await readContent([], process.stdin);
  await runSessionStart(input, process.env, (output) => parentPort?.postMessage(output));
  parentPort?.close();
}

function main(): void {
  // A separate event loop enforces the deadline even during synchronous model
  // or SQLite work. Worker stdout is withheld so only successful JSON escapes.
  setTimeout(() => process.exit(0), 8000);
  try {
    const worker = new Worker(__filename, { stdin: true, stdout: true, stderr: true });
    worker.stdout.resume();
    worker.stderr.resume();
    process.stdin.pipe(worker.stdin!);
    worker.stdin!.on('error', () => process.exit(0));
    worker.once('message', (output: string) => {
      process.stdout.write(output, () => process.exit(0));
    });
    worker.once('error', () => process.exit(0));
    worker.once('exit', () => process.exit(0));
    process.stdin.once('error', () => process.exit(0));
  } catch {
    process.exit(0);
  }
}

if (require.main === module) {
  if (isMainThread) main();
  else workerMain().catch(() => parentPort?.close());
}
/* v8 ignore stop */
