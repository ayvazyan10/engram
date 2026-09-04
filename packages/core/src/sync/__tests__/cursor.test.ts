/**
 * Tests for cursor.ts — sync cursor bookkeeping in the local `sync_state`
 * table. Uses a temp SQLite database (real DB access, unlike conflict.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { getDb, closeDatabase } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  computeSyncId,
  migrateLegacySyncState,
  readCursor,
  writeCursor,
  pullCursorWithOverlap,
} from '../cursor.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

type SyncDb = BetterSQLite3Database<typeof schema>;

/** The pre-fix sync id: SHA-256 of the whole lowercased URL, password and all. */
function legacySyncId(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex');
}

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-cursor-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  // Set env so getDatabase() (used internally by getDb()) opens our temp path.
  process.env['ENGRAM_DB_PATH'] = dbPath;
});

afterEach(() => {
  closeDatabase();
  delete process.env['ENGRAM_DB_PATH'];
  cleanupTestDb(dbPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── computeSyncId ──────────────────────────────────────────────────────────

describe('computeSyncId', () => {
  it('is deterministic for the same URL', () => {
    const url = 'postgres://user:pass@host:5432/db';
    expect(computeSyncId(url)).toBe(computeSyncId(url));
  });

  it('normalizes surrounding whitespace and the case of scheme and host', () => {
    // Scheme and host only. This test used to assert that the WHOLE url was
    // lowercased, which quietly encoded two defects as correct: it collapsed
    // the password's case space (making the stored digest cheaper to crack,
    // back when the password was in it at all), and it merged `/DB` with
    // `/db` — two genuinely different Postgres databases — onto one cursor
    // row. Postgres compares role and database names case-sensitively.
    const a = computeSyncId('POSTGRES://user:pass@HOST:5432/db');
    const b = computeSyncId('  postgres://user:pass@host:5432/db  ');
    expect(a).toBe(b);
  });

  it('treats database name and username as case-sensitive, like Postgres does', () => {
    expect(computeSyncId('postgres://user:pass@host:5432/DB')).not.toBe(
      computeSyncId('postgres://user:pass@host:5432/db')
    );
    expect(computeSyncId('postgres://User:pass@host:5432/db')).not.toBe(
      computeSyncId('postgres://user:pass@host:5432/db')
    );
  });

  it('produces different ids for different URLs', () => {
    const a = computeSyncId('postgres://user:pass@host-a:5432/db');
    const b = computeSyncId('postgres://user:pass@host-b:5432/db');
    expect(a).not.toBe(b);
  });

  it('returns a hex-encoded SHA-256 digest', () => {
    const id = computeSyncId('postgres://user:pass@host:5432/db');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  // ─── S2: the id must not be an offline password oracle ────────────────────

  it('does not depend on the password at all', () => {
    // `sync_state.id` sits in engram.db. If the password is one of its
    // inputs and everything else is in the CLI config, the row is an
    // offline-crackable password hash for anyone who gets a copy of the
    // file (a backup, a stolen laptop).
    const a = computeSyncId('postgres://user:hunter2@host:5432/db');
    const b = computeSyncId('postgres://user:a-totally-different-secret@host:5432/db');
    const c = computeSyncId('postgres://user@host:5432/db');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('cannot be reproduced by hashing the connection string, so a guess cannot be checked', () => {
    const url = 'postgres://user:hunter2@host:5432/db';
    expect(computeSyncId(url)).not.toBe(legacySyncId(url));
  });

  it('ignores query parameters — one target reached two ways is one target', () => {
    expect(computeSyncId('postgres://user:pass@host:5432/db?sslmode=require')).toBe(
      computeSyncId('postgres://user:pass@host:5432/db?sslmode=disable')
    );
  });

  it('still strips the password from a connection string it cannot parse as a URL', () => {
    // `new URL()` rejects an out-of-range port, so this takes the fallback
    // path — which must not quietly reintroduce the oracle.
    const withSecret = 'postgres://user:hunter2@host:999999/db';
    const withOther = 'postgres://user:different-secret@host:999999/db';
    expect(computeSyncId(withSecret)).toBe(computeSyncId(withOther));
  });
});

// ─── readCursor / writeCursor ───────────────────────────────────────────────

describe('readCursor', () => {
  it('returns null for an unknown syncId', () => {
    const db = getDb();
    expect(readCursor(db, 'sha256-of-nothing')).toBeNull();
  });
});

describe('writeCursor + readCursor', () => {
  it('creates a row on first write and reads it back', () => {
    const db = getDb();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');

    writeCursor(db, syncId, {
      deviceId: 'device-aaa',
      pullCursor: '2026-01-01T00:00:00.000Z',
      lastPushAt: '2026-01-01T00:00:01.000Z',
      lastSyncAt: '2026-01-01T00:00:02.000Z',
      lastError: null,
      embeddingModel: 'text-embedding-3-small',
    });

    const cursor = readCursor(db, syncId);

    expect(cursor).not.toBeNull();
    expect(cursor?.syncId).toBe(syncId);
    expect(cursor?.deviceId).toBe('device-aaa');
    expect(cursor?.pullCursor).toBe('2026-01-01T00:00:00.000Z');
    expect(cursor?.lastPushAt).toBe('2026-01-01T00:00:01.000Z');
    expect(cursor?.lastSyncAt).toBe('2026-01-01T00:00:02.000Z');
    expect(cursor?.lastError).toBeNull();
    expect(cursor?.embeddingModel).toBe('text-embedding-3-small');
  });

  it('defaults deviceId to getDeviceId() when not provided on first write', () => {
    const db = getDb();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');

    writeCursor(db, syncId, { pullCursor: '2026-01-01T00:00:00.000Z' });

    const cursor = readCursor(db, syncId);
    expect(cursor?.deviceId).toBeTruthy();
    expect(typeof cursor?.deviceId).toBe('string');
  });

  it('a partial update does not clobber fields it did not touch', () => {
    const db = getDb();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');

    writeCursor(db, syncId, {
      deviceId: 'device-aaa',
      pullCursor: '2026-01-01T00:00:00.000Z',
      lastPushAt: '2026-01-01T00:00:01.000Z',
      lastSyncAt: '2026-01-01T00:00:02.000Z',
      lastError: 'boom',
      embeddingModel: 'text-embedding-3-small',
    });

    // Only touch pullCursor on this call.
    writeCursor(db, syncId, { pullCursor: '2026-01-05T00:00:00.000Z' });

    const cursor = readCursor(db, syncId);
    expect(cursor?.pullCursor).toBe('2026-01-05T00:00:00.000Z');
    // Everything else survives untouched.
    expect(cursor?.deviceId).toBe('device-aaa');
    expect(cursor?.lastPushAt).toBe('2026-01-01T00:00:01.000Z');
    expect(cursor?.lastSyncAt).toBe('2026-01-01T00:00:02.000Z');
    expect(cursor?.lastError).toBe('boom');
    expect(cursor?.embeddingModel).toBe('text-embedding-3-small');
  });

  it('an explicit null clears a field (distinct from omitting it)', () => {
    const db = getDb();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');

    writeCursor(db, syncId, { lastError: 'boom' });
    writeCursor(db, syncId, { lastError: null });

    const cursor = readCursor(db, syncId);
    expect(cursor?.lastError).toBeNull();
  });
});

// ─── S2: carrying a pre-fix row onto the new id ─────────────────────────────

describe('migrateLegacySyncState', () => {
  const url = 'postgres://user:pass@host:5432/db';

  /** Writes a row directly under `id`, bypassing computeSyncId. */
  function seedRow(db: SyncDb, id: string, overrides: Partial<schema.NewSyncState> = {}): void {
    db.insert(schema.syncState)
      .values({
        id,
        deviceId: 'device-legacy',
        pullCursor: '2026-01-01T00:00:00.000Z',
        lastPushAt: '2026-01-01T00:00:01.000Z',
        lastSyncAt: '2026-01-01T00:00:02.000Z',
        lastError: 'a remembered failure',
        embeddingModel: 'text-embedding-3-small',
        createdAt: '2025-12-01T00:00:00.000Z',
        ...overrides,
      })
      .run();
  }

  it('moves a row written under the old password-derived id onto the new one', () => {
    const db = getDb();
    seedRow(db, legacySyncId(url));

    migrateLegacySyncState(db, url);

    const cursor = readCursor(db, computeSyncId(url));
    expect(cursor).not.toBeNull();
    expect(cursor?.pullCursor).toBe('2026-01-01T00:00:00.000Z');
    expect(cursor?.lastPushAt).toBe('2026-01-01T00:00:01.000Z');
    expect(cursor?.deviceId).toBe('device-legacy');
    expect(cursor?.embeddingModel).toBe('text-embedding-3-small');
    expect(cursor?.lastError).toBe('a remembered failure');
    // The old row is retired, so this can never run twice.
    expect(readCursor(db, legacySyncId(url))).toBeNull();
  });

  it('is idempotent and a no-op when there is nothing to migrate', () => {
    const db = getDb();
    migrateLegacySyncState(db, url);
    migrateLegacySyncState(db, url);
    expect(readCursor(db, computeSyncId(url))).toBeNull();
  });

  it('never overwrites a row that already exists under the new id', () => {
    const db = getDb();
    seedRow(db, legacySyncId(url), { pullCursor: '2020-01-01T00:00:00.000Z' });
    seedRow(db, computeSyncId(url), { pullCursor: '2026-06-01T00:00:00.000Z' });

    migrateLegacySyncState(db, url);

    expect(readCursor(db, computeSyncId(url))?.pullCursor).toBe('2026-06-01T00:00:00.000Z');
    expect(readCursor(db, legacySyncId(url))).toBeNull();
  });
});

// ─── S9: writeCursor must not lose a concurrent writer's field ──────────────

describe('writeCursor concurrency', () => {
  it('does not clobber a field another connection wrote between our read and our write', () => {
    const db = getDb();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');
    writeCursor(db, syncId, {
      deviceId: 'device-aaa',
      pullCursor: '2026-01-01T00:00:00.000Z',
      lastPushAt: '2026-01-01T00:00:01.000Z',
    });

    // A genuinely separate connection to the same file, standing in for the
    // MCP server's auto-sync racing an `engram cloud sync` invocation.
    const other = new Database(dbPath);
    other.pragma('busy_timeout = 5000');
    const otherDb = drizzle(other, { schema }) as SyncDb;

    // Fire the interfering write at the moment our writeCursor is about to
    // issue its INSERT — i.e. after any read it might have done. A
    // read-modify-write loses the interfering value here; a single statement
    // that names only the columns it was asked to touch cannot.
    let interfered = false;
    const interposed = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          return (...args: unknown[]) => {
            if (!interfered) {
              interfered = true;
              writeCursor(otherDb, syncId, { lastPushAt: '2026-02-02T00:00:00.000Z' });
            }
            return (target.insert as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as SyncDb;

    try {
      writeCursor(interposed, syncId, { pullCursor: '2026-03-03T00:00:00.000Z' });

      const cursor = readCursor(db, syncId);
      expect(cursor?.pullCursor).toBe('2026-03-03T00:00:00.000Z');
      expect(cursor?.lastPushAt).toBe('2026-02-02T00:00:00.000Z');
      expect(cursor?.deviceId).toBe('device-aaa');
    } finally {
      other.close();
    }
  });

  it('an update to one field leaves the row createdAt untouched', () => {
    const db = getDb();
    const syncId = computeSyncId('postgres://user:pass@host:5432/db');
    writeCursor(db, syncId, { pullCursor: '2026-01-01T00:00:00.000Z' });
    const created = db.select().from(schema.syncState).all()[0]?.createdAt;

    writeCursor(db, syncId, { lastSyncAt: '2026-05-05T00:00:00.000Z' });

    expect(db.select().from(schema.syncState).all()[0]?.createdAt).toBe(created);
  });
});

// ─── pullCursorWithOverlap ──────────────────────────────────────────────────

describe('pullCursorWithOverlap', () => {
  it('returns null when the cursor is null (first sync)', () => {
    expect(pullCursorWithOverlap(null)).toBeNull();
  });

  it('subtracts 5 minutes from a valid timestamp', () => {
    const result = pullCursorWithOverlap('2026-01-01T00:10:00.000Z');
    expect(result).toBe('2026-01-01T00:05:00.000Z');
  });

  it('handles a timestamp near midnight/date boundaries correctly', () => {
    const result = pullCursorWithOverlap('2026-01-01T00:02:00.000Z');
    expect(result).toBe('2025-12-31T23:57:00.000Z');
  });
});
