import { expect, it } from 'vitest';
import { ContradictionDetector } from './ContradictionDetector.ts';

it('reports bare numeric value changes as contradiction signals', () => {
  const detector = new ContradictionDetector();
  expect(detector.analyzeContradiction('The service uses port 4902.', 'The service uses port 4901'))
    .toContainEqual(expect.objectContaining({ type: 'value_change' }));
});

it('does not flag matching numeric values or different statements', () => {
  const detector = new ContradictionDetector();
  expect(detector.analyzeContradiction('The service uses port 4901.', 'The service uses port 4901')).toEqual([]);
  expect(detector.analyzeContradiction('The service uses port 4901', 'The client retries 3 times')).toEqual([]);
});
