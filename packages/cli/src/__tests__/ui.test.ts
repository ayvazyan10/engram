/**
 * The CLI's output vocabulary. Small, but every other module's messages go
 * through it — a `fail` that printed like an `ok` would make every failure
 * path in this package read as a success.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ok, fail, step, warn, detail, G, R, X } from '../ui.js';

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

describe('result markers', () => {
  it('marks success and failure differently', () => {
    ok('stored');
    fail('stored');
    expect(printed[0]).toBe(`${G}  ✓${X} stored`);
    expect(printed[1]).toBe(`${R}  ✗${X} stored`);
    expect(printed[0]).not.toBe(printed[1]);
  });

  it('marks a step and a warning', () => {
    step('cloning');
    warn('careful');
    const plain = printed.map((line) => line.replace(ANSI, ''));
    expect(plain[0]).toBe('  → cloning');
    expect(plain[1]).toBe('  ! careful');
  });
});

describe('detail', () => {
  it('indents every supporting line', () => {
    detail(['first', 'second']);
    expect(printed).toHaveLength(2);
    for (const line of printed) expect(line).toMatch(/^ {2}/);
    expect(printed.join('\n')).toContain('first');
    expect(printed.join('\n')).toContain('second');
  });

  it('prints nothing for nothing', () => {
    detail([]);
    expect(printed).toEqual([]);
  });
});
