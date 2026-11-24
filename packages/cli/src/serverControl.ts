/**
 * Server lifecycle helpers for the Engram CLI.
 *
 * Kept free of process.exit / console side effects so the start / restart /
 * status commands can share the logic and it stays unit-testable.
 */

import net from 'net';
import path from 'path';
import { statSync } from 'fs';
import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';

/** Direct node invocations of the checkout's entrypoints that predate their build. */
export function staleServerPids(repoPath: string, restartedPid?: number): number[] {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return [];
  const scripts = ['packages/mcp/dist/server.js', 'apps/server/dist/index.js'].map(
    script => path.resolve(repoPath, script),
  );
  const output = execFileSync('ps', ['-eo', 'pid=,etime=,args=', '-ww'], {
    encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1024 * 1024,
  });
  const now = Date.now();
  const stale: number[] = [];
  for (const line of output.split('\n')) {
    // ps etime is [[DD-]HH:]MM:SS on both Linux and macOS.
    const row = /^\s*(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(?:\S*\/)?node(?:js)?\s+(?:--[\w-]+(?:=\S+)?\s+)*(?:--\s+)?(.+)$/.exec(line);
    if (!row) continue;
    const [, pid, days, hours, minutes, seconds, args] = row;
    if (Number(pid) === restartedPid) continue;
    const script = scripts.find(file => args === file || args?.startsWith(file + ' '));
    if (!script) continue;
    const totalHours = Number(days ?? 0) * 24 + Number(hours ?? 0);
    const elapsed = (totalHours * 60 + Number(minutes)) * 60 + Number(seconds);
    if (now - elapsed * 1000 < statSync(script).mtimeMs) stale.push(Number(pid));
  }
  return stale;
}

/** 0.0.0.0 / :: are bind addresses, not connectable — map them to loopback. */
export function connectHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

/** True if the given PID is alive (signal-0 probe). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Resolve whether something is accepting TCP connections on host:port. */
export function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, connectHost(host));
  });
}

/** A value we are willing to ask the operating system about. */
export function isValidPort(port: unknown): port is number {
  return Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535;
}

const processLookupOptions = { encoding: 'utf8', timeout: 3000, stdio: 'pipe' } as const;

/**
 * PID of the process listening on a TCP port, or null when it can't be
 * determined (nothing listening, or the OS lookup is unavailable).
 *
 * `execFileSync` with an argv array, never `execSync` with a command string.
 * The port arrives from ~/.engram/config.json, and a config holding
 * `"port": "1; touch /tmp/pwned #"` used to run that command through a shell on
 * every `engram status`. The range check is the second half of the same fix:
 * nothing that is not a port is worth asking about.
 */
export function portListenerPid(port: number): number | null {
  if (!isValidPort(port)) return null;
  try {
    const out = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`], processLookupOptions)
      : execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], processLookupOptions);
    const first = out.split(/\s+/).filter(Boolean)[0];
    if (!first) return null;
    const pid = parseInt(first, 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export interface StartupResult {
  healthy: boolean;
  exited: boolean;
  exitCode: number | null;
}

/**
 * Wait until a freshly spawned server answers GET /api/health with 2xx. Aborts
 * early if the child process dies first (bind failure / crash), so a foreign
 * process already holding the port can't be mistaken for a successful start.
 * Only returns healthy:true when the child is still alive AND the API responded.
 */
export async function awaitServerHealthy(
  child: ChildProcess,
  host: string,
  port: number,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<StartupResult> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 500;
  const url = `http://${connectHost(host)}:${port}/api/health`;

  const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null;

  for (let i = 0; i < attempts; i++) {
    if (hasExited()) return { healthy: false, exited: true, exitCode: child.exitCode };
    await new Promise((r) => setTimeout(r, intervalMs));
    if (hasExited()) return { healthy: false, exited: true, exitCode: child.exitCode };
    try {
      const res = await fetch(url);
      if (res.ok) return { healthy: true, exited: false, exitCode: null };
    } catch {
      // not accepting connections yet — keep polling
    }
  }

  return { healthy: false, exited: hasExited(), exitCode: child.exitCode };
}

export type ServerLiveness =
  | { state: 'stopped' }
  | { state: 'running'; pid: number }
  | { state: 'unknown'; pid: number }
  | { state: 'port_mismatch'; pid: number; ownerPid: number };

/** A managed child can still be starting, before it owns a listening socket. */
export function verifyServer(pid: number, port: number, serverScript?: string): ServerLiveness {
  if (!pidAlive(pid)) return { state: 'stopped' };
  const owner = portListenerPid(port);
  if (serverScript) {
    try {
      const args = process.platform === 'win32'
        ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], processLookupOptions)
        : execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'args='], processLookupOptions);
      if (args.trim()) {
        const command = /^(?:"([^"]+)"|(\S+))\s+(.+)$/.exec(args.trim());
        const executable = path.basename(command?.[1] ?? command?.[2] ?? '');
        const script = command?.[3]?.replace(/^"(.*)"$/, '$1');
        if (!/^node(?:js)?(?:\.exe)?$/i.test(executable) || script !== serverScript) return { state: 'stopped' };
        if (owner === null) return { state: 'running', pid };
      }
    } catch { /* Process arguments unavailable. Use the listener's owner. */ }
  }
  if (owner !== null && owner !== pid) return { state: 'port_mismatch', pid, ownerPid: owner };
  return owner === pid ? { state: 'running', pid } : { state: 'unknown', pid };
}
