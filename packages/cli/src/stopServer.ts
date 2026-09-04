/**
 * Stopping the server, and being honest about whether it stopped.
 *
 * `engram stop` sent SIGTERM, unlinked the pidfile and printed
 * "Server stopped (PID n)" without waiting for anything. Two consequences, both
 * reported by users:
 *
 *  - the server needs a moment to close its database and release the port, so
 *    the `engram start` that followed found the port taken and blamed "a
 *    process not managed by Engram" — which was Engram, still exiting;
 *  - a pidfile outlives a reboot. If the operating system had handed that PID
 *    to another process of the same user, `engram stop` SIGTERMed a stranger
 *    and called it a success. `engram status` already guarded against this with
 *    `verifyServer`; stop and `update --restart` did not.
 *
 * Kept free of console and process side effects so both call sites share it and
 * it can be tested with a fake clock.
 */

export type StopOutcome =
  | { status: 'not-running' }
  | { status: 'stopped'; pid: number; waitedMs: number }
  | { status: 'port-mismatch'; pid: number; ownerPid: number }
  | { status: 'not-serving'; pid: number; port: number }
  | { status: 'timeout'; pid: number; waitedMs: number }
  | { status: 'signal-failed'; pid: number; error: string };

export interface StopDeps {
  alive(pid: number): boolean;
  /** PID listening on the port, or null when it cannot be determined. */
  portOwner(port: number): number | null;
  /** Whether anything at all accepts connections on the port. */
  portOpen(): Promise<boolean>;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
}

export interface StopOptions {
  /** How long to wait for the process to exit before giving up. */
  graceMs?: number;
  pollMs?: number;
}

/**
 * Signal the server and wait for it to go.
 *
 * SIGTERM only: escalating to SIGKILL would cut off a process in the middle of
 * writing SQLite, and choosing that for the user is not this command's call. A
 * process that outlasts the grace period is reported as still running.
 */
export async function stopProcess(
  pid: number,
  port: number,
  deps: StopDeps,
  options: StopOptions = {},
): Promise<StopOutcome> {
  const graceMs = options.graceMs ?? 10000;
  const pollMs = options.pollMs ?? 100;

  if (!deps.alive(pid)) return { status: 'not-running' };

  // A live PID is not proof it is ours — a pidfile outlives a reboot, and the
  // operating system reuses PIDs. Our server always listens, so a closed port
  // settles it: whatever holds that PID now, it is not the Engram server.
  // (This is the check `status` did not have either; it only compared owners.)
  if (!await deps.portOpen()) {
    return { status: 'not-serving', pid, port };
  }

  // Port open, but owned by somebody else: same conclusion, more evidence.
  const owner = deps.portOwner(port);
  if (owner !== null && owner !== pid) {
    return { status: 'port-mismatch', pid, ownerPid: owner };
  }

  try {
    deps.kill(pid, 'SIGTERM');
  } catch (err) {
    return { status: 'signal-failed', pid, error: err instanceof Error ? err.message : String(err) };
  }

  let waitedMs = 0;
  while (waitedMs < graceMs) {
    await deps.sleep(pollMs);
    waitedMs += pollMs;
    if (!deps.alive(pid)) return { status: 'stopped', pid, waitedMs };
  }

  return { status: 'timeout', pid, waitedMs };
}

export interface StopMessage {
  /** False whenever the server may still be running. */
  readonly ok: boolean;
  readonly message: string;
  readonly detail: readonly string[];
}

/** How each outcome reads on screen — and which of them are failures. */
export function describeStopOutcome(outcome: StopOutcome): StopMessage {
  switch (outcome.status) {
    case 'not-running':
      return { ok: true, message: 'Server is not running.', detail: [] };
    case 'stopped':
      return {
        ok: true,
        message: `Server stopped (PID ${outcome.pid}, ${outcome.waitedMs}ms)`,
        detail: [],
      };
    case 'not-serving':
      return {
        ok: false,
        message: `Refusing to signal PID ${outcome.pid} — it is alive, but nothing is listening on :${outcome.port}.`,
        detail: [
          'The pidfile is stale: after a reboot that PID can belong to an unrelated process of yours.',
          `If you changed the port since starting the server, stop it yourself: kill ${outcome.pid}`,
          'Otherwise the server is already gone and the pidfile can be removed.',
        ],
      };
    case 'port-mismatch':
      return {
        ok: false,
        message: `Refusing to signal PID ${outcome.pid} — it is alive but PID ${outcome.ownerPid} owns the port.`,
        detail: [
          'The pidfile is stale: after a reboot the operating system can hand that PID to an unrelated process.',
          'Check what is listening, then remove the pidfile if it is not Engram.',
        ],
      };
    case 'timeout':
      return {
        ok: false,
        message: `Server (PID ${outcome.pid}) did not exit within ${outcome.waitedMs}ms of SIGTERM.`,
        detail: [
          'It may still be flushing the database. Wait, then check: engram status',
          `If it is stuck, end it yourself: kill -9 ${outcome.pid}`,
        ],
      };
    case 'signal-failed':
      return {
        ok: false,
        message: `Failed to stop PID ${outcome.pid}: ${outcome.error}`,
        detail: [],
      };
  }
}
