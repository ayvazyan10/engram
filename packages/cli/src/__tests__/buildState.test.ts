/**
 * Whether the checkout on disk has actually been built.
 *
 * `engram update` returned early on git state alone: if the fetch found nothing
 * new it printed "Already up to date." and exited 0 — even when the previous
 * run had fast-forwarded the repository and then died in `pnpm install`, so
 * apps/server/dist was missing or built from the commit before. `engram start`
 * then ran the old server, or failed with "Server not found", and nothing said
 * that a rebuild was what was missing.
 *
 * The build stamp is what makes "up to date" answerable: it records the
 * revision a COMPLETED build was made from, so an interrupted update leaves the
 * old revision behind and the next run can tell.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildArtifactPaths, buildStatus, parseBuildStamp, serializeBuildStamp } from '../buildState.js';

const REPO = '/home/tester/.engram/repo';
const STAMP = '/home/tester/.engram/build.json';
const HEAD = 'a1b2c3d';

/** An `exists` probe over a fixed set of present paths. */
function existsIn(present: readonly string[]): (p: string) => boolean {
  return (p) => present.includes(p);
}

const allArtifacts = buildArtifactPaths(REPO).map((a) => a.path);

function readerFor(contents: Record<string, string>): (p: string) => string {
  return (p) => {
    const value = contents[p];
    if (value === undefined) {
      const err = new Error(`ENOENT: no such file, open '${p}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return value;
  };
}

describe('buildArtifactPaths', () => {
  it('names the entry points the CLI itself runs', () => {
    const paths = buildArtifactPaths(REPO).map((a) => a.path);
    expect(paths).toContain(path.join(REPO, 'apps', 'server', 'dist', 'index.js'));
    expect(paths).toContain(path.join(REPO, 'packages', 'mcp', 'dist', 'server.js'));
    expect(paths).toContain(path.join(REPO, 'packages', 'cli', 'dist', 'cli.js'));
  });
});

describe('buildStatus', () => {
  it('is current when every artifact exists and the stamp names this revision', () => {
    const status = buildStatus({
      repoPath: REPO,
      stampPath: STAMP,
      headRev: HEAD,
      exists: existsIn([...allArtifacts, STAMP]),
      readFile: readerFor({ [STAMP]: serializeBuildStamp(HEAD, new Date('2026-01-01T00:00:00Z')) }),
    });
    expect(status.current).toBe(true);
    expect(status.reasons).toEqual([]);
  });

  it('is not current when an artifact is missing, and names it', () => {
    const missing = path.join(REPO, 'apps', 'server', 'dist', 'index.js');
    const status = buildStatus({
      repoPath: REPO,
      stampPath: STAMP,
      headRev: HEAD,
      exists: existsIn([...allArtifacts.filter((p) => p !== missing), STAMP]),
      readFile: readerFor({ [STAMP]: serializeBuildStamp(HEAD, new Date()) }),
    });
    expect(status.current).toBe(false);
    expect(status.reasons.join('\n')).toContain(missing);
  });

  /**
   * The reported sequence: run one fast-forwards to a new commit and dies in
   * `pnpm install`; run two sees git up to date. The artifacts from the OLD
   * build are all still there — only the stamp can tell the two apart.
   */
  it('is not current when the last completed build was a different revision', () => {
    const status = buildStatus({
      repoPath: REPO,
      stampPath: STAMP,
      headRev: HEAD,
      exists: existsIn([...allArtifacts, STAMP]),
      readFile: readerFor({ [STAMP]: serializeBuildStamp('0000fff', new Date()) }),
    });
    expect(status.current).toBe(false);
    expect(status.reasons.join('\n')).toMatch(/0000fff/);
    expect(status.reasons.join('\n')).toMatch(new RegExp(HEAD));
  });

  it('is not current when no completed build was ever recorded', () => {
    const status = buildStatus({
      repoPath: REPO,
      stampPath: STAMP,
      headRev: HEAD,
      exists: existsIn(allArtifacts),
      readFile: readerFor({}),
    });
    expect(status.current).toBe(false);
    expect(status.reasons.join('\n')).toMatch(/no completed build/i);
  });

  it('is not current when the stamp cannot be parsed', () => {
    const status = buildStatus({
      repoPath: REPO,
      stampPath: STAMP,
      headRev: HEAD,
      exists: existsIn([...allArtifacts, STAMP]),
      readFile: readerFor({ [STAMP]: '{ not json' }),
    });
    expect(status.current).toBe(false);
    expect(status.reasons.join('\n')).toMatch(/no completed build|could not be read/i);
  });

  /**
   * When git cannot say what HEAD is there is nothing to compare against —
   * the artifacts are all we have, and claiming a mismatch would send every
   * user into a needless rebuild.
   */
  it('trusts the artifacts when the revision is unknown', () => {
    const status = buildStatus({
      repoPath: REPO,
      stampPath: STAMP,
      headRev: null,
      exists: existsIn([...allArtifacts, STAMP]),
      readFile: readerFor({ [STAMP]: serializeBuildStamp('0000fff', new Date()) }),
    });
    expect(status.current).toBe(true);
  });
});

describe('build stamp round trip', () => {
  it('records the revision and when the build finished', () => {
    const now = new Date('2026-03-04T05:06:07.000Z');
    const stamp = parseBuildStamp(serializeBuildStamp(HEAD, now));
    expect(stamp).toEqual({ rev: HEAD, builtAt: '2026-03-04T05:06:07.000Z' });
  });

  it('reads a stamp with no revision as no stamp at all', () => {
    expect(parseBuildStamp('{}')).toBeNull();
    expect(parseBuildStamp('null')).toBeNull();
    expect(parseBuildStamp('[]')).toBeNull();
    expect(parseBuildStamp('not json')).toBeNull();
  });
});
