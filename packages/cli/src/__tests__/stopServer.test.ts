/**
 * `engram stop` used to send SIGTERM, unlink the pidfile and print
 * "Server stopped" in the same breath — before the process had gone anywhere.
 * Two things came out of that:
 *
 *  (a) the server takes a moment to exit, so the next `engram start` found the
 *      port still held and reported it as "in use by a process not managed by
 *      Engram" — which was Engram, still shutting down;
 *  (b) the pidfile survives a reboot, and if that PID had been reused by
 *      another process of the same user, `engram stop` SIGTERMed it and
 *      reported success. `status` already verified ownership through
 *      `verifyServer`; `stop` and `update --restart` did not.
 */

import { describe, it, expect } from 'vitest';
import { stopProcess, describeStopOutcome, type StopDeps } from '../stopServer.js';

/** A fake process that dies after `diesAfterMs` of waiting. */
function fakeProcess(options: {
  diesAfterMs?: number;
  owner?: number | null;
  portOpen?: boolean;
  killThrows?: string;
}): { deps: StopDeps; signals: string[]; elapsed: () => number } {
  const signals: string[] = [];
  let elapsed = 0;
  const diesAfter = options.diesAfterMs ?? 0;
  let signalled = false;

  const deps: StopDeps = {
    alive: () => !(signalled && elapsed >= diesAfter),
    portOwner: () => (options.owner === undefined ? null : options.owner),
    portOpen: async () => options.portOpen !== false,
    kill: (_pid, signal) => {
      if (options.killThrows) throw new Error(options.killThrows);
      signals.push(signal);
      signalled = true;
    },
    sleep: async (ms) => { elapsed += ms; },
  };

  return { deps, signals, elapsed: () => elapsed };
}

describe('stopProcess', () => {
  it('waits for the process to actually go away before reporting it stopped', async () => {
    const { deps, signals, elapsed } = fakeProcess({ diesAfterMs: 900 });
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 10000, pollMs: 100 });

    expect(outcome.status).toBe('stopped');
    expect(signals).toEqual(['SIGTERM']);
    // It cannot have answered before the process was gone.
    expect(elapsed()).toBeGreaterThanOrEqual(900);
  });

  it('reports a timeout instead of success when the process is still alive', async () => {
    const { deps, signals } = fakeProcess({ diesAfterMs: Number.MAX_SAFE_INTEGER });
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 1000, pollMs: 100 });

    expect(outcome.status).toBe('timeout');
    expect(signals).toEqual(['SIGTERM']);
    // Never escalates on its own: SIGKILL on a database writer is not ours to
    // choose. The message has to say what is still running instead.
    expect(signals).not.toContain('SIGKILL');
  });

  it('refuses to signal a PID that does not own the port', async () => {
    const { deps, signals } = fakeProcess({ diesAfterMs: 0, owner: 9999 });
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 1000, pollMs: 100 });

    expect(outcome).toEqual({ status: 'port-mismatch', pid: 4242, ownerPid: 9999 });
    expect(signals).toEqual([]);
  });

  it('proceeds when the port owner cannot be determined — lsof is not always there', async () => {
    const { deps, signals } = fakeProcess({ diesAfterMs: 0, owner: null });
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 1000, pollMs: 100 });

    expect(outcome.status).toBe('stopped');
    expect(signals).toEqual(['SIGTERM']);
  });

  /**
   * The reboot case from the report: the pidfile outlived the machine, the
   * operating system handed that PID to something else, and nothing at all is
   * listening on Engram's port. A live PID is not evidence — only the port is.
   */
  it('refuses to signal a live PID when nothing is listening on the port', async () => {
    const { deps, signals } = fakeProcess({ diesAfterMs: 0, portOpen: false });
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 1000, pollMs: 100 });

    expect(outcome).toEqual({ status: 'not-serving', pid: 4242, port: 4901 });
    expect(signals).toEqual([]);
  });

  it('reports a process that was already gone rather than claiming to have stopped it', async () => {
    const deps: StopDeps = {
      alive: () => false,
      portOwner: () => null,
      portOpen: async () => false,
      kill: () => { throw new Error('kill must not be called'); },
      sleep: async () => {},
    };
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 1000, pollMs: 100 });
    expect(outcome).toEqual({ status: 'not-running' });
  });

  it('reports a failed signal as a failure', async () => {
    const { deps } = fakeProcess({ killThrows: 'EPERM: operation not permitted' });
    const outcome = await stopProcess(4242, 4901, deps, { graceMs: 1000, pollMs: 100 });

    expect(outcome.status).toBe('signal-failed');
    if (outcome.status === 'signal-failed') expect(outcome.error).toMatch(/EPERM/);
  });
});

describe('describeStopOutcome', () => {
  it('never phrases a failure as a success', () => {
    const failures = [
      describeStopOutcome({ status: 'timeout', pid: 1, waitedMs: 10000 }),
      describeStopOutcome({ status: 'port-mismatch', pid: 1, ownerPid: 2 }),
      describeStopOutcome({ status: 'signal-failed', pid: 1, error: 'EPERM' }),
      describeStopOutcome({ status: 'not-serving', pid: 1, port: 4901 }),
    ];
    for (const failure of failures) {
      expect(failure.ok).toBe(false);
      expect(failure.message.toLowerCase()).not.toContain('server stopped');
    }
  });

  it('explains a pidfile that outlived the process it named', () => {
    const described = describeStopOutcome({ status: 'not-serving', pid: 7, port: 4901 });
    expect(described.ok).toBe(false);
    expect(described.message).toContain('7');
    expect(described.message).toContain('4901');
    expect(described.detail.join(' ')).toMatch(/pidfile|port/i);
  });

  it('says what to do about a pidfile pointing at someone else', () => {
    const described = describeStopOutcome({ status: 'port-mismatch', pid: 1, ownerPid: 2 });
    expect(described.message).toContain('1');
    expect(described.message).toContain('2');
    expect(described.detail.join(' ')).toMatch(/pidfile/i);
  });

  it('reports a clean stop as a success', () => {
    const described = describeStopOutcome({ status: 'stopped', pid: 77, waitedMs: 300 });
    expect(described.ok).toBe(true);
    expect(described.message).toContain('77');
  });

  it('treats "was not running" as nothing to do, not as an error', () => {
    const described = describeStopOutcome({ status: 'not-running' });
    expect(described.ok).toBe(true);
    expect(described.message).toMatch(/not running/i);
  });
});
