/**
 * The webhook dispatch ceiling must not remove itself when misconfigured.
 *
 * `parseInt(process.env['ENGRAM_WEBHOOK_MAX_CONCURRENCY'] ?? '32', 10)` with
 * nothing reading the result means `ENGRAM_WEBHOOK_MAX_CONCURRENCY=many` is
 * `NaN` — and `this.inFlight >= NaN` is false for every value of `inFlight`,
 * so `fire()` never refuses. The bound that exists to stop one batch-store from
 * stacking hundreds of detached deliveries (each holding a socket, a payload
 * and up to ~30s of retries) disappeared precisely when someone had tried to
 * configure it.
 *
 * Unlike the body-size cap this is a tuning knob, not a security control: the
 * safe answer to a malformed value is the documented default, announced on
 * stderr, rather than a core module that throws on import and takes every
 * consumer down with it.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveMaxConcurrentDispatch } from '../WebhookManager.js';

describe('resolveMaxConcurrentDispatch', () => {
  it('defaults to 32 when unset', () => {
    expect(resolveMaxConcurrentDispatch({})).toBe(32);
  });

  it('treats a blank value as unset', () => {
    expect(resolveMaxConcurrentDispatch({ ENGRAM_WEBHOOK_MAX_CONCURRENCY: '' })).toBe(32);
  });

  it('honours a configured ceiling', () => {
    expect(resolveMaxConcurrentDispatch({ ENGRAM_WEBHOOK_MAX_CONCURRENCY: '4' })).toBe(4);
  });

  it('never yields NaN, which would compare false against every inFlight count', () => {
    const warn = vi.fn();
    const limit = resolveMaxConcurrentDispatch({ ENGRAM_WEBHOOK_MAX_CONCURRENCY: 'many' }, warn);

    expect(Number.isFinite(limit)).toBe(true);
    expect(limit).toBe(32);
    // The comparison `fire()` makes, on the value it would have had.
    expect(0 >= limit).toBe(false);
    expect(limit >= limit).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ENGRAM_WEBHOOK_MAX_CONCURRENCY must be a number')
    );
  });

  it('refuses a ceiling of zero or less — that is not a bound, it is a stall', () => {
    const warn = vi.fn();
    expect(resolveMaxConcurrentDispatch({ ENGRAM_WEBHOOK_MAX_CONCURRENCY: '0' }, warn)).toBe(32);
    expect(resolveMaxConcurrentDispatch({ ENGRAM_WEBHOOK_MAX_CONCURRENCY: '-1' }, warn)).toBe(32);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the value is usable', () => {
    const warn = vi.fn();
    resolveMaxConcurrentDispatch({ ENGRAM_WEBHOOK_MAX_CONCURRENCY: '8' }, warn);
    resolveMaxConcurrentDispatch({}, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
