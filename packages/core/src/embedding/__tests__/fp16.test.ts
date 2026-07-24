/**
 * Regression tests for the FP16 embedding codec.
 *
 * The subnormal branch of float32ToFloat16 dropped the implicit leading
 * mantissa bit, so every component landing in the FP16 subnormal range
 * (~2^-24 .. 2^-14) was silently corrupted on persisted vectors — 2^-15
 * round-tripped to exactly 0.
 */

import { describe, it, expect } from 'vitest';
import { packFP16, unpackFP16 } from '../Embedder.js';

function roundTrip(values: number[]): Float32Array {
  return unpackFP16(packFP16(Float32Array.from(values)));
}

describe('FP16 codec', () => {
  it('round-trips subnormal-range values instead of flushing them to zero', () => {
    const value = Math.pow(2, -15); // 3.0517578125e-05, an FP16 subnormal
    const [out] = roundTrip([value]);

    expect(out).not.toBe(0);
    expect(Math.abs(out! - value) / value).toBeLessThan(0.05);
  });

  it('keeps small values accurate across the subnormal range', () => {
    const values = [6e-5, 3e-5, 1e-5, 5e-6, 1e-6];
    const out = roundTrip(values);

    values.forEach((expected, i) => {
      const actual = out[i]!;
      expect(actual, `value ${expected}`).not.toBe(0);
      // FP16 subnormals are coarse; allow generous relative error but require
      // the magnitude to survive.
      expect(Math.abs(actual - expected) / expected, `value ${expected}`).toBeLessThan(0.2);
    });
  });

  it('preserves sign for negative subnormals', () => {
    const [out] = roundTrip([-Math.pow(2, -15)]);
    expect(out).toBeLessThan(0);
  });

  it('round-trips normal-range values accurately', () => {
    const values = [1, -1, 0.5, 0.25, -0.75, 0.1234];
    const out = roundTrip(values);
    values.forEach((expected, i) => {
      expect(Math.abs(out[i]! - expected)).toBeLessThan(0.001);
    });
  });

  it('round-trips zero exactly (signed zero is preserved)', () => {
    const out = roundTrip([0, -0]);
    expect(Math.abs(out[0]!)).toBe(0);
    expect(Math.abs(out[1]!)).toBe(0);
  });

  it('handles a realistic normalized embedding without zeroing components', () => {
    // L2-normalized vectors routinely contain very small components.
    const raw = Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 1e-5 : 0.2));
    const out = roundTrip(raw);
    const zeroed = raw.filter((v, i) => v !== 0 && out[i] === 0);
    expect(zeroed).toHaveLength(0);
  });
});
