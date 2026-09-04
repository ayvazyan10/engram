import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// `test.globals` is off (matching the rest of the repo's vitest configs), so
// Testing Library's auto-cleanup — which detects a global `afterEach` — never
// registers itself. Do it explicitly instead, or DOM from one test's render()
// leaks into the next.
afterEach(() => {
  cleanup();
});
