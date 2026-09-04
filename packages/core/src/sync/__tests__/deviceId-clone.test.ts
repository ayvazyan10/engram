/**
 * Regression tests for a copied `engram.db` — the documented
 * restore-from-backup / disk-clone path.
 *
 * A clone used to duplicate `device_id` onto both installations, and the
 * consequence is worse than the "can silently mis-resolve a conflict" the
 * caveat in `../deviceId.ts` described: the pull filter is
 * `device_id IS NULL OR device_id != ours`, so with a shared id every row
 * from the twin reads as an echo of our own push and is skipped — in both
 * directions. The two installs sit there exchanging nothing, and
 * `engram cloud status` reports no error because nothing failed.
 *
 * These tests copy a real database file and reopen it from a second path,
 * which is exactly what `cp engram.db /elsewhere/` or a restored backup
 * produces: a new inode at a new path.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';

import { getDb, closeDatabase } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { getDeviceId, resetDeviceId, _resetMemoizedDeviceIdForTests } from '../deviceId.js';
import { shouldApplyPulledRow } from '../conflict.js';
import { computeSyncId, readCursor, writeCursor } from '../cursor.js';

const dirs: string[] = [];
const dbPaths: string[] = [];

/** Points the process at `dbPath` as if it were a fresh install/boot. */
function activate(dbPath: string): void {
  closeDatabase();
  process.env['ENGRAM_DB_PATH'] = dbPath;
  _resetMemoizedDeviceIdForTests();
  getDb();
}

function freshDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-device-clone-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'engram.db');
  dbPaths.push(dbPath);
  return dbPath;
}

/**
 * Copies the database file the way a backup restore does. The connection has
 * to be closed first so SQLite checkpoints and removes the WAL — otherwise
 * the copy is missing whatever is still only in `-wal`.
 */
function cloneDatabase(source: string): string {
  closeDatabase();
  const target = freshDbPath();
  fs.copyFileSync(source, target);
  return target;
}

function insertMemory(id: string, deviceId: string): void {
  const now = new Date().toISOString();
  getDb()
    .insert(schema.memories)
    .values({ id, type: 'semantic', content: `content ${id}`, createdAt: now, updatedAt: now, deviceId })
    .run();
}

function memoryDeviceId(id: string): string | null | undefined {
  return getDb().select().from(schema.memories).all().find((row) => row.id === id)?.deviceId;
}

afterEach(() => {
  closeDatabase();
  delete process.env['ENGRAM_DB_PATH'];
  _resetMemoizedDeviceIdForTests();
  for (const dbPath of dbPaths.splice(0)) cleanupTestDb(dbPath);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('why a shared device id is fatal, not merely untidy', () => {
  it('makes every row from the twin look like an echo of our own push', () => {
    // Both directions: whichever install is pulling, the other install's
    // rows carry the id it is filtering itself out by.
    expect(shouldApplyPulledRow('shared-id', 'shared-id')).toBe(false);
    expect(shouldApplyPulledRow('other-id', 'shared-id')).toBe(true);
  });
});

describe('getDeviceId — copied database detection', () => {
  it('gives a copied database a different device id from its source', () => {
    const original = freshDbPath();
    activate(original);
    const originalId = getDeviceId();

    const copy = cloneDatabase(original);
    activate(copy);
    const copyId = getDeviceId();

    expect(copyId).not.toBe(originalId);
  });

  it('leaves the source installation untouched', () => {
    const original = freshDbPath();
    activate(original);
    const originalId = getDeviceId();

    const copy = cloneDatabase(original);
    activate(copy);
    getDeviceId();

    activate(original);
    expect(getDeviceId()).toBe(originalId);
  });

  it('is stable across ordinary reopens of the same file', () => {
    const dbPath = freshDbPath();
    activate(dbPath);
    const first = getDeviceId();

    activate(dbPath);
    expect(getDeviceId()).toBe(first);
    activate(dbPath);
    expect(getDeviceId()).toBe(first);
  });

  it('re-attributes local rows so a pending push is not stranded on the old id', () => {
    // The push query selects `device_id IS NULL OR device_id = ours`. A row
    // left on the previous id becomes invisible to push forever, so a write
    // made just before the clone was taken would never leave this machine.
    const original = freshDbPath();
    activate(original);
    const originalId = getDeviceId();
    insertMemory('mem-pending', originalId);

    const copy = cloneDatabase(original);
    activate(copy);
    const copyId = getDeviceId();

    expect(copyId).not.toBe(originalId);
    expect(memoryDeviceId('mem-pending')).toBe(copyId);
  });

  it('re-attributes the sync_state row too', () => {
    const original = freshDbPath();
    activate(original);
    const originalId = getDeviceId();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');
    writeCursor(getDb(), syncId, { deviceId: originalId, pullCursor: '2026-01-01T00:00:00.000Z' });

    const copy = cloneDatabase(original);
    activate(copy);
    const copyId = getDeviceId();

    const cursor = readCursor(getDb(), syncId);
    expect(cursor?.deviceId).toBe(copyId);
    // and the cursor itself survives — the clone does not re-pull everything
    expect(cursor?.pullCursor).toBe('2026-01-01T00:00:00.000Z');
  });

  it('warns rather than failing silently', () => {
    const original = freshDbPath();
    activate(original);
    getDeviceId();
    const copy = cloneDatabase(original);

    activate(copy);
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    try {
      getDeviceId();
    } finally {
      console.warn = realWarn;
    }

    expect(warnings.join('\n')).toMatch(/different installation/i);
  });
});

describe('getDeviceId — upgrade path', () => {
  it('keeps the id of an installation that predates fingerprinting, and adopts one', () => {
    // A database written by the shipped version has a device_id and no
    // fingerprint. Re-minting there would churn every existing install on
    // upgrade, to guess at a collision that cannot be confirmed after the
    // fact.
    const dbPath = freshDbPath();
    activate(dbPath);
    const id = getDeviceId();

    activate(dbPath);
    getDb().delete(schema.localMeta).where(eq(schema.localMeta.key, 'device_fingerprint')).run();

    activate(dbPath);
    expect(getDeviceId()).toBe(id);

    const stored = getDb().select().from(schema.localMeta).all();
    expect(stored.some((row) => row.key === 'device_fingerprint')).toBe(true);
  });
});

describe('resetDeviceId', () => {
  it('mints a new id and re-attributes local rows', () => {
    const dbPath = freshDbPath();
    activate(dbPath);
    const before = getDeviceId();
    insertMemory('mem-a', before);

    const after = resetDeviceId();

    expect(after).not.toBe(before);
    expect(getDeviceId()).toBe(after);
    expect(memoryDeviceId('mem-a')).toBe(after);
  });

  it('works on a database that has no device id yet', () => {
    const dbPath = freshDbPath();
    activate(dbPath);
    const id = resetDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
