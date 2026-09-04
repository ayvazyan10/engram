/**
 * `ENGRAM_API_KEY=""` must not silently disable authentication.
 *
 * The gate was `if (API_KEY)`, which is false for the empty string — exactly
 * what a host templating an unset optional field passes. Every config file and
 * dashboard would still say a key was configured while the API was wide open.
 * The same empty-string-templating class was already fixed for
 * ENGRAM_NAMESPACE_MODE and for the MCP database path; here the safe reading is
 * the opposite one, because "auth wanted, value lost" is not a state to guess
 * at. Unset still means no auth — the local-first default is untouched.
 *
 * Its own file: the check runs at module scope, so it needs an import that is
 * expected to fail, in a registry no other suite shares.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.tmpdir(), `engram-api-key-empty-${process.pid}.db`);

afterEach(() => {
  delete process.env['ENGRAM_API_KEY'];
  vi.resetModules();
});

describe('ENGRAM_API_KEY set to an empty value', () => {
  it('refuses to start rather than running unauthenticated', async () => {
    vi.resetModules();
    process.env['ENGRAM_DB_PATH'] = dbPath;
    process.env['ENGRAM_DECAY_INTERVAL'] = '0';
    process.env['ENGRAM_API_KEY'] = '';

    await expect(import('../index.js')).rejects.toThrow(/ENGRAM_API_KEY is set but empty/);
  });

  it('refuses a whitespace-only value too', async () => {
    vi.resetModules();
    process.env['ENGRAM_DB_PATH'] = dbPath;
    process.env['ENGRAM_API_KEY'] = '   ';

    await expect(import('../index.js')).rejects.toThrow(/ENGRAM_API_KEY is set but empty/);
  });
});
