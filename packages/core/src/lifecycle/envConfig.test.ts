import { expect, it } from 'vitest';
import { readDedupThreshold } from './envConfig.ts';

it.each([undefined, '', '   '])('defaults the dedup threshold when unset: %s', (value) => {
  expect(readDedupThreshold({ ENGRAM_DEDUP_THRESHOLD: value })).toBe(0.97);
});

it.each(['0', '-0.1', '1.01', 'NaN', 'Infinity', '0.97junk'])('rejects invalid dedup threshold %s', (value) => {
  expect(() => readDedupThreshold({ ENGRAM_DEDUP_THRESHOLD: value })).toThrow('ENGRAM_DEDUP_THRESHOLD');
});

it.each(['0.01', '0.97', '1'])('accepts dedup threshold %s', (value) => {
  expect(readDedupThreshold({ ENGRAM_DEDUP_THRESHOLD: value })).toBe(Number(value));
});
