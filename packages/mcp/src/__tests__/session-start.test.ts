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
    canAccessNamespace = mocks.canAccessNamespace;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.git.mockImplementation((_command: string, args: readonly string[]) =>
    args.includes('--show-toplevel') ? '/work/neuralCore\n' : 'feature/memory\n');
  mocks.initialize.mockResolvedValue(undefined);
  mocks.recall.mockResolvedValue({ context: 'Past project decisions.' });
  mocks.getByTag.mockResolvedValue([]);
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

  it('derives the project namespace from payload.cwd', async () => {
    await runSessionStart('{"cwd":"/work/neuralCore/nested"}', env, vi.fn());
    expect(mocks.git).toHaveBeenCalledWith('git', [
      '-C', '/work/neuralCore/nested', 'rev-parse', '--show-toplevel',
    ], expect.objectContaining({ timeout: 500 }));
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({
      namespaceMode: 'filter', namespace: '/work/neuralCore',
    }));
  });

  it('emits the SessionStart context envelope capped at 6000 characters', async () => {
    const write = vi.fn();
    mocks.recall.mockResolvedValue({ context: 'x'.repeat(7000) });
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env, write)).toBe(0);
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x'.repeat(6000) },
    });
    expect(mocks.recall).toHaveBeenCalledWith('neuralCore feature/memory', {
      maxTokens: 1500, source: 'mcp-client',
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

  it.each(['initialize', 'recall', 'shutdown'] as const)('is silent and exits zero when %s throws', async (method) => {
    mocks[method].mockImplementation(() => { throw new Error('brain failed'); });
    const stdout = vi.spyOn(process.stdout, 'write');
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env)).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });

  it('keeps the recalled context when counting pending sessions fails', async () => {
    mocks.getByTag.mockImplementation(() => { throw new Error('brain failed'); });
    const write = vi.fn();
    expect(await runSessionStart('{"cwd":"/work/neuralCore"}', env, write)).toBe(0);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toContain('Past project decisions.');
    expect(write.mock.calls[0]![0]).not.toContain('get_distill_tasks');
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
    mocks.recall.mockResolvedValue({ context: '' });
    const write = vi.fn();
    expect(await runSessionStart('{}', env, write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(7000)])('adds one bounded reminder even with empty or full recall', async (context) => {
    mocks.recall.mockResolvedValue({ context });
    mocks.getByTag.mockResolvedValue([{ namespace: 'work' }, { namespace: null }]);
    const write = vi.fn();
    await runSessionStart('{}', env, write);
    const output = JSON.parse(write.mock.calls[0]![0] as string).hookSpecificOutput.additionalContext as string;
    expect(output.length).toBeLessThanOrEqual(6000);
    expect(output.split('\n').filter((line) => line.includes('get_distill_tasks'))).toEqual([
      '2 past sessions are waiting to be distilled — call get_distill_tasks when convenient.',
    ]);
    expect(mocks.getByTag).toHaveBeenCalledWith('pending-distill', Number.MAX_SAFE_INTEGER);
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
