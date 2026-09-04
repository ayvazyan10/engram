/**
 * The proxy's configuration reader.
 *
 * Two shapes are pinned here because both shipped:
 *
 *   ENGRAM_PROXY_HOST=""     read with `??`, so the empty string a templating
 *     host produces for an untouched optional field beat the loopback default
 *     and `listen(port, '')` bound every interface — an unauthenticated
 *     endpoint onto the user's GPU and memory store, on the LAN.
 *
 *   ENGRAM_MAX_BODY_BYTES=10mb  `parseInt` gives NaN, and `size > NaN` is false
 *     for every size, so the body cap did not change — it vanished, while the
 *     startup banner went on printing a limit.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EnvConfigError,
  readEnvString,
  readEnvNumber,
  readEnvNumberOr,
  readProxyConfig,
  DEFAULT_LISTEN_HOST,
  DEFAULT_MAX_BODY_BYTES,
} from '../env.js';

describe('readEnvString', () => {
  it('treats absent, empty and whitespace-only alike as unset', () => {
    expect(readEnvString({}, 'X')).toBeUndefined();
    expect(readEnvString({ X: '' }, 'X')).toBeUndefined();
    expect(readEnvString({ X: '  ' }, 'X')).toBeUndefined();
  });

  it('returns a configured value unchanged', () => {
    expect(readEnvString({ X: '0.0.0.0' }, 'X')).toBe('0.0.0.0');
  });
});

describe('readEnvNumber', () => {
  it('falls back only when the variable is blank', () => {
    expect(readEnvNumber({}, 'N', 7)).toBe(7);
    expect(readEnvNumber({ N: '' }, 'N', 7)).toBe(7);
    expect(readEnvNumber({ N: '9' }, 'N', 7)).toBe(9);
  });

  it('refuses what parseInt would have salvaged', () => {
    expect(() => readEnvNumber({ N: '10mb' }, 'N', 7)).toThrow(/N must be a whole number/);
    expect(() => readEnvNumber({ N: 'lots' }, 'N', 7)).toThrow(EnvConfigError);
    expect(() => readEnvNumber({ N: '1.5' }, 'N', 7)).toThrow(/whole number/);
  });

  it('enforces bounds', () => {
    expect(() => readEnvNumber({ N: '-1' }, 'N', 7, { min: 0 })).toThrow(/at least 0/);
    expect(() => readEnvNumber({ N: '70000' }, 'N', 7, { max: 65535 })).toThrow(/at most 65535/);
  });
});

describe('readEnvNumberOr', () => {
  it('warns and uses the default instead of yielding NaN', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({ N: 'soon' }, 'N', 1500, {}, warn)).toBe(1500);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('N must be a whole number'));
  });

  it('stays silent for an unset or valid variable', () => {
    const warn = vi.fn();
    expect(readEnvNumberOr({}, 'N', 1500, {}, warn)).toBe(1500);
    expect(readEnvNumberOr({ N: '10' }, 'N', 1500, { min: 1 }, warn)).toBe(10);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('readProxyConfig', () => {
  it('binds loopback when nothing is configured', () => {
    expect(readProxyConfig({}).listenHost).toBe(DEFAULT_LISTEN_HOST);
  });

  it('binds loopback for a blank ENGRAM_PROXY_HOST — the templated-empty case', () => {
    // `'' ?? '127.0.0.1'` kept the empty string, and listen(port, '') binds
    // every interface. This is the whole defect.
    expect(readProxyConfig({ ENGRAM_PROXY_HOST: '' }).listenHost).toBe(DEFAULT_LISTEN_HOST);
    expect(readProxyConfig({ ENGRAM_PROXY_HOST: '   ' }).listenHost).toBe(DEFAULT_LISTEN_HOST);
  });

  it('still honours a deliberate wide bind', () => {
    expect(readProxyConfig({ ENGRAM_PROXY_HOST: '0.0.0.0' }).listenHost).toBe('0.0.0.0');
  });

  it('keeps the body cap when nothing is configured', () => {
    expect(readProxyConfig({}).maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it('refuses a malformed body cap rather than removing the cap', () => {
    expect(() => readProxyConfig({ ENGRAM_MAX_BODY_BYTES: '10mb' })).toThrow(
      /ENGRAM_MAX_BODY_BYTES must be a whole number/
    );
    expect(() => readProxyConfig({ ENGRAM_MAX_BODY_BYTES: '0' })).toThrow(/at least 1/);
  });

  it('refuses a port that is not a port', () => {
    expect(() => readProxyConfig({ OLLAMA_PROXY_PORT: 'eleven' })).toThrow(/OLLAMA_PROXY_PORT/);
    expect(() => readProxyConfig({ OLLAMA_PROXY_PORT: '99999' })).toThrow(/at most 65535/);
  });

  it('falls back with a warning for the tuning knobs, which are not controls', () => {
    const warn = vi.fn();
    const config = readProxyConfig(
      { ENGRAM_MAX_TOKENS: 'plenty', ENGRAM_UPSTREAM_TIMEOUT_MS: 'ages' },
      warn
    );
    expect(config.maxTokens).toBe(1500);
    expect(config.upstreamTimeoutMs).toBe(300_000);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('treats blank targets as unset rather than as empty URLs', () => {
    const config = readProxyConfig({ OLLAMA_TARGET: '', ENGRAM_API: '  ' });
    expect(config.ollamaTarget).toBe('http://localhost:11434');
    expect(config.engramApi).toBe('http://localhost:4901');
  });

  it('leaves tool retry on unless it is switched off explicitly', () => {
    expect(readProxyConfig({}).toolRetry).toBe(true);
    expect(readProxyConfig({ ENGRAM_TOOL_RETRY: '' }).toolRetry).toBe(true);
    expect(readProxyConfig({ ENGRAM_TOOL_RETRY: 'false' }).toolRetry).toBe(false);
  });
});
