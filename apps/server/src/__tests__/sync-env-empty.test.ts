/**
 * The REST server refuses to start on a sync configuration it cannot act on.
 *
 * Three variables, one root cause — an environment value read without checking
 * what came back:
 *
 *   ENGRAM_SYNC_ENCRYPTION_KEY=""  `''` is falsy, so SyncEngine's
 *     `if (!encryptionKey)` read it as "no encryption configured" and pushed
 *     the whole store in the clear, while the config that set the variable
 *     still said encryption was on. This is the inverse of the rule
 *     ENGRAM_API_KEY adopted, where empty aborts rather than being guessed at;
 *     for a security control, "wanted, value lost" is not a state to interpret.
 *
 *   ENGRAM_SYNC_INTERVAL=abc  `parseInt` gives NaN, `NaN ?? default` keeps the
 *     NaN because NaN is not nullish, and `setInterval(NaN)` degenerates into a
 *     timer firing about every millisecond — a loop against the user's own
 *     Postgres. The MCP server already threw on this exact input.
 *
 *   ENGRAM_SYNC_MODE=Auto  cast with `as`, so an unrecognised value reached
 *     SyncEngine intact and `mode !== 'auto'` turned the scheduler off: a typo
 *     silently disabled sync.
 *
 * Its own file: the checks run at module scope, so each case needs an import
 * that is expected to fail, in a registry no other suite shares.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.tmpdir(), `engram-sync-env-empty-${process.pid}.db`);

const SYNC_VARS = [
  'ENGRAM_SYNC_ENCRYPTION_KEY',
  'ENGRAM_SYNC_INTERVAL',
  'ENGRAM_SYNC_MODE',
  'ENGRAM_SYNC_URL',
] as const;

afterEach(() => {
  for (const name of SYNC_VARS) delete process.env[name];
  vi.resetModules();
});

/** Import the server module afresh with the given sync environment applied. */
function importServerWith(env: Partial<Record<(typeof SYNC_VARS)[number], string>>): Promise<unknown> {
  vi.resetModules();
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  return import('../index.js');
}

describe('ENGRAM_SYNC_ENCRYPTION_KEY set to an empty value', () => {
  it('refuses to start rather than syncing in plaintext', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_ENCRYPTION_KEY: '' })).rejects.toThrow(
      /ENGRAM_SYNC_ENCRYPTION_KEY is set but empty/
    );
  });

  it('refuses a whitespace-only value too', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_ENCRYPTION_KEY: '   ' })).rejects.toThrow(
      /ENGRAM_SYNC_ENCRYPTION_KEY is set but empty/
    );
  });

  it('says what unsetting it would mean, so the message is actionable', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_ENCRYPTION_KEY: '' })).rejects.toThrow(
      /Unset it to sync without end-to-end encryption/
    );
  });
});

describe('ENGRAM_SYNC_INTERVAL', () => {
  it('refuses a value parseInt would have turned into NaN', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_INTERVAL: 'abc' })).rejects.toThrow(
      /ENGRAM_SYNC_INTERVAL must be a number/
    );
  });

  it('refuses a value parseInt would have silently truncated', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_INTERVAL: '30s' })).rejects.toThrow(
      /ENGRAM_SYNC_INTERVAL must be a number/
    );
  });

  it('refuses zero and negatives — both schedule a timer that never rests', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_INTERVAL: '0' })).rejects.toThrow(
      /ENGRAM_SYNC_INTERVAL must be at least 1/
    );
    await expect(importServerWith({ ENGRAM_SYNC_INTERVAL: '-5' })).rejects.toThrow(
      /ENGRAM_SYNC_INTERVAL must be at least 1/
    );
  });
});

describe('ENGRAM_SYNC_MODE', () => {
  it('refuses an unrecognised mode instead of disabling the scheduler', async () => {
    await expect(importServerWith({ ENGRAM_SYNC_MODE: 'Auto' })).rejects.toThrow(
      /ENGRAM_SYNC_MODE must be one of: auto, manual, off/
    );
  });

  it('still treats a blank mode as unset, so a templated field does not abort startup', async () => {
    // No ENGRAM_SYNC_URL, so no SyncEngine is constructed — the point is only
    // that module evaluation survives a blank value.
    await expect(importServerWith({ ENGRAM_SYNC_MODE: '' })).resolves.toBeDefined();
  });
});
