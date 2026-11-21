#!/usr/bin/env node
/** Recall project memory for Claude Code without holding up a session. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { SearchHit } from '@engram-ai-memory/core';
import type { NamespaceEnv } from './namespaceEnv.ts';
import type * as NamespaceModule from './namespaceEnv.ts';
import type * as StoreModule from './store-session.ts';
import type * as VersionModule from './versionNotice.ts';

// This package emits CommonJS without rewriting .ts specifiers. Load the
// emitted siblings lazily, keeping core/model loading inside the worker.
const storeModulePath = './store-session.js';
const namespaceModulePath = './namespaceEnv.js';
const versionModulePath = './versionNotice.js';

export function buildRecallQuery(cwd: string, branch = ''): string {
  return [path.basename(path.resolve(cwd)), branch.trim()].filter(Boolean).join(' ');
}

function sessionLines(hits: SearchHit[], source: string, threshold: number): string {
  const transcript = /^\s*(?:user\s*:|assistant\s*:|claude code session [^:\n]+:|session summary\s*:)/im;
  const candidates = hits.flatMap((hit) => {
    // Hybrid search can return keyword hits below the requested cosine threshold.
    if (!(hit.score >= threshold)) return [];
    const tags: string[] = JSON.parse(hit.tags);
    if (tags.includes('import:markdown') && tags.some((tag) => tag.toLowerCase() === 'memory.md')) return [];
    // Raw transcripts are noise whatever their type (consolidation stores them as semantic).
    if (transcript.test(hit.content) || transcript.test(hit.summary ?? '')) return [];
    if (hit.type === 'episodic'
      && (hit.source !== source || tags.includes('pending-distill') || tags.includes('session-summary'))) return [];

    const text = (hit.summary ?? hit.content).trim().replace(/[\r\n]+/g, ' ');
    const pinned = tags.includes('pinned');
    const handover = tags.includes('handover') || tags.includes('handoff') || /^hand(?:over|off)\b/i.test(text);
    if (!text || !(pinned || handover || hit.importance >= 0.8)) return [];
    return [{ hit, text, pinned, handover }];
  });
  candidates.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.handover) - Number(a.handover)
    || b.hit.importance - a.hit.importance || b.hit.score - a.hit.score);

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const { hit, text } of candidates) {
    if (seen.has(text)) continue;
    seen.add(text);
    const origin = (hit.source || 'unknown').replace(/[\r\n]+/g, ' ');
    lines.push(`[${hit.id.slice(0, 8)} · ${hit.createdAt.slice(0, 10)} · sim ${hit.score.toFixed(2)} · ${origin}] ${text.slice(0, 800)}`);
    if (lines.length === 3) break;
  }
  return lines.join('\n');
}

async function recallContext(cwd: string, env: NamespaceEnv): Promise<string> {
  const { resolveNamespaceSettings }: typeof NamespaceModule = await import(namespaceModulePath);
  const { namespaceMode, namespace } = resolveNamespaceSettings(env, cwd);
  if (!namespace || namespaceMode === 'none') return '';
  const { NeuralBrain, resolveDbPath, readEnvNumber } = await import('@engram-ai-memory/core');
  const threshold = readEnvNumber(env, 'ENGRAM_RECALL_MIN_SIM', { min: 0, max: 1, integer: false }) ?? 0.5;
  const dbPath = resolveDbPath(env['ENGRAM_DB_PATH']);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const source = env['ENGRAM_SOURCE'] || 'mcp-client';
  const brain = new NeuralBrain({
    dbPath, defaultSource: source, namespaceMode, namespace,
  });
  try {
    await brain.initialize();
    const hits = await brain.search(`${buildRecallQuery(namespace)} project handover, current decisions and next steps`, {
      namespace, threshold, topK: 50,
    });
    return sessionLines(hits, source, threshold);
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
    const parts = [
      await recallContext(cwd, env).catch(() => ''),
      await (import(versionModulePath) as Promise<typeof VersionModule>)
        .then((module) => module.versionNotice()).catch(() => ''),
    ];
    const additionalContext = parts.filter(Boolean).join('\n\n');
    if (additionalContext) {
      write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
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
