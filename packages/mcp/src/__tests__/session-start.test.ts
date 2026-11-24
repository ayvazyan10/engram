import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { buildRecallQuery, runSessionStart } from '../session-start.ts';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  findMany: vi.fn(),
  versionNotice: vi.fn(),
  closeDb: vi.fn(),
  mkdir: vi.fn(),
  git: vi.fn(),
  getByTag: vi.fn(),
  getContradictionTasks: vi.fn(),
}));

const hit = {
  id: '12345678-abcd', type: 'semantic', source: 'mcp-client', tags: '[]',
  score: 0.62, importance: 0.8, summary: null, content: 'Past project decisions.',
  createdAt: '2026-11-21T12:00:00Z',
} as const;
const decisionLine = '[12345678 · 2026-11-21 · mcp-client] Past project decisions.';

vi.mock('../versionNotice.ts', () => ({ versionNotice: mocks.versionNotice }));
vi.mock('node:fs', () => ({ mkdirSync: mocks.mkdir }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.git }));
vi.mock('@engram-ai-memory/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@engram-ai-memory/core')>(),
  getDb: mocks.getDb,
  closeDb: mocks.closeDb,
  NeuralBrain: class {
    getByTag = mocks.getByTag;
    getContradictionTasks = mocks.getContradictionTasks;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.git.mockReturnValue('/work/neuralCore/.git\n');
  mocks.getDb.mockReturnValue({ query: { memories: { findMany: mocks.findMany } } });
  mocks.findMany.mockResolvedValue([hit]);
  mocks.versionNotice.mockResolvedValue('');
});

afterEach(() => vi.restoreAllMocks());

function queriedScope() {
  const { where } = mocks.findMany.mock.calls[0]![0];
  return where({ namespace: 'namespace', archivedAt: 'archivedAt' }, { sql: String.raw });
}

describe('buildRecallQuery', () => {
  it('combines the project basename with the current branch', () => {
    expect(buildRecallQuery('/work/neuralCore/', ' feature/memory\n'))
      .toBe('neuralCore feature/memory');
  });

  it('uses just the directory name when git has no branch', () => {
    expect(buildRecallQuery('/work/neuralCore')).toBe('neuralCore');
  });
});

