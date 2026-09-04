/**
 * Regression test for VectorSearch.search topK bounds.
 *
 * `scores.slice(0, topK)` reads a negative topK as an offset from the end, so
 * asking for -1 results returned EVERY hit except the single worst one. The
 * REST route caps topK from above but not from below, so the value is reachable.
 */

import { describe, it, expect } from 'vitest';
import { VectorSearch } from '../VectorSearch.js';

function unit(values: number[]): Float32Array {
  return Float32Array.from(values);
}

function makeIndex(): VectorSearch {
  const index = new VectorSearch(3);
  index.load([
    { id: 'a', vector: unit([1, 0, 0]), type: 'semantic' },
    { id: 'b', vector: unit([0.9, 0.1, 0]), type: 'semantic' },
    { id: 'c', vector: unit([0.8, 0.2, 0]), type: 'semantic' },
  ]);
  return index;
}

describe('VectorSearch.search topK', () => {
  const query = unit([1, 0, 0]);

  it('returns nothing for a negative topK', () => {
    expect(makeIndex().search(query, -1)).toEqual([]);
  });

  it('returns nothing for a zero topK', () => {
    expect(makeIndex().search(query, 0)).toEqual([]);
  });

  it('returns nothing for a non-finite topK', () => {
    expect(makeIndex().search(query, Number.NaN)).toEqual([]);
    expect(makeIndex().search(query, -Infinity)).toEqual([]);
  });

  it('still honours a positive topK', () => {
    expect(makeIndex().search(query, 2)).toHaveLength(2);
    expect(makeIndex().search(query, 99)).toHaveLength(3);
  });
});
