/**
 * Regression: an empty ENGRAM_NAMESPACE_MODE must be treated as unset.
 *
 * The variable was read with `??`, which only falls back when the variable is
 * absent. Hosts that template an untouched optional config field — the Claude
 * Desktop extension among them — pass an empty string instead of omitting it,
 * so the module-level validation threw and the server never started.
 *
 * The env vars are set before importing ../index.js because the brain
 * singleton reads them at construction time; the import itself is the
 * regression, so this file must not share a module registry with other suites.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.tmpdir(), `engram-empty-mode-test-${process.pid}.db`);

let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  process.env['ENGRAM_NAMESPACE_MODE'] = '';
  process.env['ENGRAM_NAMESPACE'] = '';

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
});

afterAll(async () => {
  try { brain?.shutdown(); } catch { /* best effort */ }
  delete process.env['ENGRAM_NAMESPACE_MODE'];
  delete process.env['ENGRAM_NAMESPACE'];
  for (const suffix of ['', '-shm', '-wal', '-journal', '.index']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
});

describe('empty ENGRAM_NAMESPACE_MODE', () => {
  it('starts in none mode instead of aborting', () => {
    expect(brain.getNamespaceMode()).toBe('none');
    expect(brain.getNamespace()).toBeUndefined();
  });

  it('stores into the shared pool', async () => {
    const { memory } = await brain.store({ content: 'Memory stored with an empty namespace mode' });
    expect(memory.namespace).toBeNull();
  });
});
