/**
 * The session-summary writer must land in the namespace the user configured.
 *
 * `store-session` read only ENGRAM_SOURCE and the database path, so it always
 * wrote with `namespace: null` and built the non-namespaced index beside the
 * isolated one. With ENGRAM_NAMESPACE_MODE=isolated ENGRAM_NAMESPACE=work the
 * summary written by scripts/claude-code-hook.sh was invisible to the isolated
 * brain and visible to every other namespace — the opposite of isolation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NeuralBrain } from '@engram-ai-memory/core';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import { resolveDbPath, readContent, storeSession } from '../store-session.js';

const dbs: string[] = [];

function tempDb(name: string): string {
  const dbPath = path.join(os.tmpdir(), `engram-session-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  dbs.push(dbPath);
  return dbPath;
}

afterEach(() => {
  for (const db of dbs.splice(0)) cleanupTestDb(db);
});

/** Search a namespaced view of the same database file. */
async function searchAs(
  dbPath: string,
  namespaceMode: 'none' | 'filter' | 'isolated',
  namespace: string | undefined,
  query: string,
): Promise<string[]> {
  const brain = new NeuralBrain({ dbPath, namespaceMode, ...(namespace ? { namespace } : {}) });
  await brain.initialize();
  try {
    const results = await brain.search(query, { topK: 20, threshold: 0.1 });
    return results.map((m) => m.content);
  } finally {
    brain.shutdown();
  }
}

describe('resolveDbPath', () => {
  it('passes a configured path through byte-for-byte', () => {
    expect(resolveDbPath('/tmp/somewhere/engram.db')).toBe('/tmp/somewhere/engram.db');
  });

  it('treats blank as unset — an empty string is a temp database that is deleted on close', () => {
    expect(resolveDbPath('', '/home/tester')).toBe(path.join('/home/tester', '.engram', 'engram.db'));
    expect(resolveDbPath('   ', '/home/tester')).toBe(path.join('/home/tester', '.engram', 'engram.db'));
    expect(resolveDbPath(undefined, '/home/tester')).toBe(path.join('/home/tester', '.engram', 'engram.db'));
  });
});

describe('readContent', () => {
  it('prefers the command line, joined so a multi-word summary survives', async () => {
    const content = await readContent(['node', 'store-session.js', 'a', 'session', 'summary'], emptyStdin());
    expect(content).toBe('a session summary');
  });

  it('falls back to stdin when no argument was given', async () => {
    const content = await readContent(['node', 'store-session.js'], stdinOf('  piped summary text  '));
    expect(content).toBe('piped summary text');
  });
});

async function* emptyStdin(): AsyncIterable<Buffer> {
  // nothing piped
}

async function* stdinOf(text: string): AsyncIterable<Buffer> {
  yield Buffer.from(text, 'utf8');
}

describe('storeSession in isolated mode', () => {
  it('writes into the configured namespace, where the isolated brain can see it', async () => {
    const dbPath = tempDb('isolated');
    await storeSession('Refactored the sync engine and fixed the pull cursor', {
      ENGRAM_DB_PATH: dbPath,
      ENGRAM_NAMESPACE_MODE: 'isolated',
      ENGRAM_NAMESPACE: 'work',
    });

    const visible = await searchAs(dbPath, 'isolated', 'work', 'sync engine pull cursor');
    expect(visible.join('\n')).toContain('Refactored the sync engine');
  });

  it('does not leak the summary into a different isolated namespace', async () => {
    const dbPath = tempDb('leak');
    await storeSession('Private notes about the work namespace only', {
      ENGRAM_DB_PATH: dbPath,
      ENGRAM_NAMESPACE_MODE: 'isolated',
      ENGRAM_NAMESPACE: 'work',
    });

    const other = await searchAs(dbPath, 'isolated', 'personal', 'private notes work namespace');
    expect(other.join('\n')).not.toContain('Private notes about the work namespace');
  });

  it('still works with no namespace configured at all', async () => {
    const dbPath = tempDb('plain');
    await storeSession('A plain session summary with no namespace', { ENGRAM_DB_PATH: dbPath });

    const visible = await searchAs(dbPath, 'none', undefined, 'plain session summary');
    expect(visible.join('\n')).toContain('A plain session summary');
  });

  it('creates the database directory rather than failing on SQLITE_CANTOPEN', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-session-dir-'));
    const dbPath = path.join(dir, 'nested', 'deeper', 'engram.db');
    dbs.push(dbPath);

    await storeSession('A summary stored under a directory that did not exist', { ENGRAM_DB_PATH: dbPath });
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('refuses an invalid namespace mode instead of silently writing to none', async () => {
    await expect(
      storeSession('A summary that must not be stored under a bogus mode', {
        ENGRAM_DB_PATH: tempDb('bogus'),
        ENGRAM_NAMESPACE_MODE: 'nonsense',
      }),
    ).rejects.toThrow(/ENGRAM_NAMESPACE_MODE/);
  });
});
