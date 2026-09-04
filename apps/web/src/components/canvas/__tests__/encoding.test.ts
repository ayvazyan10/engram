/**
 * The encoding is what makes the picture readable, so the rules are asserted
 * against the distribution they were designed for. The live store's importance
 * is 55% one value (0.825) spread over 0.33-1.0; its access counts are 60%
 * zero with a maximum of 433; its ages run 0-166 days.
 */

import { describe, it, expect } from 'vitest';
import {
  BRIGHTNESS_UNENCODED,
  DIMMED_FACTOR,
  IMPORTANCE_BANDS,
  MIN_BRIGHTNESS,
  haloScale,
  importanceRadius,
  recencyBrightness,
  tint,
} from '../encoding.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-04T00:00:00.000Z');
/** The server's real policy — GET /api/decay/policy returns 7, not the 30 this
 *  module used to hardcode. */
const HALF_LIFE = 7;

describe('importanceRadius', () => {
  it('separates the live distribution into visibly different sizes', () => {
    // The old encoding was 0.5 + importance * 1.5: 0.33 -> 1.0 and 1.0 -> 2.0,
    // a 2x span over a distribution that is mostly one value. These four are
    // 3.6x apart end to end and land on distinct steps.
    const radii = [0.33, 0.75, 0.825, 0.95].map(importanceRadius);
    expect(new Set(radii).size).toBe(4);
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(3);
  });

  it('is a step function with fixed thresholds — a node cannot resize because another memory was written', () => {
    expect(importanceRadius(0.8199)).toBe(importanceRadius(0.7));
    expect(importanceRadius(0.82)).toBe(importanceRadius(0.899));
    expect(importanceRadius(0.9)).toBe(IMPORTANCE_BANDS[0]!.radius);
  });

  it('handles the ends of the scale', () => {
    expect(importanceRadius(0)).toBeGreaterThan(0);
    expect(importanceRadius(1)).toBe(IMPORTANCE_BANDS[0]!.radius);
    expect(importanceRadius(-1)).toBeGreaterThan(0);
  });
});

describe('recencyBrightness', () => {
  it('halves the distance to the floor every half-life, on whatever half-life it is given', () => {
    const fresh = recencyBrightness(NOW, NOW, HALF_LIFE);
    const oneLife = recencyBrightness(NOW - HALF_LIFE * DAY, NOW, HALF_LIFE);
    const twoLives = recencyBrightness(NOW - 2 * HALF_LIFE * DAY, NOW, HALF_LIFE);
    expect(fresh).toBeCloseTo(1, 5);
    expect(oneLife - MIN_BRIGHTNESS).toBeCloseTo((fresh - MIN_BRIGHTNESS) / 2, 5);
    expect(twoLives - MIN_BRIGHTNESS).toBeCloseTo((fresh - MIN_BRIGHTNESS) / 4, 5);
  });

  it('never reaches zero, so an old memory dims but keeps its hue', () => {
    expect(recencyBrightness(NOW - 3650 * DAY, NOW, HALF_LIFE)).toBeGreaterThan(0.4);
  });

  it('survives a missing or unparseable timestamp', () => {
    expect(recencyBrightness(NaN, NOW, HALF_LIFE)).toBeGreaterThan(0);
    expect(Number.isFinite(recencyBrightness(NOW + DAY, NOW, HALF_LIFE))).toBe(true);
  });

  // F3: the module used to hardcode 30 while the server's policy was 7, and the
  // scene key printed "30-day half-life" as the definition of the channel. A
  // month-old memory therefore drew at 0.71 — reading as "still fresh" — while
  // the server put its strength at 2^(-30/7) = 0.051, on the archive threshold.
  it('a 30-day-old memory now draws near the floor, as the server\'s policy says it should', () => {
    const onServerPolicy = recencyBrightness(NOW - 30 * DAY, NOW, HALF_LIFE);
    expect(onServerPolicy).toBeLessThan(0.46);
    // What the hardcoded 30 used to draw for exactly the same memory.
    expect(recencyBrightness(NOW - 30 * DAY, NOW, 30)).toBeGreaterThan(0.7);
  });

  it('turns the channel OFF rather than inventing a half-life when the policy is unavailable', () => {
    expect(recencyBrightness(NOW - 400 * DAY, NOW, null)).toBe(BRIGHTNESS_UNENCODED);
    expect(recencyBrightness(NOW, NOW, null)).toBe(BRIGHTNESS_UNENCODED);
    // A nonsense policy is no policy — it must not silently become one.
    expect(recencyBrightness(NOW - 400 * DAY, NOW, 0)).toBe(BRIGHTNESS_UNENCODED);
    expect(recencyBrightness(NOW - 400 * DAY, NOW, Number.NaN)).toBe(BRIGHTNESS_UNENCODED);
  });
});

describe('haloScale', () => {
  it('grows with retrieval count and saturates instead of running away', () => {
    expect(haloScale(0)).toBeLessThan(haloScale(5));
    expect(haloScale(5)).toBeLessThan(haloScale(60));
    expect(haloScale(100)).toBeCloseTo(haloScale(433), 5);
    expect(haloScale(433)).toBeLessThan(3.5);
  });

  it('treats a missing or negative count as never recalled', () => {
    expect(haloScale(-4)).toBe(haloScale(0));
  });
});

describe('tint', () => {
  it('scales a colour without shifting its hue', () => {
    const full = tint(0x22d3ee, 1);
    const half = tint(0x22d3ee, 0.5);
    expect(half.r / full.r).toBeCloseTo(0.5, 6);
    expect(half.g / full.g).toBeCloseTo(0.5, 6);
    expect(half.b / full.b).toBeCloseTo(0.5, 6);
  });

  it('maps a full-brightness channel to 1', () => {
    expect(tint(0xffffff, 1)).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('knocks search-excluded nodes well back without hiding them', () => {
    expect(DIMMED_FACTOR).toBeGreaterThan(0);
    expect(DIMMED_FACTOR).toBeLessThan(0.25);
  });
});
