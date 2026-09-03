import { describe, it, expect } from 'vitest';

import { installFailureHints } from '../installFailure.js';

// The Node version from the real Windows report that prompted this hint block:
// Node 24 is ABI 137, which better-sqlite3 11.x had no win32-x64 prebuild for.
const REPORTED_NODE = 'v24.19.0';

describe('installFailureHints', () => {
  it('names both causes and nothing else — a longer block buries the install output above it', () => {
    expect(installFailureHints(REPORTED_NODE)).toHaveLength(2);
  });

  it('gives every hint a cause and a way out, so no line is a dead end', () => {
    for (const hint of installFailureHints(REPORTED_NODE)) {
      expect(hint.cause.trim().length).toBeGreaterThan(0);
      expect(hint.fix.trim().length).toBeGreaterThan(0);
    }
  });

  // ─── Cause 1: no prebuilt native binary for the running Node ───────────────

  it('quotes the running Node version back, which is the fact the user needs and cannot see', () => {
    const [nativeBinary] = installFailureHints(REPORTED_NODE);
    expect(nativeBinary.cause).toContain(REPORTED_NODE);
  });

  it('names better-sqlite3, the only dependency that compiles', () => {
    const [nativeBinary] = installFailureHints(REPORTED_NODE);
    expect(nativeBinary.cause).toContain('better-sqlite3');
  });

  it('points at Node 22 LTS, the version with a prebuilt binary everywhere', () => {
    const [nativeBinary] = installFailureHints(REPORTED_NODE);
    expect(nativeBinary.fix).toContain('Node 22');
  });

  it('reads process.version when the caller does not pass one', () => {
    const [nativeBinary] = installFailureHints();
    expect(nativeBinary.cause).toContain(process.version);
  });

  it('interpolates whatever version it is handed rather than a hardcoded one', () => {
    const [nativeBinary] = installFailureHints('v18.20.0');
    expect(nativeBinary.cause).toContain('v18.20.0');
    expect(nativeBinary.cause).not.toContain(REPORTED_NODE);
  });

  // ─── Cause 2: a file locked by a running Engram process (Windows) ──────────

  it('tells the user to stop Engram, which is what frees the locked file', () => {
    const [, lockedFile] = installFailureHints(REPORTED_NODE);
    expect(lockedFile.fix).toContain('engram stop');
  });

  it('names EPERM, the string the user can actually match against their output', () => {
    const [, lockedFile] = installFailureHints(REPORTED_NODE);
    expect(lockedFile.cause).toContain('EPERM');
  });

  it('marks the locked-file case as the Windows one, so other platforms can skip it', () => {
    const [, lockedFile] = installFailureHints(REPORTED_NODE);
    expect(lockedFile.cause).toContain('Windows');
  });

  // ─── Purity ───────────────────────────────────────────────────────────────

  it('builds fresh hints per call — a caller mutating the result must not poison the next one', () => {
    const first = installFailureHints(REPORTED_NODE);
    const second = installFailureHints(REPORTED_NODE);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
