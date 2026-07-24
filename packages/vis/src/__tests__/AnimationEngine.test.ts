/**
 * Regression tests for AnimationEngine timer lifecycle.
 *
 * - ensureRunning guarded on frameTimer, which tick() only assigns at its END
 *   (after firing listeners), so a listener calling trigger() re-entered tick()
 *   recursively and each unwind spawned another setTimeout chain — stop()
 *   cancelled one and the rest kept emitting forever.
 * - triggerWave never tracked its timers, so a pending wave restarted the loop
 *   after stop().
 * - decayRate <= 0 produced a non-terminating loop / unbounded activation.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnimationEngine } from '../AnimationEngine.js';

const engines: AnimationEngine[] = [];
function makeEngine(decayRate?: number): AnimationEngine {
  const engine = new AnimationEngine(decayRate);
  engines.push(engine);
  return engine;
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
  vi.useRealTimers();
});

describe('AnimationEngine constructor', () => {
  it('rejects a non-positive decay rate', () => {
    expect(() => new AnimationEngine(0)).toThrow(/positive/i);
    expect(() => new AnimationEngine(-0.1)).toThrow(/positive/i);
    expect(() => new AnimationEngine(Number.NaN)).toThrow(/positive/i);
  });

  it('accepts a valid decay rate', () => {
    expect(() => new AnimationEngine(0.05)).not.toThrow();
  });
});

describe('re-entrant trigger', () => {
  it('does not spawn parallel timer chains when a listener re-triggers', async () => {
    vi.useFakeTimers();
    const engine = makeEngine(0.2);

    // Simulates "activation propagates to neighbours": the listener re-enters
    // trigger() DURING the tick (which is what spawned an extra chain) and
    // keeps the loop alive, so any orphaned chain is still running at stop().
    engine.onActivation(() => {
      engine.trigger('b', 1);
    });

    engine.trigger('a', 1);
    await vi.advanceTimersByTimeAsync(200);

    engine.stop();

    // stop() clears the single live timer. With the bug it cleared only the
    // last handle and the orphaned chain kept emitting.
    let eventsAfterStop = 0;
    engine.onActivation(() => { eventsAfterStop++; });
    await vi.advanceTimersByTimeAsync(500);

    expect(eventsAfterStop).toBe(0);
  });
});

describe('stop()', () => {
  it('cancels pending triggerWave timers so the loop cannot resurrect', async () => {
    vi.useFakeTimers();
    const engine = makeEngine(0.2);

    let events = 0;
    engine.onActivation(() => { events++; });

    engine.triggerWave(['a', 'b', 'c', 'd'], 1, 50);
    // Stop before the later wave steps fire.
    engine.stop();

    await vi.advanceTimersByTimeAsync(1000);

    expect(events).toBe(0);
  });

  it('is idempotent', () => {
    const engine = makeEngine(0.1);
    engine.trigger('a', 1);
    expect(() => { engine.stop(); engine.stop(); }).not.toThrow();
  });
});

describe('activation values', () => {
  it('never emits an activation above 1', async () => {
    vi.useFakeTimers();
    const engine = makeEngine(0.1);

    const seen: number[] = [];
    engine.onActivation((events) => { events.forEach((e) => seen.push(e.activation)); });

    // Repeated triggers must not accumulate past the documented ceiling.
    engine.trigger('a', 1);
    engine.trigger('a', 1);
    engine.trigger('a', 1);

    await vi.advanceTimersByTimeAsync(100);

    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it('drains activations to zero and stops on its own', async () => {
    vi.useFakeTimers();
    const engine = makeEngine(0.25);

    engine.trigger('a', 1);
    await vi.advanceTimersByTimeAsync(500);

    expect(engine.getActivation('a')).toBe(0);
  });
});
