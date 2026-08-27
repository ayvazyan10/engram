/**
 * Tests for cursor.ts — sync cursor bookkeeping in the local `sync_state`
 * table. Uses a temp SQLite database (real DB access, unlike conflict.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getDb, closeDatabase } from '../../db/index.js';
import { computeSyncId, readCursor, writeCursor, pullCursorWithOverlap } from '../cursor.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

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

  it('normalizes case and surrounding whitespace', () => {
    const a = computeSyncId('postgres://User:Pass@Host:5432/DB');
    const b = computeSyncId('  postgres://user:pass@host:5432/db  ');
    expect(a).toBe(b);
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
