/**
 * Where the server puts the database when the host gave it no path.
 *
 * The Claude Desktop extension templates `ENGRAM_DB_PATH` from an optional
 * `db_path` field whose default is `""`, and whose description tells the user
 * "Leave empty to use the default (~/.engram/engram.db)". An empty string is
 * not "unset" to better-sqlite3 — it is an ANONYMOUS TEMPORARY DATABASE that
 * is deleted when the connection closes. So `store_memory` answered "Memory
 * stored successfully", the process exited, and every memory was gone with no
 * .db file ever created.
 *
 * These tests pin both halves: blank means "not configured", and the default
 * the manifest advertises is the default the server actually uses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** A throwaway home, so importing the server cannot touch the real ~/.engram. */
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-dbpath-home-'));
const realHome = process.env['HOME'];
const realDbPath = process.env['ENGRAM_DB_PATH'];

type ServerModule = typeof import('../server.js');
let mod: ServerModule;

beforeAll(async () => {
  process.env['HOME'] = fakeHome;
  // Exactly what the extension passes for an untouched optional field.
  process.env['ENGRAM_DB_PATH'] = '';
  mod = await import('../server.js');
});

afterAll(() => {
  if (realHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = realHome;
  if (realDbPath === undefined) delete process.env['ENGRAM_DB_PATH'];
  else process.env['ENGRAM_DB_PATH'] = realDbPath;
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('resolveDbPath', () => {
  const home = '/home/tester';
  const documentedDefault = path.join(home, '.engram', 'engram.db');

  it('treats an empty string as "not configured" — the extension sends one for an untouched field', () => {
    expect(mod.resolveDbPath('', home)).toBe(documentedDefault);
  });

  it('treats a whitespace-only value as "not configured"', () => {
    expect(mod.resolveDbPath('   ', home)).toBe(documentedDefault);
    expect(mod.resolveDbPath('\n', home)).toBe(documentedDefault);
  });

  it('treats an absent variable as "not configured"', () => {
    expect(mod.resolveDbPath(undefined, home)).toBe(documentedDefault);
  });

  it('uses the default the manifest promises, not the process working directory', () => {
    // Under Claude Desktop the cwd belongs to the app, not the user, so
    // cwd/engram.db is a path nobody can find and nobody chose.
    expect(mod.resolveDbPath('', home)).not.toContain(process.cwd());
    expect(mod.resolveDbPath('', home)).toBe(documentedDefault);
  });

  it('never returns a blank path, which better-sqlite3 reads as a temp database', () => {
    for (const raw of ['', '   ', undefined]) {
      expect(mod.resolveDbPath(raw, home).length).toBeGreaterThan(0);
    }
  });

  it('passes a configured path through untouched', () => {
    expect(mod.resolveDbPath('/var/data/engram.db', home)).toBe('/var/data/engram.db');
  });

  it('defaults to the real home directory when none is given', () => {
    expect(mod.resolveDbPath('')).toBe(path.join(os.homedir(), '.engram', 'engram.db'));
  });
});

describe('server startup with a blank ENGRAM_DB_PATH', () => {
  it('normalises the variable so no core code path can inherit the blank', () => {
    // Everything downstream (getDeviceId, a second getDatabase call, the sync
    // engine) reads this variable directly. Leaving '' in it hands each of
    // them the same anonymous-temp-database trap.
    const resolved = process.env['ENGRAM_DB_PATH'];
    expect(resolved).toBeTruthy();
    expect(resolved).toBe(path.join(fakeHome, '.engram', 'engram.db'));
  });

  it('creates the directory the database will live in', () => {
    // better-sqlite3 does not create it, and a missing parent surfaces as a
    // bare SQLITE_CANTOPEN with no path in the message.
    expect(fs.existsSync(path.join(fakeHome, '.engram'))).toBe(true);
  });
});
