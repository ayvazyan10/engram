/**
 * What the CLI says when something goes wrong.
 *
 * These messages are the whole value of the failure paths: an auth rejection
 * from a credential helper reads as a network outage unless it is spelled out,
 * a refused config file must never look like a written one, and a partial
 * install must not end on a success banner. Assertions here are on the parts a
 * user acts on — the cause and the fix — not on decoration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reportFetchFailure,
  reportSyncFailure,
  reportGlobalInstallFailure,
  reportInstallFailure,
  reportConfigRefusal,
  reportBackup,
} from '../reporters.js';
import { ConfigParseError } from '../claudeSetup.js';

/** ANSI colour codes, stripped before asserting on wording. */
// eslint-disable-next-line no-control-regex -- matching the escapes ui.ts emits
const ANSI = /\u001b\[[0-9;]*m/g;

let printed: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  printed = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
});
afterEach(() => logSpy.mockRestore());

/** Everything printed, with the ANSI colours stripped. */
const output = (): string => printed.join('\n').replace(ANSI, '');

describe('reportFetchFailure', () => {
  it('names a credential helper as the cause of an auth failure on a public repo', () => {
    reportFetchFailure('auth', '/home/tester/.engram/repo');
    expect(output()).toMatch(/public repository/);
    expect(output()).toMatch(/credential/);
    expect(output()).toMatch(/git credential reject/);
  });

  it('tells the user how to start over when the remote is gone', () => {
    reportFetchFailure('not-found', '/home/tester/.engram/repo');
    expect(output()).toMatch(/does not exist/);
    expect(output()).toContain('/home/tester/.engram/repo');
    expect(output()).toMatch(/engram setup/);
  });

  it('says plainly that the network is the problem when it is', () => {
    reportFetchFailure('network', '/repo');
    expect(output()).toMatch(/Check your connection/);
    expect(output()).not.toMatch(/credential/);
  });

  it('still says something for a failure it has no special wording for', () => {
    reportFetchFailure('unknown' as never, '/repo');
    expect(output()).toMatch(/Could not fetch/);
  });
});

describe('reportSyncFailure', () => {
  it('names the files that blocked an update and offers --force', () => {
    reportSyncFailure(
      { status: 'blocked', failure: 'untracked-collision', blocked: ['apps/web/index.html'], detail: 'error: untracked' },
      '/repo',
    );
    expect(output()).toContain('apps/web/index.html');
    expect(output()).toContain('error: untracked');
    expect(output()).toMatch(/engram update --force/);
  });

  it('distinguishes local edits from a diverged checkout', () => {
    reportSyncFailure({ status: 'blocked', failure: 'local-changes', blocked: ['README.md'], detail: '' }, '/repo');
    expect(output()).toMatch(/local edits/);

    printed = [];
    reportSyncFailure({ status: 'blocked', failure: 'diverged', blocked: [], detail: '' }, '/repo');
    expect(output()).toMatch(/commits that are not upstream/);
  });

  it('explains a missing upstream with the command that sets one', () => {
    reportSyncFailure({ status: 'no-upstream' }, '/repo');
    expect(output()).toMatch(/--set-upstream-to=origin\/master/);
  });

  it('delegates a failed fetch to the fetch wording', () => {
    reportSyncFailure({ status: 'fetch-failed', failure: 'network' }, '/repo');
    expect(output()).toMatch(/Check your connection/);
  });

  it('says nothing about failure for a result that did not fail', () => {
    reportSyncFailure({ status: 'up-to-date' }, '/repo');
    expect(output()).toBe('');
  });
});

describe('reportGlobalInstallFailure', () => {
  it('shows npm\'s own diagnosis and a fix aimed at the prefix in use', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: Buffer.from('npm error code EACCES\nnpm error path /usr/lib/node_modules'),
    });
    reportGlobalInstallFailure(err, '/usr/lib', 'install');
    expect(output()).toMatch(/EACCES/);
    expect(output()).toMatch(/Fix:/);
  });
});

describe('reportInstallFailure', () => {
  it('offers the known causes of a failed dependency install', () => {
    reportInstallFailure();
    expect(output()).toMatch(/Install failed/);
    expect(output()).toMatch(/Fix:/);
  });
});

describe('reportConfigRefusal', () => {
  it('records an unparsable config as skipped and refuses to overwrite it', () => {
    const skipped: string[] = [];
    reportConfigRefusal(new ConfigParseError('/home/tester/.claude.json', 'Unexpected end of JSON input'), 'MCP registration', skipped);

    expect(output()).toMatch(/will not overwrite/);
    expect(output()).toContain('/home/tester/.claude.json');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('/home/tester/.claude.json');
  });

  it('records any other failure as skipped too, so the banner cannot claim success', () => {
    const skipped: string[] = [];
    reportConfigRefusal(new Error('EACCES: permission denied'), 'Claude Code hooks', skipped);
    expect(skipped).toEqual(['Claude Code hooks — EACCES: permission denied']);
  });

  it('handles a thrown non-Error without losing the message', () => {
    const skipped: string[] = [];
    reportConfigRefusal('disk full', 'MCP registration', skipped);
    expect(skipped[0]).toContain('disk full');
  });
});

describe('reportBackup', () => {
  it('says where the rescue copy went', () => {
    reportBackup('/home/tester/.claude.json.20260101T000000Z.bak');
    expect(output()).toContain('.bak');
  });

  it('says nothing when there was no file to back up', () => {
    reportBackup(null);
    expect(output()).toBe('');
  });
});
