/**
 * Tests for the Claude Code auto-memory helpers used by `engram setup`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  ConfigParseError,
  backupPathFor,
  readJson,
  readJsonOrEmpty,
  registerHook,
  renderHook,
  installHookScript,
  updateJsonConfig,
  writeJsonConfig,
  CLAUDE_HOOKS,
} from '../claudeSetup.js';

describe('renderHook', () => {
  it('replaces every API-base placeholder', () => {
    const out = renderHook('a __API_BASE__ b __API_BASE__ c', 'http://localhost:4901');
    expect(out).toBe('a http://localhost:4901 b http://localhost:4901 c');
    expect(out).not.toContain('__API_BASE__');
  });

  it('leaves a template without the placeholder unchanged', () => {
    expect(renderHook('#!/bin/bash\necho hi', 'http://x')).toBe('#!/bin/bash\necho hi');
  });
});

describe('registerHook', () => {
  it('adds a hook for an event', () => {
    const s: Record<string, unknown> = {};
    registerHook(s, 'UserPromptSubmit', '/a/engram-recall.sh', 8);
    const entries = (s as any).hooks.UserPromptSubmit;
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks[0]).toMatchObject({ type: 'command', command: '/a/engram-recall.sh', timeout: 8 });
  });

  it('is idempotent across repeated runs', () => {
    const s: Record<string, unknown> = {};
    for (let i = 0; i < 3; i++) registerHook(s, 'SessionEnd', '/a/engram-session-end.sh', 15);
    expect((s as any).hooks.SessionEnd).toHaveLength(1);
  });

  it('dedupes by script basename, not exact path (never fires twice)', () => {
    const s: Record<string, unknown> = {};
    registerHook(s, 'UserPromptSubmit', '/home/.engram/hooks/engram-recall.sh', 8);
    // Same script under a different directory must not be added again.
    registerHook(s, 'UserPromptSubmit', '/home/.claude/hooks/engram-recall.sh', 8);
    expect((s as any).hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('preserves unrelated existing hooks for the same event', () => {
    const s: Record<string, any> = {
      hooks: { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: '/other/thing.sh' }] }] },
    };
    registerHook(s, 'UserPromptSubmit', '/a/engram-recall.sh', 8);
    expect(s.hooks.UserPromptSubmit).toHaveLength(2);
  });
});

/**
 * ~/.claude.json is Claude Code's PRIMARY state file: oauthAccount, userID,
 * and every project's trust state and history — 86 KB of it on a working
 * machine. `engram setup` read it with a `readJson` that answered {} for
 * anything it could not parse, merged its one key into that {}, and wrote the
 * result back. One torn read during a concurrent Claude Code write (it rewrites
 * that file constantly), one BOM, one truncated line, and the user was logged
 * out with every project untrusted, with no backup anywhere.
 *
 * The rule these tests pin: never write over a file whose current contents we
 * failed to parse. "Absent" is safe to create; "present but unparseable" is
 * not ours to replace.
 */
describe('readJson', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-readjson-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns {} for a missing file — nothing exists to destroy', () => {
    expect(readJson(path.join(dir, 'nope.json'))).toEqual({});
  });

  it('REFUSES a corrupt file instead of reporting it as empty', () => {
    const f = path.join(dir, 'bad.json');
    fs.writeFileSync(f, '{ not json');
    expect(() => readJson(f)).toThrow(ConfigParseError);
  });

  it('names the offending file, because the user has to go fix that one', () => {
    const f = path.join(dir, 'bad.json');
    fs.writeFileSync(f, '{ "mcpServers": ');
    try {
      readJson(f);
      expect.unreachable('readJson must not accept a truncated file');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigParseError);
      expect((err as ConfigParseError).file).toBe(f);
      expect((err as Error).message).toContain(f);
    }
  });

  it('refuses a file whose top level is not an object', () => {
    const f = path.join(dir, 'array.json');
    fs.writeFileSync(f, '[1, 2, 3]');
    expect(() => readJson(f)).toThrow(ConfigParseError);
  });

  it('reads a file that only carries a UTF-8 BOM — the bytes are all still there', () => {
    const f = path.join(dir, 'bom.json');
    fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ userID: 'u1' }));
    expect(readJson(f)).toEqual({ userID: 'u1' });
  });

  it('treats a zero-byte file as empty — there is nothing in it to lose', () => {
    const f = path.join(dir, 'empty.json');
    fs.writeFileSync(f, '');
    expect(readJson(f)).toEqual({});
  });

  it('parses a valid file', () => {
    const f = path.join(dir, 'ok.json');
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { engram: { command: 'node' } } }));
    expect(readJson(f).mcpServers.engram.command).toBe('node');
  });
});

describe('readJsonOrEmpty', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-readjson-lenient-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('answers {} for a corrupt file, for read-only inspection like `engram doctor`', () => {
    const f = path.join(dir, 'bad.json');
    fs.writeFileSync(f, '{ not json');
    expect(readJsonOrEmpty(f)).toEqual({});
  });

  it('parses a valid file the same way', () => {
    const f = path.join(dir, 'ok.json');
    fs.writeFileSync(f, JSON.stringify({ a: 1 }));
    expect(readJsonOrEmpty(f)).toEqual({ a: 1 });
  });
});

