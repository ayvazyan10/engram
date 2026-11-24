#!/usr/bin/env node
/** Recall project memory for Claude Code without holding up a session. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { Memory } from '@engram-ai-memory/core';
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

type SessionMemory = Pick<Memory, 'id' | 'content' | 'summary' | 'type' | 'tags' | 'source' | 'importance' | 'createdAt'>;

function sessionLines(hits: SessionMemory[], source: string): string {
  const transcript = /^\s*(?:user\s*:|assistant\s*:|claude code session [^:\n]+:|session summary\s*:)/im;
  const candidates = hits.flatMap((hit) => {
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
    || b.hit.importance - a.hit.importance || b.hit.createdAt.localeCompare(a.hit.createdAt)
    || a.hit.id.localeCompare(b.hit.id));

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const { hit, text } of candidates) {
    if (seen.has(text)) continue;
    seen.add(text);
    const origin = (hit.source || 'unknown').replace(/[\r\n]+/g, ' ');
    lines.push(`[${hit.id.slice(0, 8)} · ${hit.createdAt.slice(0, 10)} · ${origin}] ${text.slice(0, 800)}`);
    if (lines.length === 3) break;
  }
  return lines.join('\n');
}

async function recallContext(cwd: string, env: NamespaceEnv): Promise<string> {
  const { resolveNamespaceSettings }: typeof NamespaceModule = await import(namespaceModulePath);
  const { namespaceMode, namespace } = resolveNamespaceSettings(env, cwd);
  if (!namespace || namespaceMode === 'none') return '';
  const { getDb, closeDb, resolveDbPath } = await import('@engram-ai-memory/core');
  const dbPath = resolveDbPath(env['ENGRAM_DB_PATH']);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const source = env['ENGRAM_SOURCE'] || 'mcp-client';
  try {
    const memories = await getDb(dbPath).query.memories.findMany({
      columns: { id: true, content: true, summary: true, type: true, tags: true, source: true, importance: true, createdAt: true },
      where: (m, { sql }) => sql`${m.namespace} = ${namespace} AND ${m.archivedAt} IS NULL`,
    });
    return sessionLines(memories, source);
  } finally {
    closeDb();
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
