/**
 * Regression test for a cross-process race in getDeviceId().
 *
 * Before the fix, two processes bootstrapping getDeviceId() against the same
 * brand-new database could both observe "no local_meta row yet", both
 * attempt `INSERT INTO local_meta (key, value) VALUES ('device_id', ...)`,
 * and the loser threw SQLITE_CONSTRAINT_PRIMARYKEY on `local_meta.key` —
 * surfacing as an unrelated HTTP 500. The fix (`.onConflictDoNothing()` +
 * re-select in packages/core/src/sync/deviceId.ts) makes the loser adopt the
 * winner's id instead of throwing.
 *
 * A single Node process can't reproduce this: the bug only manifests when
 * two independent SQLite connections interleave their SELECT-then-INSERT
 * around each other, which requires genuinely separate OS processes against
 * one shared file. So this test spawns several real child processes (via
 * node:child_process) racing to call the actual compiled getDeviceId()
 * against one fresh temp database, and asserts none of them throw and all
 * agree on the same id.
 *
 * Reliability note: to make the interleaving happen reliably rather than
 * "usually, on a fast machine", every worker opens its DB connection first,
 * then blocks on a ready/go handshake over stdio (see
 * deviceId-race-worker.cjs) — the parent only releases every worker once
 * ALL of them have reported ready, so their getDeviceId() calls fire within
 * a tight window of each other. This is a deliberate, documented technique
 * (a synchronization barrier immediately before the critical section), not
 * a best-effort approximation: given the fix, correctness does not actually
 * depend on the workers landing on the exact same tick — a genuinely fresh
 * process's first getDeviceId() call always does its own SELECT before any
 * INSERT it can see, so ANY interleaving where two workers' SELECTs both
 * land before either's INSERT commits reproduces the original race
 * condition, and the barrier makes that overlap highly likely on every run
 * without depending on exact timing for the assertions to hold.
 *
 * This test rebuilds `dist/` (via `tsc`) in `beforeAll` so the compiled
 * worker script reflects the CURRENT source rather than a stale prior build
 * — `vitest run` alone does not do this, unlike the turbo `test` pipeline.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { getDatabaseConnection, closeDatabase } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, '../../..');
const WORKER_SCRIPT = path.join(__dirname, 'deviceId-race-worker.cjs');
const NUM_WORKERS = 4;
const HANDSHAKE_TIMEOUT_MS = 20000;

function tempDbPath(): string {
  return path.join(__dirname, `test-race-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

interface WorkerResult {
  ok: boolean;
  deviceId?: string;
  error?: string;
}

interface WorkerOutcome {
  exitCode: number | null;
  result: WorkerResult | null;
}

/**
 * Spawns `count` real child processes, each opening the given
 * (already-migrated) SQLite file and calling getDeviceId() for the first
 * time, gated behind a ready/go handshake so their calls fire within
 * milliseconds of each other. See the file-level doc comment for why this
 * is a deliberate reliability technique rather than a flaky timing hack.
 */
function raceGetDeviceId(dbPath: string, count: number): Promise<WorkerOutcome[]> {
  return new Promise((resolve, reject) => {
    const children: ChildProcessWithoutNullStreams[] = Array.from({ length: count }, () =>
      spawn(process.execPath, [WORKER_SCRIPT, dbPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    );

    const outcomes: WorkerOutcome[] = children.map(() => ({ exitCode: null, result: null }));

    let readyCount = 0;
    let settled = false;
    let pendingExits = count;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      for (const child of children) child.kill();
      reject(new Error(`Timed out waiting for ${count} getDeviceId() workers to become ready/finish`));
    }, HANDSHAKE_TIMEOUT_MS);

    children.forEach((child, index) => {
      let buffer = '';
      let sawReady = false;

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;

          if (!sawReady && line === 'READY') {
            sawReady = true;
            readyCount++;
            if (readyCount === count) {
              // Every worker is connected and blocked on stdin — release
              // them all in the same synchronous pass, as close to
              // simultaneously as this event loop allows.
              for (const c of children) c.stdin.write('GO\n');
            }
            continue;
          }

          try {
            outcomes[index]!.result = JSON.parse(line) as WorkerResult;
          } catch {
            // Ignore stray non-JSON output.
          }
        }
      });

      child.on('exit', (code) => {
        outcomes[index]!.exitCode = code;
        pendingExits--;
        if (pendingExits === 0 && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(outcomes);
        }
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  });
}

describe('getDeviceId — cross-process race regression', () => {
  let dbPath: string;

  beforeAll(() => {
    // Rebuild dist so the worker (plain Node, no TS transform available)
    // runs the CURRENT source of adapter.ts / deviceId.ts.
    execFileSync(path.join(CORE_ROOT, 'node_modules', '.bin', 'tsc'), ['-p', path.join(CORE_ROOT, 'tsconfig.json')], {
      cwd: CORE_ROOT,
      stdio: 'inherit',
    });
  }, 60000);

  afterEach(() => {
    if (dbPath) cleanupTestDb(dbPath);
  });

  it('never throws and every process agrees on one device id under real concurrent first-bootstrap', async () => {
    dbPath = tempDbPath();

    // Pre-create and fully migrate the DB ONCE, in-process, so local_meta
    // exists but is empty (no device_id row yet) before the race starts.
    // This isolates the test to the getDeviceId() bootstrap race itself,
    // rather than also racing the (separately-tested) schema migration.
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    const outcomes = await raceGetDeviceId(dbPath, NUM_WORKERS);

    outcomes.forEach((outcome, index) => {
      expect(outcome.exitCode, `worker ${index} exit code`).toBe(0);
      expect(outcome.result, `worker ${index} produced a result line`).not.toBeNull();
      expect(outcome.result?.ok, `worker ${index} error: ${outcome.result?.error}`).toBe(true);
    });

    const ids = outcomes.map((o) => o.result?.deviceId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size, `all workers should agree on one id, got: ${JSON.stringify(ids)}`).toBe(1);

    const deviceId = ids[0]!;
    expect(deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // Confirm it's genuinely persisted on disk, not just agreed upon across
    // the workers' in-memory results.
    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const row = sqlite.prepare("SELECT value FROM local_meta WHERE key = 'device_id'").get() as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(deviceId);
    } finally {
      sqlite.close();
    }
  });
});
