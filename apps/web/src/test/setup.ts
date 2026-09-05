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

/**
 * jsdom implements no ResizeObserver, and the plate box is measured with one
 * (components/plates/PlateSurface.tsx) — every plate is handed a width and a
 * height in CSS pixels and lays itself out against those, so the measurement
 * is not decoration that a test can skip.
 *
 * This stand-in reports the zero box jsdom actually has, which is the right
 * answer here: PlateSurface renders the plate only once the box is non-zero,
 * so a test asserting what AppLayout PASSES does not also have to boot five
 * visualizations, two of which want WebGL. A test that needs a real size
 * overrides the entry it observes.
 */
class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = TestResizeObserver;
}
