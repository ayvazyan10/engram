import { resolveDbPath } from '@engram-ai-memory/core';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isMainThread, Worker, workerData } from 'node:worker_threads';

const RELEASE_URL = 'https://raw.githubusercontent.com/ayvazyan10/engram/master/packages/mcp/package.json';
const CACHE_TTL = 24 * 60 * 60 * 1000;

function packageVersion(value: unknown): string {
  if (!value || typeof value !== 'object' || !('version' in value)) return '';
  return typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version) ? value.version : '';
}

async function installedVersion(): Promise<string> {
  return packageVersion(JSON.parse(await readFile(path.join(__dirname, '../package.json'), 'utf8')));
}

async function refreshLatestVersion(cache: string): Promise<string> {
  const response = await fetch(RELEASE_URL, { signal: AbortSignal.timeout(1500), redirect: 'error' });
  if (!response.ok) return '';
  const version = packageVersion(await response.json());
  if (!version) return '';
  await mkdir(path.dirname(cache), { recursive: true });
  const temporary = `${cache}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version, timestamp: Date.now() }), { flag: 'wx' });
    await rename(temporary, cache);
  } finally {
    await rm(temporary, { force: true });
  }
  return version;
}

if (!isMainThread && require.main === module) {
  void refreshLatestVersion(workerData as string).catch(() => '');
}

async function latestVersion(cacheOnly: boolean): Promise<string> {
  const dataDir = path.dirname(resolveDbPath(process.env['ENGRAM_DB_PATH']));
  const cache = path.join(dataDir, 'version-notice.json');
  let cached = '';
  try {
    const entry: unknown = JSON.parse(await readFile(cache, 'utf8'));
    cached = packageVersion(entry);
    if (cached && entry && typeof entry === 'object' && 'timestamp' in entry && typeof entry.timestamp === 'number') {
      const age = Date.now() - entry.timestamp;
      if (age >= 0 && age <= CACHE_TTL) return cached;
    }
  } catch { /* Missing or invalid cache: check upstream. */ }

  if (cacheOnly) {
    // The worker owns the fetch, so even an active request cannot hold stdio shutdown open.
    try {
      const worker = new Worker(__filename, { workerData: cache });
      worker.on('error', () => { /* Best-effort refresh. */ });
      worker.unref();
    } catch { /* Still use the cached version if the worker could not start. */ }
    return cached;
  }
  return (await refreshLatestVersion(cache).catch(() => '')) || cached;
}

function newerThan(latest: string, installed: string): boolean {
  const current = installed.split('.').map(BigInt);
  for (const [index, part] of latest.split('.').entries()) {
    const difference = BigInt(part) - current[index]!;
    if (difference !== 0n) return difference > 0n;
  }
  return false;
}

async function staleServerNotice(installed: string): Promise<string> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return '';
  const { stdout } = await promisify(execFile)('ps', ['-eo', 'pid=,ppid=,etime=,args=', '-ww'], {
    timeout: 1500, maxBuffer: 16 * 1024 * 1024,
  });
  const now = Date.now();
  const lines = stdout.split('\n');
  const parents = new Map<number, number>();
  const launchers = new Set<number>();
  for (const line of lines) {
    const row = /^\s*(\d+)\s+(\d+)\s+\S+\s+(.+)$/.exec(line);
    if (!row) continue;
    parents.set(Number(row[1]), Number(row[2]));
    // npx can leave both "npm exec ... engram-mcp" and "sh -c engram-mcp"
    // between the server and the client that also launched this hook.
    if (/^(?:npm exec |npx |(?:\S*\/)?(?:ba|da|z)?sh -c ).*\bengram-mcp\b/.test(row[3]!)) {
      launchers.add(Number(row[1]));
    }
  }
  const ancestors = new Set<number>();
  let pid = parents.get(process.pid);
  // Stop below init: orphans reparented to pid 1 belong to no session.
  while (pid && pid !== 1 && !ancestors.has(pid)) {
    ancestors.add(pid);
    pid = parents.get(pid);
  }
  for (const [script, kind] of [['../dist/server.js', 'MCP'], ['../../../apps/server/dist/index.js', 'HTTP']] as const) {
    const filename = path.resolve(__dirname, script);
    const build = await stat(filename).catch(() => undefined);
    if (!build) continue;
    for (const line of lines) {
      // ps etime is [[DD-]HH:]MM:SS. Match the node entrypoint, including homes with spaces.
      const row = /^\s*\d+\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(?:\S*\/)?node(?:js)?\s+(?:--[\w-]+(?:=\S+)?\s+)*(?:--\s+)?(.+)$/.exec(line);
      if (!row) continue;
      const [, ppid, days, hours, minutes, seconds, args] = row;
      const totalHours = Number(days ?? 0) * 24 + Number(hours ?? 0);
      const elapsed = (totalHours * 60 + Number(minutes)) * 60 + Number(seconds);
      if (now - elapsed * 1000 >= build.mtimeMs) continue;
      if (kind === 'MCP') {
        let parent = Number(ppid);
        while (launchers.has(parent) && !ancestors.has(parent)) parent = parents.get(parent) ?? 0;
        if (!ancestors.has(parent)) continue;
      }
      if (args !== filename && !args?.startsWith(filename + ' ')) {
        const bin = kind === 'MCP' && args?.match(/^(\/.+?\/(?:engram-mcp|mcp))(?=\s|$)/)?.[1];
        if (!bin || await realpath(bin).catch(() => '') !== filename) continue;
      }
      return kind === 'MCP'
        ? `Engram MCP in this session was started before the installed v${installed} build — restart the client to load it.`
        : `An Engram HTTP server is running an older build (version unknown), installed v${installed} — run \`engram stop\` then \`engram start\` to load it.`;
    }
  }
  return '';
}

async function updateNotice(installed: string, cacheOnly: boolean): Promise<string> {
  const latest = await latestVersion(cacheOnly);
  return latest && newerThan(latest, installed)
    ? `Engram v${latest} is available (installed v${installed}). Offer the user to run \`engram update\`.`
    : '';
}

export async function cachedUpdateNotice(): Promise<string> {
  const installed = await installedVersion().catch(() => '');
  return installed ? updateNotice(installed, true).catch(() => '') : '';
}

export async function versionNotice(): Promise<string> {
  const installed = await installedVersion().catch(() => '');
  if (!installed) return '';
  const notices = await Promise.all([
    staleServerNotice(installed).catch(() => ''),
    updateNotice(installed, false).catch(() => ''),
  ]);
  return notices.filter(Boolean).join('\n');
}
