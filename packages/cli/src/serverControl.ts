/**
 * Server lifecycle helpers for the Engram CLI.
 *
 * Kept free of process.exit / console side effects so the start / restart /
 * status commands can share the logic and it stays unit-testable.
 */

import net from 'net';
import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';

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

/**
 * PID of the process listening on a TCP port, or null when it can't be
 * determined (nothing listening, or `lsof` unavailable). macOS + Linux.
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
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
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
  | { state: 'port_mismatch'; pid: number; ownerPid: number };

/**
 * Verify a pidfile PID is not just alive but actually owns the port. When lsof
 * can't determine the owner (returns null), liveness is trusted — the caller
 * can still probe the API to confirm.
 */
export function verifyServer(pid: number, port: number): ServerLiveness {
  if (!pidAlive(pid)) return { state: 'stopped' };
  const owner = portListenerPid(port);
  if (owner !== null && owner !== pid) {
    return { state: 'port_mismatch', pid, ownerPid: owner };
  }
  return { state: 'running', pid };
}
