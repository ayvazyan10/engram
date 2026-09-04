/**
 * The three decisions this repo kept re-making per call site, pinned once.
 *
 * Every case here is a shape that shipped as a defect somewhere: an empty
 * string beating `??`, `parseInt` handing `NaN` to something that compares
 * against it, and a string cast into an enum it is not a member of.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EnvConfigError,
  readEnvString,
  requireConfiguredEnv,
  readEnvNumber,
  readEnvNumberOr,
  readEnvEnum,
} from '../envConfig.js';

describe('readEnvString', () => {
  it('treats absent, empty and whitespace-only alike as unset', () => {
    expect(readEnvString({}, 'X')).toBeUndefined();
    expect(readEnvString({ X: '' }, 'X')).toBeUndefined();
    expect(readEnvString({ X: '   \t ' }, 'X')).toBeUndefined();
  });

  it('returns a configured value byte-for-byte, surrounding space included', () => {
    expect(readEnvString({ X: ' pass phrase ' }, 'X')).toBe(' pass phrase ');
  });
});

describe('requireConfiguredEnv', () => {
  const guidance = 'Unset it to disable.';

  it('returns undefined when the variable is absent', () => {
    expect(requireConfiguredEnv({}, 'SECRET', guidance)).toBeUndefined();
  });

  it('refuses a set-but-empty value rather than reading it as unset', () => {
    expect(() => requireConfiguredEnv({ SECRET: '' }, 'SECRET', guidance)).toThrow(EnvConfigError);
    expect(() => requireConfiguredEnv({ SECRET: '  ' }, 'SECRET', guidance)).toThrow(
      /SECRET is set but empty\. Unset it to disable\./
    );
  });

  it('passes a real value through untouched', () => {
    expect(requireConfiguredEnv({ SECRET: ' key ' }, 'SECRET', guidance)).toBe(' key ');
  });
});

describe('readEnvNumber', () => {
  it('is undefined for a blank variable', () => {
    expect(readEnvNumber({}, 'N')).toBeUndefined();
    expect(readEnvNumber({ N: '' }, 'N')).toBeUndefined();
  });

  it('parses a whole number', () => {
    expect(readEnvNumber({ N: ' 42 ' }, 'N')).toBe(42);
  });

  it('rejects what parseInt would have salvaged', () => {
    // parseInt('10abc') is 10 and parseInt('soon') is NaN; both used to reach
    // the caller unchallenged.
    expect(() => readEnvNumber({ N: '10abc' }, 'N')).toThrow(/must be a number, got "10abc"/);
    expect(() => readEnvNumber({ N: 'abc' }, 'N')).toThrow(/must be a number/);
    expect(() => readEnvNumber({ N: 'Infinity' }, 'N')).toThrow(/must be a number/);
  });

  it('rejects a fraction unless the spec allows one', () => {
    expect(() => readEnvNumber({ N: '1.5' }, 'N')).toThrow(/must be a whole number/);
    expect(readEnvNumber({ N: '1.5' }, 'N', { integer: false })).toBe(1.5);
  });

  it('enforces bounds', () => {
    expect(() => readEnvNumber({ N: '0' }, 'N', { min: 1 })).toThrow(/must be at least 1, got 0/);
    expect(() => readEnvNumber({ N: '99' }, 'N', { max: 10 })).toThrow(/must be at most 10, got 99/);
    expect(readEnvNumber({ N: '5' }, 'N', { min: 1, max: 10 })).toBe(5);
  });

  it('names the variable on the error so the operator knows what to fix', () => {
    try {
      readEnvNumber({ ENGRAM_SYNC_INTERVAL: 'abc' }, 'ENGRAM_SYNC_INTERVAL');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvConfigError);
      expect((err as EnvConfigError).variable).toBe('ENGRAM_SYNC_INTERVAL');
    }
  });

  it('truncates an absurdly long value in the message', () => {
    expect(() => readEnvNumber({ N: 'x'.repeat(200) }, 'N')).toThrow(/…/);
  });
});

describe('readEnvNumberOr', () => {
  it('uses the fallback when unset, without warning', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({}, 'N', 16, {}, warn)).toBe(16);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and falls back on a malformed value instead of yielding NaN', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({ N: 'abc' }, 'N', 16, {}, warn)).toBe(16);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('N must be a number'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the default (16)'));
  });

  it('warns and falls back on an out-of-range value', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({ N: '-4' }, 'N', 16, { min: 1 }, warn)).toBe(16);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('must be at least 1'));
  });

  it('supports a non-numeric fallback for "leave it to the engine"', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({ N: 'nope' }, 'N', undefined, {}, warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the built-in default'));
  });

  it('accepts a valid value', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({ N: '7' }, 'N', 16, { min: 1 }, warn)).toBe(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns on stderr by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readEnvNumberOr({ N: 'abc' }, 'N', 3)).toBe(3);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('readEnvEnum', () => {
  const modes = ['auto', 'manual', 'off'] as const;

  it('is undefined for a blank variable, so the caller keeps its default', () => {
    expect(readEnvEnum({ M: '' }, 'M', modes)).toBeUndefined();
    expect(readEnvEnum({}, 'M', modes)).toBeUndefined();
  });

  it('accepts a member', () => {
    expect(readEnvEnum({ M: 'manual' }, 'M', modes)).toBe('manual');
  });

  it('refuses an unrecognised value instead of casting it', () => {
    expect(() => readEnvEnum({ M: 'Auto' }, 'M', modes)).toThrow(
      /M must be one of: auto, manual, off — got "Auto"/
    );
    expect(() => readEnvEnum({ M: 'offf' }, 'M', modes)).toThrow(EnvConfigError);
  });
});
