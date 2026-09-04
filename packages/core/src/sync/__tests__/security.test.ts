/**
 * Phase 4 security tests for cloud sync — verifies that a Postgres sync
 * password never leaks into thrown errors, `SyncEngine.status().lastError`,
 * or the redaction helpers in `db/pg/connection.ts`.
 *
 * The `redactSyncUrl` / `validateSyncUrl` unit tests here don't need a real
 * database and always run. The `SyncEngine` tests do need one (a wrong
 * password is only meaningful against a real server) and follow the same
 * `describeWithPg` availability guard as `sync-engine.test.ts`.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` (section 5, Phase 4).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getDb, closeDatabase } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { _resetMemoizedDeviceIdForTests } from '../deviceId.js';
import { SyncEngine } from '../SyncEngine.js';
import { redactSyncUrl, validateSyncUrl } from '../../db/pg/connection.js';

// ─── availability guard (same as sync-engine.test.ts) ──────────────────────

const PG_URL =
  process.env['TEST_PG_URL'] ??
  'postgres://postgres:engram_test_pass@localhost:5432/engram_sync_test?sslmode=disable';
const SKIP_REQUESTED = Boolean(process.env['SKIP_PG_TESTS']);

let pgAvailable = false;
try {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: PG_URL, connectionTimeoutMillis: 3000 });
  await pool.query('SELECT 1');
  await pool.end();
  pgAvailable = true;
} catch {
  // unavailable — describeWithPg below skips the whole suite
}

const shouldRun = !SKIP_REQUESTED && pgAvailable;
const describeWithPg = shouldRun ? describe : describe.skip;

if (!shouldRun) {
  console.info(
    `[security.test.ts] skipping PG-dependent tests: ${
      SKIP_REQUESTED ? 'SKIP_PG_TESTS is set' : `PostgreSQL is unavailable at ${PG_URL}`
    }`
  );
}

// ─── unit tests: redactSyncUrl (no PG needed) ──────────────────────────────

describe('redactSyncUrl', () => {
  it('replaces password with ***', () => {
    const url = 'postgres://user:mysecret123@host:5432/db?sslmode=require';
    const redacted = redactSyncUrl(url);
    expect(redacted).not.toContain('mysecret123');
    expect(redacted).toContain('***');
  });

  it('handles URL-encoded passwords', () => {
    const url = 'postgres://user:p%40ss%23word@host:5432/db';
    const redacted = redactSyncUrl(url);
    expect(redacted).not.toContain('p%40ss%23word');
    expect(redacted).not.toContain('p@ss#word');
  });

  it('returns placeholder for unparseable strings', () => {
    expect(redactSyncUrl('not-a-url')).toBe('<unparseable-connection-string>');
  });

  it('handles no-password URLs gracefully', () => {
    const url = 'postgres://user@host:5432/db';
    const redacted = redactSyncUrl(url);
    expect(redacted).toContain('user');
    expect(redacted).toContain('host');
  });
});

// ─── unit tests: validateSyncUrl TLS enforcement (no PG needed) ────────────

describe('validateSyncUrl TLS enforcement', () => {
  const savedEnv = process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = savedEnv;
    } else {
      delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    }
  });

  it('rejects URLs without sslmode=require', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() => validateSyncUrl('postgres://user:pass@host:5432/db')).toThrow(/sslmode/i);
  });

  it('rejects sslmode=disable without the escape hatch', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() => validateSyncUrl('postgres://user:pass@host:5432/db?sslmode=disable')).toThrow(/sslmode/i);
  });

  it('accepts sslmode=require', () => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
    expect(() => validateSyncUrl('postgres://user:pass@host:5432/db?sslmode=require')).not.toThrow();
  });

  it('allows unencrypted when ENGRAM_SYNC_ALLOW_UNENCRYPTED=true', () => {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
    expect(() => validateSyncUrl('postgres://user:pass@host:5432/db?sslmode=disable')).not.toThrow();
  });
});

// ─── integration tests: SyncEngine password redaction (needs PG) ──────────

describeWithPg('SyncEngine — password redaction (Phase 4)', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
  });

  afterAll(() => {
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
  });

  afterEach(() => {
    closeDatabase();
    delete process.env['ENGRAM_DB_PATH'];
    _resetMemoizedDeviceIdForTests();
    if (dbPath) {
      cleanupTestDb(dbPath);
    }
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function activateFreshDevice(): void {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-sync-security-test-'));
    dbPath = path.join(dir, 'test.db');
    closeDatabase();
    process.env['ENGRAM_DB_PATH'] = dbPath;
    _resetMemoizedDeviceIdForTests();
    getDb();
  }

  it('does not leak the raw password in a sync() error thrown for a wrong password', async () => {
    activateFreshDevice();
    const secretPassword = 'SUPER_SECRET_p4ssw0rd';
    const badUrl = `postgres://postgres:${secretPassword}@localhost:5432/engram_sync_test?sslmode=disable`;

    const engine = new SyncEngine({ syncUrl: badUrl, mode: 'manual' });
    try {
      await engine.sync();
      throw new Error('expected engine.sync() to reject on a wrong password');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(secretPassword);

      const status = engine.status();
      expect(status.lastError).not.toBeNull();
      expect(status.lastError).not.toContain(secretPassword);
    } finally {
      await engine.dispose();
    }
  });

  it('status().lastError does not contain the raw password after a failed sync', async () => {
    activateFreshDevice();
    const secretPassword = `LEAK_TEST_${Date.now()}`;
    const badUrl = `postgres://postgres:${secretPassword}@localhost:5432/engram_sync_test?sslmode=disable`;

    const engine = new SyncEngine({ syncUrl: badUrl, mode: 'manual' });
    try {
      await engine.sync();
    } catch {
      // expected — wrong password
    }

    const status = engine.status();
    await engine.dispose();

    expect(status.lastError).not.toContain(secretPassword);
  });
});