describe('backupPathFor', () => {
  const when = new Date('2026-09-04T07:08:09.123Z');

  it('stamps the backup with a sortable timestamp', () => {
    expect(backupPathFor('/home/me/.claude.json', when, () => false)).toBe('/home/me/.claude.json.20260904T070809Z.bak');
  });

  it('never overwrites a backup that already exists', () => {
    const taken = new Set(['/home/me/.claude.json.20260904T070809Z.bak']);
    expect(backupPathFor('/home/me/.claude.json', when, (p) => taken.has(p))).toBe(
      '/home/me/.claude.json.20260904T070809Z-2.bak',
    );
  });
});

describe('writeJsonConfig', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-writejson-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates a new file, with no backup to make', () => {
    const f = path.join(dir, 'new.json');
    expect(writeJsonConfig(f, { a: 1 })).toBeNull();
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ a: 1 });
  });

  it('backs up the previous contents byte-for-byte before replacing them', () => {
    const f = path.join(dir, 'existing.json');
    const before = JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' }, projects: { '/x': {} } }, null, 2);
    fs.writeFileSync(f, before);

    const backup = writeJsonConfig(f, { replaced: true });

    expect(backup).not.toBeNull();
    expect(fs.readFileSync(backup!, 'utf8')).toBe(before);
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ replaced: true });
  });

  it('creates the parent directory when it does not exist yet', () => {
    const f = path.join(dir, 'nested', 'deep', 'settings.json');
    writeJsonConfig(f, { hooks: {} });
    expect(fs.existsSync(f)).toBe(true);
  });

  it('leaves no temp files behind — a rename is the only thing the user sees', () => {
    const f = path.join(dir, 'atomic.json');
    writeJsonConfig(f, { a: 1 });
    writeJsonConfig(f, { a: 2 });
    const stray = fs.readdirSync(dir).filter((e) => e.includes('.tmp'));
    expect(stray).toEqual([]);
  });

  it('keeps the permissions the file already had', () => {
    const f = path.join(dir, 'perms.json');
    fs.writeFileSync(f, '{}');
    fs.chmodSync(f, 0o600);
    writeJsonConfig(f, { a: 1 });
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe('updateJsonConfig', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-updatejson-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('merges into an existing config and keeps everything else', () => {
    const f = path.join(dir, 'claude.json');
    fs.writeFileSync(f, JSON.stringify({ userID: 'u1', mcpServers: { other: { command: 'x' } } }));

    updateJsonConfig(f, (current) => ({
      ...current,
      mcpServers: { ...(current.mcpServers as Record<string, unknown>), engram: { command: 'node' } },
    }));

    const after = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(after.userID).toBe('u1');
    expect(after.mcpServers.other.command).toBe('x');
    expect(after.mcpServers.engram.command).toBe('node');
  });

  it('LEAVES A CORRUPT FILE EXACTLY AS IT FOUND IT — the whole point', () => {
    const f = path.join(dir, 'claude.json');
    // A torn read of a file Claude Code was midway through rewriting.
    const corrupt = '{"oauthAccount":{"emailAddress":"me@example.com"},"projects":{"/x":{"allowed';
    fs.writeFileSync(f, corrupt);

    expect(() => updateJsonConfig(f, (current) => ({ ...current, mcpServers: {} }))).toThrow(ConfigParseError);

    expect(fs.readFileSync(f, 'utf8')).toBe(corrupt);
    expect(fs.readdirSync(dir)).toEqual(['claude.json']);
  });

  it('creates the file when it is simply absent', () => {
    const f = path.join(dir, 'fresh.json');
    updateJsonConfig(f, (current) => ({ ...current, mcpServers: { engram: {} } }));
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ mcpServers: { engram: {} } });
  });

  it('does not mutate the object it handed the caller', () => {
    const f = path.join(dir, 'immutable.json');
    fs.writeFileSync(f, JSON.stringify({ a: 1 }));
    let seen: Record<string, unknown> | null = null;
    updateJsonConfig(f, (current) => { seen = current; return { ...current, b: 2 }; });
    expect(seen).toEqual({ a: 1 });
  });
});

describe('installHookScript', () => {
  let dir: string;
  let templateDir: string;
  let hooksDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-hookinstall-'));
    templateDir = path.join(dir, 'templates');
    hooksDir = path.join(dir, 'hooks');
    fs.mkdirSync(templateDir);
    fs.writeFileSync(path.join(templateDir, 'engram-recall.sh'), '#!/bin/bash\nAPI="__API_BASE__"\n');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes an executable, placeholder-substituted copy into hooksDir', () => {
    const dest = installHookScript(templateDir, hooksDir, 'engram-recall.sh', 'http://localhost:4901');
    expect(dest).toBe(path.join(hooksDir, 'engram-recall.sh'));
    const body = fs.readFileSync(dest, 'utf8');
    expect(body).toContain('API="http://localhost:4901"');
    expect(body).not.toContain('__API_BASE__');
    // Executable bit set for the owner.
    expect(fs.statSync(dest).mode & 0o100).toBe(0o100);
  });

  it('creates hooksDir if it does not exist', () => {
    expect(fs.existsSync(hooksDir)).toBe(false);
    installHookScript(templateDir, hooksDir, 'engram-recall.sh', 'http://x');
    expect(fs.existsSync(hooksDir)).toBe(true);
  });
});

describe('CLAUDE_HOOKS manifest', () => {
  it('covers both the recall and session-end events', () => {
    const events = CLAUDE_HOOKS.map((h) => h.event);
    expect(events).toContain('UserPromptSubmit');
    expect(events).toContain('SessionEnd');
    for (const h of CLAUDE_HOOKS) expect(h.file).toMatch(/^engram-.*\.sh$/);
  });
});
