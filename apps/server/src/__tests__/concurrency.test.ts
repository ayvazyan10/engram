/**
 * The bounded fan-out used by POST /api/memory/batch.
 *
 * The handler used to hand all 1000 permitted items to `Promise.all` at once,
 * so a single request opened up to 1000 concurrent embedder calls. The array
 * bound caps how much work a request may ask for; this caps how much of it
 * runs at the same time.
 */

import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../lib/concurrency.js';

describe('mapWithConcurrency', () => {
  it('never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n % 3));
      inFlight--;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('returns results in input order, not completion order', async () => {
    // Deliberately inverted delays: the last item finishes first.
    const out = await mapWithConcurrency([30, 20, 10, 0], 4, async (delay, i) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return i;
    });

    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('propagates a failure', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });

  it('rejects a limit below 1', async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(RangeError);
  });
});
