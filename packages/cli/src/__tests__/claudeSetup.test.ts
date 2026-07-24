/**
 * Tests for the Claude Code auto-memory helpers used by `engram setup`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { readJson, renderHook, installHookScript, registerHook, CLAUDE_HOOKS } from '../claudeSetup.js';

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

describe('readJson', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-readjson-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns {} for a missing file', () => {
    expect(readJson(path.join(dir, 'nope.json'))).toEqual({});
  });

  it('returns {} for a corrupt file rather than throwing', () => {
    const f = path.join(dir, 'bad.json');
    fs.writeFileSync(f, '{ not json');
    expect(readJson(f)).toEqual({});
  });

  it('parses a valid file', () => {
    const f = path.join(dir, 'ok.json');
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { engram: { command: 'node' } } }));
    expect(readJson(f).mcpServers.engram.command).toBe('node');
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
