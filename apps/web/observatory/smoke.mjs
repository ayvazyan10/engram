/**
 * Headless smoke test. Chromium hangs on this box, so this is the substitute
 * for looking at the screen: it mounts the page in jsdom against the REAL API
 * on 4901, lets the effects run, and prints what came out.
 *
 * It proves the wiring, not the picture — it cannot tell you whether a
 * visualization looks right. Use it to confirm your slot mounts, receives a
 * non-zero box, and reads the store, before asking anyone to look at 4912.
 *
 *   cd apps/web && node observatory/smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:4912/',
  pretendToBeVisual: true,
});
const w = dom.window;

const define = (key, value) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    /* a few of these are getter-only on newer Node; the app does not use those */
  }
};

define('window', w);
define('document', w.document);
for (const key of [
  'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event',
  'KeyboardEvent', 'MouseEvent', 'location', 'history', 'SVGElement', 'DOMRect',
]) define(key, w[key]);
define('getComputedStyle', w.getComputedStyle.bind(w));
define('requestAnimationFrame', w.requestAnimationFrame.bind(w));
define('cancelAnimationFrame', w.cancelAnimationFrame.bind(w));
define('addEventListener', w.addEventListener.bind(w));
define('removeEventListener', w.removeEventListener.bind(w));
define('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
define('ResizeObserver', class {
  constructor(callback) { this.callback = callback; }
  observe() { this.callback([{ contentRect: { width: 1200, height: 760 } }]); }
  disconnect() {}
});

// `data.ts` fetches relative URLs, which the dev server proxies. jsdom has no
// proxy, so point them at the API directly.
const nativeFetch = globalThis.fetch;
define('fetch', (url, init) =>
  nativeFetch(typeof url === 'string' && url.startsWith('/') ? `http://127.0.0.1:4901${url}` : url, init));

const server = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
});

let failed = false;
try {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await server.ssrLoadModule('/App.tsx');

  createRoot(document.getElementById('root')).render(React.createElement(App));
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const root = document.getElementById('root');
  const text = root.textContent.replace(/\s+/g, ' ').trim();

  console.log('\nSWITCH');
  for (const button of root.querySelectorAll('.obs-switch-item')) {
    console.log(`  ${button.getAttribute('aria-pressed') === 'true' ? '*' : ' '} ${button.textContent.trim()}`);
  }
  console.log('\nSTAMP');
  for (const cell of root.querySelectorAll('.obs-cell')) {
    const [label, value, note] = [...cell.children].map((n) => n.textContent.trim());
    console.log(`  ${label.padEnd(18)} ${String(value).padEnd(8)} ${note ?? ''}`);
  }
  console.log('\nCLAIM\n  ' + (root.querySelector('.obs-claim')?.textContent.trim() ?? '(none)'));
  console.log('\nPLATE\n  ' + (root.querySelector('.obs-plate')?.textContent.replace(/\s+/g, ' ').trim() ?? '(empty)'));

  if (/did not answer|Reading the store/.test(text)) {
    console.log('\nFAIL: the page never got past its loading or error state.');
    failed = true;
  }
} catch (cause) {
  console.error('\nFAIL:', cause);
  failed = true;
} finally {
  await server.close();
  process.exit(failed ? 1 : 0);
}
