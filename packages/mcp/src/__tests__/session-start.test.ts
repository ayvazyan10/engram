import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { buildRecallQuery, runSessionStart } from '../session-start.ts';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  recall: vi.fn(),
  shutdown: vi.fn(),
  construct: vi.fn(),
  mkdir: vi.fn(),
  git: vi.fn(),
  getByTag: vi.fn(),
  getContradictionTasks: vi.fn(),
  canAccessNamespace: vi.fn(),
}));

vi.mock('node:fs', () => ({ mkdirSync: mocks.mkdir }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.git }));
vi.mock('@engram-ai-memory/core', async (importOriginal) => ({
  resolveDbPath: (await importOriginal<typeof import('@engram-ai-memory/core')>()).resolveDbPath,
  NeuralBrain: class {
    constructor(config: unknown) { mocks.construct(config); }
    initialize = mocks.initialize;
    recall = mocks.recall;
    shutdown = mocks.shutdown;
    getByTag = mocks.getByTag;
    getContradictionTasks = mocks.getContradictionTasks;
    canAccessNamespace = mocks.canAccessNamespace;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.git.mockImplementation((_command: string, args: readonly string[]) =>
    args.includes('--git-common-dir') ? '/work/neuralCore/.git\n'
      : args.includes('--show-toplevel') ? '/work/neuralCore\n' : 'feature/memory\n');
  mocks.initialize.mockResolvedValue(undefined);
  mocks.recall.mockResolvedValue({ context: 'Past project decisions.', memories: [{}] });
  mocks.getByTag.mockResolvedValue([]);
  mocks.getContradictionTasks.mockResolvedValue([]);
  mocks.canAccessNamespace.mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

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
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({
      namespaceMode: 'filter', namespace: '/work/neuralCore',
    }));
  });

  it('falls back to the git top level when old git echoes an unsupported --path-format', async () => {
    mocks.git.mockImplementation((_command: string, args: readonly string[]) =>
      args.includes('--path-format=absolute') ? '--path-format=absolute\n.git\n' : '/work/neuralCore\n');
    await runSessionStart('{"cwd":"/work/neuralCore/nested"}', env, vi.fn());
    expect(mocks.git).toHaveBeenCalledWith('git', [
      '-C', '/work/neuralCore/nested', 'rev-parse', '--show-toplevel',
    ], expect.any(Object));
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({ namespace: '/work/neuralCore' }));
  });

  it('emits the SessionStart context envelope without character truncation', async () => {
    const write = vi.fn();
    mocks.recall.mockResolvedValue({ context: 'x'.repeat(7000), memories: [{}] });
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env, write)).toBe(0);
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x'.repeat(7000) },
    });
    expect(mocks.recall).toHaveBeenCalledWith('neuralCore feature/memory', {
      threshold: 0.35, graphDepth: 0, maxTokens: 600, touch: false,
    });
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });

  it('reuses tilde expansion and isolated namespace settings', async () => {
    await runSessionStart('{}', {
      ENGRAM_DB_PATH: '~/hook-test/memory.db', ENGRAM_SOURCE: 'claude-code',
      ENGRAM_NAMESPACE_MODE: 'isolated', ENGRAM_NAMESPACE: 'work',
    }, vi.fn());
    expect(mocks.construct).toHaveBeenCalledWith({
      dbPath: path.join(os.homedir(), 'hook-test/memory.db'),
      defaultSource: 'claude-code', namespaceMode: 'isolated', namespace: 'work',
    });
    expect(mocks.git).toHaveBeenCalledWith('git', [
      '-C', process.cwd(), 'rev-parse', '--abbrev-ref', 'HEAD',
    ], expect.objectContaining({ timeout: 500 }));
  });

  it('still recalls project memory when git fails', async () => {
    mocks.git.mockImplementation(() => { throw new Error('not a repository'); });
    await runSessionStart('{"cwd":"/work/neuralCore"}', env, vi.fn());
    expect(mocks.recall).toHaveBeenCalledWith('neuralCore', expect.any(Object));
  });

  it('uses only global memories outside git at a filesystem root or the home directory', async () => {
    mocks.git.mockImplementation(() => { throw new Error('not a repository'); });
    for (const cwd of [path.parse(process.cwd()).root, os.homedir()]) {
      await runSessionStart(JSON.stringify({ cwd }), env, vi.fn());
      expect(mocks.construct).toHaveBeenLastCalledWith(expect.objectContaining({ namespaceMode: 'filter' }));
      expect(mocks.construct.mock.lastCall?.[0]).not.toHaveProperty('namespace');
    }
  });

  it.each(['initialize', 'recall', 'shutdown'] as const)('is silent and exits zero when %s throws', async (method) => {
    mocks[method].mockImplementation(() => { throw new Error('brain failed'); });
    const stdout = vi.spyOn(process.stdout, 'write');
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env)).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
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
      .toBe('Past project decisions.');
    expect(mocks.getContradictionTasks).not.toHaveBeenCalled();
  });

  it.each([0, 2, 100])('omits reminders for %s pending contradictions and pending distillation', async (count) => {
    mocks.recall.mockResolvedValue({ context: 'x'.repeat(7000), memories: [{}] });
    mocks.getByTag.mockResolvedValue([{ namespace: 'work' }]);
    mocks.getContradictionTasks.mockResolvedValue(Array.from({ length: count }, () => ({})));
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    const output = JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext as string;
    expect(output).toBe('x'.repeat(7000));
    expect(output).not.toContain('get_distill_tasks');
    expect(mocks.getContradictionTasks).not.toHaveBeenCalled();
    expect(output).not.toContain('get_contradiction_tasks');
  });

  it('is silent and exits zero when the DB directory cannot be created', async () => {
    mocks.mkdir.mockImplementation(() => { throw new Error('invalid DB path'); });
    const write = vi.fn();
    expect(await runSessionStart('{}', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it('ignores malformed hook input without opening the brain', async () => {
    const write = vi.fn();
    expect(await runSessionStart('not JSON', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it('does not inject an empty recall result', async () => {
    mocks.recall.mockResolvedValue({ context: '', memories: [] });
    const write = vi.fn();
    expect(await runSessionStart('{}', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(7000)])('omits distillation reminders with empty or full recall', async (context) => {
    mocks.recall.mockResolvedValue({ context, memories: context ? [{}] : [] });
    mocks.getByTag.mockResolvedValue([{ namespace: 'work' }, { namespace: null }]);
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    if (context) {
      const output = JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext as string;
      expect(output).toBe(context);
    } else {
      expect(write).not.toHaveBeenCalled();
    }
    expect(mocks.getByTag).not.toHaveBeenCalled();
  });

  it('adds no reminder when pending sessions are outside the caller scope', async () => {
    mocks.getByTag.mockResolvedValue([{ namespace: 'other' }]);
    mocks.canAccessNamespace.mockReturnValue(false);
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    expect(JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext)
      .toBe('Past project decisions.');
  });
});
