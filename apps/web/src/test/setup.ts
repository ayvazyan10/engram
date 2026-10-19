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
 * jsdom implements no ResizeObserver. Report the zero box it actually has
 * for map and chart measurements; tests that need a real size override it.
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

// jsdom does not lay out, so it has no scrollIntoView; cmdk keeps the
// highlighted command in view with it.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
