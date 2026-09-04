/**
 * Runtime-entered API key storage (F2).
 *
 * There is deliberately no build-time env var for this. Vite inlines
 * `import.meta.env.VITE_*` as a literal string in the shipped JS — for most
 * secrets that's fine because the page itself is access-controlled, but here
 * the key IS what controls page access, and it's a single shared credential
 * for the whole memory store with no per-session rotation. A key baked into
 * `dist/assets/*.js` is a full compromise the moment that bundle is
 * downloadable, which is exactly what happens once the server correctly
 * serves the dashboard's static assets without requiring the key (see
 * apps/server/src/index.ts's onRequest hook).
 *
 * Instead the key is entered at runtime by the user (via UnlockGate) and
 * held in sessionStorage: private to this tab, never touches build output,
 * and gone when the tab closes.
 */

const STORAGE_KEY = 'engram_api_key';

/** Read the stored key, if any. Guarded — sessionStorage can throw (private
 *  browsing in some browsers, storage disabled by policy). */
export function getStoredApiKey(): string | undefined {
  try {
    const key = sessionStorage.getItem(STORAGE_KEY);
    return key && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

export function setStoredApiKey(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Storage unavailable — the next request simply 401s again and the
    // unlock gate stays up. Nothing more to do here.
  }
}

export function clearStoredApiKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