describe('runSessionStart', () => {
  const env = { ENGRAM_DB_PATH: '/tmp/engram-hook-test/memory.db' };

  it('derives the main repository namespace from a linked worktree payload.cwd', async () => {
    await runSessionStart('{"cwd":"/work/feature-worktree/nested"}', env, vi.fn());
    expect(mocks.git).toHaveBeenCalledWith('git', [
      '-C', '/work/feature-worktree/nested', 'rev-parse', '--path-format=absolute', '--git-common-dir',
    ], expect.objectContaining({ timeout: 500 }));
    expect(queriedScope()).toBe('namespace = /work/neuralCore AND archivedAt IS NULL');
  });

  it('falls back to the git top level when old git echoes an unsupported --path-format', async () => {
    mocks.git.mockImplementation((_command: string, args: readonly string[]) =>
      args.includes('--path-format=absolute') ? '--path-format=absolute\n.git\n' : '/work/neuralCore\n');
    await runSessionStart('{"cwd":"/work/neuralCore/nested"}', env, vi.fn());
    expect(mocks.git).toHaveBeenCalledWith('git', [
      '-C', '/work/neuralCore/nested', 'rev-parse', '--show-toplevel',
    ], expect.any(Object));
    expect(queriedScope()).toBe('namespace = /work/neuralCore AND archivedAt IS NULL');
  });

  it('emits up to three ranked memory lines and appends the version notice', async () => {
    const write = vi.fn();
    mocks.findMany.mockResolvedValue([
      { ...hit, id: '44444444-abcd', content: 'Fourth decision.', score: 0.5 },
      hit,
      { ...hit, id: '22222222-abcd', importance: 0.3, tags: '["handover"]', summary: 'Next steps.' },
      { ...hit, id: '33333333-abcd', importance: 0.1, tags: '["pinned"]', score: 0.5, content: 'x'.repeat(801) },
    ]);
    mocks.versionNotice.mockResolvedValue('Update available.');
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env, write)).toBe(0);
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [
        '[33333333 · 2026-11-21 · mcp-client] ' + 'x'.repeat(800),
        '[22222222 · 2026-11-21 · mcp-client] Next steps.',
        decisionLine, '', 'Update available.',
      ].join('\n') },
    });
    expect(queriedScope()).toBe('namespace = /work/neuralCore AND archivedAt IS NULL');
    expect(mocks.closeDb).toHaveBeenCalledOnce();
  });

  it('reuses tilde expansion and isolated namespace settings', async () => {
    await runSessionStart('{}', {
      ENGRAM_DB_PATH: '~/hook-test/memory.db', ENGRAM_SOURCE: 'claude-code',
      ENGRAM_NAMESPACE_MODE: 'isolated', ENGRAM_NAMESPACE: 'work',
    }, vi.fn());
    expect(mocks.getDb).toHaveBeenCalledWith(path.join(os.homedir(), 'hook-test/memory.db'));
    expect(queriedScope()).toBe('namespace = work AND archivedAt IS NULL');
    expect(mocks.git).not.toHaveBeenCalled();
  });

  it('still recalls project memory when git fails', async () => {
    mocks.git.mockImplementation(() => { throw new Error('not a repository'); });
    await runSessionStart('{"cwd":"/work/neuralCore"}', env, vi.fn());
    expect(queriedScope()).toBe('namespace = /work/neuralCore AND archivedAt IS NULL');
  });

  it('skips search outside git at a filesystem root or the home directory', async () => {
    mocks.git.mockImplementation(() => { throw new Error('not a repository'); });
    const write = vi.fn();
    for (const cwd of [path.parse(process.cwd()).root, os.homedir()]) {
      expect(await runSessionStart(JSON.stringify({ cwd }), env, write)).toBe(0);
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('skips search when namespace mode is none even with an explicit namespace', async () => {
    const write = vi.fn();
    await runSessionStart('{}', { ...env, ENGRAM_NAMESPACE_MODE: 'none', ENGRAM_NAMESPACE: 'work' }, write);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['getDb', 'findMany', 'closeDb'] as const)('is silent and exits zero when %s throws', async (method) => {
    mocks[method].mockImplementation(() => { throw new Error('brain failed'); });
    const stdout = vi.spyOn(process.stdout, 'write');
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env)).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(mocks.closeDb).toHaveBeenCalledOnce();
  });

  it('keeps the recalled context without counting pending sessions', async () => {
    mocks.getByTag.mockImplementation(() => { throw new Error('brain failed'); });
    const write = vi.fn();
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env, write)).toBe(0);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toContain('Past project decisions.');
    expect(write.mock.calls[0]![0]).not.toContain('get_distill_tasks');
    expect(mocks.getByTag).not.toHaveBeenCalled();
  });

  it('keeps recalled context without counting contradiction candidates', async () => {
    mocks.getContradictionTasks.mockRejectedValue(new Error('read failed'));
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    expect(JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext)
      .toBe(decisionLine);
    expect(mocks.getContradictionTasks).not.toHaveBeenCalled();
  });

  it.each([0, 2, 100])('omits reminders for %s pending contradictions and pending distillation', async (count) => {
    mocks.getByTag.mockResolvedValue([{ namespace: 'work' }]);
    mocks.getContradictionTasks.mockResolvedValue(Array.from({ length: count }, () => ({})));
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    const output = JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext as string;
    expect(output).toBe(decisionLine);
    expect(output).not.toContain('get_distill_tasks');
    expect(mocks.getContradictionTasks).not.toHaveBeenCalled();
    expect(output).not.toContain('get_contradiction_tasks');
  });

  it('is silent and exits zero when the DB directory cannot be created', async () => {
    mocks.mkdir.mockImplementation(() => { throw new Error('invalid DB path'); });
    const write = vi.fn();
    expect(await runSessionStart('{}', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('ignores malformed hook input without opening the brain', async () => {
    const write = vi.fn();
    expect(await runSessionStart('not JSON', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('does not inject an empty search result', async () => {
    mocks.findMany.mockResolvedValue([]);
    const write = vi.fn();
    expect(await runSessionStart('{}', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, true])('omits distillation reminders with or without a search hit: hit=%s', async (hasHit) => {
    mocks.findMany.mockResolvedValue(hasHit ? [hit] : []);
    mocks.getByTag.mockResolvedValue([{ namespace: 'work' }, { namespace: null }]);
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    if (hasHit) {
      const output = JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext as string;
      expect(output).toBe(decisionLine);
    } else {
      expect(write).not.toHaveBeenCalled();
    }
    expect(mocks.getByTag).not.toHaveBeenCalled();
  });

  it('adds no reminder when pending sessions are outside the caller scope', async () => {
    mocks.getByTag.mockResolvedValue([{ namespace: 'other' }]);
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    expect(JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext)
      .toBe(decisionLine);
    expect(queriedScope()).toBe('namespace = /work/neuralCore AND archivedAt IS NULL');
    expect(mocks.getByTag).not.toHaveBeenCalled();
  });

  it('keeps pins regardless of similarity and filters routine notes, transcripts and other clients’ episodes', async () => {
    mocks.findMany.mockResolvedValue([
      { ...hit, id: '11111111-abcd', content: 'User: old prompt', summary: 'Decision.' },
      { ...hit, id: '22222222-abcd', type: 'procedural', summary: 'Assistant: old reply' },
      { ...hit, id: '33333333-abcd', type: 'episodic', content: 'Other client episode.' },
      { ...hit, id: '44444444-abcd', importance: 0.79, content: 'Routine note.' },
      { ...hit, id: '55555555-abcd', tags: '["pinned"]', score: 0.61, content: 'Below the gate.' },
      { ...hit, type: 'episodic', source: 'claude-code' },
    ]);
    const write = vi.fn();
    await runSessionStart('{}', { ...env, ENGRAM_RECALL_MIN_SIM: '0.62', ENGRAM_SOURCE: 'claude-code' }, write);
    expect(JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext)
      .toBe('[55555555 · 2026-11-21 · mcp-client] Below the gate.\n[12345678 · 2026-11-21 · claude-code] Past project decisions.');
  });
});
